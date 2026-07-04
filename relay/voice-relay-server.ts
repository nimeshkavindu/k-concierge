import type { IncomingMessage } from "node:http";
import { createServer as createHttpsServer, type ServerOptions } from "node:https";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import { addProductToCart, calculateCartSubtotal } from "../src/lib/cart";
import {
  GeminiFlashClient,
  type GeminiFlashInteraction,
  type GeminiFlashTool,
} from "../src/lib/gemini-flash-client";
import { KaprukaMCPClient } from "../src/lib/mcp-client";
import {
  ClientMessageSchema,
  MAX_VOICE_UTTERANCE_BASE64_LENGTH,
  MAX_VOICE_UTTERANCE_DURATION_MS,
  type ClientMessage,
  type RelayServerMessage,
} from "../src/lib/voice-contracts";
import { verifyVoiceSessionToken } from "../src/lib/voice-token";
import {
  assertPaymentUrl,
  type CartItem,
  type CheckoutDetails,
  CreateOrderPayloadSchema,
  type DeliveryCheck,
  normalizeDeliveryResult,
  normalizeProducts,
  normalizeQuantity,
  type Product,
} from "../src/lib/validation";

const SearchArgsSchema = z.object({
  query: z.string().trim().min(3),
});

const AddToCartArgsSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.unknown().optional(),
});

