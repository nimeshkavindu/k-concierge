import { create } from "zustand";
import type {
  CartItem,
  CheckoutDetails,
  DeliveryCheck,
  Product,
} from "@/lib/validation";
import {
  ROUTE_FILTERS,
  getLabeledProducts,
  getRouteLabel,
  type RouteFilter,
} from "@/lib/product-routes";
import type { VoiceStatus } from "@/lib/voice-contracts";

export type { CartItem, Product };
export type { RouteFilter };

export type UIComponentState = "WELCOME" | "PRODUCT_CATALOG" | "CART" | "CHECKOUT";
export type CheckoutStatus = "IDLE" | "CREATING" | "COMPLETE" | "ERROR";
export type ChatRole = "user" | "assistant";
export type ProductStatus = "idle" | "searching" | "ready" | "empty" | "error";

export interface CheckoutDraft {
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  locationType: CheckoutDetails["delivery"]["locationType"];
  deliveryInstructions: string;
  senderName: string;
  senderAnonymous: boolean;
  giftMessage: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

interface RelayCommands {
  addToCart: (productId: string, quantity: number) => void;
  createOrder: (checkout: CheckoutDetails) => void;
}

interface AssistantCommands {
  submitText: (text: string) => Promise<void>;
  toggleVoice: () => Promise<void>;
  addProductToCart?: (productId: string, quantity: number) => Promise<void>;
}

interface AppState {
  activeStage: UIComponentState;
  isListening: boolean;
  relayConnected: boolean;
  userTranscript: string;
  chatMessages: ChatMessage[];
  latestAssistantReply: string | null;
  agentVoiceStatus: VoiceStatus;
  voiceError: string | null;
  products: Product[];
  productStatus: ProductStatus;
  lastUserIntent: string | null;
  assistantSummary: string | null;
  selectedProductId: string | null;
  productDetailOpen: boolean;
  activeRouteFilter: RouteFilter;

  cart: CartItem[];
  cartSubtotal: number;
  isCartTrayOpen: boolean;

  deliveryCity: string | null;
  deliveryDate: string | null;
  deliveryAvailable: boolean | null;
  deliveryMessage: string | null;
  checkoutLink: string | null;
  checkoutStatus: CheckoutStatus;
  checkoutDraft: CheckoutDraft;

  relayCommands: RelayCommands | null;
  assistantCommands: AssistantCommands | null;

  setStage: (stage: UIComponentState) => void;
  setListening: (listening: boolean) => void;
  setRelayConnected: (connected: boolean) => void;
  setTranscript: (text: string, role?: ChatRole) => void;
  addChatMessage: (role: ChatRole, text: string) => void;
  setLatestAssistantReply: (text: string | null) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setVoiceError: (message: string | null) => void;
  setProductStatus: (status: ProductStatus) => void;
  beginProductSearch: (query: string) => void;
  finishAssistantTurn: () => void;
  setProducts: (products: Product[]) => void;
  setRouteFilter: (route: RouteFilter) => void;
  setSelectedProduct: (productId: string | null) => void;
  openProductDetail: (productId: string) => void;
  closeProductDetail: () => void;
  setCartState: (cart: CartItem[], subtotal: number) => void;
  openCartTray: () => void;
  closeCartTray: () => void;
  toggleCartTray: () => void;
  setDeliveryCheck: (delivery: DeliveryCheck) => void;
  setCheckoutLink: (link: string) => void;
  setCheckoutStatus: (status: CheckoutStatus) => void;
  setCheckoutDraft: (draft: Partial<CheckoutDraft>) => void;
  resetCheckoutDraft: () => void;
  setRelayCommands: (commands: RelayCommands | null) => void;
  setAssistantCommands: (commands: AssistantCommands | null) => void;
  requestAssistantText: (text: string) => Promise<void>;
  requestVoiceToggle: () => Promise<void>;
  requestAddToCart: (productId: string, quantity?: number) => void;
  requestCreateOrder: (checkout: CheckoutDetails) => void;
  resetSessionState: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeStage: "WELCOME",
  isListening: false,
  relayConnected: false,
  userTranscript: "",
  chatMessages: [],
  latestAssistantReply: null,
  agentVoiceStatus: "IDLE",
  voiceError: null,
  products: [],
  productStatus: "idle",
  lastUserIntent: null,
  assistantSummary: null,
  selectedProductId: null,
  productDetailOpen: false,
  activeRouteFilter: "All",

