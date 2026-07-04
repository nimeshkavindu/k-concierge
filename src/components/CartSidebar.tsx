"use client";

import { useAppStore } from "@/store/app-store";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CreditCard,
  Gift,
  MapPin,
  ShoppingBag,
  X,
} from "lucide-react";

/* eslint-disable @next/next/no-img-element */

export default function CartSidebar() {
  const {
    cart,
    cartSubtotal,
    checkoutLink,
    closeCartTray,
    deliveryAvailable,
    isCartTrayOpen,
    setStage,
    toggleCartTray,
  } = useAppStore();
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const hasItems = cart.length > 0;

  if (!hasItems) return null;

  if (!isCartTrayOpen) {
    return (
      <aside className="order-pill fixed inset-x-4 bottom-24 z-30 mx-auto flex max-w-sm items-center justify-between gap-4 rounded-full border border-retail-border bg-white/95 px-4 py-3 shadow-2xl shadow-retail-charcoal/15 backdrop-blur-xl lg:bottom-28 lg:left-[calc(50%+2.875rem)] lg:right-auto lg:w-[21rem] lg:-translate-x-1/2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kapruka-red/8 text-kapruka-red">
            <ShoppingBag className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-kapruka-red px-1 text-[0.65rem] font-black text-white">
              {itemCount}
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-retail-charcoal">
              Order tray
            </p>
            <p className="text-sm font-black text-retail-charcoal">
              Rs. {cartSubtotal.toLocaleString()}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleCartTray}
          className="flex h-10 shrink-0 items-center justify-center rounded-full border border-retail-border bg-white px-4 text-sm font-black text-retail-charcoal transition-colors hover:border-kapruka-red/30 hover:text-kapruka-red"
          aria-label="Open order tray"
        >
          Open
        </button>
      </aside>
    );
  }

  return (
    <aside className="order-journey-panel fixed inset-x-4 bottom-24 z-30 mx-auto flex max-h-[70dvh] max-w-md flex-col rounded-[1.5rem] border border-retail-border bg-white/96 p-4 shadow-2xl shadow-retail-charcoal/15 backdrop-blur-xl sm:p-5 lg:bottom-28 lg:left-auto lg:right-8 lg:w-[23rem]">
      <div className="border-b border-retail-border pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-retail-muted">
              Order journey
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-black text-retail-charcoal">
              <ShoppingBag className="h-5 w-5 text-kapruka-red" />
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeCartTray}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-retail-border bg-white text-retail-muted transition-colors hover:border-kapruka-red/30 hover:text-kapruka-red"
            aria-label="Close order tray"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-3xl font-black text-kapruka-red">
          Rs. {cartSubtotal.toLocaleString()}
        </p>
      </div>

      <OrderTimeline
        hasDelivery={deliveryAvailable === true}
        hasPayment={Boolean(checkoutLink)}
      />

      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto py-5 pr-1">
        {cart.map((item) => (
          <div
            key={item.id}
            className="flex gap-3 border-b border-retail-border pb-4 last:border-0"
          >
            <img
              src={item.imageUrl || "/api/placeholder/80/80"}
              alt={item.name}
              className="h-16 w-16 shrink-0 rounded-2xl border border-retail-border object-cover"
            />
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-sm font-black leading-tight text-retail-charcoal">
                {item.name}
              </h3>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-sm font-black text-kapruka-red">
                  Rs. {item.priceLKR.toLocaleString()}
                </p>
                <p className="rounded-full bg-retail-gray px-2 py-1 text-xs font-bold text-retail-muted">
                  Qty {item.quantity}
                </p>
              </div>
            </div>
          </div>
        ))}

        <div className="rounded-2xl border border-retail-gold/25 bg-retail-gold/10 p-4">
          <div className="flex items-start gap-3">
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-retail-gold" />
            <div>
              <p className="text-sm font-black text-retail-charcoal">
                Sending a gift?
              </p>
              <p className="mt-1 text-sm leading-6 text-retail-muted">
                Add a message during checkout and Kapruka can include it with the order.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-retail-border pt-4">
        <button
          type="button"
          onClick={() => setStage("CHECKOUT")}
          disabled={!hasItems}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-kapruka-red py-3 text-sm font-black text-white shadow-lg shadow-kapruka-red/20 transition-colors hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none"
        >
          Continue checkout
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function OrderTimeline({
  hasDelivery,
  hasPayment,
}: {
  hasDelivery: boolean;
  hasPayment: boolean;
}) {
  const steps = [
    { label: "Selected gift", done: true, icon: Gift },
    { label: "Delivery check", done: hasDelivery, icon: MapPin },
    { label: "Recipient details", done: false, icon: Circle },
    { label: "Payment link", done: hasPayment, icon: CreditCard },
  ];

  return (
    <div className="border-b border-retail-border py-4" aria-label="Order journey steps">
      <div className="space-y-3">
        {steps.map((step) => {
          const Icon = step.done ? CheckCircle2 : step.icon;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                  step.done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-retail-border bg-white text-retail-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-black text-retail-charcoal">
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