const DeliveryArgsSchema = z.object({
  city: z.string().trim().min(2),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_LIVE_SESSION_MAX_MS = 180_000;
const LIVE_IDLE_TIMEOUT_MS = 45_000;
const LIVE_SETUP_TIMEOUT_MS = 15_000;
const DEFAULT_CLIENT_KEEPALIVE_MS = 25_000;

export type RelayTlsConfig = Pick<ServerOptions, "ca" | "cert" | "key">;

export interface RelayConfig {
  port: number;
  host?: string;
  tls?: RelayTlsConfig;
  tokenSecret: string;
  geminiApiKey: string;
  geminiEndpoint?: string;
  geminiTextEndpoint?: string;
  geminiTextModel?: string;
  geminiAudioModel?: string;
  geminiLiveModel?: string;
  liveEnabled?: boolean;
  voiceUtteranceMaxMs?: number;
  liveSessionMaxMs?: number;
  clientKeepaliveMs?: number;
  mcpEndpoint?: string;
}

interface SessionState {
  products: Product[];
  cart: CartItem[];
  subtotal: number;
  delivery: DeliveryCheck | null;
  checkoutLink: string | null;
  orderCreated: boolean;
}

interface RelaySession {
  state: SessionState;
  mcpClient: KaprukaMCPClient;
  flashClient: GeminiFlashClient;
  audioClient: GeminiFlashClient;
  flashInteractionId: string | null;
  liveSocket: WebSocket | null;
  liveReady: Promise<WebSocket> | null;
  liveCloseExpected: boolean;
  liveSessionTimer: ReturnType<typeof setTimeout> | null;
  liveIdleTimer: ReturnType<typeof setTimeout> | null;
  sentPrematureLiveAudioWarning: boolean;
}

interface ShoppingToolOptions {
  sendProducts?: boolean;
  onProducts?: (products: Product[]) => void;
  fallbackText?: string;
}

interface SearchResult {
  products: Product[];
  query: string;
}

const CONCIERGE_SYSTEM_PROMPT = `
You are the Kapruka AI Shopping Concierge. You are a warm, highly efficient Sri Lankan digital assistant.
- You speak naturally in English, but understand Sinhala and Tanglish perfectly.
- If the user uses Tanglish or Sinhala, reply in a conversational, friendly Sri Lankan English tone, occasionally using localized words like 'Shape', 'Machan', or 'Ayubowan'.
- Do not act like a robotic search engine. Be opinionated and helpful.
- You have two modes: 'Utility' (fast shopping for groceries/electronics) and 'Empathy' (thoughtful recommendations for gifts/flowers).
- Never use markdown or text lists. Keep verbal responses short and punchy.
- You can search products, add products to the cart, and check delivery constraints. The user must click the checkout button before any payment link is generated.
- When adding to cart, use quantity 1 unless the user explicitly asks for another quantity. Never infer quantity from product size, price, model number, or product name.
`;

export function createVoiceRelayServer(config: RelayConfig): WebSocketServer {
  logRelay("server.create", {
    host: config.host,
    port: config.port,
    textModel: config.geminiTextModel,
    audioModel: config.geminiAudioModel,
    liveModel: config.geminiLiveModel ?? DEFAULT_GEMINI_LIVE_MODEL,
    liveEnabled: config.liveEnabled ?? true,
    hasTextEndpointOverride: Boolean(config.geminiTextEndpoint),
    hasLiveEndpointOverride: Boolean(config.geminiEndpoint),
    hasMcpEndpointOverride: Boolean(config.mcpEndpoint),
    tlsEnabled: Boolean(config.tls),
  });
  const httpsServer = config.tls ? createHttpsServer(config.tls) : null;
  const wss = httpsServer
    ? new WebSocketServer({ server: httpsServer })
    : new WebSocketServer({
        host: config.host,
        port: config.port,
      });

  if (httpsServer) {
    const closeWebSocketServer = wss.close.bind(wss);
    wss.close = ((callback?: (err?: Error) => void) => {
      closeWebSocketServer((webSocketError?: Error) => {
        httpsServer.close((serverError?: Error) => {
          callback?.(webSocketError ?? serverError);
        });
      });
    }) as WebSocketServer["close"];
    httpsServer.listen(config.port, config.host);
  }

  wss.on("connection", (client, request) => {
    logRelay("connection.accepted", {
      remoteAddress: request.socket.remoteAddress,
      urlPath: request.url?.split("?")[0],
    });
    handleClientConnection(client, request, config).catch((error) => {
      logRelay("connection.setup_error", { message: errorToMessage(error) });
      sendJson(client, { type: "error", message: toClientError(error) });
      client.close(1011, "Relay setup failed");
    });
  });

  return wss;
}

async function handleClientConnection(
  client: WebSocket,
  request: IncomingMessage,
  config: RelayConfig,
): Promise<void> {
  const clientKeepaliveTimer = startClientKeepalive(client, config);
  const token = extractToken(request);
  if (!token || !verifyVoiceSessionToken(token, config.tokenSecret)) {
    logRelay("connection.invalid_token", { hasToken: Boolean(token) });
    clearInterval(clientKeepaliveTimer);
    client.close(1008, "Invalid voice session");
    return;
  }
  logRelay("connection.token_valid");

  const state: SessionState = {
    products: [],
    cart: [],
    subtotal: 0,
    delivery: null,
    checkoutLink: null,
    orderCreated: false,
  };
  const session: RelaySession = {
    state,
    mcpClient: new KaprukaMCPClient({ endpoint: config.mcpEndpoint }),
    flashClient: new GeminiFlashClient({
      apiKey: config.geminiApiKey,
      endpoint: config.geminiTextEndpoint,
      model: config.geminiTextModel,
    }),
    audioClient: new GeminiFlashClient({
      apiKey: config.geminiApiKey,
      endpoint: config.geminiTextEndpoint,
      model: config.geminiAudioModel ?? config.geminiTextModel,
    }),
    flashInteractionId: null,
    liveSocket: null,
    liveReady: null,
    liveCloseExpected: false,
    liveSessionTimer: null,
    liveIdleTimer: null,
    sentPrematureLiveAudioWarning: false,
  };

  client.on("close", () => {
    clearInterval(clientKeepaliveTimer);
    logRelay("connection.client_closed", {
      hadLiveSocket: Boolean(session.liveSocket),
    });
    if (
      session.liveSocket?.readyState === WebSocket.OPEN ||
      session.liveSocket?.readyState === WebSocket.CONNECTING
    ) {
      closeLiveSession(session, "client_closed");
    }
  });

  client.on("message", (data) => {
    logRelay("client.message.raw", {
      byteLength: rawDataToString(data).length,
    });
    handleClientMessage(data, client, session, config).catch((error) => {
      logRelay("client.message.error", { message: errorToMessage(error) });
      sendJson(client, { type: "error", message: toClientError(error) });
      sendJson(client, { type: "status", status: "IDLE" });
    });
  });

  logRelay("connection.ready");
  sendJson(client, { type: "ready" });
  sendJson(client, { type: "status", status: "IDLE" });
}

function startClientKeepalive(
  client: WebSocket,
  config: RelayConfig,
): ReturnType<typeof setInterval> {
  const intervalMs = config.clientKeepaliveMs ?? DEFAULT_CLIENT_KEEPALIVE_MS;
  const timer = setInterval(() => {
    if (client.readyState !== WebSocket.OPEN) return;

    logRelay("connection.keepalive.ping");
    client.ping();
  }, intervalMs);
  timer.unref?.();
  return timer;
}

async function handleClientMessage(
  data: RawData,
  client: WebSocket,
  session: RelaySession,
  config: RelayConfig,
): Promise<void> {
  const message = ClientMessageSchema.parse(JSON.parse(rawDataToString(data)));
  logRelay("client.message.parsed", summarizeClientMessage(message));

  if (message.type === "voice_utterance") {
    await handleVoiceUtterance(client, session, message, config);
    return;
  }

  if (message.type === "live_start") {
    await startLiveConversation(client, session, config);
    return;
  }

  if (message.type === "live_audio") {
    await sendLiveAudio(client, session, message.data);
    return;
  }

  if (message.type === "live_stop") {
    closeLiveSession(session, "client_stop");
    sendJson(client, { type: "status", status: "IDLE" });
    return;
  }

  if (message.type === "text") {
    await handleTextMessage(client, session, message.text);
    return;
  }

  if (message.type === "add_to_cart") {
    logRelay("cart.client_add.start", {
      productId: message.productId,
      quantity: message.quantity,
    });
    addProductById(session.state, message.productId, message.quantity);
    sendCart(client, session.state);
    logRelay("cart.client_add.success", summarizeCart(session.state));
    return;
  }

  logRelay("checkout.client_create.start", {
    cartCount: session.state.cart.length,
    hasDelivery: Boolean(session.state.delivery),
    orderCreated: session.state.orderCreated,
  });
  await createOrderFromClient(
    client,
    session.state,
    session.mcpClient,
    message.checkout,
  );
}

async function handleVoiceUtterance(
  client: WebSocket,
  session: RelaySession,
  message: Extract<ClientMessage, { type: "voice_utterance" }>,
  config: RelayConfig,
): Promise<void> {
  const maxDurationMs =
    config.voiceUtteranceMaxMs ?? MAX_VOICE_UTTERANCE_DURATION_MS;
  if (message.durationMs > maxDurationMs) {
    throw new Error("Voice recording is too long. Keep it under 30 seconds.");
  }
  if (message.data.length > MAX_VOICE_UTTERANCE_BASE64_LENGTH) {
    throw new Error("Voice recording is too large. Try a shorter request.");
  }

  logRelay("voice_utterance.start", {
    durationMs: message.durationMs,
    mimeType: message.mimeType,
    dataLength: message.data.length,
  });
  sendJson(client, { type: "status", status: "TRANSCRIBING" });

  const transcript = await transcribeVoiceUtterance(
    session.audioClient,
    message.data,
    message.mimeType,
  );
  logRelay("voice_utterance.transcribed", {
    length: transcript.length,
    preview: transcript.slice(0, 80),
  });
  await handleTextMessage(client, session, transcript);
}

async function transcribeVoiceUtterance(
  audioClient: GeminiFlashClient,
  audioBase64: string,
  mimeType: "audio/wav",
): Promise<string> {
  const interaction = await audioClient.createInteraction({
    input: [
      {
        type: "text",
        text:
          "Transcribe this shopping voice request. Return only the user's spoken words. If there is no clear speech, return EMPTY_AUDIO.",
      },
      {
        type: "audio",
        data: audioBase64,
        mime_type: mimeType,
      },
    ],
  });

  const transcript = normalizeTranscript(interaction.outputText);
  if (!transcript) {
    throw new Error("I could not hear a clear voice request. Try speaking again or type it.");
  }
  if (transcript.length > 1000) {
    throw new Error("Voice request is too long. Try a shorter request.");
  }
  return transcript;
}

async function startLiveConversation(
  client: WebSocket,
  session: RelaySession,
  config: RelayConfig,
): Promise<void> {
  await getLiveSocket(client, session, config);
}

async function sendLiveAudio(
  client: WebSocket,
  session: RelaySession,
  data: string,
): Promise<void> {
  if (!session.liveSocket && !session.liveReady) {
    logRelay("live.audio.dropped_before_start", { dataLength: data.length });
    if (!session.sentPrematureLiveAudioWarning) {
      session.sentPrematureLiveAudioWarning = true;
      sendJson(client, {
        type: "error",
        message: "Start Live Conversation before sending live audio.",
      });
    }
    return;
  }
  const liveSocket = session.liveSocket?.readyState === WebSocket.OPEN
    ? session.liveSocket
    : await session.liveReady;
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Live Conversation is not connected.");
  }
  resetLiveIdleTimer(client, session);
  liveSocket.send(
    JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data,
        },
      },
    }),
  );
}

