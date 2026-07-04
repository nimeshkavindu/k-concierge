import { z } from "zod";

const JsonRpcErrorSchema = z.object({
  code: z.number().optional(),
  message: z.string().default("MCP request failed."),
});

const JsonRpcResponseSchema = z.object({
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});

const AllowedMcpToolSchema = z.enum([
  "kapruka_search_products",
  "kapruka_check_delivery",
  "kapruka_create_order",
]);

export type AllowedMcpTool = z.infer<typeof AllowedMcpToolSchema>;

interface KaprukaMCPClientOptions {
  endpoint?: string;
  timeoutMs?: number;
}

export class KaprukaMCPClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private sessionId: string | null = null;
  private requestId = 1;

  constructor(options: KaprukaMCPClientOptions = {}) {
    this.endpoint =
      options.endpoint ?? process.env.MCP_ENDPOINT ?? "https://mcp.kapruka.com/mcp";
    this.timeoutMs = options.timeoutMs ?? 12_000;
    logMcp("client.created", {
      endpoint: this.endpoint,
      timeoutMs: this.timeoutMs,
    });
  }

  async initialize(): Promise<void> {
    if (this.sessionId) {
      logMcp("initialize.skip_existing_session");
      return;
    }

    logMcp("initialize.start");

    const { response } = await this.postJsonRpc({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "kapruka-agent-relay", version: "1.0.0" },
      },
      id: this.requestId++,
    });

    const sessionId = response.headers.get("Mcp-Session-Id");
    if (!sessionId) {
      logMcp("initialize.missing_session_id");
      throw new Error("MCP initialize response did not include a session ID.");
    }
    this.sessionId = sessionId;
    logMcp("initialize.success", { hasSessionId: true });
  }

  async callTool(name: AllowedMcpTool, args: unknown): Promise<unknown> {
    const toolName = AllowedMcpToolSchema.parse(name);
    logMcp("tool.start", { toolName, args: summarizeMcpArgs(args) });

    for (let attempt = 0; attempt < 2; attempt++) {
      await this.initialize();
      logMcp("tool.attempt", { toolName, attempt: attempt + 1 });

      try {
        const { json } = await this.postJsonRpc(
          {
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: toolName, arguments: { params: args } },
            id: this.requestId++,
          },
          this.sessionId,
        );

        const parsed = JsonRpcResponseSchema.parse(json);
        if (parsed.error) {
          logMcp("tool.json_rpc_error", {
            toolName,
            message: parsed.error.message,
            code: parsed.error.code,
          });
          throw new Error(parsed.error.message);
        }

        const result = parseMcpContent(parsed.result);
        logMcp("tool.success", {
          toolName,
          result: summarizeMcpResult(result),
        });
        return result;
      } catch (error) {
        logMcp("tool.error", {
          toolName,
          attempt: attempt + 1,
          message: errorToMessage(error),
        });
        if (attempt === 0 && isSessionRecoverableError(error)) {
          logMcp("tool.reinitializing_session", { toolName });
          this.sessionId = null;
          continue;
        }
        throw error;
      }
    }

    throw new Error("MCP request failed after retry.");
  }

  private async postJsonRpc(
    body: Record<string, unknown>,
    sessionId?: string | null,
  ): Promise<{ response: Response; json: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const method = typeof body.method === "string" ? body.method : "unknown";
    logMcp("http.start", {
      method,
      hasSessionId: Boolean(sessionId),
    });

    try {
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          logMcp("http.error_status", {
            method,
            status: response.status,
            contentType: response.headers.get("content-type"),
          });
          throw new Error(`MCP HTTP ${response.status}`);
        }

        const text = await response.text();
        logMcp("http.success", {
          method,
          status: response.status,
          contentType: response.headers.get("content-type"),
          bodyLength: text.length,
        });
        return { response, json: parseJsonRpcHttpBody(text) };
      } catch (error) {
        if (isAbortError(error)) {
          logMcp("http.timeout", { method, timeoutMs: this.timeoutMs });
          throw new Error(`Kapruka MCP timed out after ${this.timeoutMs}ms.`);
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isSessionRecoverableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /session|401|403|404|409/i.test(error.message);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
}

function parseMcpContent(result: unknown): unknown {
  const resultRecord = asRecord(result);
  const outputResult = resultRecord?.result;
  if (typeof outputResult === "string") {
    return parseMaybeJson(outputResult);
  }

  const content = z
    .object({
      content: z
        .array(
          z.object({
            text: z.string().optional(),
          }),
        )
        .optional(),
    })
    .safeParse(result);

  const contentText = content.success ? content.data.content?.[0]?.text : null;
  if (!contentText) return result ?? null;

  return parseMaybeJson(contentText);
}

function parseJsonRpcHttpBody(body: string): unknown {
  const direct = tryParseJson(body);
  if (direct !== null) return direct;

  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim();

    if (!data) continue;

    const parsed = tryParseJson(data);
    if (parsed !== null) return parsed;
  }

  throw new Error("MCP response was not valid JSON-RPC.");
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function logMcp(event: string, details: Record<string, unknown> = {}): void {
  console.info("[kapruka-mcp]", event, details);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeMcpArgs(args: unknown): Record<string, unknown> {
  const source = asRecord(args);
  if (!source) return { type: typeof args };

  return {
    q: source.q,
    city: source.city,
    delivery_date: source.delivery_date,
    product_id: source.product_id,
    cartCount: Array.isArray(source.cart) ? source.cart.length : undefined,
    currency: source.currency,
    response_format: source.response_format,
  };
}

function summarizeMcpResult(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) {
    return { type: "array", count: result.length };
  }

  const source = asRecord(result);
  if (!source) return { type: typeof result };

  return {
    keys: Object.keys(source).slice(0, 12),
    resultCount: Array.isArray(source.results) ? source.results.length : undefined,
    itemCount: Array.isArray(source.items) ? source.items.length : undefined,
    hasCheckoutUrl:
      typeof source.checkout_url === "string" || typeof source.payment_url === "string",
    available: source.available,
  };
}
