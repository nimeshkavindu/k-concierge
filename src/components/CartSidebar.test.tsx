// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CartSidebar from "./CartSidebar";
import { useAppStore } from "@/store/app-store";

describe("CartSidebar", () => {
  afterEach(() => {
    cleanup();
    useAppStore.getState().resetSessionState();
    useAppStore.setState({
      activeStage: "WELCOME",
      relayConnected: false,
      relayCommands: null,
      assistantCommands: null,
    });
  });

  it("hides the order tray when the cart is empty", () => {
    const { container } = render(<CartSidebar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("auto-opens when products are added to the tray", () => {
    useAppStore.getState().setCartState(
      [
        {
          id: "tea-1",
          name: "Ceylon Tea Gift Box",
          priceLKR: 2400,
          imageUrl: "",
          quantity: 2,
        },
      ],
      4800,
    );

    render(<CartSidebar />);

    expect(screen.getByText(/2 items/i)).toBeInTheDocument();
    expect(screen.getAllByText(/rs\. 4,800/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /checkout/i })).toBeEnabled();
  });

  it("can be manually closed and reopened from the compact button", () => {
    useAppStore.getState().setCartState(
      [
        {
          id: "tea-1",
          name: "Ceylon Tea Gift Box",
          priceLKR: 2400,
          imageUrl: "",
          quantity: 1,
        },
      ],
      2400,
    );

    const { rerender } = render(<CartSidebar />);
    fireEvent.click(screen.getByRole("button", { name: /close order tray/i }));
    rerender(<CartSidebar />);

    expect(screen.getByRole("button", { name: /open order tray/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /checkout/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open order tray/i }));
    rerender(<CartSidebar />);

    expect(screen.getByRole("button", { name: /checkout/i })).toBeEnabled();
  });
});