  cart: [],
  cartSubtotal: 0,
  isCartTrayOpen: false,
  deliveryCity: null,
  deliveryDate: null,
  deliveryAvailable: null,
  deliveryMessage: null,
  checkoutLink: null,
  checkoutStatus: "IDLE",
  checkoutDraft: createEmptyCheckoutDraft(),
  relayCommands: null,
  assistantCommands: null,

  setStage: (stage) => set({ activeStage: stage }),
  setListening: (listening) => set({ isListening: listening }),
  setRelayConnected: (connected) => set({ relayConnected: connected }),
  setTranscript: (text, role = "assistant") =>
    set((state) => ({
      userTranscript: text,
      chatMessages: appendChatMessage(state.chatMessages, role, text),
      latestAssistantReply:
        role === "assistant" ? normalizeNullableText(text) : state.latestAssistantReply,
    })),
  addChatMessage: (role, text) =>
    set((state) => ({
      chatMessages: appendChatMessage(state.chatMessages, role, text),
      latestAssistantReply:
        role === "assistant" ? normalizeNullableText(text) : state.latestAssistantReply,
    })),
  setLatestAssistantReply: (text) => set({ latestAssistantReply: normalizeNullableText(text) }),
  setVoiceStatus: (status) => set({ agentVoiceStatus: status }),
  setVoiceError: (message) => set({ voiceError: message }),
  setProductStatus: (status) => set({ productStatus: status }),
  beginProductSearch: (query) => {
    const normalized = query.trim();
    if (!normalized) return;

    set({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "searching",
      lastUserIntent: normalized,
      assistantSummary: null,
      selectedProductId: null,
      productDetailOpen: false,
      activeRouteFilter: "All",
      voiceError: null,
    });
  },
  finishAssistantTurn: () =>
    set((state) => {
      if (state.productStatus !== "searching") return {};
      return {
        productStatus: state.products.length > 0 ? "ready" : "idle",
        activeStage: state.products.length > 0 ? state.activeStage : "WELCOME",
      };
    }),
  setProducts: (products) =>
    set((state) => {
      const keepThinkingResults =
        products.length === 0 && state.agentVoiceStatus === "THINKING";
      const nextProducts = keepThinkingResults ? state.products : products;
      const selectedStillExists = nextProducts.some(
        (product) => product.id === state.selectedProductId,
      );

      return {
        products: nextProducts,
        activeStage: keepThinkingResults ? state.activeStage : "PRODUCT_CATALOG",
        productStatus: keepThinkingResults
          ? "searching"
          : products.length > 0
            ? "ready"
            : "idle",
        selectedProductId: keepThinkingResults
          ? state.selectedProductId
          : selectedStillExists
            ? state.selectedProductId
            : null,
        productDetailOpen: keepThinkingResults
          ? state.productDetailOpen
          : selectedStillExists && state.productDetailOpen,
        activeRouteFilter: keepThinkingResults ? state.activeRouteFilter : "All",
        assistantSummary: keepThinkingResults
          ? state.assistantSummary
          : products.length > 0
          ? buildAssistantSummary(products.length, state.lastUserIntent)
          : null,
      };
    }),
  setRouteFilter: (route) =>
    set((state) => {
      const selectedProductVisible = isSelectedProductVisible(
        state.products,
        state.selectedProductId,
        route,
      );

      return {
        activeStage: state.products.length > 0 ? "PRODUCT_CATALOG" : state.activeStage,
        productStatus: state.products.length > 0 ? "ready" : state.productStatus,
        activeRouteFilter: route,
        selectedProductId: selectedProductVisible ? state.selectedProductId : null,
        productDetailOpen: selectedProductVisible && state.productDetailOpen,
      };
    }),
  setSelectedProduct: (productId) =>
    set((state) => {
      const product = productId
        ? state.products.find((item) => item.id === productId)
        : null;
      const productRoute = product ? findProductRouteFilter(product, state.products) : "All";
      return {
        selectedProductId: product?.id ?? null,
        activeStage: product ? "PRODUCT_CATALOG" : state.activeStage,
        productStatus: product ? "ready" : state.productStatus,
        productDetailOpen: Boolean(product),
        activeRouteFilter:
          product && state.activeRouteFilter !== "All" && state.activeRouteFilter !== productRoute
            ? productRoute
            : state.activeRouteFilter,
        assistantSummary: product ? buildSelectedProductSummary(product) : state.assistantSummary,
      };
    }),
  openProductDetail: (productId) =>
    set((state) => {
      const product = state.products.find((item) => item.id === productId);
      if (!product) return {};

      const productRoute = findProductRouteFilter(product, state.products);
      return {
        activeStage: "PRODUCT_CATALOG",
        productStatus: "ready",
        selectedProductId: product.id,
        productDetailOpen: true,
        activeRouteFilter:
          state.activeRouteFilter === "All" || state.activeRouteFilter === productRoute
            ? state.activeRouteFilter
            : productRoute,
        assistantSummary: buildSelectedProductSummary(product),
      };
    }),
  closeProductDetail: () =>
    set({
      selectedProductId: null,
      productDetailOpen: false,
    }),
  setCartState: (cart, subtotal) =>
    set((state) => ({
      cart,
      cartSubtotal: subtotal,
      isCartTrayOpen: cart.length > 0 ? true : state.isCartTrayOpen,
    })),
  openCartTray: () => set({ isCartTrayOpen: true }),
  closeCartTray: () => set({ isCartTrayOpen: false }),
  toggleCartTray: () =>
    set((state) => ({ isCartTrayOpen: !state.isCartTrayOpen })),
  setDeliveryCheck: (delivery) =>
    set({
      deliveryCity: delivery.city,
      deliveryDate: delivery.date,
      deliveryAvailable: delivery.available,
      deliveryMessage: delivery.message,
      activeStage: "CHECKOUT",
      checkoutStatus: "IDLE",
    }),
  setCheckoutLink: (link) =>
    set({ checkoutLink: link, checkoutStatus: "COMPLETE", activeStage: "CHECKOUT" }),
  setCheckoutStatus: (status) => set({ checkoutStatus: status }),
  setCheckoutDraft: (draft) =>
    set((state) => ({
      checkoutDraft: {
        ...state.checkoutDraft,
        ...draft,
      },
    })),
  resetCheckoutDraft: () => set({ checkoutDraft: createEmptyCheckoutDraft() }),
  setRelayCommands: (commands) => set({ relayCommands: commands }),
  setAssistantCommands: (commands) => set({ assistantCommands: commands }),

