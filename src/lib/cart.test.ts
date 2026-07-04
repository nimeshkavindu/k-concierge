import { describe, expect, it } from "vitest";
import { addProductToCart, calculateCartSubtotal } from "./cart";
import type { Product } from "./validation";

const product: Product = {
  id: "flowers-1",
  name: "Flower Bouquet",
  priceLKR: 2500,
  imageUrl: "",
};

describe("cart reducer", () => {
  it("adds products and calculates subtotal", () => {
    const first = addProductToCart([], product, 2);
    expect(first).toEqual({
      cart: [{ ...product, quantity: 2 }],
      subtotal: 5000,
    });

    const second = addProductToCart(first.cart, product, 1);
    expect(second.cart[0]?.quantity).toBe(3);
    expect(calculateCartSubtotal(second.cart)).toBe(7500);
  });

  it("rejects invalid quantities", () => {
    expect(() => addProductToCart([], product, 0)).toThrow(/Quantity/);
    expect(() => addProductToCart([], product, 21)).toThrow(/Quantity/);
  });
});
