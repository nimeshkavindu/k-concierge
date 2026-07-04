import type { CartItem, Product } from "./validation";
import { normalizeQuantity } from "./validation";

export interface CartState {
  cart: CartItem[];
  subtotal: number;
}

export function calculateCartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.priceLKR * item.quantity, 0);
}

export function addProductToCart(
  cart: CartItem[],
  product: Product,
  quantityValue: unknown = 1,
): CartState {
  const quantity = normalizeQuantity(quantityValue);
  if (!quantity) {
    throw new Error("Quantity must be an integer from 1 to 20.");
  }

  const nextCart = cart.some((item) => item.id === product.id)
    ? cart.map((item) =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + quantity }
          : item,
      )
    : [...cart, { ...product, quantity }];

  const cappedCart = nextCart.map((item) =>
    item.quantity > 20 ? { ...item, quantity: 20 } : item,
  );

  return {
    cart: cappedCart,
    subtotal: calculateCartSubtotal(cappedCart),
  };
}
