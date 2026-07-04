import { z } from "zod";

const DEFAULT_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.5-flash";

const InteractionStepSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.unknown().optional(),
    content: z.unknown().optional(),
  })
  .passthrough();

const InteractionResponseSchema = z
  .object({
    id: z.string(),
    output_text: z.string().optional(),
    steps: z.array(InteractionStepSchema).optional().default([]),
  })
  .passthrough();

export interface GeminiFlashTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiFlashFunctionCall {
  id: string;
  name: string;
  args: unknown;
}

export interface GeminiFlashInteraction {
  id: string;
  outputText: string;
  functionCalls: GeminiFlashFunctionCall[];
}

interface GeminiFlashClientOptions {
  apiKey: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

interface CreateInteractionOptions {
  input: unknown;
  previousInteractionId?: string | null;
  systemInstruction?: string;
  tools?: GeminiFlashTool[];
}

export class GeminiFlashClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiFlashClientOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? DEFAULT_INTERACTIONS_ENDPOINT;
    this.model = options.model ?? DEFAULT_GEMINI_TEXT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    logFlash("client.created", {
      endpoint: this.endpoint,
      model: this.model,
      timeoutMs: this.timeoutMs,
    });
  }

  async createInteraction(
    options: CreateInteractionOptions,
  ): Promise<GeminiFlashInteraction> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    logFlash("interaction.start", {
      model: this.model,
      input: summarizeInput(options.input),
      hasPreviousInteraction: Boolean(options.previousInteractionId),
      toolCount: options.tools?.length ?? 0,
    });

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          input: options.input,
          ...(options.previousInteractionId
            ? { previous_interaction_id: options.previousInteractionId }
            : {}),
          ...(options.systemInstruction
            ? { system_instruction: options.systemInstruction }
            : {}),
          ...(options.tools ? { tools: options.tools } : {}),
          generation_config: {
            thinking_level: "low",
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logFlash("interaction.http_error", {
          status: response.status,
          contentType: response.headers.get("content-type"),
        });
        throw new Error(`Gemini Flash HTTP ${response.status}`);
      }

      const parsed = InteractionResponseSchema.parse(await response.json());
      const interaction = {
        id: parsed.id,
        outputText: parsed.output_text ?? extractOutputText(parsed.steps),
        functionCalls: parsed.steps.flatMap((step, index) => {
          if (step.type !== "function_call" || typeof step.name !== "string") {
            return [];
          }

          return [
            {
              id: step.id ?? `${step.name}-${index}`,
              name: step.name,
              args: step.arguments ?? {},
            },
          ];
        }),
      };
      logFlash("interaction.success", {
        id: interaction.id,
        outputLength: interaction.outputText.length,
        functionCalls: interaction.functionCalls.map((call) => call.name),
        stepCount: parsed.steps.length,
      });
      return interaction;
    } catch (error) {
      if (isAbortError(error)) {
        logFlash("interaction.timeout", { timeoutMs: this.timeoutMs });
        throw new Error(`Gemini Flash timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractOutputText(steps: Array<z.infer<typeof InteractionStepSchema>>): string {
  for (let index = steps.length - 1; index >= 0; index--) {
    const text = extractTextFromContent(steps[index]?.content);
    if (text) return text;
  }
  return "";
}

function extractTextFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const maybeText = (part as Record<string, unknown>).text;
        return typeof maybeText === "string" ? maybeText : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

function logFlash(event: string, details: Record<string, unknown> = {}): void {
  console.info("[gemini-flash]", event, details);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
}

function summarizeInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    return {
      type: "text",
      length: input.length,
      preview: input.slice(0, 80),
    };
  }

  if (Array.isArray(input)) {
    return {
      type: "array",
      count: input.length,
      itemTypes: input
        .map((item) =>
          item && typeof item === "object"
            ? (item as Record<string, unknown>).type
            : typeof item,
        )
        .slice(0, 5),
    };
  }

  return { type: typeof input };
}
