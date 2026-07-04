import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { DEFAULT_GEMINI_TEXT_MODEL } from "../src/lib/gemini-flash-client";
import { createVoiceRelayServer, type RelayTlsConfig } from "./voice-relay-server";

loadEnvConfig(process.cwd());

const port = Number(process.env.VOICE_RELAY_PORT ?? process.env.PORT ?? 8787);
const host = process.env.VOICE_RELAY_HOST ?? "0.0.0.0";
const tokenSecret = process.env.VOICE_RELAY_TOKEN_SECRET;
const geminiApiKey = process.env.GEMINI_API_KEY;
const liveEnabled = process.env.GEMINI_LIVE_ENABLED !== "false";
const tls = loadRelayTlsConfig();

if (!tokenSecret) {
  console.error("VOICE_RELAY_TOKEN_SECRET is required.");
  process.exit(1);
}

if (!geminiApiKey) {
  console.error("GEMINI_API_KEY is required.");
  process.exit(1);
}

const server = createVoiceRelayServer({
  port,
  host,
  tokenSecret,
  geminiApiKey,
  geminiEndpoint: process.env.GEMINI_LIVE_ENDPOINT,
  geminiTextEndpoint: process.env.GEMINI_TEXT_ENDPOINT,
  geminiTextModel: process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL,
  geminiAudioModel: process.env.GEMINI_AUDIO_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL,
  geminiLiveModel: process.env.GEMINI_LIVE_MODEL,
  liveEnabled,
  tls,
  voiceUtteranceMaxMs: Number(process.env.VOICE_UTTERANCE_MAX_MS ?? 30_000),
  liveSessionMaxMs: Number(process.env.LIVE_SESSION_MAX_MS ?? 180_000),
  mcpEndpoint: process.env.MCP_ENDPOINT,
});

server.on("listening", () => {
  console.log(`Voice relay listening on ${tls ? "wss" : "ws"}://${host}:${port}`);
});

server.on("error", (error) => {
  console.error("Voice relay failed:", error);
  process.exitCode = 1;
});

function loadRelayTlsConfig(): RelayTlsConfig | undefined {
  const keyPath = process.env.VOICE_RELAY_TLS_KEY;
  const certPath = process.env.VOICE_RELAY_TLS_CERT;
  const caPath = process.env.VOICE_RELAY_TLS_CA;

  if (!keyPath && !certPath && !caPath) return undefined;

  if (!keyPath || !certPath) {
    console.error(
      "VOICE_RELAY_TLS_KEY and VOICE_RELAY_TLS_CERT are both required for WSS relay mode.",
    );
    process.exit(1);
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
    ca: caPath ? readFileSync(caPath) : undefined,
  };
}
