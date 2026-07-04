import { afterEach, describe, expect, it, vi } from "vitest";
import { KaprukaMCPClient } from "./mcp-client";

describe("KaprukaMCPClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes a session and parses text JSON tool content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', {
          headers: { "Mcp-Session-Id": "session-1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"text":"[{\\"id\\":\\"p1\\",\\"name\\":\\"Tea\\"}]"}]}}\n\n',
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaprukaMCPClient({
      endpoint: "https://mcp.example.test/mcp",
      timeoutMs: 1000,
    });

    await expect(client.callTool("kapruka_search_products", { q: "tea" })).resolves.toEqual([
      { id: "p1", name: "Tea" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": "session-1",
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      method: "tools/call",
      params: {
        name: "kapruka_search_products",
        arguments: { params: { q: "tea" } },
      },
    });
  });

  it("reinitializes once after a recoverable session failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: {} }), {
          headers: { "Mcp-Session-Id": "stale-session" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: {} }), {
          headers: { "Mcp-Session-Id": "fresh-session" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { content: [{ text: "Delivery available." }] },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new KaprukaMCPClient({
      endpoint: "https://mcp.example.test/mcp",
      timeoutMs: 1000,
    });

    await expect(
      client.callTool("kapruka_check_delivery", {
        city: "Colombo",
        delivery_date: "2026-07-01",
      }),
    ).resolves.toBe("Delivery available.");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
