import { describe, expect, it } from "vitest";
import {
  getAudioCaptureSupportError,
  normalizeAudioCaptureError,
} from "./audio-capture-support";

describe("audio capture support", () => {
  it("returns a secure-origin message for insecure browser contexts", () => {
    const error = getAudioCaptureSupportError({
      isSecureContext: false,
      getUserMedia: async () => new MediaStream(),
    });

    expect(error).toMatchObject({
      code: "INSECURE_CONTEXT",
      expected: true,
    });
    expect(error?.userMessage).toMatch(/secure page on android/i);
  });

  it("returns unsupported guidance when getUserMedia is unavailable", () => {
    const error = getAudioCaptureSupportError({
      isSecureContext: true,
      getUserMedia: undefined,
    });

    expect(error).toMatchObject({
      code: "UNSUPPORTED_BROWSER",
      expected: true,
    });
    expect(error?.userMessage).toMatch(/chrome over https/i);
  });

  it("maps permission denials to a friendly message", () => {
    const error = normalizeAudioCaptureError({ name: "NotAllowedError" });

    expect(error).toMatchObject({
      code: "PERMISSION_DENIED",
      expected: true,
    });
    expect(error.userMessage).toMatch(/permission was blocked/i);
  });

  it("maps missing microphone errors to a friendly message", () => {
    const error = normalizeAudioCaptureError({ name: "NotFoundError" });

    expect(error).toMatchObject({
      code: "NO_MICROPHONE",
      expected: true,
    });
    expect(error.userMessage).toMatch(/no microphone/i);
  });
});