async function getLiveSocket(
  client: WebSocket,
  session: RelaySession,
  config: RelayConfig,
): Promise<WebSocket> {
  if (config.liveEnabled === false) {
    throw new Error("Live Conversation is disabled for this relay.");
  }
  if (session.liveSocket?.readyState === WebSocket.OPEN) {
    logRelay("live.reuse_open_socket");
    sendJson(client, { type: "status", status: "LIVE" });
    return session.liveSocket;
  }

  if (session.liveReady) {
    logRelay("live.await_existing_connection");
    return session.liveReady;
  }

  logRelay("live.connect.start");
  session.sentPrematureLiveAudioWarning = false;
  sendJson(client, { type: "status", status: "LIVE_CONNECTING" });
  const gemini = new WebSocket(buildGeminiUrl(config));
  session.liveSocket = gemini;
  session.liveCloseExpected = false;
  session.liveReady = new Promise((resolve, reject) => {
    let settled = false;
    const setupTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resetLiveState();
      closeLiveSession(session, "setup_timeout");
      reject(new Error("Live Conversation setup timed out."));
    }, LIVE_SETUP_TIMEOUT_MS);

    const resetLiveState = () => {
      clearTimeout(setupTimeout);
      clearLiveTimers(session);
      if (session.liveSocket === gemini) {
        session.liveSocket = null;
        session.liveReady = null;
      }
    };

    gemini.on("open", () => {
      logRelay("live.connect.open");
      gemini.send(JSON.stringify(createGeminiSetupMessage(config)));
      logRelay("live.setup.sent");
    });

    gemini.on("message", (data) => {
      const rawMessage = rawDataToString(data);
      const response = JSON.parse(rawMessage);
      logRelay("live.message.received", { byteLength: rawMessage.length });
      resetLiveIdleTimer(client, session);
      if (asRecord(response)?.setupComplete) {
        logRelay("live.setup.complete");
        if (!settled) {
          settled = true;
          clearTimeout(setupTimeout);
          startLiveTimers(client, session, config);
          sendJson(client, { type: "status", status: "LIVE" });
          resolve(gemini);
        }
      }
      handleGeminiMessage(
        response,
        client,
        gemini,
        session.state,
        session.mcpClient,
      ).catch((error) => {
        logRelay("live.message.error", { message: errorToMessage(error) });
        sendJson(client, { type: "error", message: toClientError(error) });
        sendJson(client, { type: "status", status: "IDLE" });
      });
    });

    gemini.on("close", () => {
      logRelay("live.close", { expected: session.liveCloseExpected });
      const expected = session.liveCloseExpected;
      resetLiveState();
      if (!settled) {
        settled = true;
        reject(new Error("Live Conversation closed before setup completed."));
      }
      if (!expected && client.readyState === WebSocket.OPEN) {
        sendJson(client, {
          type: "error",
          message: "Live Conversation disconnected. Start it again when you need live voice.",
        });
      }
      sendJson(client, { type: "status", status: "IDLE" });
    });

    gemini.on("error", () => {
      logRelay("live.error");
      resetLiveState();
      const error = new Error("Voice service connection failed.");
      sendJson(client, { type: "error", message: error.message });
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });

  return session.liveReady;
}