  requestAssistantText: async (text) => {
    const normalized = text.trim();
    if (!normalized) return;

    const requestedRoute = findRequestedRouteFilter(normalized);
    if (requestedRoute) {
      const products = get().products;
      const reply = buildRouteFilterReply(requestedRoute, products);
      const selectedProductVisible = isSelectedProductVisible(
        products,
        get().selectedProductId,
        requestedRoute,
      );
      set((state) => ({
        activeStage: products.length > 0 ? "PRODUCT_CATALOG" : state.activeStage,
        productStatus: products.length > 0 ? "ready" : state.productStatus,
        activeRouteFilter: requestedRoute,
        selectedProductId: selectedProductVisible ? state.selectedProductId : null,
        productDetailOpen: selectedProductVisible && state.productDetailOpen,
        latestAssistantReply: reply,
        voiceError: null,
      }));
      get().addChatMessage("user", normalized);
      get().addChatMessage("assistant", reply);
      return;
    }

    const commands = get().assistantCommands;
    const productTarget = resolvePromptProductTarget(
      normalized,
      get().products,
      get().selectedProductId,
    );

    if (isProductViewRequest(normalized)) {
      if (productTarget) {
        const reply = `${productTarget.name} is open in the product detail view.`;
        const productRoute = findProductRouteFilter(productTarget, get().products);
        set((state) => ({
          activeStage: "PRODUCT_CATALOG",
          productStatus: "ready",
          selectedProductId: productTarget.id,
          productDetailOpen: true,
          activeRouteFilter:
            state.activeRouteFilter === "All" || state.activeRouteFilter === productRoute
              ? state.activeRouteFilter
              : productRoute,
          assistantSummary: buildSelectedProductSummary(productTarget),
          latestAssistantReply: reply,
          voiceError: null,
        }));
        get().addChatMessage("user", normalized);
        get().addChatMessage("assistant", reply);
        return;
      }

      if (shouldAskForMissingProductTarget(normalized)) {
        const reply = buildProductTargetRequiredReply(get().products);
        set({ latestAssistantReply: reply, voiceError: null });
        get().addChatMessage("user", normalized);
        get().addChatMessage("assistant", reply);
        return;
      }
    }

    if (
      isProductAddRequest(normalized) &&
      productTarget &&
      (get().relayConnected || get().relayCommands)
    ) {
      const quantity = extractRequestedQuantity(normalized);
      const reply = `Added ${quantity} ${quantity === 1 ? "item" : "items"} of ${productTarget.name} to your order tray.`;
      const productRoute = findProductRouteFilter(productTarget, get().products);
      set((state) => ({
        activeStage: "PRODUCT_CATALOG",
        productStatus: "ready",
        selectedProductId: productTarget.id,
        productDetailOpen: true,
        activeRouteFilter:
          state.activeRouteFilter === "All" || state.activeRouteFilter === productRoute
            ? state.activeRouteFilter
            : productRoute,
        assistantSummary: `${productTarget.name} is being added to your order tray.`,
        latestAssistantReply: reply,
        voiceError: null,
      }));
      get().addChatMessage("user", normalized);

      if (commands?.addProductToCart) {
        await commands.addProductToCart(productTarget.id, quantity);
        get().addChatMessage("assistant", reply);
        return;
      }

      const relayCommands = get().relayCommands;
      if (relayCommands) {
        relayCommands.addToCart(productTarget.id, quantity);
        get().addChatMessage("assistant", reply);
        return;
      }
    }

    if (
      isProductAddRequest(normalized) &&
      !productTarget &&
      get().products.length > 0 &&
      shouldAskForMissingProductTarget(normalized)
    ) {
      const reply = buildProductTargetRequiredReply(get().products);
      set({ latestAssistantReply: reply, voiceError: null });
      get().addChatMessage("user", normalized);
      get().addChatMessage("assistant", reply);
      return;
    }

    const checkoutPrefill = extractCheckoutPrefill(normalized);
    if (Object.keys(checkoutPrefill.draft).length > 0) {
      const reply = buildCheckoutPrefillReply(
        checkoutPrefill.labels,
        get().cart.length,
        get().deliveryAvailable,
      );
      set((state) => ({
        activeStage: "CHECKOUT",
        checkoutDraft: {
          ...state.checkoutDraft,
          ...checkoutPrefill.draft,
        },
        isCartTrayOpen: state.cart.length > 0 ? true : state.isCartTrayOpen,
        latestAssistantReply: reply,
        voiceError: null,
      }));
      get().addChatMessage("user", normalized);
      get().addChatMessage("assistant", reply);
      return;
    }

    if (isCheckoutNavigationRequest(normalized)) {
      const hasCart = get().cart.length > 0;
      const reply = hasCart
        ? "Your checkout is open. Review delivery and recipient details, then click Generate Payment Link when ready."
        : "Add an item to your order tray before checkout.";
      set((state) => ({
        activeStage: hasCart ? "CHECKOUT" : state.activeStage,
        isCartTrayOpen: hasCart ? true : state.isCartTrayOpen,
        latestAssistantReply: reply,
        voiceError: null,
      }));
      get().addChatMessage("user", normalized);
      get().addChatMessage("assistant", reply);
      return;
    }

    if (!commands) {
      set({
        voiceError: "Ask Kapruka is still getting ready. Try again in a moment.",
        productStatus: "error",
      });
      return;
    }

    get().beginProductSearch(normalized);
    await commands.submitText(normalized);
  },

