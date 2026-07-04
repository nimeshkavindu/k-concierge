import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const ORIGINAL_ENV = {
  VOICE_RELAY_PUBLIC_URL: process.env.VOICE_RELAY_PUBLIC_URL,
  VOICE_RELAY_TOKEN_SECRET: process.env.VOICE_RELAY_TOKEN_SECRET,
};

describe("voice session route", () => {
  afterEach(() => {
    process.env.VOICE_RELAY_PUBLIC_URL = ORIGINAL_ENV.VOICE_RELAY_PUBLIC_URL;
    process.env.VOICE_RELAY_TOKEN_SECRET = ORIGINAL_ENV.VOICE_RELAY_TOKEN_SECRET;
  });

  it("rewrites localhost relay URLs for HTTP LAN browser requests", async () => {
    process.env.VOICE_RELAY_PUBLIC_URL = "ws://127.0.0.1:8787";
    process.env.VOICE_RELAY_TOKEN_SECRET = "test-secret";

    const response = await POST(
      new Request("http://192.168.8.107:3000/api/voice-session", {
        method: "POST",
        headers: {
          host: "192.168.8.107:3000",
        },
      }),
    );
    const body = await response.json();
    const relayUrl = new URL(body.relayUrl);

    expect(response.status).toBe(200);
    expect(relayUrl.protocol).toBe("ws:");
    expect(relayUrl.host).toBe("192.168.8.107:8787");
    expect(relayUrl.searchParams.get("token")).toBeTruthy();
  });

  it("rewrites localhost relay URLs for HTTPS LAN browser requests", async () => {
    process.env.VOICE_RELAY_PUBLIC_URL = "ws://127.0.0.1:8787";
    process.env.VOICE_RELAY_TOKEN_SECRET = "test-secret";

    const response = await POST(
      new Request("https://192.168.8.107:3000/api/voice-session", {
        method: "POST",
        headers: {
          host: "192.168.8.107:3000",
        },
      }),
    );
    const body = await response.json();
    const relayUrl = new URL(body.relayUrl);

    expect(response.status).toBe(200);
    expect(relayUrl.protocol).toBe("wss:");
    expect(relayUrl.host).toBe("192.168.8.107:8787");
    expect(relayUrl.searchParams.get("token")).toBeTruthy();
  });

  it("keeps localhost relay URLs for localhost browser requests", async () => {
    process.env.VOICE_RELAY_PUBLIC_URL = "ws://127.0.0.1:8787";
    process.env.VOICE_RELAY_TOKEN_SECRET = "test-secret";

    const response = await POST(
      new Request("http://localhost:3000/api/voice-session", {
        method: "POST",
        headers: {
          host: "localhost:3000",
        },
      }),
    );
    const body = await response.json();
    const relayUrl = new URL(body.relayUrl);

    expect(response.status).toBe(200);
    expect(relayUrl.protocol).toBe("ws:");
    expect(relayUrl.host).toBe("127.0.0.1:8787");
  });

  it("upgrades localhost relay URLs for HTTPS localhost browser requests", async () => {
    process.env.VOICE_RELAY_PUBLIC_URL = "ws://127.0.0.1:8787";
    process.env.VOICE_RELAY_TOKEN_SECRET = "test-secret";

    const response = await POST(
      new Request("https://localhost:3000/api/voice-session", {
        method: "POST",
        headers: {
          host: "localhost:3000",
        },
      }),
    );
    const body = await response.json();
    const relayUrl = new URL(body.relayUrl);

    expect(response.status).toBe(200);
    expect(relayUrl.protocol).toBe("wss:");
    expect(relayUrl.host).toBe("127.0.0.1:8787");
  });

  it("rewrites local relay paths for HTTPS Cloudflare tunnel requests", async () => {
    process.env.VOICE_RELAY_PUBLIC_URL = "ws://127.0.0.1/relay";
    process.env.VOICE_RELAY_TOKEN_SECRET = "test-secret";

    const response = await POST(
      new Request("http://127.0.0.1/api/voice-session", {
        method: "POST",
        headers: {
          host: "kapruka-demo.trycloudflare.com",
          "x-forwarded-host": "kapruka-demo.trycloudflare.com",
          "x-forwarded-proto": "https",
        },
      }),
    );
    const body = await response.json();
    const relayUrl = new URL(body.relayUrl);

    expect(response.status).toBe(200);
    expect(relayUrl.protocol).toBe("wss:");
    expect(relayUrl.host).toBe("kapruka-demo.trycloudflare.com");
    expect(relayUrl.pathname).toBe("/relay");
    expect(relayUrl.searchParams.get("token")).toBeTruthy();
  });
});