function startLiveTimers(
  client: WebSocket,
  session: RelaySession,
  config: RelayConfig,
): void {
  clearLiveTimers(session);
  session.liveSessionTimer = setTimeout(() => {
    logRelay("live.session_limit_reached");
    sendJson(client, {
      type: "error",
      message: "Live Conversation reached its time limit. Start a new live session if needed.",
    });
    closeLiveSession(session, "session_limit");
    sendJson(client, { type: "status", status: "IDLE" });
  }, config.liveSessionMaxMs ?? DEFAULT_LIVE_SESSION_MAX_MS);
  resetLiveIdleTimer(client, session);
}

function resetLiveIdleTimer(client: WebSocket, session: RelaySession): void {
  if (session.liveIdleTimer) {
    clearTimeout(session.liveIdleTimer);
  }
  session.liveIdleTimer = setTimeout(() => {
    logRelay("live.idle_timeout");
    sendJson(client, {
      type: "error",
      message: "Live Conversation paused after inactivity.",
    });
    closeLiveSession(session, "idle_timeout");
    sendJson(client, { type: "status", status: "IDLE" });
  }, LIVE_IDLE_TIMEOUT_MS);
}

function clearLiveTimers(session: RelaySession): void {
  if (session.liveSessionTimer) {
    clearTimeout(session.liveSessionTimer);
    session.liveSessionTimer = null;
  }
  if (session.liveIdleTimer) {
    clearTimeout(session.liveIdleTimer);
    session.liveIdleTimer = null;
  }
}

function closeLiveSession(session: RelaySession, reason: string): void {
  logRelay("live.close_requested", { reason });
  session.liveCloseExpected = true;
  clearLiveTimers(session);
  if (
    session.liveSocket?.readyState === WebSocket.OPEN ||
    session.liveSocket?.readyState === WebSocket.CONNECTING
  ) {
    session.liveSocket.close();
  }
  session.liveSocket = null;
  session.liveReady = null;
}

async function handleTextMessage(
  client: WebSocket,
  session: RelaySession,
  text: string,
): Promise<void> {
  logRelay("text.start", { length: text.length, preview: text.slice(0, 80) });
  sendJson(client, { type: "transcript", role: "user", text });
  sendJson(client, { type: "status", status: "THINKING" });
  let latestProducts: Product[] | null = null;

  let interaction: GeminiFlashInteraction;
  try {
    interaction = await session.flashClient.createInteraction({
      input: text,
      previousInteractionId: session.flashInteractionId,
      systemInstruction: CONCIERGE_SYSTEM_PROMPT,
      tools: createGeminiFlashTools(),
    });
  } catch (error) {
    if (isGeminiRateLimitError(error)) {
      await recoverTextTurnFromRateLimit(client, session, text, latestProducts);
      return;
    }
    throw error;
  }
  session.flashInteractionId = interaction.id;
  logRelay("text.flash.initial_response", {
    interactionId: interaction.id,
    outputLength: interaction.outputText.length,
    functionCalls: interaction.functionCalls.map((call) => call.name),
  });

  for (let depth = 0; depth < 4 && interaction.functionCalls.length > 0; depth++) {
    logRelay("text.tool_loop.start", {
      depth,
      functionCalls: interaction.functionCalls.map((call) => call.name),
    });
    const functionResults = [];

    for (const functionCall of interaction.functionCalls) {
      logRelay("text.tool_call.start", {
        name: functionCall.name,
        callId: functionCall.id,
        args: summarizeToolArgs(functionCall.args),
      });
      const result = await executeShoppingTool(
        functionCall.name,
        functionCall.args,
        client,
        session.state,
        session.mcpClient,
        {
          sendProducts: false,
          onProducts: (products) => {
            latestProducts = products;
          },
          fallbackText: text,
        },
      );
      logRelay("text.tool_call.success", {
        name: functionCall.name,
        result: summarizeToolResult(result),
      });
      functionResults.push({
        type: "function_result",
        name: functionCall.name,
        call_id: functionCall.id,
        result: [{ type: "text", text: JSON.stringify(result) }],
      });
    }

    try {
      interaction = await session.flashClient.createInteraction({
        input: functionResults,
        previousInteractionId: interaction.id,
        systemInstruction: CONCIERGE_SYSTEM_PROMPT,
        tools: createGeminiFlashTools(),
      });
    } catch (error) {
      if (isGeminiRateLimitError(error)) {
        await recoverTextTurnFromRateLimit(client, session, text, latestProducts);
        return;
      }
      throw error;
    }
    session.flashInteractionId = interaction.id;
    logRelay("text.flash.followup_response", {
      interactionId: interaction.id,
      outputLength: interaction.outputText.length,
      functionCalls: interaction.functionCalls.map((call) => call.name),
    });
  }

  const responseText =
    interaction.outputText ||
    (session.state.products.length > 0
      ? "I found options and updated your shopping session."
      : "I could not find matching products yet. Try a clearer category like flowers, cake, tea, chocolates, or a specific gift idea.");
  logRelay("text.complete", {
    responseLength: responseText.length,
    cartCount: session.state.cart.length,
    productCount: session.state.products.length,
    hasBufferedProducts: latestProducts !== null,
  });
  if (latestProducts !== null) {
    sendJson(client, { type: "products", products: latestProducts });
  }
  sendJson(client, {
    type: "transcript",
    role: "assistant",
    text: responseText,
  });
  sendJson(client, { type: "status", status: "IDLE" });
}