  requestVoiceToggle: async () => {
    const commands = get().assistantCommands;
    if (!commands) {
      set({
        voiceError: "Speak mode is still getting ready. Try again in a moment.",
      });
      return;
    }

    await commands.toggleVoice();
  },

  requestAddToCart: (productId, quantity = 1) => {
    const commands = get().relayCommands;
    if (!commands) {
      set({ voiceError: "Ask Kapruka before adding items to your order tray." });
      return;
    }
    commands.addToCart(productId, quantity);
  },

  requestCreateOrder: (checkout) => {
    const commands = get().relayCommands;
    if (!commands) {
      set({
        checkoutStatus: "ERROR",
        voiceError: "Ask Kapruka before checkout.",
      });
      return;
    }
    set({ checkoutStatus: "CREATING", voiceError: null });
    commands.createOrder(checkout);
  },

  resetSessionState: () =>
    set({
      products: [],
      productStatus: "idle",
      lastUserIntent: null,
      assistantSummary: null,
      selectedProductId: null,
      productDetailOpen: false,
      activeRouteFilter: "All",
      cart: [],
      cartSubtotal: 0,
      isCartTrayOpen: false,
      deliveryCity: null,
      deliveryDate: null,
      deliveryAvailable: null,
      deliveryMessage: null,
      checkoutLink: null,
      checkoutStatus: "IDLE",
      checkoutDraft: createEmptyCheckoutDraft(),
      userTranscript: "",
      chatMessages: [],
      latestAssistantReply: null,
      voiceError: null,
    }),
}));

