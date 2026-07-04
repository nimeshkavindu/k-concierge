// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CheckoutStage from "./CheckoutStage";
import { useAppStore } from "@/store/app-store";

describe("CheckoutStage", () => {
  afterEach(() => {
    cleanup();
    useAppStore.getState().resetSessionState();
    useAppStore.setState({
      activeStage: "WELCOME",
      relayConnected: false,
      relayCommands: null,
      assistantCommands: null,
      checkoutStatus: "IDLE",
    });
  });

  it("requires a manual click to request order creation", async () => {
    const createOrder = vi.fn();
    useAppStore.setState({
      relayConnected: true,
      relayCommands: {
        addToCart: vi.fn(),
        createOrder,
      },
      cart: [
        {
          id: "tea-1",
          name: "Ceylon Tea",
          priceLKR: 1200,
          imageUrl: "",
          quantity: 1,
        },
      ],
      cartSubtotal: 1200,
      deliveryCity: "Colombo",
      deliveryDate: "2026-07-01",
      deliveryAvailable: true,
      deliveryMessage: "Delivery is available.",
    });

    render(<CheckoutStage />);
    fireEvent.change(screen.getByLabelText(/recipient name/i), {
      target: { value: "Recipient" },
    });
    fireEvent.change(screen.getByLabelText(/recipient phone/i), {
      target: { value: "0771234567" },
    });
    fireEvent.change(screen.getByLabelText(/delivery address/i), {
      target: { value: "123 Flower Road" },
    });
    fireEvent.change(screen.getByLabelText(/^sender name$/i), {
      target: { value: "Sender" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate payment link/i }));

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: { name: "Recipient", phone: "0771234567" },
        delivery: expect.objectContaining({ address: "123 Flower Road" }),
        sender: { name: "Sender", anonymous: false },
      }),
    );
    expect(useAppStore.getState().checkoutStatus).toBe("CREATING");
  }, 10_000);

  it("disables payment-link creation until delivery is checked", () => {
    useAppStore.setState({
      relayConnected: true,
      relayCommands: {
        addToCart: vi.fn(),
        createOrder: vi.fn(),
      },
      cart: [
        {
          id: "tea-1",
          name: "Ceylon Tea",
          priceLKR: 1200,
          imageUrl: "",
          quantity: 1,
        },
      ],
      cartSubtotal: 1200,
      deliveryAvailable: null,
    });

    render(<CheckoutStage />);

    expect(screen.getByRole("button", { name: /generate payment link/i })).toBeDisabled();
  });

  it("uses checkout details prefilled from chat", async () => {
    const createOrder = vi.fn();
    useAppStore.setState({
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
      deliveryCity: "Colombo",
      deliveryDate: "2026-07-01",
      deliveryAvailable: true,
      checkoutDraft: {
        recipientName: "Nimeshi Perera",
        recipientPhone: "0771234567",
        deliveryAddress: "12 Flower Road",
        locationType: "house",
        deliveryInstructions: "",
        senderName: "Nimesh",
        senderAnonymous: false,
        giftMessage: "Happy birthday",
      },
    });

    render(<CheckoutStage />);

    expect(screen.getByLabelText(/recipient name/i)).toHaveValue("Nimeshi Perera");
    expect(screen.getByLabelText(/recipient phone/i)).toHaveValue("0771234567");
    expect(screen.getByLabelText(/delivery address/i)).toHaveValue("12 Flower Road");
    expect(screen.getByLabelText(/^sender name$/i)).toHaveValue("Nimesh");
    expect(screen.getByLabelText(/gift message/i)).toHaveValue("Happy birthday");

    fireEvent.click(screen.getByRole("button", { name: /generate payment link/i }));

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: { name: "Nimeshi Perera", phone: "0771234567" },
        sender: { name: "Nimesh", anonymous: false },
        giftMessage: "Happy birthday",
      }),
    );
  });
});