async function handleGeminiMessage(
  response: unknown,
  client: WebSocket,
  gemini: WebSocket,
  state: SessionState,
  mcpClient: KaprukaMCPClient,
): Promise<void> {
  logRelay("live.message.parsed", {
    topLevelKeys: Object.keys(asRecord(response) ?? {}).slice(0, 8),
  });
  const responseRecord = asRecord(response);
  if (responseRecord?.goAway) {
    logRelay("live.go_away", { goAway: responseRecord.goAway });
  }
  const serverContent = asRecord(response)?.serverContent;
  if (!serverContent || typeof serverContent !== "object") {
    logRelay("live.message.ignored_no_server_content");
    return;
  }

  const serverContentRecord = asRecord(serverContent);
  const inputTranscription = asRecord(serverContentRecord?.inputTranscription);
  if (typeof inputTranscription?.text === "string") {
    logRelay("live.input_transcription", {
      length: inputTranscription.text.length,
    });
    sendJson(client, {
      type: "transcript",
      role: "user",
      text: inputTranscription.text,
    });
  }

  const outputTranscription = asRecord(serverContentRecord?.outputTranscription);
  if (typeof outputTranscription?.text === "string") {
    logRelay("live.output_transcription", {
      length: outputTranscription.text.length,
    });
    sendJson(client, {
      type: "transcript",
      role: "assistant",
      text: outputTranscription.text,
    });
  }

  const modelTurn = serverContentRecord?.modelTurn;
  const parts = asRecord(modelTurn)?.parts;

  if (Array.isArray(parts)) {
    for (const part of parts) {
      const partRecord = asRecord(part);
      if (!partRecord) continue;

      const inlineData = asRecord(partRecord.inlineData);
      if (
        inlineData &&
        typeof inlineData.mimeType === "string" &&
        inlineData.mimeType.startsWith("audio/pcm") &&
        typeof inlineData.data === "string"
      ) {
        sendJson(client, { type: "status", status: "SPEAKING" });
        sendJson(client, { type: "audio", data: inlineData.data });
        logRelay("live.audio.sent_to_client", {
          byteLength: inlineData.data.length,
          mimeType: inlineData.mimeType,
        });
      }

      if (typeof partRecord.text === "string") {
        logRelay("live.text_part", { length: partRecord.text.length });
        sendJson(client, {
          type: "transcript",
          role: "assistant",
          text: partRecord.text,
        });
      }

      const functionCall = asRecord(partRecord.functionCall);
      if (functionCall) {
        logRelay("live.function_call.received", {
          name: functionCall.name,
          id: functionCall.id,
          args: summarizeToolArgs(functionCall.args),
        });
        await handleToolCall(functionCall, client, gemini, state, mcpClient);
      }
    }
  }

  if (serverContentRecord?.turnComplete === true) {
    logRelay("live.turn_complete");
    sendJson(client, { type: "status", status: "LIVE" });
  }
}

async function handleToolCall(
  functionCall: Record<string, unknown>,
  client: WebSocket,
  gemini: WebSocket,
  state: SessionState,
  mcpClient: KaprukaMCPClient,
): Promise<void> {
  const functionId =
    typeof functionCall.id === "string" ? functionCall.id : String(functionCall.name);
  const name = typeof functionCall.name === "string" ? functionCall.name : "";
  const args = functionCall.args ?? {};

  logRelay("live.tool_call.start", {
    name,
    functionId,
    args: summarizeToolArgs(args),
  });
  sendJson(client, { type: "status", status: "THINKING" });

  try {
    const response = await executeShoppingTool(
      name,
      args,
      client,
      state,
      mcpClient,
    );
    sendToolResponse(gemini, functionId, name, response);
    logRelay("live.tool_call.success", {
      name,
      result: summarizeToolResult(response),
    });
  } catch (error) {
    sendToolResponse(gemini, functionId, name, {
      status: "error",
      message: toClientError(error),
    });
    logRelay("live.tool_call.error", {
      name,
      message: errorToMessage(error),
    });
    throw error;
  }
}