function createEmptyCheckoutDraft(): CheckoutDraft {
  return {
    recipientName: "",
    recipientPhone: "",
    deliveryAddress: "",
    locationType: "house",
    deliveryInstructions: "",
    senderName: "",
    senderAnonymous: false,
    giftMessage: "",
  };
}

function buildAssistantSummary(productCount: number, intent: string | null): string {
  const countText =
    productCount === 1 ? "1 thoughtful option" : `${productCount} thoughtful options`;
  const intentText = intent ? ` for "${intent}"` : "";
  return `I found ${countText}${intentText}.`;
}

function buildSelectedProductSummary(product: Product): string {
  return `${product.name} is selected. Review it here or add it to your order tray.`;
}

function resolvePromptProductTarget(
  text: string,
  products: Product[],
  selectedProductId: string | null,
): Product | null {
  const matchedProduct = findReferencedProduct(text, products);
  if (matchedProduct) return matchedProduct;

  const routeTarget = findRouteReferencedProduct(text, products);
  if (routeTarget) return routeTarget;

  if (isContextualProductReference(text)) {
    return products.find((product) => product.id === selectedProductId) ?? null;
  }

  return null;
}

function findRouteReferencedProduct(text: string, products: Product[]): Product | null {
  const route = findReferencedRouteLabel(text);
  if (!route) return null;

  return getLabeledProducts(products).find((item) => item.routeLabel === route)?.product ?? null;
}

function findReferencedRouteLabel(text: string): Exclude<RouteFilter, "All"> | null {
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) return null;

  for (const route of ROUTE_FILTERS) {
    if (route === "All") continue;
    const routeWord = route.toLowerCase();
    if (
      normalizedText === routeWord ||
      new RegExp(`\\b${routeWord}\\s+(?:one|item|product|pick|option)\\b`).test(
        normalizedText,
      )
    ) {
      return route;
    }
  }

  return null;
}

function findRequestedRouteFilter(text: string): RouteFilter | null {
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) return null;

  if (
    /\b(?:clear|reset)\s+(?:the\s+)?filters?\b/.test(normalizedText) ||
    /\bshow\s+all\b/.test(normalizedText) ||
    /\b(?:all|every)\s+(?:products?|options?|picks?)\b/.test(normalizedText)
  ) {
    return "All";
  }

  for (const route of ROUTE_FILTERS) {
    if (route === "All") continue;
    const routeWord = route.toLowerCase();
    if (normalizedText === routeWord) return route;

    if (
      new RegExp(`\\b(?:filter|only|just)\\s+(?:by\\s+)?${routeWord}\\b`).test(
        normalizedText,
      ) ||
      new RegExp(
        `\\b(?:show|see|list|display)\\s+(?:me\\s+)?${routeWord}\\s*(?:options?|picks?|products?)?\\b$`,
      ).test(normalizedText) ||
      new RegExp(`\\b${routeWord}\\s+(?:options?|picks?|products?)\\b`).test(
        normalizedText,
      )
    ) {
      return route;
    }
  }

  return null;
}

function buildRouteFilterReply(route: RouteFilter, products: Product[]): string {
  if (products.length === 0) {
    return route === "All"
      ? "All will be the default filter when product options are ready."
      : `${route} will be selected once product options are ready.`;
  }

  if (route === "All") return `Showing all ${products.length} options.`;

  const count = getLabeledProducts(products).filter(
    (item) => item.routeLabel === route,
  ).length;
  return count > 0
    ? `Showing ${count} ${route.toLowerCase()} ${count === 1 ? "pick" : "picks"}.`
    : `There are no ${route.toLowerCase()} picks in this response yet.`;
}

