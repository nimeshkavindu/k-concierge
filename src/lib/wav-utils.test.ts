import { describe, expect, it } from "vitest";
import {
  getPcm16Base64DurationMs,
  isSilentPcm16Base64,
  pcm16Base64ChunksToWavBase64,
} from "./wav-utils";

describe("wav-utils", () => {
  it("wraps PCM16 chunks in a mono WAV container", () => {
    const chunk = Buffer.from([0, 16, 0, 16]).toString("base64");
    const wav = Buffer.from(
      pcm16Base64ChunksToWavBase64([chunk], 16_000),
      "base64",
    );

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(4);
  });

  it("computes duration from PCM16 sample count", () => {
    const oneSecond = Buffer.alloc(16_000 * 2).toString("base64");

    expect(getPcm16Base64DurationMs([oneSecond], 16_000)).toBe(1000);
  });

  it("detects silent and voiced PCM16 chunks", () => {
    const silence = Buffer.alloc(512).toString("base64");
    const voiced = Buffer.from([0, 16, 0, 16, 0, 16, 0, 16]).toString("base64");

    expect(isSilentPcm16Base64([])).toBe(true);
    expect(isSilentPcm16Base64([silence])).toBe(true);
    expect(isSilentPcm16Base64([voiced])).toBe(false);
  });
});