async function executeShoppingTool(
  name: string,
  args: unknown,
  client: WebSocket,
  state: SessionState,
  mcpClient: KaprukaMCPClient,
  options: ShoppingToolOptions = {},
): Promise<Record<string, unknown>> {
  if (name === "search_products") {
    const parsedArgs = SearchArgsSchema.parse(args);
    const searchResult = await searchProductsWithFallbacks(
      client,
      mcpClient,
      parsedArgs.query,
      options.fallbackText,
    );
    state.products = searchResult.products;
    logRelay("tool.search.normalized", {
      count: state.products.length,
      query: searchResult.query,
      firstProduct: state.products[0]
        ? {
            id: state.products[0].id,
            name: state.products[0].name,
            priceLKR: state.products[0].priceLKR,
          }
        : null,
    });
    if (options.sendProducts !== false) {
      sendJson(client, { type: "products", products: state.products });
    }
    options.onProducts?.(state.products);

    return {
      status: "success",
      itemsFound: state.products.length,
      query: searchResult.query,
      products: state.products.map((product) => ({
        id: product.id,
        name: product.name,
        priceLKR: product.priceLKR,
      })),
      message: "Products are displayed on the user's screen.",
    };
  }

  if (name === "add_to_cart") {
    const parsedArgs = AddToCartArgsSchema.parse(args);
    const quantity = normalizeQuantity(parsedArgs.quantity);
    if (!quantity) throw new Error("Invalid quantity.");
    logRelay("tool.cart_add.start", {
      productId: parsedArgs.productId,
      quantity,
    });

    const product = addProductById(state, parsedArgs.productId, quantity);
    sendCart(client, state);
    logRelay("tool.cart_add.success", summarizeCart(state));
    return {
      status: "success",
      cart: state.cart.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
      })),
      subtotal: state.subtotal,
      message: `Added ${quantity} of ${product.name} to cart.`,
    };
  }

  if (name === "check_delivery_constraints") {
    const parsedArgs = DeliveryArgsSchema.parse(args);
    logRelay("tool.delivery.start", {
      city: parsedArgs.city,
      date: parsedArgs.date,
      productId: getDeliveryProductId(state),
    });
    const result = await mcpClient.callTool("kapruka_check_delivery", {
      city: parsedArgs.city,
      delivery_date: parsedArgs.date,
      product_id: getDeliveryProductId(state),
      response_format: "json",
    });
    state.delivery = normalizeDeliveryResult(
      result,
      parsedArgs.city,
      parsedArgs.date,
    );
    sendJson(client, { type: "delivery", delivery: state.delivery });
    logRelay("tool.delivery.success", {
      city: state.delivery.city,
      date: state.delivery.date,
      available: state.delivery.available,
      message: state.delivery.message,
    });
    return {
      status: state.delivery.available ? "success" : "unavailable",
      delivery: state.delivery,
      message: state.delivery.message,
    };
  }

  logRelay("tool.unsupported", { name });
  return {
    status: "error",
    message: "Unsupported tool call.",
  };
}

async function recoverTextTurnFromRateLimit(
  client: WebSocket,
  session: RelaySession,
  text: string,
  latestProducts: Product[] | null,
): Promise<void> {
  logRelay("text.rate_limit_recovery.start", {
    hadProducts: Boolean(latestProducts?.length),
  });
  let products = latestProducts;

  if (!products || products.length === 0) {
    const recoveredSearch = await searchProductsWithFallbacks(
      client,
      session.mcpClient,
      inferRecoveryQuery(text),
      text,
    );
    session.state.products = recoveredSearch.products;
    products = recoveredSearch.products;
    logRelay("text.rate_limit_recovery.search_complete", {
      query: recoveredSearch.query,
      count: products.length,
    });
  }

  sendJson(client, { type: "products", products: products ?? [] });
  sendJson(client, {
    type: "transcript",
    role: "assistant",
    text:
      products && products.length > 0
        ? "I found a few options for you. My response hit a temporary limit, but you can review these products now."
        : "I hit a temporary response limit and could not find matching products yet. Try flowers, cake, tea, chocolates, or another specific gift idea.",
  });
  sendJson(client, { type: "status", status: "IDLE" });
}

async function searchProductsWithFallbacks(
  client: WebSocket,
  mcpClient: KaprukaMCPClient,
  primaryQuery: string,
  fallbackText?: string,
): Promise<SearchResult> {
  const queries = buildProductSearchQueries(primaryQuery, fallbackText);
  let lastQuery = queries[0] ?? primaryQuery;
  let lastError: unknown = null;
  let hasSuccessfulSearch = false;

  for (const query of queries) {
    lastQuery = query;
    logRelay("tool.search.start", {
      query,
      fallback: query !== primaryQuery,
    });
    sendJson(client, {
      type: "products_status",
      status: "searching",
      query,
    });

    let products: Product[];
    try {
      const result = await mcpClient.callTool("kapruka_search_products", {
        q: query,
        limit: 10,
        currency: "LKR",
        response_format: "json",
      });
      hasSuccessfulSearch = true;
      products = normalizeProducts(result);
    } catch (error) {
      lastError = error;
      logRelay("tool.search.attempt_error", {
        query,
        message: errorToMessage(error),
      });
      continue;
    }
    logRelay("tool.search.attempt_normalized", {
      query,
      count: products.length,
    });

    if (products.length > 0) {
      return { products, query };
    }
  }

  if (!hasSuccessfulSearch && lastError) {
    throw lastError;
  }

  return { products: [], query: lastQuery };
}

function buildProductSearchQueries(primaryQuery: string, fallbackText = ""): string[] {
  const text = normalizeSearchText(`${primaryQuery} ${fallbackText}`);
  const queries = [primaryQuery];

  if (/\b(chocolate|chocolates|sweet|sweets)\b/i.test(text)) {
    queries.push("chocolate cake", "cake");
  }

  if (
    /\b(gift|gifts|cute|girlfriend|girl|friend|freind|gf|love|birthday|anniversary|adare|lassana)\b/i.test(
      text,
    )
  ) {
    queries.push("flowers", "bouquet", "cake", "mug", "tea gifts");
  }

  if (/\b(flower|flowers|rose|roses|bouquet)\b/i.test(text)) {
    queries.push("bouquet", "flowers");
  }

  if (/\b(tea|ceylon)\b/i.test(text)) {
    queries.push("tea gifts", "tea");
  }

  if (/\b(cake|cakes)\b/i.test(text)) {
    queries.push("cake");
  }

  queries.push("cake", "flowers", "tea gifts");

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 6);
}