function buildProductTargetRequiredReply(products: Product[]): string {
  if (products.length === 0) {
    return "Tell me which product to view or add after I find some options.";
  }

  const sampleNames = products
    .slice(0, 3)
    .map((product) => product.name)
    .join(", ");
  return `Which product should I use? You can say a product name, selected product, or one of these: ${sampleNames}.`;
}

function isSelectedProductVisible(
  products: Product[],
  selectedProductId: string | null,
  route: RouteFilter,
): boolean {
  if (!selectedProductId) return false;
  if (route === "All") return products.some((product) => product.id === selectedProductId);

  return getLabeledProducts(products).some(
    (item) => item.product.id === selectedProductId && item.routeLabel === route,
  );
}

function findProductRouteFilter(product: Product, products: Product[]): Exclude<RouteFilter, "All"> {
  const index = Math.max(
    products.findIndex((item) => item.id === product.id),
    0,
  );
  return getRouteLabel(product, index);
}

function findReferencedProduct(text: string, products: Product[]): Product | null {
  const normalizedText = normalizeSearchText(text);
  const scoredProducts = products
    .map((product) => {
      const normalizedName = normalizeSearchText(product.name);
      const normalizedId = normalizeSearchText(product.id);
      const nameTokens = normalizedName
        .split(" ")
        .filter((word) => word.length > 2);
      const matchingTokens = nameTokens.filter((word) => normalizedText.includes(word));
      const hasDistinctiveToken = nameTokens.some(
        (word) => word.length >= 7 && normalizedText.includes(word),
      );

      if (normalizedText.includes(normalizedId)) return { product, score: 100 };
      if (normalizedText.includes(normalizedName)) return { product, score: 90 };
      if (matchingTokens.length >= 2) return { product, score: 40 + matchingTokens.length };
      if (hasDistinctiveToken) return { product, score: 30 };
      return { product, score: 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scoredProducts[0]?.product ?? null;
}

function isProductViewRequest(text: string): boolean {
  return /\b(view|show|details?|see|open|inspect|look at)\b/i.test(text);
}

function isProductAddRequest(text: string): boolean {
  if (isCheckoutNavigationRequest(text)) return false;
  return /\b(add|buy|purchase|order|cart|get|take)\b/i.test(text);
}

function isContextualProductReference(text: string): boolean {
  return /\b(this|that|it|current|selected|focused)\b/i.test(text);
}

function shouldAskForMissingProductTarget(text: string): boolean {
  return (
    isContextualProductReference(text) ||
    /\b(view|details?|open|inspect|look at)\b/i.test(text) ||
    /\b(?:add|cart)\b/i.test(text)
  );
}

function isCheckoutNavigationRequest(text: string): boolean {
  return /\b(checkout|check out|proceed|process order|place order|complete order|payment link|pay)\b/i.test(
    text,
  );
}

function extractRequestedQuantity(text: string): number {
  const normalizedText = normalizeSearchText(text);
  const wordQuantity = extractWordQuantity(normalizedText);
  if (wordQuantity) return wordQuantity;

  const patterns = [
    /\b(?:qty|quantity)\s*(?:is|:|-)?\s*([0-9]{1,2})\b/i,
    /\bx\s*([0-9]{1,2})\b/i,
    /\badd\s+([0-9]{1,2})\b/i,
    /\b([0-9]{1,2})\s+(?:of|x)\b/i,
  ];
  const match = patterns
    .map((pattern) => text.match(pattern))
    .find((quantityMatch): quantityMatch is RegExpMatchArray => Boolean(quantityMatch));
  if (!match) return 1;

  const quantity = Number.parseInt(match[1], 10);
  if (!Number.isInteger(quantity)) return 1;
  return Math.min(Math.max(quantity, 1), 20);
}

function extractWordQuantity(text: string): number | null {
  const wordQuantities: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  for (const [word, quantity] of Object.entries(wordQuantities)) {
    if (
      new RegExp(`\\badd\\s+${word}\\b`).test(text) ||
      new RegExp(`\\b${word}\\s+(?:of|x)\\b`).test(text)
    ) {
      return quantity;
    }
  }

  return null;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeNullableText(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function extractCheckoutPrefill(text: string): {
  draft: Partial<CheckoutDraft>;
  labels: string[];
} {
  const draft: Partial<CheckoutDraft> = {};
  const labels: string[] = [];

  const recipientName = extractDelimitedValue(text, [
    "recipient name",
    "recipient",
  ]);
  if (recipientName && isLikelyPersonName(recipientName)) {
    draft.recipientName = recipientName;
    labels.push("recipient name");
  }

  const recipientPhone = extractDelimitedValue(text, [
    "recipient phone",
    "phone number",
    "phone",
    "mobile",
    "contact number",
    "contact",
  ]);
  if (recipientPhone) {
    const normalizedPhone = recipientPhone.replace(/[^\d+]/g, "");
    if (normalizedPhone.length >= 7 && normalizedPhone.length <= 30) {
      draft.recipientPhone = normalizedPhone;
      labels.push("recipient phone");
    }
  }

  const deliveryAddress = extractDelimitedValue(text, [
    "delivery address",
    "address",
  ]);
  if (deliveryAddress && deliveryAddress.length >= 3) {
    draft.deliveryAddress = deliveryAddress.slice(0, 250);
    labels.push("delivery address");
  }

  const deliveryInstructions = extractDelimitedValue(text, [
    "delivery instructions",
    "instructions",
  ]);
  if (deliveryInstructions) {
    draft.deliveryInstructions = deliveryInstructions.slice(0, 250);
    labels.push("delivery instructions");
  }

  const senderName = extractDelimitedValue(text, ["sender name", "sender", "from"]);
  if (senderName && isLikelyPersonName(senderName)) {
    draft.senderName = senderName;
    labels.push("sender name");
  }

  const giftMessage = extractDelimitedValue(text, [
    "gift message",
    "card message",
    "message",
  ]);
  if (giftMessage) {
    draft.giftMessage = giftMessage.slice(0, 300);
    labels.push("gift message");
  }

  if (/\b(apartment|flat)\b/i.test(text)) {
    draft.locationType = "apartment";
    labels.push("location type");
  } else if (/\boffice\b/i.test(text)) {
    draft.locationType = "office";
    labels.push("location type");
  } else if (/\bhouse|home\b/i.test(text)) {
    draft.locationType = "house";
    labels.push("location type");
  }

  if (/\b(anonymous|hide sender|do not show sender|don't show sender)\b/i.test(text)) {
    draft.senderAnonymous = true;
    labels.push("anonymous sender");
  }

  return { draft, labels: [...new Set(labels)] };
}

function extractDelimitedValue(text: string, labels: string[]): string | null {
  const escapedLabels = labels.map(escapeRegExp).join("|");
  const boundaryLabels = [
    "recipient name",
    "recipient",
    "recipient phone",
    "phone number",
    "phone",
    "mobile",
    "contact number",
    "contact",
    "delivery address",
    "address",
    "delivery instructions",
    "instructions",
    "sender name",
    "sender",
    "from",
    "gift message",
    "card message",
    "message",
  ]
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(
    `(?:^|\\b)(?:${escapedLabels})\\s*(?:is|:|-)?\\s*(.+?)(?=\\s+(?:${boundaryLabels})\\s*(?:is|:|-)?\\s*|$)`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return null;

  return cleanCheckoutValue(match[1]);
}

function cleanCheckoutValue(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^["'“”]+|["'“”.,]+$/g, "")
    .replace(/\s+/g, " ");
  return cleaned ? cleaned : null;
}

function isLikelyPersonName(value: string): boolean {
  return /^[a-z][a-z .'-]{1,78}$/i.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCheckoutPrefillReply(
  labels: string[],
  cartCount: number,
  deliveryAvailable: boolean | null,
): string {
  const filledText =
    labels.length > 0
      ? `I filled ${labels.join(", ")} in checkout.`
      : "I updated checkout details.";
  const cartText =
    cartCount > 0
      ? "Review the form before generating the payment link."
      : "Add an item to your order tray before creating a payment link.";
  const deliveryText =
    deliveryAvailable === true
      ? ""
      : " Delivery must be checked before payment link creation.";
  return `${filledText} ${cartText}${deliveryText}`;
}

function appendChatMessage(
  messages: ChatMessage[],
  role: ChatRole,
  text: string,
): ChatMessage[] {
  const normalized = text.trim();
  if (!normalized) return messages;

  return [
    ...messages,
    {
      id: `${Date.now()}-${messages.length}`,
      role,
      text: normalized,
    },
  ].slice(-30);
}
