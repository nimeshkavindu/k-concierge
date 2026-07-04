import { z } from "zod";

export const MAX_QUANTITY = 20;

export function isSafeImageUrl(value: string): boolean {
  if (value === "") return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isValidPaymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "kapruka.com" || hostname.endsWith(".kapruka.com"))
    );
  } catch {
    return false;
  }
}

export const ProductSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  priceLKR: z.number().finite().nonnegative(),
  imageUrl: z.string().refine(isSafeImageUrl, "Unsafe image URL"),
});

export type Product = z.infer<typeof ProductSchema>;

export const QuantitySchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_QUANTITY);

export const CartItemSchema = ProductSchema.extend({
  quantity: QuantitySchema,
});

export type CartItem = z.infer<typeof CartItemSchema>;

export const DeliveryCheckSchema = z.object({
  city: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  available: z.boolean(),
  message: z.string().trim().min(1),
});

export type DeliveryCheck = z.infer<typeof DeliveryCheckSchema>;

export const LocationTypeSchema = z.enum(["house", "apartment", "office", "other"]);

export const CurrencySchema = z.enum(["LKR", "USD", "GBP", "AUD", "CAD", "EUR"]);

export const RecipientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(30),
});

export const SenderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  anonymous: z.boolean().default(false),
});

export const CheckoutDetailsSchema = z.object({
  recipient: RecipientSchema,
  delivery: z.object({
    address: z.string().trim().min(3).max(250),
    locationType: LocationTypeSchema.default("house"),
    instructions: z.string().trim().max(250).optional().default(""),
  }),
  sender: SenderSchema,
  giftMessage: z.string().trim().max(300).optional().default(""),
  currency: CurrencySchema.default("LKR"),
});

export type CheckoutDetails = z.infer<typeof CheckoutDetailsSchema>;

export const OrderItemSchema = z.object({
  product_id: z.string().trim().min(3).max(80),
  quantity: QuantitySchema,
  icing_text: z.string().trim().max(120).nullable().optional().default(null),
});

export const CreateOrderPayloadSchema = z.object({
  cart: z.array(OrderItemSchema).min(1).max(30),
  recipient: RecipientSchema,
  delivery: z.object({
    address: z.string().trim().min(3).max(250),
    city: z.string().trim().min(2).max(100),
    location_type: LocationTypeSchema.default("house"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    instructions: z.string().trim().max(250).nullable().optional().default(null),
  }),
  sender: SenderSchema,
  gift_message: z.string().trim().max(300).nullable().optional().default(null),
  currency: CurrencySchema.default("LKR"),
  response_format: z.literal("json").default("json"),
});

export function normalizeQuantity(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : 1;

  const result = QuantitySchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function coerceStructuredValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  const source = asRecord(value);
  if (typeof source?.result === "string") {
    return coerceStructuredValue(source.result);
  }

  return value;
}

function firstString(
  source: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  const source = asRecord(value);
  if (source) {
    return parsePrice(source.amount);
  }

  if (typeof value !== "string") return null;

  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeProduct(value: unknown): Product | null {
  const source = asRecord(coerceStructuredValue(value));
  if (!source) return null;

  const id = firstString(source, ["id", "productId", "product_id", "sku", "code"]);
  const name = firstString(source, ["name", "title", "productName", "product_name"]);
  const imageUrl =
    firstString(source, ["imageUrl", "image_url", "image", "thumbnail", "thumbnailUrl"]) ??
    "";
  const priceLKR =
    parsePrice(source.priceLKR) ??
    parsePrice(source.price_lkr) ??
    parsePrice(source.price) ??
    parsePrice(source.amount);

  if (!id || !name || priceLKR === null) return null;

  const parsed = ProductSchema.safeParse({ id, name, priceLKR, imageUrl });
  return parsed.success ? parsed.data : null;
}

export function normalizeProducts(value: unknown): Product[] {
  const structured = coerceStructuredValue(value);
  const source = asRecord(structured);
  const candidates = Array.isArray(structured)
    ? structured
    : Array.isArray(source?.products)
      ? source.products
      : Array.isArray(source?.items)
        ? source.items
        : Array.isArray(source?.results)
          ? source.results
          : [];

  const seen = new Set<string>();
  const products: Product[] = [];

  for (const candidate of candidates) {
    const product = normalizeProduct(candidate);
    if (product && !seen.has(product.id)) {
      seen.add(product.id);
      products.push(product);
    }
  }

  return products;
}

export function normalizeDeliveryResult(
  value: unknown,
  city: string,
  date: string,
): DeliveryCheck {
  const structured = coerceStructuredValue(value);
  const source = asRecord(structured);
  const rawMessage =
    typeof structured === "string"
      ? structured
      : firstString(source ?? {}, [
          "message",
          "status",
          "reason",
          "text",
          "perishable_warning",
        ]);
  const availableValue =
    source?.available ?? source?.deliverable ?? source?.canDeliver ?? source?.isAvailable;
  const available =
    typeof availableValue === "boolean"
      ? availableValue
      : !/\b(unavailable|not available|cannot deliver|can't deliver)\b/i.test(
          rawMessage ?? "",
        );
  const checkedDate = firstString(source ?? {}, ["checked_date", "delivery_date", "date"]);
  const rate = source?.rate;
  const rateMessage =
    typeof rate === "number" && Number.isFinite(rate) ? ` Delivery fee: LKR ${rate}.` : "";
  const message =
    rawMessage ||
    (available ? "Delivery is available." : "Delivery is not available.") + rateMessage;

  return DeliveryCheckSchema.parse({
    city: firstString(source ?? {}, ["city"]) ?? city,
    date: checkedDate ?? date,
    available,
    message,
  });
}

export function assertPaymentUrl(value: unknown): string {
  const structured = coerceStructuredValue(value);
  const source = asRecord(structured);
  const candidate =
    typeof structured === "string"
      ? structured
      : firstString(source ?? {}, [
          "checkout_url",
          "checkoutUrl",
          "payment_url",
          "paymentUrl",
        ]);

  if (!candidate || !isValidPaymentUrl(candidate)) {
    throw new Error("Unsafe payment URL returned by order service.");
  }
  return candidate;
}