function inferRecoveryQuery(text: string): string {
  const normalized = normalizeSearchText(text);
  if (/\b(flower|flowers|rose|roses|bouquet)\b/.test(normalized)) return "bouquet";
  if (/\b(tea|ceylon)\b/.test(normalized)) return "tea gifts";
  if (/\b(cake|cakes)\b/.test(normalized)) return "cake";
  if (/\b(chocolate|chocolates)\b/.test(normalized)) return "chocolate cake";
  if (/\b(gift|cute|girlfriend|girl|friend|freind|gf|love)\b/.test(normalized)) {
    return "flowers";
  }
  return "gift";
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function createOrderFromClient(
  client: WebSocket,
  state: SessionState,
  mcpClient: KaprukaMCPClient,
  checkout: CheckoutDetails,
): Promise<void> {
  logRelay("checkout.start", {
    cartCount: state.cart.length,
    hasDelivery: Boolean(state.delivery),
    orderCreated: state.orderCreated,
  });
  if (state.orderCreated) {
    logRelay("checkout.reject_duplicate");
    throw new Error("A payment link has already been created for this session.");
  }
  if (state.cart.length === 0) {
    logRelay("checkout.reject_empty_cart");
    throw new Error("Add at least one product before checkout.");
  }
  if (!state.delivery || !state.delivery.available) {
    logRelay("checkout.reject_delivery_missing_or_unavailable", {
      delivery: state.delivery,
    });
    throw new Error("Delivery must be checked before checkout.");
  }

  sendJson(client, { type: "status", status: "THINKING" });
  const orderPayload = CreateOrderPayloadSchema.parse({
    cart: state.cart.map((item) => ({
      product_id: item.id,
      quantity: item.quantity,
      icing_text: null,
    })),
    recipient: checkout.recipient,
    delivery: {
      address: checkout.delivery.address,
      city: state.delivery.city,
      location_type: checkout.delivery.locationType,
      date: state.delivery.date,
      instructions: checkout.delivery.instructions || null,
    },
    sender: checkout.sender,
    gift_message: checkout.giftMessage || null,
    currency: checkout.currency,
    response_format: "json",
  });
  logRelay("checkout.payload_valid", {
    cartCount: orderPayload.cart.length,
    city: orderPayload.delivery.city,
    date: orderPayload.delivery.date,
    currency: orderPayload.currency,
    hasGiftMessage: Boolean(orderPayload.gift_message),
  });
  const result = await mcpClient.callTool("kapruka_create_order", orderPayload);

  const paymentUrl = assertPaymentUrl(result);
  state.checkoutLink = paymentUrl;
  state.orderCreated = true;

  sendJson(client, { type: "checkout", checkoutLink: paymentUrl });
  sendJson(client, { type: "status", status: "IDLE" });
  logRelay("checkout.success", {
    checkoutHost: new URL(paymentUrl).hostname,
  });
}

function getDeliveryProductId(state: SessionState): string | null {
  return state.cart[0]?.id ?? state.products[0]?.id ?? null;
}

function addProductById(
  state: SessionState,
  productId: string,
  quantity: number,
): Product {
  if (state.orderCreated) {
    throw new Error("Cart cannot be changed after payment link creation.");
  }

  const product = state.products.find((item) => item.id === productId);
  if (!product) {
    throw new Error("Product ID was not found in the current search results.");
  }

  const next = addProductToCart(state.cart, product, quantity);
  state.cart = next.cart;
  state.subtotal = next.subtotal;
  return product;
}

function sendCart(client: WebSocket, state: SessionState): void {
  state.subtotal = calculateCartSubtotal(state.cart);
  logRelay("cart.send", summarizeCart(state));
  sendJson(client, {
    type: "cart",
    cart: state.cart,
    subtotal: state.subtotal,
  });
}

function sendToolResponse(
  gemini: WebSocket,
  functionId: string,
  name: string,
  response: Record<string, unknown>,
): void {
  if (gemini.readyState !== WebSocket.OPEN) {
    logRelay("live.tool_response.skip_socket_not_open", { name, functionId });
    return;
  }

  logRelay("live.tool_response.send", {
    name,
    functionId,
    response: summarizeToolResult(response),
  });
  gemini.send(
    JSON.stringify({
      toolResponse: {
        functionResponses: [
          {
            id: functionId,
            name,
            response,
          },
        ],
      },
    }),
  );
}

function sendJson(socket: WebSocket, message: RelayServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    logRelay("client.send", summarizeRelayMessage(message));
    socket.send(JSON.stringify(message));
    return;
  }

  logRelay("client.send.skipped_socket_not_open", {
    type: message.type,
    readyState: socket.readyState,
  });
}

function extractToken(request: IncomingMessage): string | null {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `ws://${host}`);
  return url.searchParams.get("token");
}

function buildGeminiUrl(config: RelayConfig): string {
  const url = new URL(
    config.geminiEndpoint ??
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
  );
  url.searchParams.set("key", config.geminiApiKey);
  return url.toString();
}

function normalizeTranscript(text: string): string | null {
  const normalized = text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^transcript:\s*/i, "")
    .trim();
  if (!normalized || /^empty_audio$/i.test(normalized) || /^no clear speech/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function createGeminiFlashTools(): GeminiFlashTool[] {
  return [
    {
      type: "function",
      name: "search_products",
      description:
        "Search the Kapruka product catalog. Use this whenever the user asks for an item.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The product name to search for. Minimum 3 characters.",
          },
        },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "add_to_cart",
      description: "Add a specific product from the current search results to the cart.",
      parameters: {
        type: "object",
        properties: {
          productId: {
            type: "string",
            description: "Product ID from the current search results.",
          },
          quantity: {
            type: "number",
            description:
              "Quantity from 1 to 20. Use 1 unless the user explicitly asks for another quantity. Do not infer this from product size, price, model number, or product name.",
          },
        },
        required: ["productId", "quantity"],
      },
    },
    {
      type: "function",
      name: "check_delivery_constraints",
      description:
        "Check if Kapruka can deliver to a specific city on a specific date.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "Canonical Kapruka delivery city, such as Colombo 03 or Galle.",
          },
          date: {
            type: "string",
            description: "Delivery date in YYYY-MM-DD format.",
          },
        },
        required: ["city", "date"],
      },
    },
  ];
}

