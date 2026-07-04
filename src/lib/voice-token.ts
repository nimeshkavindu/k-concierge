import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const VOICE_SESSION_TTL_MS = 5 * 60 * 1000;

const VoiceSessionTokenPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
});

export type VoiceSessionTokenPayload = z.infer<
  typeof VoiceSessionTokenPayloadSchema
>;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodePayload(payload: VoiceSessionTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function createVoiceSessionToken(
  secret: string,
  now = Date.now(),
  ttlMs = VOICE_SESSION_TTL_MS,
): { token: string; payload: VoiceSessionTokenPayload } {
  if (!secret) {
    throw new Error("VOICE_RELAY_TOKEN_SECRET is required.");
  }

  const payload = {
    sessionId: randomUUID(),
    expiresAt: now + ttlMs,
  };
  const encodedPayload = encodePayload(payload);
  return {
    token: `${encodedPayload}.${sign(encodedPayload, secret)}`,
    payload,
  };
}

export function verifyVoiceSessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): VoiceSessionTokenPayload | null {
  if (!token || !secret) return null;

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return null;

  const expected = sign(encodedPayload, secret);
  const expectedBuffer = Buffer.from(expected, "base64url");
  const receivedBuffer = Buffer.from(signature, "base64url");
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }

  try {
    const payload = VoiceSessionTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    return payload.expiresAt > now ? payload : null;
  } catch {
    return null;
  }
}
