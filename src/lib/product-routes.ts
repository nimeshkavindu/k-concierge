import type { Product } from "@/lib/validation";

export const ROUTE_LABELS = ["Romantic", "Practical", "Premium"] as const;
export const ROUTE_FILTERS = ["All", ...ROUTE_LABELS] as const;

export type RouteLabel = (typeof ROUTE_LABELS)[number];
export type RouteFilter = (typeof ROUTE_FILTERS)[number];

export interface LabeledProduct {
  product: Product;
  routeLabel: RouteLabel;
}

export function getLabeledProducts(products: Product[]): LabeledProduct[] {
  return products.map((product, index) => ({
    product,
    routeLabel: getRouteLabel(product, index),
  }));
}

export function getRouteCounts(items: LabeledProduct[]): Record<RouteFilter, number> {
  const counts: Record<RouteFilter, number> = {
    All: items.length,
    Romantic: 0,
    Practical: 0,
    Premium: 0,
  };

  for (const item of items) {
    counts[item.routeLabel] += 1;
  }

  return counts;
}

export function getRouteLabel(product: Product, index: number): RouteLabel {
  const name = product.name.toLowerCase();
  if (name.includes("flower") || name.includes("bouquet") || name.includes("rose")) {
    return "Romantic";
  }
  if (name.includes("tea") || name.includes("hamper") || name.includes("gift box")) {
    return "Practical";
  }
  if (product.priceLKR >= 10_000) return "Premium";
  return ROUTE_LABELS[index % ROUTE_LABELS.length];
}

export function getRouteSubtitle(route: RouteFilter): string {
  if (route === "All") return "Every pick";
  if (route === "Romantic") return "Most loved";
  if (route === "Practical") return "Everyday joy";
  return "Indulgent picks";
}
