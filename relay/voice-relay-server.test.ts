import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createVoiceSessionToken } from "../src/lib/voice-token";
import { createVoiceRelayServer } from "./voice-relay-server";
import type { RelayServerMessage } from "../src/lib/voice-contracts";

interface Harness {
  client: WebSocket;
  geminiConnection: Promise<WebSocket>;
  getGeminiConnectionCount: () => number;
  close: () => Promise<void>;
}

interface HarnessOptions {
  clientKeepaliveMs?: number;
}

const openHarnesses: Harness[] = [];

describe("voice relay server", () => {
  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.close()));
  });

  it("handles search, cart, delivery, and manual checkout with mocked upstreams", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123");
    const userTranscript = waitForMessage(
      harness.client,
      (message) =>
        message.type === "transcript" &&
        message.role === "user" &&
        message.text === "Find Ceylon tea gifts",
    );
    const productsMessage = waitForMessage(
      harness.client,
      (message) => message.type === "products",
    );
    const productsStatusMessage = waitForMessage(
      harness.client,
      (message) =>
        message.type === "products_status" &&
        message.status === "searching" &&
        message.query === "tea",
    );
    harness.client.send(
      JSON.stringify({ type: "text", text: "Find Ceylon tea gifts" }),
    );
    await expect(userTranscript).resolves.toMatchObject({
      type: "transcript",
      role: "user",
    });
    await expect(productsStatusMessage).resolves.toMatchObject({
      type: "products_status",
      status: "searching",
      query: "tea",
    });

    const products = await productsMessage;
    expect(products).toMatchObject({
      products: [{ id: "tea-1", name: "Ceylon Tea", priceLKR: 1200 }],
    });

    harness.client.send(
      JSON.stringify({ type: "add_to_cart", productId: "tea-1", quantity: 2 }),
    );
    await expect(
      waitForMessage(harness.client, (message) => message.type === "cart"),
    ).resolves.toMatchObject({
      cart: [{ id: "tea-1", quantity: 2 }],
      subtotal: 2400,
    });

    harness.client.send(
      JSON.stringify({
        type: "text",
        text: "Check delivery to Colombo on 2026-07-01",
      }),
    );
    await expect(
      waitForMessage(harness.client, (message) => message.type === "delivery"),
    ).resolves.toMatchObject({
      delivery: {
        city: "Colombo",
        date: "2026-07-01",
        available: true,
      },
    });

    harness.client.send(JSON.stringify({ type: "create_order", checkout: checkoutDetails() }));
    await expect(
      waitForMessage(harness.client, (message) => message.type === "checkout"),
    ).resolves.toMatchObject({
      checkoutLink: "https://checkout.kapruka.com/pay/123",
    });
  });

  it("rejects unsafe payment URLs from order creation", async () => {
    const harness = await createHarness("https://kapruka.com.evil.test/pay/123");

    const productsMessage = waitForMessage(
      harness.client,
      (message) => message.type === "products" && message.products.length === 1,
    );
    harness.client.send(
      JSON.stringify({ type: "text", text: "Find Ceylon tea gifts" }),
    );
    await productsMessage;
    harness.client.send(
      JSON.stringify({ type: "add_to_cart", productId: "tea-1", quantity: 1 }),
    );
    await waitForMessage(harness.client, (message) => message.type === "cart");

    const deliveryMessage = waitForMessage(
      harness.client,
      (message) => message.type === "delivery",
    );
    harness.client.send(
      JSON.stringify({
        type: "text",
        text: "Check delivery to Colombo on 2026-07-01",
      }),
    );
    await deliveryMessage;

    harness.client.send(JSON.stringify({ type: "create_order", checkout: checkoutDetails() }));
    await expect(
      waitForMessage(
        harness.client,
        (message) =>
          message.type === "error" && /Unsafe payment URL/.test(message.message),
      ),
    ).resolves.toMatchObject({ type: "error" });
  });

  it("buffers intermediate empty searches and emits recovered product results", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123");
    const firstProductsMessage = waitForMessage(
      harness.client,
      (message) => message.type === "products",
    );
    const firstStatusMessage = waitForMessage(
      harness.client,
      (message) =>
        message.type === "products_status" &&
        message.status === "searching" &&
        message.query === "empty",
    );

    harness.client.send(
      JSON.stringify({ type: "text", text: "Find mixed gift options" }),
    );

    await expect(firstStatusMessage).resolves.toMatchObject({
      type: "products_status",
      query: "empty",
    });
    const products = await firstProductsMessage;
    expect(products).toMatchObject({
      type: "products",
      products: [{ id: "cake-1", name: "Chocolate Cake", priceLKR: 4450 }],
    });
  });

  it("recovers product results when Gemini rate-limits after a narrow empty search", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123");
    const productsMessage = waitForMessage(
      harness.client,
      (message) => message.type === "products" && message.products.length > 0,
    );
    const assistantMessage = waitForMessage(
      harness.client,
      (message) =>
        message.type === "transcript" &&
        message.role === "assistant" &&
        /temporary limit/i.test(message.text),
    );

    harness.client.send(
      JSON.stringify({
        type: "text",
        text: "Find rate limit cute gift for my girl friend",
      }),
    );

    await expect(productsMessage).resolves.toMatchObject({
      type: "products",
      products: [
        {
          id: "cake-1",
          name: "Chocolate Cake",
          priceLKR: 4450,
        },
      ],
    });
    await expect(assistantMessage).resolves.toMatchObject({
      type: "transcript",
      role: "assistant",
    });
  });

  it("transcribes a voice utterance and runs the normal text shopping flow", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123");
    const userTranscript = waitForMessage(
      harness.client,
      (message) =>
        message.type === "transcript" &&
        message.role === "user" &&
        message.text === "Find Ceylon tea gifts",
    );
    const productsMessage = waitForMessage(
      harness.client,
      (message) => message.type === "products" && message.products.length > 0,
    );

    harness.client.send(
      JSON.stringify({
        type: "voice_utterance",
        data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=",
        mimeType: "audio/wav",
        durationMs: 1200,
      }),
    );

    await expect(userTranscript).resolves.toMatchObject({
      type: "transcript",
      role: "user",
      text: "Find Ceylon tea gifts",
    });
    await expect(productsMessage).resolves.toMatchObject({
      type: "products",
      products: [{ id: "tea-1", name: "Ceylon Tea", priceLKR: 1200 }],
    });
    expect(harness.getGeminiConnectionCount()).toBe(0);
  });

  it("opens Gemini Live only after explicit live_start", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123");
    expect(harness.getGeminiConnectionCount()).toBe(0);

    const liveStatus = waitForMessage(
      harness.client,
      (message) => message.type === "status" && message.status === "LIVE",
    );
    harness.client.send(JSON.stringify({ type: "live_start" }));
    const gemini = await harness.geminiConnection;
    const setupMessage = await waitForGeminiMessage(gemini, (message) =>
      Boolean(message.setup),
    );
    expect(setupMessage).toMatchObject({
      setup: {
        model: "models/gemini-3.1-flash-live-preview",
        responseModalities: ["AUDIO"],
      },
    });
    expect(setupMessage).not.toHaveProperty("setup.generationConfig");
    gemini.send(JSON.stringify({ setupComplete: {} }));
    await liveStatus;

    harness.client.send(JSON.stringify({ type: "live_audio", data: "AAAA" }));
    await expect(
      waitForGeminiMessage(gemini, (message) => Boolean(message.realtimeInput)),
    ).resolves.toMatchObject({
      realtimeInput: {
        audio: { mimeType: "audio/pcm;rate=16000", data: "AAAA" },
      },
    });
  });

  it("handles Gemini Live top-level tool calls", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123");
    const productsMessage = waitForMessage(
      harness.client,
      (message) => message.type === "products" && message.products.length > 0,
    );

    harness.client.send(JSON.stringify({ type: "live_start" }));
    const gemini = await harness.geminiConnection;
    await waitForGeminiMessage(gemini, (message) => Boolean(message.setup));
    gemini.send(JSON.stringify({ setupComplete: {} }));
    await waitForMessage(
      harness.client,
      (message) => message.type === "status" && message.status === "LIVE",
    );

    gemini.send(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: "live-search-1",
              name: "search_products",
              args: { query: "tea" },
            },
          ],
        },
      }),
    );

    await expect(productsMessage).resolves.toMatchObject({
      type: "products",
      products: [{ id: "tea-1", name: "Ceylon Tea", priceLKR: 1200 }],
    });
    await expect(
      waitForGeminiMessage(gemini, (message) => Boolean(message.toolResponse)),
    ).resolves.toMatchObject({
      toolResponse: {
        functionResponses: [
          {
            id: "live-search-1",
            name: "search_products",
          },
        ],
      },
    });
  });

  it("drops premature live audio without flooding errors", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123");
    const messages: RelayServerMessage[] = [];
    const onMessage = (data: RawData) => {
      messages.push(JSON.parse(rawDataToString(data)) as RelayServerMessage);
    };
    harness.client.on("message", onMessage);

    const warning = waitForMessage(
      harness.client,
      (message) =>
        message.type === "error" &&
        message.message === "Start Live Conversation before sending live audio.",
    );

    harness.client.send(JSON.stringify({ type: "live_audio", data: "AAAA" }));
    harness.client.send(JSON.stringify({ type: "live_audio", data: "BBBB" }));
    harness.client.send(JSON.stringify({ type: "live_audio", data: "CCCC" }));

    await expect(warning).resolves.toMatchObject({
      type: "error",
      message: "Start Live Conversation before sending live audio.",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    harness.client.off("message", onMessage);

    expect(messages.filter((message) => message.type === "error")).toHaveLength(1);
    expect(harness.getGeminiConnectionCount()).toBe(0);
  });

  it("sends client keepalive pings for tunneled websocket sessions", async () => {
    const harness = await createHarness("https://checkout.kapruka.com/pay/123", {
      clientKeepaliveMs: 10,
    });

    await expect(waitForPing(harness.client)).resolves.toBeUndefined();
  });
});

