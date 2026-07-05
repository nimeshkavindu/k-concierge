import { useCallback, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import {
  RelayServerMessageSchema,
  VoiceSessionResponseSchema,
  type ClientMessage,
  type RelayServerMessage,
} from "@/lib/voice-contracts";
import type { CheckoutDetails } from "@/lib/validation";

interface PendingConnection {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingLiveStart extends PendingConnection {
  promise: Promise<void>;
}

interface VoiceRelayOptions {
  onDisconnect?: () => void;
}

export function useVoiceRelay(
  onAudioDataReceived: (base64String: string) => void,
  options: VoiceRelayOptions = {},
) {
  const onDisconnect = options.onDisconnect;
  const {
    beginProductSearch,
    finishAssistantTurn,
    resetSessionState,
    setCartState,
    setCheckoutLink,
    setCheckoutStatus,
    setDeliveryCheck,
    setProducts,
    setProductStatus,
    setRelayConnected,
    setTranscript,
    setVoiceError,
    setVoiceStatus,
  } = useAppStore();
  const wsRef = useRef<WebSocket | null>(null);
  const pendingConnectionRef = useRef<PendingConnection | null>(null);
  const pendingLiveStartRef = useRef<PendingLiveStart | null>(null);
  const isLiveReadyRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const rejectPendingConnection = useCallback((error: Error) => {
    const pending = pendingConnectionRef.current;
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingConnectionRef.current = null;
    pending.reject(error);
  }, []);

  const resolvePendingConnection = useCallback(() => {
    const pending = pendingConnectionRef.current;
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingConnectionRef.current = null;
    pending.resolve();
  }, []);

  const rejectPendingLiveStart = useCallback((error: Error) => {
    const pending = pendingLiveStartRef.current;
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingLiveStartRef.current = null;
    pending.reject(error);
  }, []);

  const resolvePendingLiveStart = useCallback(() => {
    const pending = pendingLiveStartRef.current;
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingLiveStartRef.current = null;
    pending.resolve();
  }, []);

  const applyRelayMessage = useCallback(
    (rawMessage: unknown) => {
      const message = RelayServerMessageSchema.parse(rawMessage);
      logVoiceClient("relay.message", summarizeRelayMessage(message));

      if (message.type === "ready") {
        setIsConnected(true);
        setIsConnecting(false);
        setRelayConnected(true);
        resolvePendingConnection();
        return;
      }

      if (message.type === "status") {
        setVoiceStatus(message.status);
        if (message.status === "LIVE") {
          isLiveReadyRef.current = true;
          resolvePendingLiveStart();
        }
        if (message.status === "IDLE") {
          isLiveReadyRef.current = false;
          rejectPendingLiveStart(
            new Error("Live Conversation stopped before it was ready."),
          );
          finishAssistantTurn();
        }
        return;
      }

      if (message.type === "audio") {
        setVoiceStatus("SPEAKING");
        onAudioDataReceived(message.data);
        return;
      }

      if (message.type === "transcript") {
        setTranscript(message.text, message.role);
        return;
      }

      if (message.type === "products_status") {
        beginProductSearch(message.query);
        return;
      }

      if (message.type === "products") {
        setProducts(message.products);
        return;
      }

      if (message.type === "cart") {
        setCartState(message.cart, message.subtotal);
        return;
      }

      if (message.type === "delivery") {
        setDeliveryCheck(message.delivery);
        return;
      }

      if (message.type === "checkout") {
        setCheckoutLink(message.checkoutLink);
        return;
      }

      if (!isLiveRelayError(message.message)) {
        setCheckoutStatus("ERROR");
        setProductStatus("error");
      }
      isLiveReadyRef.current = false;
      rejectPendingLiveStart(new Error(message.message));
      setVoiceError(message.message);
    },
    [
      beginProductSearch,
      finishAssistantTurn,
      onAudioDataReceived,
      resolvePendingConnection,
      rejectPendingLiveStart,
      resolvePendingLiveStart,
      setCartState,
      setCheckoutLink,
      setCheckoutStatus,
      setDeliveryCheck,
      setProducts,
      setProductStatus,
      setRelayConnected,
      setTranscript,
      setVoiceError,
      setVoiceStatus,
    ],
  );

  const sendMessage = useCallback(
    (message: ClientMessage): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        logVoiceClient("send.blocked_not_connected", {
          type: message.type,
          readyState: ws?.readyState ?? null,
        });
        setVoiceError("Voice relay is not connected.");
        return false;
      }
      logVoiceClient("send", summarizeClientMessage(message));
      ws.send(JSON.stringify(message));
      return true;
    },
    [setVoiceError],
  );

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      logVoiceClient("connect.skip_already_open");
      return;
    }

    logVoiceClient("connect.start");
    isLiveReadyRef.current = false;
    resetSessionState();
    setIsConnecting(true);
    setVoiceStatus("CONNECTING");
    setVoiceError(null);

    const response = await fetch("/api/voice-session", { method: "POST" });
    logVoiceClient("session.response", { status: response.status, ok: response.ok });
    if (!response.ok) {
      const message = "Voice relay session could not be created.";
      setIsConnecting(false);
      setVoiceStatus("IDLE");
      setVoiceError(message);
      throw new Error(message);
    }

    const session = VoiceSessionResponseSchema.parse(await response.json());
    logVoiceClient("session.parsed", {
      relayProtocol: new URL(session.relayUrl).protocol,
      relayHost: new URL(session.relayUrl).host,
      expiresAt: session.expiresAt,
    });
    const ws = new WebSocket(session.relayUrl);
    wsRef.current = ws;

    const readyPromise = new Promise<void>((resolve, reject) => {
      pendingConnectionRef.current = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          pendingConnectionRef.current = null;
          logVoiceClient("connect.timeout");
          reject(new Error("Voice relay setup timed out."));
          ws.close();
        }, 15_000),
      };
    });

    ws.onmessage = (event) => {
      try {
        logVoiceClient("ws.message.raw", { length: String(event.data).length });
        applyRelayMessage(JSON.parse(event.data));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid relay message.";
        logVoiceClient("ws.message.parse_error", { message });
        setVoiceError(message);
      }
    };

    ws.onclose = () => {
      logVoiceClient("ws.close");
      rejectPendingConnection(new Error("Voice relay connection closed."));
      rejectPendingLiveStart(new Error("Voice relay connection closed."));
      onDisconnect?.();
      wsRef.current = null;
      isLiveReadyRef.current = false;
      setIsConnected(false);
      setIsConnecting(false);
      setRelayConnected(false);
      setVoiceStatus("IDLE");
    };

    ws.onerror = () => {
      const error = new Error("Voice relay connection failed.");
      logVoiceClient("ws.error", { message: error.message });
      setVoiceError(error.message);
      onDisconnect?.();
      rejectPendingConnection(error);
      rejectPendingLiveStart(error);
    };

    await readyPromise;
    logVoiceClient("connect.ready");
  }, [
    applyRelayMessage,
    onDisconnect,
    rejectPendingConnection,
    rejectPendingLiveStart,
    resetSessionState,
    setRelayConnected,
    setVoiceError,
    setVoiceStatus,
  ]);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      logVoiceClient("disconnect.close_socket", { readyState: ws.readyState });
      ws.close();
      wsRef.current = null;
    }
    isLiveReadyRef.current = false;
    rejectPendingLiveStart(new Error("Voice relay disconnected."));
    setIsConnected(false);
    setIsConnecting(false);
    setRelayConnected(false);
    setVoiceStatus("IDLE");
    logVoiceClient("disconnect.complete");
  }, [rejectPendingLiveStart, setRelayConnected, setVoiceStatus]);

  const sendVoiceUtterance = useCallback(
    (data: string, durationMs: number) => {
      sendMessage({
        type: "voice_utterance",
        data,
        mimeType: "audio/wav",
        durationMs,
      });
    },
    [sendMessage],
  );

  const startLive = useCallback(() => {
    if (isLiveReadyRef.current) {
      return Promise.resolve();
    }
    if (pendingLiveStartRef.current) {
      return pendingLiveStartRef.current.promise;
    }

    let resolveLiveStart!: () => void;
    let rejectLiveStart!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveLiveStart = resolve;
      rejectLiveStart = reject;
    });
    const pending: PendingLiveStart = {
      promise,
      resolve: resolveLiveStart,
      reject: rejectLiveStart,
      timeout: setTimeout(() => {
        pendingLiveStartRef.current = null;
        isLiveReadyRef.current = false;
        logVoiceClient("live.start.timeout");
        rejectLiveStart(new Error("Live Conversation setup timed out."));
      }, 15_000),
    };
    pendingLiveStartRef.current = pending;
    isLiveReadyRef.current = false;
    setVoiceStatus("LIVE_CONNECTING");
    setVoiceError(null);

    if (!sendMessage({ type: "live_start" })) {
      rejectPendingLiveStart(new Error("Voice relay is not connected."));
    }

    return promise;
  }, [rejectPendingLiveStart, sendMessage, setVoiceError, setVoiceStatus]);

  const sendLiveAudioChunk = useCallback(
    (base64Audio: string) => {
      if (!isLiveReadyRef.current) {
        logVoiceClient("live.audio.drop_not_ready", {
          dataLength: base64Audio.length,
        });
        return;
      }
      sendMessage({ type: "live_audio", data: base64Audio });
    },
    [sendMessage],
  );

  const stopLive = useCallback(() => {
    isLiveReadyRef.current = false;
    rejectPendingLiveStart(new Error("Live Conversation stopped."));
    sendMessage({ type: "live_stop" });
  }, [rejectPendingLiveStart, sendMessage]);

  const sendTextMessage = useCallback(
    (text: string) => {
      sendMessage({ type: "text", text });
    },
    [sendMessage],
  );

  const sendAddToCart = useCallback(
    (productId: string, quantity: number) => {
      sendMessage({ type: "add_to_cart", productId, quantity });
    },
    [sendMessage],
  );

  const createOrder = useCallback((checkout: CheckoutDetails) => {
    setCheckoutStatus("CREATING");
    sendMessage({ type: "create_order", checkout });
  }, [sendMessage, setCheckoutStatus]);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    sendVoiceUtterance,
    startLive,
    sendLiveAudioChunk,
    stopLive,
    sendTextMessage,
    sendAddToCart,
    createOrder,
  };
}

function logVoiceClient(event: string, details: Record<string, unknown> = {}) {
  console.info("[voice-client]", event, details);
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

  return { type: message.type, hasCheckout: true };
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

function isLiveRelayError(message: string): boolean {
  return /\b(live conversation|voice service|gemini live)\b/i.test(message);
}