function createGeminiSetupMessage(config: RelayConfig): Record<string, unknown> {
  return {
    setup: {
      model: formatGeminiModelName(
        config.geminiLiveModel ?? DEFAULT_GEMINI_LIVE_MODEL,
      ),
      systemInstruction: {
        parts: [{ text: CONCIERGE_SYSTEM_PROMPT }],
      },
      generationConfig: {
        responseModalities: ["AUDIO"],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [
        {
          functionDeclarations: [
            {
              name: "search_products",
              description:
                "Search the Kapruka product catalog. Use this whenever the user asks for an item.",
              parameters: {
                type: "OBJECT",
                properties: {
                  query: {
                    type: "STRING",
                    description: "The product name to search for.",
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "add_to_cart",
              description: "Add a specific product to the user's shopping cart.",
              parameters: {
                type: "OBJECT",
                properties: {
                  productId: { type: "STRING" },
                  quantity: {
                    type: "NUMBER",
                    description:
                      "Use 1 unless the user explicitly asks for another quantity. Do not infer quantity from product size, price, model number, or product name.",
                  },
                },
                required: ["productId", "quantity"],
              },
            },
            {
              name: "check_delivery_constraints",
              description:
                "Check if Kapruka can deliver to a specific city on a specific date.",
              parameters: {
                type: "OBJECT",
                properties: {
                  city: {
                    type: "STRING",
                    description: "Canonical Kapruka delivery city, such as Colombo 03 or Galle.",
                  },
                  date: { type: "STRING", description: "YYYY-MM-DD format" },
                },
                required: ["city", "date"],
              },
            },
          ],
        },
      ],
    },
  };
}

function formatGeminiModelName(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function logRelay(event: string, details: Record<string, unknown> = {}): void {
  console.info("[voice-relay]", event, details);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeClientMessage(message: ClientMessage): Record<string, unknown> {
  if (message.type === "voice_utterance") {
    return {
      type: message.type,
      mimeType: message.mimeType,
      durationMs: message.durationMs,
      dataLength: message.data.length,
    };
  }

  if (message.type === "live_audio") {
    return { type: message.type, dataLength: message.data.length };
  }

  if (message.type === "live_start" || message.type === "live_stop") {
    return { type: message.type };
  }

  if (message.type === "text") {
    return {
      type: message.type,
      length: message.text.length,
      preview: message.text.slice(0, 80),
    };
  }

  if (message.type === "add_to_cart") {
    return {
      type: message.type,
      productId: message.productId,
      quantity: message.quantity,
    };
  }

  return {
    type: message.type,
    hasCheckout: true,
  };
}

function summarizeRelayMessage(message: RelayServerMessage): Record<string, unknown> {
  if (message.type === "products") {
    return { type: message.type, count: message.products.length };
  }

  if (message.type === "products_status") {
    return { type: message.type, status: message.status, query: message.query };
  }

  if (message.type === "cart") {
    return {
      type: message.type,
      count: message.cart.length,
      subtotal: message.subtotal,
    };
  }

  if (message.type === "delivery") {
    return {
      type: message.type,
      city: message.delivery.city,
      date: message.delivery.date,
      available: message.delivery.available,
    };
  }

  if (message.type === "transcript") {
    return {
      type: message.type,
      role: message.role,
      length: message.text.length,
      preview: message.text.slice(0, 80),
    };
  }

  if (message.type === "audio") {
    return { type: message.type, dataLength: message.data.length };
  }

  if (message.type === "checkout") {
    return {
      type: message.type,
      host: new URL(message.checkoutLink).hostname,
    };
  }

  return message;
}

function summarizeToolArgs(args: unknown): Record<string, unknown> {
  const source = asRecord(args);
  if (!source) return { type: typeof args };

  return {
    query: source.query,
    productId: source.productId,
    quantity: source.quantity,
    city: source.city,
    date: source.date,
  };
}

function summarizeToolResult(result: Record<string, unknown>): Record<string, unknown> {
  return {
    status: result.status,
    message: result.message,
    itemsFound: result.itemsFound,
    subtotal: result.subtotal,
    deliveryAvailable: asRecord(result.delivery)?.available,
  };
}

function summarizeCart(state: SessionState): Record<string, unknown> {
  return {
    count: state.cart.length,
    subtotal: state.subtotal,
    items: state.cart.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
    })),
  };
}

function toClientError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return "Received invalid data for this voice action.";
  }
  if (isGeminiRateLimitError(error)) {
    return "The assistant is temporarily rate-limited. Please wait a moment and try again.";
  }
  if (
    error instanceof Error &&
    /timed out after \d+ms/i.test(error.message)
  ) {
    return error.message;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "The upstream service timed out.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Voice relay request failed.";
}

function isGeminiRateLimitError(error: unknown): boolean {
  return error instanceof Error && /Gemini Flash HTTP 429/i.test(error.message);
}
