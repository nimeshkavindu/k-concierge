import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type Product } from "./app-store";

const PRODUCTS: Product[] = [
  {
    id: "rose-1",
    name: "Red Rose Bouquet",
    priceLKR: 4500,
    imageUrl: "",
  },
  {
    id: "tea-1",
    name: "Ceylon Tea Gift Box",
    priceLKR: 2400,
    imageUrl: "",
  },
  {
    id: "bear-1",
    name: "Snuggle Buddy Bear 4.5 Ft White",
    priceLKR: 12500,
    imageUrl: "",
  },
];

describe("app store prompt controls", () => {
  afterEach(() => {
    useAppStore.getState().resetSessionState();
    useAppStore.setState({
      activeStage: "WELCOME",
      agentVoiceStatus: "IDLE",
      relayConnected: false,
      relayCommands: null,
      assistantCommands: null,
    });
  });

  it("sets route filters from prompt commands and restores All", async () => {
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      products: PRODUCTS,
    });

    await useAppStore.getState().requestAssistantText("show premium");

    expect(useAppStore.getState().activeRouteFilter).toBe("Premium");
    expect(useAppStore.getState().latestAssistantReply).toMatch(/showing 1 premium/i);

    await useAppStore.getState().requestAssistantText("show all");

    expect(useAppStore.getState().activeRouteFilter).toBe("All");
    expect(useAppStore.getState().latestAssistantReply).toMatch(/showing all 3 options/i);
  });

  it("opens the selected product detail from a contextual view command", async () => {
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      products: PRODUCTS,
      selectedProductId: "tea-1",
      productDetailOpen: false,
    });

    await useAppStore.getState().requestAssistantText("view this product");

    expect(useAppStore.getState().selectedProductId).toBe("tea-1");
    expect(useAppStore.getState().productDetailOpen).toBe(true);
    expect(useAppStore.getState().activeStage).toBe("PRODUCT_CATALOG");
  });

  it("adds the selected product from a contextual add command", async () => {
    const addProductToCart = vi.fn().mockResolvedValue(undefined);
    const submitText = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      assistantCommands: {
        addProductToCart,
        submitText,
        toggleLive: vi.fn(),
        toggleVoice: vi.fn(),
      },
      products: PRODUCTS,
      selectedProductId: "tea-1",
      productDetailOpen: true,
    });

    await useAppStore.getState().requestAssistantText("add 2 of this to cart");

    expect(addProductToCart).toHaveBeenCalledWith("tea-1", 2);
    expect(submitText).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedProductId).toBe("tea-1");
  });

  it("adds a route-referenced product from prompt text", async () => {
    const addProductToCart = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      assistantCommands: {
        addProductToCart,
        submitText: vi.fn().mockResolvedValue(undefined),
        toggleLive: vi.fn(),
        toggleVoice: vi.fn(),
      },
      products: PRODUCTS,
    });

    await useAppStore.getState().requestAssistantText("add 2 of the premium one");

    expect(addProductToCart).toHaveBeenCalledWith("bear-1", 2);
    expect(useAppStore.getState().selectedProductId).toBe("bear-1");
    expect(useAppStore.getState().productDetailOpen).toBe(true);
  });

  it("does not infer quantity from product sizes or vague words", async () => {
    const addProductToCart = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      assistantCommands: {
        addProductToCart,
        submitText: vi.fn().mockResolvedValue(undefined),
        toggleLive: vi.fn(),
        toggleVoice: vi.fn(),
      },
      products: PRODUCTS,
      selectedProductId: "bear-1",
      productDetailOpen: true,
    });

    await useAppStore
      .getState()
      .requestAssistantText("add Snuggle Buddy Bear 4.5 Ft White to cart");
    await useAppStore.getState().requestAssistantText("add this one to cart");

    expect(addProductToCart).toHaveBeenNthCalledWith(1, "bear-1", 1);
    expect(addProductToCart).toHaveBeenNthCalledWith(2, "bear-1", 1);
  });

  it("uses explicit numeric and word quantities from add commands", async () => {
    const addProductToCart = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      assistantCommands: {
        addProductToCart,
        submitText: vi.fn().mockResolvedValue(undefined),
        toggleLive: vi.fn(),
        toggleVoice: vi.fn(),
      },
      products: PRODUCTS,
      selectedProductId: "tea-1",
      productDetailOpen: true,
    });

    await useAppStore.getState().requestAssistantText("add two of this to cart");
    await useAppStore.getState().requestAssistantText("add x3 of this to cart");

    expect(addProductToCart).toHaveBeenNthCalledWith(1, "tea-1", 2);
    expect(addProductToCart).toHaveBeenNthCalledWith(2, "tea-1", 3);
  });

  it("asks for a product name when a contextual product command has no target", async () => {
    const addProductToCart = vi.fn().mockResolvedValue(undefined);
    const submitText = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      assistantCommands: {
        addProductToCart,
        submitText,
        toggleLive: vi.fn(),
        toggleVoice: vi.fn(),
      },
      products: PRODUCTS,
    });

    await useAppStore.getState().requestAssistantText("add this to cart");

    expect(addProductToCart).not.toHaveBeenCalled();
    expect(submitText).not.toHaveBeenCalled();
    expect(useAppStore.getState().latestAssistantReply).toMatch(
      /which product should i use/i,
    );
  });

  it("opens checkout from chat without creating a payment link", async () => {
    const createOrder = vi.fn();
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      relayCommands: {
        addToCart: vi.fn(),
        createOrder,
      },
      cart: [
        {
          id: "rose-1",
          name: "Red Rose Bouquet",
          priceLKR: 4500,
          imageUrl: "",
          quantity: 1,
        },
      ],
      cartSubtotal: 4500,
    });

    await useAppStore.getState().requestAssistantText("proceed to checkout");

    expect(useAppStore.getState().activeStage).toBe("CHECKOUT");
    expect(useAppStore.getState().isCartTrayOpen).toBe(true);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("shows a friendly error when live mode is requested before controls are ready", async () => {
    await useAppStore.getState().requestLiveToggle();

    expect(useAppStore.getState().voiceError).toBe(
      "Live Conversation is still getting ready. Try again in a moment.",
    );
  });
});