async function createHarness(
  paymentUrl: string,
  options: HarnessOptions = {},
): Promise<Harness> {
  const tokenSecret = "relay-test-secret";
  const mcp = await startMockMcpServer(paymentUrl);
  const gemini = await startMockGeminiServer();
  const flash = await startMockFlashServer();
  const relay = createVoiceRelayServer({
    port: 0,
    tokenSecret,
    geminiApiKey: "test-gemini-key",
    geminiEndpoint: gemini.url,
    geminiTextEndpoint: flash.url,
    geminiTextModel: "gemini-3.5-flash",
    mcpEndpoint: mcp.url,
    clientKeepaliveMs: options.clientKeepaliveMs,
  });
  await once(relay, "listening");

  const relayPort = (relay.address() as AddressInfo).port;
  const { token } = createVoiceSessionToken(tokenSecret);
  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/relay?token=${token}`);
  const ready = waitForMessage(client, (message) => message.type === "ready");
  await once(client, "open");
  await ready;

  const harness: Harness = {
    client,
    geminiConnection: gemini.connection,
    getGeminiConnectionCount: gemini.getConnectionCount,
    close: async () => {
      client.close();
      relay.close();
      gemini.server.close();
      await flash.close();
      await mcp.close();
    },
  };
  openHarnesses.push(harness);
  return harness;
}

async function startMockGeminiServer(): Promise<{
  server: WebSocketServer;
  url: string;
  connection: Promise<WebSocket>;
  getConnectionCount: () => number;
}> {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  let connectionCount = 0;
  let resolveConnection: (socket: WebSocket) => void = () => {};
  const connection = new Promise<WebSocket>((resolve) => {
    resolveConnection = resolve;
  });
  server.on("connection", (socket) => {
    connectionCount += 1;
    if (connectionCount === 1) resolveConnection(socket);
  });

  return {
    server,
    url: `ws://127.0.0.1:${port}`,
    connection,
    getConnectionCount: () => connectionCount,
  };
}

