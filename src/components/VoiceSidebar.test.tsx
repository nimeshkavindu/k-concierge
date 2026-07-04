// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VoiceSidebar from "./VoiceSidebar";
import { useAppStore } from "@/store/app-store";
import { AudioCaptureStartError } from "@/lib/audio-capture-support";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createOrder: vi.fn(),
  disconnect: vi.fn(),
  initPlayback: vi.fn(),
  playAudioChunk: vi.fn(),
  sendAddToCart: vi.fn(),
  sendLiveAudioChunk: vi.fn(),
  sendTextMessage: vi.fn(),
  sendVoiceUtterance: vi.fn(),
  startLive: vi.fn(),
  startRecording: vi.fn(),
  stopLive: vi.fn(),
  stopPlayback: vi.fn(),
  stopRecording: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/hooks/useAudioPlayback", () => ({
  useAudioPlayback: () => ({
    initPlayback: mocks.initPlayback,
    playAudioChunk: mocks.playAudioChunk,
    stopPlayback: mocks.stopPlayback,
  }),
}));

vi.mock("@/hooks/useAudioCapture", () => ({
  useAudioCapture: () => ({
    startRecording: mocks.startRecording,
    stopRecording: mocks.stopRecording,
  }),
}));

vi.mock("@/hooks/useVoiceRelay", () => ({
  useVoiceRelay: () => ({
    isConnected: false,
    isConnecting: false,
    connect: mocks.connect,
    createOrder: mocks.createOrder,
    disconnect: mocks.disconnect,
    sendAddToCart: mocks.sendAddToCart,
    sendLiveAudioChunk: mocks.sendLiveAudioChunk,
    sendTextMessage: mocks.sendTextMessage,
    sendVoiceUtterance: mocks.sendVoiceUtterance,
    startLive: mocks.startLive,
    stopLive: mocks.stopLive,
  }),
}));

