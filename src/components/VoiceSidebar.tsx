"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useVoiceRelay } from "@/hooks/useVoiceRelay";
import { isAudioCaptureStartError } from "@/lib/audio-capture-support";
import { MAX_VOICE_UTTERANCE_DURATION_MS } from "@/lib/voice-contracts";
import {
  getPcm16Base64DurationMs,
  isSilentPcm16Base64,
  pcm16Base64ChunksToWavBase64,
} from "@/lib/wav-utils";
import {
  Headphones,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  PackageSearch,
  ShoppingBag,
} from "lucide-react";

export default function VoiceSidebar() {
  const {
    activeStage,
    agentVoiceStatus,
    lastUserIntent,
    latestAssistantReply,
    productStatus,
    relayConnected,
    setAssistantCommands,
    setListening,
    setProductStatus,
    setRelayCommands,
    setStage,
    setVoiceError,
    setVoiceStatus,
    voiceError,
  } = useAppStore();
  const [recordingMode, setRecordingMode] = useState<"turn" | "live" | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isLivePanelOpen, setIsLivePanelOpen] = useState(false);
  const turnChunksRef = useRef<string[]>([]);
  const turnStartedAtRef = useRef<number>(0);
  const maxTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { initPlayback, playAudioChunk, stopPlayback } = useAudioPlayback();
  const { startRecording, stopRecording } = useAudioCapture();
  const isRecordingTurn = recordingMode === "turn";
  const isLiveRecording = recordingMode === "live";
  const isLiveConnecting = agentVoiceStatus === "LIVE_CONNECTING" && !isLiveRecording;

  const clearTurnTimers = useCallback(() => {
    if (maxTurnTimerRef.current) {
      clearTimeout(maxTurnTimerRef.current);
      maxTurnTimerRef.current = null;
    }
    if (turnTickTimerRef.current) {
      clearInterval(turnTickTimerRef.current);
      turnTickTimerRef.current = null;
    }
  }, []);

  const stopVoiceRecording = useCallback(() => {
    clearTurnTimers();
    stopRecording();
    setRecordingMode(null);
    setRecordingSeconds(0);
    setListening(false);
  }, [clearTurnTimers, setListening, stopRecording]);

  const {
    isConnected,
    isConnecting,
    connect,
    createOrder,
    disconnect,
    sendAddToCart,
    sendLiveAudioChunk,
    sendTextMessage,
    sendVoiceUtterance,
    startLive,
    stopLive,
  } = useVoiceRelay(playAudioChunk, { onDisconnect: stopVoiceRecording });

  const handleAudioCaptureFailure = useCallback(
    (eventName: string, error: unknown) => {
      if (!isAudioCaptureStartError(error)) return false;

      const log = error.expected ? console.warn : console.error;
      log("[voice-ui]", eventName, {
        code: error.code,
        message: error.message,
      });
      setVoiceError(error.userMessage);
      stopVoiceRecording();
      setVoiceStatus("IDLE");
      return error.expected;
    },
    [setVoiceError, setVoiceStatus, stopVoiceRecording],
  );

  const sendRecordedTurn = useCallback(() => {
    const chunks = turnChunksRef.current;
    const durationMs = Math.min(
      getPcm16Base64DurationMs(chunks),
      MAX_VOICE_UTTERANCE_DURATION_MS,
    );
    stopVoiceRecording();

    if (isSilentPcm16Base64(chunks)) {
      setVoiceError("I could not hear a clear voice request. Try speaking again or type it.");
      setVoiceStatus("IDLE");
      return;
    }

    const wavBase64 = pcm16Base64ChunksToWavBase64(chunks);
    console.info("[voice-ui]", "voice.utterance_send", {
      chunks: chunks.length,
      durationMs,
      wavLength: wavBase64.length,
    });
    setVoiceError(null);
    setVoiceStatus("TRANSCRIBING");
    sendVoiceUtterance(wavBase64, Math.max(durationMs, 1));
  }, [sendVoiceUtterance, setVoiceError, setVoiceStatus, stopVoiceRecording]);

  const toggleVoiceSession = useCallback(async () => {
    console.info("[voice-ui]", "voice.turn_toggle", {
      isConnected,
      isConnecting,
      recordingMode,
    });

    if (isConnecting) {
      console.info("[voice-ui]", "voice.turn_connect_cancel_requested");
      stopVoiceRecording();
      disconnect();
      return;
    }

    if (isRecordingTurn) {
      console.info("[voice-ui]", "voice.turn_stop_and_send_requested");
      sendRecordedTurn();
      return;
    }

    if (isLiveRecording) {
      setVoiceError("Stop Live Conversation before using tap-to-speak.");
      return;
    }

    try {
      if (!isConnected) {
        console.info("[voice-ui]", "voice.turn_connect_start");
        await connect();
      }
      turnChunksRef.current = [];
      turnStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      console.info("[voice-ui]", "voice.turn_recording_start");
      await startRecording((chunk) => {
        turnChunksRef.current.push(chunk);
      });
      setRecordingMode("turn");
      setListening(true);
      setVoiceError(null);
      setVoiceStatus("RECORDING");
      maxTurnTimerRef.current = setTimeout(() => {
        console.info("[voice-ui]", "voice.turn_max_duration_reached");
        sendRecordedTurn();
      }, MAX_VOICE_UTTERANCE_DURATION_MS);
      turnTickTimerRef.current = setInterval(() => {
        setRecordingSeconds(
          Math.floor((Date.now() - turnStartedAtRef.current) / 1000),
        );
      }, 250);
    } catch (error) {
      if (handleAudioCaptureFailure("voice.turn_start_failed", error)) return;

      console.error("[voice-ui]", "voice.turn_start_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      setVoiceError(
        "Microphone could not start. Check browser permission and try again.",
      );
      stopVoiceRecording();
      setVoiceStatus("IDLE");
      throw error;
    }
  }, [
    connect,
    disconnect,
    isConnected,
    isConnecting,
    isLiveRecording,
    isRecordingTurn,
    recordingMode,
    handleAudioCaptureFailure,
    sendRecordedTurn,
    setListening,
    setVoiceError,
    setVoiceStatus,
    startRecording,
    stopVoiceRecording,
  ]);

  const cancelVoiceTurn = useCallback(() => {
    console.info("[voice-ui]", "voice.turn_cancel");
    turnChunksRef.current = [];
    stopVoiceRecording();
    setVoiceStatus("IDLE");
  }, [setVoiceStatus, stopVoiceRecording]);

  const toggleLiveConversation = useCallback(async () => {
    console.info("[voice-ui]", "live.toggle", {
      isConnected,
      isConnecting,
      recordingMode,
    });

    if (isLiveRecording) {
      console.info("[voice-ui]", "live.stop_requested");
      stopVoiceRecording();
      stopLive();
      stopPlayback();
      setVoiceStatus("IDLE");
      return;
    }

    if (isRecordingTurn) {
      cancelVoiceTurn();
    }

    initPlayback();
    try {
      if (!isConnected) {
        console.info("[voice-ui]", "live.connect_start");
        await connect();
      }
      setVoiceStatus("LIVE_CONNECTING");
      await startLive();
      await startRecording(sendLiveAudioChunk);
      setRecordingMode("live");
      setListening(true);
      setVoiceError(null);
      setVoiceStatus("LIVE");
    } catch (error) {
      if (isAudioCaptureStartError(error)) {
        stopLive();
        if (handleAudioCaptureFailure("live.start_failed", error)) {
          stopPlayback();
          return;
        }
      }

      console.error("[voice-ui]", "live.start_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      setVoiceError("Live Conversation could not start. Try again in a moment.");
      stopPlayback();
      stopVoiceRecording();
      setVoiceStatus("IDLE");
      throw error;
    }
  }, [
    cancelVoiceTurn,
    connect,
    initPlayback,
    isConnected,
    isConnecting,
    isLiveRecording,
    isRecordingTurn,
    recordingMode,
    handleAudioCaptureFailure,
    sendLiveAudioChunk,
    setListening,
    setVoiceError,
    setVoiceStatus,
    startLive,
    startRecording,
    stopLive,
    stopPlayback,
    stopVoiceRecording,
  ]);

  const submitTextPrompt = useCallback(
    async (text: string) => {
      const nextMessage = text.trim();
      console.info("[voice-ui]", "text.submit", {
        length: nextMessage.length,
        isConnected,
        isConnecting,
      });
      if (!nextMessage || isConnecting) return;

      try {
        if (!isConnected) {
          console.info("[voice-ui]", "text.connect_start");
          await connect();
        }
        console.info("[voice-ui]", "text.send");
        sendTextMessage(nextMessage);
      } catch (error) {
        console.error("[voice-ui]", "text.send_failed");
        setProductStatus("error");
        throw error;
      }
    },
    [
      connect,
      isConnected,
      isConnecting,
      sendTextMessage,
      setProductStatus,
    ],
  );

  const addProductToCart = useCallback(
    async (productId: string, quantity: number) => {
      console.info("[voice-ui]", "text.add_product_to_cart", {
        productId,
        quantity,
        isConnected,
        isConnecting,
      });
      if (isConnecting) return;

      if (!isConnected) {
        console.info("[voice-ui]", "cart.connect_start");
        await connect();
      }
      sendAddToCart(productId, quantity);
    },
    [connect, isConnected, isConnecting, sendAddToCart],
  );

  useEffect(() => {
    setAssistantCommands({
      addProductToCart,
      submitText: submitTextPrompt,
      toggleVoice: toggleVoiceSession,
    });

    return () => setAssistantCommands(null);
  }, [addProductToCart, setAssistantCommands, submitTextPrompt, toggleVoiceSession]);

  useEffect(() => {
    setRelayCommands(
      isConnected
        ? {
            addToCart: sendAddToCart,
            createOrder,
          }
        : null,
    );
  }, [createOrder, isConnected, sendAddToCart, setRelayCommands]);

  useEffect(() => {
    return () => {
      stopVoiceRecording();
      stopPlayback();
      disconnect();
      setAssistantCommands(null);
      setRelayCommands(null);
    };
  }, [
    disconnect,
    setAssistantCommands,
    setRelayCommands,
    stopPlayback,
    stopVoiceRecording,
  ]);

  const statusText = getStatusText({
    isConnected,
    isConnecting,
    isRecording: isRecordingTurn,
    isLiveRecording,
    productStatus,
    relayConnected,
    agentVoiceStatus,
  });

  return (
    <>
      <aside
        className="desktop-icon-rail hidden lg:flex"
        aria-label="Kapruka Concierge navigation"
      >
        <nav className="flex flex-col items-center gap-4" aria-label="Shopping stages">
          <RailButton
            active={activeStage === "WELCOME"}
            label="Ask"
            onClick={() => setStage("WELCOME")}
          >
            <MessageCircle className="h-5 w-5" />
          </RailButton>
          <RailButton
            active={activeStage === "PRODUCT_CATALOG"}
            label="Finds"
            onClick={() => setStage("PRODUCT_CATALOG")}
          >
            <PackageSearch className="h-5 w-5" />
          </RailButton>
          <RailButton
            active={activeStage === "CHECKOUT"}
            label="Order"
            onClick={() => setStage("CHECKOUT")}
          >
            <ShoppingBag className="h-5 w-5" />
          </RailButton>
        </nav>
      </aside>

      <section className="voice-bottom-dock hidden lg:flex" aria-label="Voice controls">
        <div className="min-w-[10rem]">
          <p className="text-xs font-semibold text-retail-charcoal">Turn-based voice</p>
          <p className="text-[0.68rem] text-retail-muted">Simple, clear steps.</p>
        </div>

        <button
          type="button"
          aria-label={isRecordingTurn ? "Stop and send voice request" : "Tap to speak"}
          aria-pressed={isRecordingTurn}
          onClick={toggleVoiceSession}
          disabled={isLiveRecording}
          className={`flex h-11 items-center justify-center gap-2 rounded-full border px-4 text-sm font-black transition-all ${
            isRecordingTurn
              ? "border-kapruka-red bg-kapruka-red text-white"
              : "border-retail-border bg-white text-retail-charcoal hover:border-kapruka-red/30 hover:text-kapruka-red"
          } disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500`}
        >
          {isConnecting ||
          agentVoiceStatus === "CONNECTING" ||
          agentVoiceStatus === "TRANSCRIBING" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isRecordingTurn ? (
            <Mic className="h-4 w-4" />
          ) : (
            <MicOff className="h-4 w-4" />
          )}
          {isRecordingTurn ? "Stop and send" : "Tap to speak"}
        </button>

        <span className="text-retail-muted">{"->"}</span>

        <div className="flex h-11 min-w-[12rem] items-center justify-center gap-2 rounded-full border border-retail-border bg-white px-4 text-sm font-semibold text-retail-charcoal">
          <span
            className={`h-2 w-2 rounded-full ${
              isRecordingTurn ? "bg-kapruka-red" : "bg-emerald-500"
            }`}
          />
          {statusText}
          {isRecordingTurn && (
            <span className="text-kapruka-red">{recordingSeconds}s</span>
          )}
        </div>

        {isRecordingTurn && (
          <button
            type="button"
            onClick={cancelVoiceTurn}
            className="h-11 rounded-full border border-retail-border bg-white px-4 text-sm font-semibold text-retail-charcoal"
          >
            Cancel
          </button>
        )}

        <div className="h-10 w-px bg-retail-border" />

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsLivePanelOpen((open) => !open)}
            className="flex h-11 items-center justify-center gap-2 rounded-full border border-retail-border bg-white px-4 text-sm font-semibold text-retail-charcoal"
            aria-expanded={isLivePanelOpen}
          >
            <Headphones className="h-4 w-4" />
            Live Conversation
          </button>
          {isLivePanelOpen && (
            <div className="absolute bottom-14 right-0 w-72 rounded-[1.25rem] border border-retail-border bg-white p-4 shadow-2xl shadow-retail-charcoal/15">
              <p className="text-xs leading-5 text-retail-muted">
                Real-time voice uses Gemini Live audio. Use it only for a continuous spoken discussion.
              </p>
              <button
                type="button"
                onClick={toggleLiveConversation}
                disabled={isConnecting || isLiveConnecting}
                aria-pressed={isLiveRecording}
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-bold transition-colors ${
                  isLiveRecording
                    ? "bg-kapruka-red text-white"
                    : "border border-retail-border bg-white text-retail-charcoal hover:border-kapruka-red/30 hover:text-kapruka-red"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {agentVoiceStatus === "LIVE_CONNECTING" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Headphones className="h-4 w-4" />
                )}
                {isLiveRecording ? "Stop Live" : isLiveConnecting ? "Starting..." : "Start Live"}
              </button>
            </div>
          )}
        </div>

        {(latestAssistantReply || lastUserIntent) && (
          <p className="max-w-[13rem] truncate text-xs text-retail-muted">
            {latestAssistantReply || lastUserIntent}
          </p>
        )}
        {voiceError && (
          <p className="max-w-[16rem] truncate text-xs font-semibold text-kapruka-red" role="alert">
            {voiceError}
          </p>
        )}
      </section>

      <p className="sr-only" aria-live="polite">
        {statusText}
      </p>
    </>
  );
}

function RailButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-center gap-1 text-[0.68rem] font-semibold transition-colors ${
        active ? "text-kapruka-red" : "text-retail-muted hover:text-retail-charcoal"
      }`}
      aria-label={label}
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors ${
          active
            ? "border-kapruka-red bg-kapruka-red text-white"
            : "border-transparent bg-transparent group-hover:border-retail-border group-hover:bg-white"
        }`}
      >
        {children}
      </span>
      {label}
    </button>
  );
}

function getStatusText({
  isConnected,
  isConnecting,
  isRecording,
  isLiveRecording,
  productStatus,
  relayConnected,
  agentVoiceStatus,
}: {
  isConnected: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  isLiveRecording: boolean;
  productStatus: string;
  relayConnected: boolean;
  agentVoiceStatus: string;
}): string {
  if (isConnecting || agentVoiceStatus === "CONNECTING") return "Connecting";
  if (agentVoiceStatus === "LIVE_CONNECTING") return "Live connecting";
  if (agentVoiceStatus === "TRANSCRIBING") return "Transcribing";
  if (isRecording || agentVoiceStatus === "RECORDING") return "Recording";
  if (agentVoiceStatus === "THINKING") return "Thinking";
  if (productStatus === "searching") return "Searching Kapruka";
  if (agentVoiceStatus === "SPEAKING") return "Responding";
  if (isLiveRecording || agentVoiceStatus === "LIVE") return "Live";
  if (agentVoiceStatus === "LISTENING") return "Listening";
  if (isConnected || relayConnected) return "Connected";
  return "Ready";
}
