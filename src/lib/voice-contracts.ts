import { z } from "zod";
import {
  CartItemSchema,
  CheckoutDetailsSchema,
  DeliveryCheckSchema,
  ProductSchema,
  QuantitySchema,
} from "./validation";

export const VoiceStatusSchema = z.enum([
  "IDLE",
  "CONNECTING",
  "RECORDING",
  "TRANSCRIBING",
  "LISTENING",
  "THINKING",
  "SPEAKING",
  "LIVE_CONNECTING",
  "LIVE",
]);

export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const MAX_VOICE_UTTERANCE_DURATION_MS = 30_000;
export const MAX_VOICE_UTTERANCE_BASE64_LENGTH = 7_000_000;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("voice_utterance"),
    data: z.string().min(1).max(MAX_VOICE_UTTERANCE_BASE64_LENGTH),
    mimeType: z.literal("audio/wav"),
    durationMs: z.number().int().positive().max(MAX_VOICE_UTTERANCE_DURATION_MS),
  }),
  z.object({
    type: z.literal("live_start"),
  }),
  z.object({
    type: z.literal("live_audio"),
    data: z.string().min(1),
  }),
  z.object({
    type: z.literal("live_stop"),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(1000),
  }),
  z.object({
    type: z.literal("add_to_cart"),
    productId: z.string().trim().min(1),
    quantity: QuantitySchema.default(1),
  }),
  z.object({
    type: z.literal("create_order"),
    checkout: CheckoutDetailsSchema,
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const RelayServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("status"),
    status: VoiceStatusSchema,
  }),
  z.object({
    type: z.literal("audio"),
    data: z.string().min(1),
  }),
  z.object({
    type: z.literal("transcript"),
    text: z.string(),
    role: z.enum(["user", "assistant"]).default("assistant"),
  }),
  z.object({
    type: z.literal("products_status"),
    status: z.literal("searching"),
    query: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("products"),
    products: z.array(ProductSchema),
  }),
  z.object({
    type: z.literal("cart"),
    cart: z.array(CartItemSchema),
    subtotal: z.number().finite().nonnegative(),
  }),
  z.object({
    type: z.literal("delivery"),
    delivery: DeliveryCheckSchema,
  }),
  z.object({
    type: z.literal("checkout"),
    checkoutLink: z.string().url(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string().trim().min(1),
  }),
]);

export type RelayServerMessage = z.infer<typeof RelayServerMessageSchema>;

export const VoiceSessionResponseSchema = z.object({
  relayUrl: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "ws:" || url.protocol === "wss:";
    } catch {
      return false;
    }
  }, "Relay URL must be ws:// or wss://"),
  expiresAt: z.number().int().positive(),
});

export type VoiceSessionResponse = z.infer<typeof VoiceSessionResponseSchema>;
