// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MainStage from "./MainStage";
import { useAppStore } from "@/store/app-store";

describe("MainStage", () => {
  afterEach(() => {
    cleanup();
    useAppStore.getState().resetSessionState();
    useAppStore.setState({
      activeStage: "WELCOME",
      agentVoiceStatus: "IDLE",
      relayConnected: false,
      relayCommands: null,
      assistantCommands: null,
    });
  });

  it("shows a prominent text input and voice button", () => {
    render(<MainStage />);

    expect(
      screen.getByRole("heading", { name: /what are you looking for/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /intent constellation/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/what are you looking for/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tap to speak/i })).toBeInTheDocument();
  });

  it("shows relay connection progress in the compact status badge", () => {
    useAppStore.setState({ agentVoiceStatus: "CONNECTING" });

    render(<MainStage />);

    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it("shows microphone errors near the main prompt", () => {
    useAppStore.setState({
      voiceError: "Voice needs a secure page on Android.",
    });

    render(<MainStage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /voice needs a secure page on android/i,
    );
  });

  it("sends suggested prompt chips through the existing text command", async () => {
    const submitText = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      assistantCommands: {
        submitText,
        toggleVoice: vi.fn(),
      },
    });

    render(<MainStage />);
    fireEvent.click(screen.getByRole("button", { name: /tea gifts/i }));

    await waitFor(() => expect(submitText).toHaveBeenCalledWith("Tea gifts"));
  });

  it("moves product discovery from searching to ready", () => {
    const { rerender } = render(<MainStage />);

    act(() => {
      useAppStore.getState().beginProductSearch("tea gifts");
    });
    rerender(<MainStage />);

    expect(screen.getAllByText(/searching kapruka/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/curating for "tea gifts"/i)).toBeInTheDocument();

    act(() => {
      useAppStore.getState().setProducts([
        {
          id: "tea-1",
          name: "Ceylon Tea Gift Box",
          priceLKR: 2400,
          imageUrl: "",
        },
      ]);
    });
    rerender(<MainStage />);

    expect(screen.getByText(/curated reveal/i)).toBeInTheDocument();
    expect(screen.getByText(/i found 1 thoughtful option for "tea gifts"/i)).toBeInTheDocument();
    expect(screen.getByText(/found for your request/i)).toBeInTheDocument();
    expect(screen.getByText(/ceylon tea gift box/i)).toBeInTheDocument();
  });

  it("defaults product filters to All and filters by route", () => {
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      products: [
        {
          id: "bear-1",
          name: "Snuggle Buddy Bear 4.5 Ft White",
          priceLKR: 12500,
          imageUrl: "",
        },
        {
          id: "tea-1",
          name: "Ceylon Tea Gift Box",
          priceLKR: 2400,
          imageUrl: "",
        },
        {
          id: "rose-1",
          name: "Red Rose Bouquet",
          priceLKR: 4500,
          imageUrl: "",
        },
      ],
    });

    render(<MainStage />);

    expect(screen.getByRole("button", { name: /all/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/snuggle buddy bear/i)).toBeInTheDocument();
    expect(screen.getByText(/ceylon tea gift box/i)).toBeInTheDocument();
    expect(screen.getByText(/red rose bouquet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /premium/i }));

    expect(screen.getByRole("button", { name: /premium/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(useAppStore.getState().activeRouteFilter).toBe("Premium");
    expect(screen.getByText(/snuggle buddy bear/i)).toBeInTheDocument();
    expect(screen.queryByText(/ceylon tea gift box/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/red rose bouquet/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /all/i }));

    expect(useAppStore.getState().activeRouteFilter).toBe("All");
    expect(screen.getByText(/ceylon tea gift box/i)).toBeInTheDocument();
    expect(screen.getByText(/red rose bouquet/i)).toBeInTheDocument();
  });

  it("does not show a no-match message while the assistant is still thinking", () => {
    const { rerender } = render(<MainStage />);

    act(() => {
      useAppStore.setState({ agentVoiceStatus: "THINKING" });
      useAppStore.getState().beginProductSearch("soft toy");
      useAppStore.getState().setProducts([]);
    });
    rerender(<MainStage />);

    expect(screen.getByText(/curating for "soft toy"/i)).toBeInTheDocument();
    expect(screen.queryByText(/i couldn't find a good match/i)).not.toBeInTheDocument();

    act(() => {
      useAppStore.setState({ agentVoiceStatus: "IDLE" });
      useAppStore.getState().finishAssistantTurn();
    });
    rerender(<MainStage />);

    expect(screen.queryByText(/i couldn't find a good match/i)).not.toBeInTheDocument();
  });

  it("selects an existing product when the user asks to view it", async () => {
    const submitText = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      assistantCommands: {
        submitText,
        toggleVoice: vi.fn(),
      },
      products: [
        {
          id: "bouquet-1",
          name: "Pink Promise Bouquet",
          priceLKR: 12800,
          imageUrl: "",
        },
      ],
    });

    render(<MainStage />);
    fireEvent.change(screen.getByLabelText(/what are you looking for/i), {
      target: { value: "I want to view Pink Promise Bouquet." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() =>
      expect(useAppStore.getState().selectedProductId).toBe("bouquet-1"),
    );
    expect(submitText).not.toHaveBeenCalled();
    expect(useAppStore.getState().productStatus).toBe("ready");
    expect(useAppStore.getState().productDetailOpen).toBe(true);
    expect(screen.getByRole("region", { name: /focused product details/i })).toBeInTheDocument();
    expect(screen.getByText(/selected for review/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pink promise bouquet/i).length).toBeGreaterThan(1);
  });

  it("shows the latest assistant reply in existing summary copy", () => {
    useAppStore.setState({
      latestAssistantReply: "I found a thoughtful set of flower options.",
    });

    render(<MainStage />);

    expect(
      screen.getByText(/i found a thoughtful set of flower options/i),
    ).toBeInTheDocument();
  });

  it("adds an existing product from chat without relying on Gemini", async () => {
    const submitText = vi.fn().mockResolvedValue(undefined);
    const addProductToCart = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      assistantCommands: {
        addProductToCart,
        submitText,
        toggleVoice: vi.fn(),
      },
      products: [
        {
          id: "bouquet-1",
          name: "Pink Promise Bouquet",
          priceLKR: 12800,
          imageUrl: "",
        },
      ],
    });

    render(<MainStage />);
    fireEvent.change(screen.getByLabelText(/what are you looking for/i), {
      target: { value: "Add Pink Promise Bouquet to cart" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() =>
      expect(addProductToCart).toHaveBeenCalledWith("bouquet-1", 1),
    );
    expect(submitText).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedProductId).toBe("bouquet-1");
    expect(useAppStore.getState().latestAssistantReply).toMatch(/added 1 item/i);
  });

  it("falls back to Gemini text when local add is not safe", async () => {
    const submitText = vi.fn().mockResolvedValue(undefined);
    const addProductToCart = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: false,
      assistantCommands: {
        addProductToCart,
        submitText,
        toggleVoice: vi.fn(),
      },
      products: [
        {
          id: "bouquet-1",
          name: "Pink Promise Bouquet",
          priceLKR: 12800,
          imageUrl: "",
        },
      ],
    });

    render(<MainStage />);
    fireEvent.change(screen.getByLabelText(/what are you looking for/i), {
      target: { value: "Add Pink Promise Bouquet to cart" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() =>
      expect(submitText).toHaveBeenCalledWith("Add Pink Promise Bouquet to cart"),
    );
    expect(addProductToCart).not.toHaveBeenCalled();
  });

  it("opens checkout from chat without creating an order", async () => {
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
          id: "bouquet-1",
          name: "Pink Promise Bouquet",
          priceLKR: 12800,
          imageUrl: "",
          quantity: 1,
        },
      ],
      cartSubtotal: 12800,
    });

    render(<MainStage />);
    fireEvent.change(screen.getByLabelText(/what are you looking for/i), {
      target: { value: "Proceed to checkout" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() => expect(useAppStore.getState().activeStage).toBe("CHECKOUT"));
    expect(createOrder).not.toHaveBeenCalled();
    expect(useAppStore.getState().latestAssistantReply).toMatch(/checkout is open/i);
  });

  it("prefills checkout details from chat", async () => {
    render(<MainStage />);
    fireEvent.change(screen.getByLabelText(/what are you looking for/i), {
      target: {
        value:
          "recipient name Nimeshi Perera phone 0771234567 address 12 Flower Road sender name Nimesh gift message Happy birthday",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() => expect(useAppStore.getState().activeStage).toBe("CHECKOUT"));
    expect(useAppStore.getState().checkoutDraft).toMatchObject({
      recipientName: "Nimeshi Perera",
      recipientPhone: "0771234567",
      deliveryAddress: "12 Flower Road",
      senderName: "Nimesh",
      giftMessage: "Happy birthday",
    });
  });

  it("selects a product from the details button", () => {
    useAppStore.setState({
      activeStage: "PRODUCT_CATALOG",
      productStatus: "ready",
      relayConnected: true,
      products: [
        {
          id: "bouquet-1",
          name: "Pink Promise Bouquet",
          priceLKR: 12800,
          imageUrl: "",
        },
      ],
    });

    render(<MainStage />);
    fireEvent.click(
      screen.getByRole("button", { name: /view details for pink promise bouquet/i }),
    );

    expect(useAppStore.getState().selectedProductId).toBe("bouquet-1");
    expect(useAppStore.getState().productDetailOpen).toBe(true);
    expect(screen.getByRole("region", { name: /focused product details/i })).toBeInTheDocument();
    expect(screen.getByText(/selected for review/i)).toBeInTheDocument();
  });
});
