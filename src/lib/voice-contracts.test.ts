import { describe, expect, it } from "vitest";
import {
  ClientMessageSchema,
  MAX_VOICE_UTTERANCE_BASE64_LENGTH,
  MAX_VOICE_UTTERANCE_DURATION_MS,
  RelayServerMessageSchema,
} from "./voice-contracts";

describe("voice contracts", () => {
  it("accepts turn-based voice utterance messages", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "voice_utterance",
        data: "AAAA",
        mimeType: "audio/wav",
        durationMs: 1200,
      }).success,
    ).toBe(true);
  });

  it("rejects oversized or overlong voice utterance messages", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "voice_utterance",
        data: "AAAA",
        mimeType: "audio/wav",
        durationMs: MAX_VOICE_UTTERANCE_DURATION_MS + 1,
      }).success,
    ).toBe(false);

    expect(
      ClientMessageSchema.safeParse({
        type: "voice_utterance",
        data: "A".repeat(MAX_VOICE_UTTERANCE_BASE64_LENGTH + 1),
        mimeType: "audio/wav",
        durationMs: 1000,
      }).success,
    ).toBe(false);
  });

  it("accepts explicit live control messages", () => {
    expect(ClientMessageSchema.safeParse({ type: "live_start" }).success).toBe(true);
    expect(
      ClientMessageSchema.safeParse({ type: "live_audio", data: "AAAA" }).success,
    ).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "live_stop" }).success).toBe(true);
  });

  it("accepts expanded voice statuses from the relay", () => {
    expect(
      RelayServerMessageSchema.safeParse({
        type: "status",
        status: "TRANSCRIBING",
      }).success,
    ).toBe(true);
    expect(
      RelayServerMessageSchema.safeParse({
        type: "status",
        status: "LIVE",
      }).success,
    ).toBe(true);
  });
});
