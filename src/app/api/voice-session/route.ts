import { NextResponse } from "next/server";
import { createVoiceSessionToken } from "@/lib/voice-token";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const relayPublicUrl = process.env.VOICE_RELAY_PUBLIC_URL;
  const tokenSecret = process.env.VOICE_RELAY_TOKEN_SECRET;
  console.info("[voice-session]", "request.start", {
    hasRelayPublicUrl: Boolean(relayPublicUrl),
    hasTokenSecret: Boolean(tokenSecret),
  });

  if (!relayPublicUrl || !tokenSecret) {
    console.error("[voice-session]", "request.missing_config");
    return NextResponse.json(
      { error: "Voice relay is not configured." },
      { status: 500 },
    );
  }

  const { token, payload } = createVoiceSessionToken(tokenSecret);
  const relayUrl = createBrowserReachableRelayUrl(relayPublicUrl, request);
  relayUrl.searchParams.set("token", token);
  console.info("[voice-session]", "request.success", {
    relayProtocol: relayUrl.protocol,
    relayHost: relayUrl.host,
    expiresAt: payload.expiresAt,
  });

  return NextResponse.json(
    {
      relayUrl: relayUrl.toString(),
      expiresAt: payload.expiresAt,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function createBrowserReachableRelayUrl(relayPublicUrl: string, request: Request): URL {
  const relayUrl = new URL(relayPublicUrl);
  const requestHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!requestHost || !isLocalRelayHost(relayUrl.hostname)) return relayUrl;

  const requestOrigin = parseRequestOrigin(request, requestHost);
  if (!requestOrigin) return relayUrl;

  if (!isLocalRelayHost(requestOrigin.hostname)) {
    relayUrl.hostname = requestOrigin.hostname;
  }
  relayUrl.protocol = requestOrigin.protocol === "https:" ? "wss:" : "ws:";
  return relayUrl;
}

function parseRequestOrigin(request: Request, host: string): URL | null {
  const fallbackProtocol = new URL(request.url).protocol;
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProtocol ? `${forwardedProtocol}:` : fallbackProtocol;

  try {
    return new URL(`${protocol}//${host}`);
  } catch {
    return null;
  }
}

function isLocalRelayHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(
    hostname.toLowerCase(),
  );
}
