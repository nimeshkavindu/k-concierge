import { describe, expect, it } from "vitest";
import { createVoiceSessionToken, verifyVoiceSessionToken } from "./voice-token";

describe("voice session tokens", () => {
  it("creates verifiable expiring tokens", () => {
    const now = 1_800_000_000_000;
    const { token, payload } = createVoiceSessionToken("secret", now, 1000);

    expect(verifyVoiceSessionToken(token, "secret", now)).toEqual(payload);
    expect(verifyVoiceSessionToken(token, "wrong-secret", now)).toBeNull();
    expect(verifyVoiceSessionToken(token, "secret", now + 1001)).toBeNull();
  });

  it("rejects tampered token payloads", () => {
    const { token } = createVoiceSessionToken("secret");
    const [payload, signature] = token.split(".");
    const tampered = `${payload?.slice(0, -1)}x.${signature}`;

    expect(verifyVoiceSessionToken(tampered, "secret")).toBeNull();
  });
});