describe("VoiceSidebar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.order.length = 0;
    useAppStore.getState().resetSessionState();
    useAppStore.setState({
      activeStage: "WELCOME",
      agentVoiceStatus: "IDLE",
      relayConnected: false,
      relayCommands: null,
      assistantCommands: null,
    });
  });

  it("waits for relay connection before starting tap-to-speak capture", async () => {
    mocks.connect.mockImplementation(async () => {
      mocks.order.push("connect");
    });
    mocks.startRecording.mockImplementation(async () => {
      mocks.order.push("record");
    });

    render(<VoiceSidebar />);
    fireEvent.click(screen.getByRole("button", { name: /tap to speak/i }));

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1));
    expect(mocks.order).toEqual(["connect", "record"]);
    expect(mocks.initPlayback).not.toHaveBeenCalled();
    expect(mocks.startLive).not.toHaveBeenCalled();
    expect(mocks.sendLiveAudioChunk).not.toHaveBeenCalled();
  });

  it("sends one voice utterance when tap-to-speak recording stops", async () => {
    const voicedChunk = window.btoa(String.fromCharCode(0, 16, 0, 16, 0, 16, 0, 16));
    mocks.startRecording.mockImplementation(async (onChunk: (chunk: string) => void) => {
      onChunk(voicedChunk);
    });

    render(<VoiceSidebar />);
    fireEvent.click(screen.getByRole("button", { name: /tap to speak/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop and send voice request/i }))
        .toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /stop and send voice request/i }));

    await waitFor(() => expect(mocks.sendVoiceUtterance).toHaveBeenCalledTimes(1));
    expect(mocks.sendVoiceUtterance.mock.calls[0][0]).toEqual(expect.any(String));
    expect(mocks.sendVoiceUtterance.mock.calls[0][1]).toBeGreaterThan(0);
    expect(mocks.sendLiveAudioChunk).not.toHaveBeenCalled();
  });

  it("shows expected microphone failures without rethrowing tap-to-speak", async () => {
    mocks.startRecording.mockRejectedValue(
      new AudioCaptureStartError({
        code: "INSECURE_CONTEXT",
        message: "Microphone capture requires a secure browser context.",
        userMessage: "Voice needs a secure page on Android.",
      }),
    );

    render(<VoiceSidebar />);
    await waitFor(() =>
      expect(useAppStore.getState().assistantCommands).not.toBeNull(),
    );

    await expect(useAppStore.getState().requestVoiceToggle()).resolves.toBeUndefined();

    expect(mocks.startRecording).toHaveBeenCalledTimes(1);
    expect(mocks.stopRecording).toHaveBeenCalled();
    expect(mocks.sendVoiceUtterance).not.toHaveBeenCalled();
    expect(useAppStore.getState().agentVoiceStatus).toBe("IDLE");
    expect(useAppStore.getState().voiceError).toBe(
      "Voice needs a secure page on Android.",
    );
  });

  it("connects without recording when the primary text command sends a message", async () => {
    mocks.connect.mockImplementation(async () => {
      mocks.order.push("connect");
    });

    render(<VoiceSidebar />);
    await waitFor(() =>
      expect(useAppStore.getState().assistantCommands).not.toBeNull(),
    );

    await useAppStore
      .getState()
      .requestAssistantText("Find birthday cakes in Colombo");

    await waitFor(() => expect(mocks.sendTextMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(
      "Find birthday cakes in Colombo",
    );
    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.order).toEqual(["connect"]);
    expect(useAppStore.getState().productStatus).toBe("searching");
  });

  it("waits for live readiness before streaming microphone audio", async () => {
    let resolveLive!: () => void;
    const liveReady = new Promise<void>((resolve) => {
      resolveLive = resolve;
    });
    mocks.connect.mockImplementation(async () => {
      mocks.order.push("connect");
    });
    mocks.startLive.mockImplementation(() => {
      mocks.order.push("live");
      return liveReady;
    });
    mocks.startRecording.mockImplementation(async (onChunk: (chunk: string) => void) => {
      mocks.order.push("record");
      onChunk("AAAA");
    });

    render(<VoiceSidebar />);
    fireEvent.click(screen.getByRole("button", { name: /live conversation/i }));
    fireEvent.click(screen.getByRole("button", { name: /start live/i }));

    await waitFor(() => expect(mocks.startLive).toHaveBeenCalledTimes(1));
    expect(mocks.initPlayback).toHaveBeenCalledTimes(1);
    expect(mocks.startRecording).not.toHaveBeenCalled();
    expect(mocks.sendLiveAudioChunk).not.toHaveBeenCalled();

    await act(async () => {
      resolveLive();
      await liveReady;
    });

    await waitFor(() => expect(mocks.startRecording).toHaveBeenCalledTimes(1));
    expect(mocks.order).toEqual(["connect", "live", "record"]);
    expect(mocks.sendLiveAudioChunk).toHaveBeenCalledWith("AAAA");
    expect(mocks.sendVoiceUtterance).not.toHaveBeenCalled();
  });

  it("shows expected microphone failures without rethrowing live conversation", async () => {
    mocks.startRecording.mockRejectedValue(
      new AudioCaptureStartError({
        code: "PERMISSION_DENIED",
        message: "Microphone permission was denied.",
        userMessage: "Microphone permission was blocked.",
      }),
    );

    render(<VoiceSidebar />);
    fireEvent.click(screen.getByRole("button", { name: /live conversation/i }));
    fireEvent.click(screen.getByRole("button", { name: /start live/i }));

    await waitFor(() =>
      expect(useAppStore.getState().voiceError).toBe(
        "Microphone permission was blocked.",
      ),
    );
    expect(mocks.startLive).toHaveBeenCalledTimes(1);
    expect(mocks.stopLive).toHaveBeenCalledTimes(1);
    expect(mocks.stopPlayback).toHaveBeenCalledTimes(1);
    expect(mocks.stopRecording).toHaveBeenCalled();
    expect(mocks.sendLiveAudioChunk).not.toHaveBeenCalled();
    expect(useAppStore.getState().agentVoiceStatus).toBe("IDLE");
  });
});