async function startMockFlashServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  let nextId = 1;
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const body = JSON.parse(await readRequestBody(request));
      response.setHeader("Content-Type", "application/json");

      if (
        body.model === "gemini-3.5-flash" &&
        Array.isArray(body.input) &&
        body.input.some((item: Record<string, unknown>) => item.type === "audio")
      ) {
        response.end(
          JSON.stringify({
            id: `flash-audio-${nextId++}`,
            output_text: "Find Ceylon tea gifts",
            steps: [],
          }),
        );
        return;
      }

      if (
        body.model !== "gemini-3.5-flash" ||
        !Array.isArray(body.tools) ||
        body.tools[0]?.name !== "search_products"
      ) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: "Invalid Flash request" }));
        return;
      }

      const id = `flash-${nextId++}`;
      if (typeof body.input === "string" && /rate limit/i.test(body.input)) {
        response.end(
          JSON.stringify({
            id: "flash-rate-limit-initial",
            steps: [
              {
                type: "function_call",
                id: "flash-search-chocolate",
                name: "search_products",
                arguments: { query: "chocolate" },
              },
            ],
          }),
        );
        return;
      }

      if (typeof body.input === "string" && /delivery/i.test(body.input)) {
        response.end(
          JSON.stringify({
            id,
            steps: [
              {
                type: "function_call",
                id: "flash-delivery-1",
                name: "check_delivery_constraints",
                arguments: { city: "Colombo", date: "2026-07-01" },
              },
            ],
          }),
        );
        return;
      }

      if (typeof body.input === "string" && /mixed/i.test(body.input)) {
        response.end(
          JSON.stringify({
            id,
            steps: [
              {
                type: "function_call",
                id: "flash-search-empty",
                name: "search_products",
                arguments: { query: "empty" },
              },
            ],
          }),
        );
        return;
      }

      if (typeof body.input === "string") {
        response.end(
          JSON.stringify({
            id,
            steps: [
              {
                type: "function_call",
                id: "flash-search-1",
                name: "search_products",
                arguments: { query: "tea" },
              },
            ],
          }),
        );
        return;
      }

      const toolName = body.input?.[0]?.name;
      const toolResultText = body.input?.[0]?.result?.[0]?.text;
      if (body.previous_interaction_id === "flash-rate-limit-initial") {
        response.statusCode = 429;
        response.end(JSON.stringify({ error: "Rate limit exceeded" }));
        return;
      }

      if (
        toolName === "search_products" &&
        typeof toolResultText === "string" &&
        /"itemsFound":0/.test(toolResultText)
      ) {
        response.end(
          JSON.stringify({
            id,
            steps: [
              {
                type: "function_call",
                id: "flash-search-fallback",
                name: "search_products",
                arguments: { query: "tea" },
              },
            ],
          }),
        );
        return;
      }

      response.end(
        JSON.stringify({
          id,
          output_text:
            toolName === "check_delivery_constraints"
              ? "Delivery is available for Colombo on 2026-07-01."
              : "I found Ceylon Tea and displayed it for you.",
          steps: [],
        }),
      );
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/interactions`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startMockMcpServer(paymentUrl: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const body = JSON.parse(await readRequestBody(request));
      response.setHeader("Content-Type", "application/json");

      if (body.method === "initialize") {
        response.setHeader("Mcp-Session-Id", "test-session");
        response.end(JSON.stringify({ result: {} }));
        return;
      }

      const toolName = body.params?.name;
      const params = body.params?.arguments?.params;
      if (toolName === "kapruka_search_products" && params?.q === "tea") {
        response.end(
          JSON.stringify({
            result: {
              content: [
                {
                  text: JSON.stringify([
                    {
                      id: "tea-1",
                      name: "Ceylon Tea",
                      priceLKR: 1200,
                      imageUrl: "https://kapruka.com/tea.jpg",
                    },
                  ]),
                },
              ],
            },
          }),
        );
        return;
      }

      if (
        toolName === "kapruka_search_products" &&
        (params?.q === "chocolate" || params?.q === "empty")
      ) {
        response.end(
          JSON.stringify({
            result: {
              content: [
                {
                  text: JSON.stringify([]),
                },
              ],
            },
          }),
        );
        return;
      }

      if (
        toolName === "kapruka_search_products" &&
        (params?.q === "chocolate cake" || params?.q === "cake")
      ) {
        response.end(
          JSON.stringify({
            result: {
              content: [
                {
                  text: JSON.stringify([
                    {
                      id: "cake-1",
                      name: "Chocolate Cake",
                      priceLKR: 4450,
                      imageUrl: "https://kapruka.com/cake.jpg",
                    },
                  ]),
                },
              ],
            },
          }),
        );
        return;
      }

      if (
        toolName === "kapruka_check_delivery" &&
        params?.city === "Colombo" &&
        params?.delivery_date === "2026-07-01"
      ) {
        response.end(
          JSON.stringify({
            result: {
              content: [
                {
                  text: JSON.stringify({
                    available: true,
                    message: "Delivery is available.",
                  }),
                },
              ],
            },
          }),
        );
        return;
      }

      if (
        toolName === "kapruka_create_order" &&
        params?.cart?.[0]?.product_id === "tea-1" &&
        params?.recipient?.name === "Recipient" &&
        params?.delivery?.city === "Colombo"
      ) {
        response.end(
          JSON.stringify({
            result: {
              content: [
                {
                  text: JSON.stringify({ checkout_url: paymentUrl }),
                },
              ],
            },
          }),
        );
        return;
      }

      response.statusCode = 400;
      response.end(JSON.stringify({ error: { message: "Unknown tool" } }));
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function checkoutDetails() {
  return {
    recipient: {
      name: "Recipient",
      phone: "0771234567",
    },
    delivery: {
      address: "123 Flower Road",
      locationType: "house",
      instructions: "",
    },
    sender: {
      name: "Sender",
      anonymous: false,
    },
    giftMessage: "Happy birthday",
    currency: "LKR",
  };
}

function waitForPing(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("ping", onPing);
      reject(new Error("Timed out waiting for relay ping."));
    }, 500);
    const onPing = () => {
      clearTimeout(timeout);
      resolve();
    };

    socket.once("ping", onPing);
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: RelayServerMessage) => boolean,
): Promise<RelayServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for relay message."));
    }, 2000);

    const onMessage = (data: RawData) => {
      const message = JSON.parse(rawDataToString(data)) as RelayServerMessage;
      if (predicate(message)) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(message);
        return;
      }

      if (message.type === "error") {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        reject(new Error(message.message));
      }
    };

    socket.on("message", onMessage);
  });
}

function waitForGeminiMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for Gemini message."));
    }, 2000);

    const onMessage = (data: RawData) => {
      const message = JSON.parse(rawDataToString(data)) as Record<string, unknown>;
      if (!predicate(message)) return;

      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };

    socket.on("message", onMessage);
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
