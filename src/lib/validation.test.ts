import { describe, expect, it } from "vitest";
import {
  assertPaymentUrl,
  isValidPaymentUrl,
  normalizeDeliveryResult,
  normalizeProduct,
  normalizeProducts,
  normalizeQuantity,
} from "./validation";

describe("validation helpers", () => {
  it("normalizes supported product shapes and rejects unsafe products", () => {
    expect(
      normalizeProduct({
        product_id: "cake-1",
        title: "Birthday Cake",
        price: { amount: 4500, currency: "LKR" },
        image_url: "https://kapruka.com/images/cake.jpg",
      }),
    ).toEqual({
      id: "cake-1",
      name: "Birthday Cake",
      priceLKR: 4500,
      imageUrl: "https://kapruka.com/images/cake.jpg",
    });

    expect(
      normalizeProduct({
        id: "x",
        name: "Unsafe",
        priceLKR: 100,
        imageUrl: "javascript:alert(1)",
      }),
    ).toBeNull();
  });

  it("deduplicates normalized products from common result containers", () => {
    expect(
      normalizeProducts({
        items: [
          { id: "1", name: "Tea", priceLKR: 100, imageUrl: "" },
          { id: "1", name: "Tea duplicate", priceLKR: 200, imageUrl: "" },
          { id: "", name: "Broken", priceLKR: 1, imageUrl: "" },
        ],
      }),
    ).toEqual([{ id: "1", name: "Tea", priceLKR: 100, imageUrl: "" }]);
  });

  it("validates quantities and Kapruka payment URLs", () => {
    expect(normalizeQuantity("2")).toBe(2);
    expect(normalizeQuantity(20)).toBe(20);
    expect(normalizeQuantity(21)).toBeNull();
    expect(normalizeQuantity(1.5)).toBeNull();

    expect(isValidPaymentUrl("https://kapruka.com/pay/123")).toBe(true);
    expect(isValidPaymentUrl("https://checkout.kapruka.com/pay/123")).toBe(true);
    expect(isValidPaymentUrl("http://kapruka.com/pay/123")).toBe(false);
    expect(isValidPaymentUrl("https://kapruka.com.evil.test/pay/123")).toBe(false);
    expect(() => assertPaymentUrl("https://evil.test/pay")).toThrow(/Unsafe/);
  });

  it("normalizes delivery results with explicit and inferred availability", () => {
    expect(
      normalizeDeliveryResult(
        {
          city: "Colombo",
          checked_date: "2026-07-01",
          available: true,
          rate: 450,
        },
        "Colombo",
        "2026-07-01",
      ),
    ).toEqual({
      city: "Colombo",
      date: "2026-07-01",
      available: true,
      message: "Delivery is available. Delivery fee: LKR 450.",
    });

    expect(
      normalizeDeliveryResult("Delivery unavailable for this date.", "Galle", "2026-07-02")
        .available,
    ).toBe(false);
  });
});
