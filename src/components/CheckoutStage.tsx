"use client";

import type { FormEvent, ReactNode } from "react";
import { useMemo } from "react";
import { useAppStore, type CheckoutDraft } from "@/store/app-store";
import type { CheckoutDetails } from "@/lib/validation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CreditCard,
  Gift,
  Loader2,
  MapPin,
  ShieldCheck,
} from "lucide-react";

/* eslint-disable @next/next/no-img-element */

export default function CheckoutStage() {
  const {
    cart,
    cartSubtotal,
    checkoutDraft: form,
    checkoutLink,
    checkoutStatus,
    deliveryAvailable,
    deliveryDate,
    deliveryCity,
    deliveryMessage,
    relayConnected,
    requestCreateOrder,
    setCheckoutDraft,
    setStage,
  } = useAppStore();

  const checkoutDetails = useMemo<CheckoutDetails>(
    () => ({
      recipient: {
        name: form.recipientName,
        phone: form.recipientPhone,
      },
      delivery: {
        address: form.deliveryAddress,
        locationType: form.locationType,
        instructions: form.deliveryInstructions,
      },
      sender: {
        name: form.senderName,
        anonymous: form.senderAnonymous,
      },
      giftMessage: form.giftMessage,
      currency: "LKR",
    }),
    [form],
  );

  const hasRequiredCheckoutDetails =
    form.recipientName.trim() !== "" &&
    form.recipientPhone.trim().length >= 7 &&
    form.deliveryAddress.trim().length >= 3 &&
    form.senderName.trim() !== "";

  const canCreateOrder =
    cart.length > 0 &&
    relayConnected &&
    deliveryAvailable === true &&
    hasRequiredCheckoutDetails &&
    !checkoutLink &&
    checkoutStatus !== "CREATING";

  const updateForm = <Key extends keyof CheckoutDraft>(
    key: Key,
    value: CheckoutDraft[Key],
  ) => {
    setCheckoutDraft({ [key]: value } as Partial<CheckoutDraft>);
  };

  const handleCreateOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateOrder) return;
    requestCreateOrder(checkoutDetails);
  };
  const firstItem = cart[0] ?? null;

  return (
    <div className="checkout-screen mx-auto w-full max-w-6xl pb-24 sm:pb-16">
      <button
        type="button"
        onClick={() => setStage("PRODUCT_CATALOG")}
        className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-retail-border bg-white text-retail-muted shadow-sm transition-colors hover:border-kapruka-red/30 hover:text-kapruka-red"
        aria-label="Back to product results"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="soft-reveal mb-6 rounded-[1.5rem] border border-retail-border bg-white/88 p-5 shadow-xl shadow-retail-charcoal/5 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-kapruka-red/8 text-kapruka-red">
            <Gift className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-retail-muted">
              Your order journey
            </p>
            <h2 className="display-serif text-3xl leading-none text-retail-charcoal sm:text-4xl">
              Prepare the payment link
            </h2>
          </div>
        </div>

        <div className="checkout-journey-grid">
          <JourneyCard
            done={cart.length > 0}
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Selected gift"
          >
            {firstItem ? (
              <div className="mt-3 flex gap-3">
                <img
                  src={firstItem.imageUrl || "/api/placeholder/96/96"}
                  alt={firstItem.name}
                  className="h-20 w-20 rounded-[1rem] border border-retail-border object-cover"
                />
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-black text-retail-charcoal">
                    {firstItem.name}
                  </p>
                  <p className="mt-1 text-xs text-retail-muted">Qty: {firstItem.quantity}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    Same-day delivery
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-retail-muted">Add a product first.</p>
            )}
          </JourneyCard>

          <JourneyCard
            done={deliveryAvailable === true}
            icon={<MapPin className="h-5 w-5" />}
            title="Delivery check"
          >
            <p className="mt-3 text-sm font-semibold text-retail-charcoal">
              Deliver to {deliveryCity || "Not selected yet"}
            </p>
            <p className="mt-1 text-xs text-retail-muted">
              {deliveryDate || "Ask for a date before checkout"}
            </p>
          </JourneyCard>

          <JourneyCard
            done={hasRequiredCheckoutDetails}
            icon={<CreditCard className="h-5 w-5" />}
            title="Recipient details"
          >
            <p className="mt-3 text-sm font-semibold text-retail-charcoal">
              {form.recipientName || "Recipient pending"}
            </p>
            <p className="mt-1 text-xs text-retail-muted">
              Add phone, address, and sender below.
            </p>
          </JourneyCard>

          <JourneyCard
            done={Boolean(checkoutLink)}
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Payment link"
          >
            <p className="mt-3 text-sm text-retail-muted">
              We create it only when you click the red button.
            </p>
          </JourneyCard>
        </div>
      </div>

        {deliveryMessage && (
          <div
            className={`mb-6 rounded-[1rem] border p-4 text-sm font-medium ${
              deliveryAvailable
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-retail-gold/30 bg-retail-gold/10 text-retail-charcoal"
            }`}
            aria-live="polite"
          >
            {deliveryMessage}
          </div>
        )}

        {!checkoutLink ? (
          <form onSubmit={handleCreateOrder} className="checkout-workspace">
            <div className="rounded-[1.5rem] border border-retail-border bg-white/88 p-5 text-left shadow-xl shadow-retail-charcoal/5 sm:p-6">
              <p className="mb-5 text-sm font-black uppercase tracking-[0.16em] text-retail-muted">
                Recipient and sender details
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-semibold text-retail-charcoal">
                Recipient name
                <input
                  value={form.recipientName}
                  onChange={(event) =>
                    updateForm("recipientName", event.target.value)
                  }
                  className="w-full rounded-lg border border-retail-border bg-white px-3 py-3 font-normal outline-none transition-colors focus:border-kapruka-red"
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </label>
              <label className="space-y-2 text-sm font-semibold text-retail-charcoal">
                Recipient phone
                <input
                  value={form.recipientPhone}
                  onChange={(event) =>
                    updateForm("recipientPhone", event.target.value)
                  }
                  className="w-full rounded-lg border border-retail-border bg-white px-3 py-3 font-normal outline-none transition-colors focus:border-kapruka-red"
                  autoComplete="tel"
                  maxLength={30}
                  required
                />
              </label>
              <label className="space-y-2 text-sm font-semibold text-retail-charcoal md:col-span-2">
                Delivery address
                <input
                  value={form.deliveryAddress}
                  onChange={(event) =>
                    updateForm("deliveryAddress", event.target.value)
                  }
                  className="w-full rounded-lg border border-retail-border bg-white px-3 py-3 font-normal outline-none transition-colors focus:border-kapruka-red"
                  autoComplete="street-address"
                  maxLength={250}
                  required
                />
              </label>
              <label className="space-y-2 text-sm font-semibold text-retail-charcoal">
                Location type
                <select
                  value={form.locationType}
                  onChange={(event) =>
                    updateForm(
                      "locationType",
                      event.target.value as CheckoutDraft["locationType"],
                    )
                  }
                  className="w-full rounded-lg border border-retail-border bg-white px-3 py-3 font-normal outline-none transition-colors focus:border-kapruka-red"
                >
                  <option value="house">House</option>
                  <option value="apartment">Apartment</option>
                  <option value="office">Office</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="space-y-2 text-sm font-semibold text-retail-charcoal">
                Sender name
                <input
                  value={form.senderName}
                  onChange={(event) =>
                    updateForm("senderName", event.target.value)
                  }
                  className="w-full rounded-lg border border-retail-border bg-white px-3 py-3 font-normal outline-none transition-colors focus:border-kapruka-red"
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </label>
              <label className="space-y-2 text-sm font-semibold text-retail-charcoal md:col-span-2">
                Delivery instructions
                <input
                  value={form.deliveryInstructions}
                  onChange={(event) =>
                    updateForm("deliveryInstructions", event.target.value)
                  }
                  className="w-full rounded-lg border border-retail-border bg-white px-3 py-3 font-normal outline-none transition-colors focus:border-kapruka-red"
                  maxLength={250}
                />
              </label>
              <label className="space-y-2 text-sm font-semibold text-retail-charcoal md:col-span-2">
                Gift message
                <textarea
                  value={form.giftMessage}
                  onChange={(event) =>
                    updateForm("giftMessage", event.target.value)
                  }
                  className="min-h-24 w-full resize-y rounded-lg border border-retail-border bg-white px-3 py-3 font-normal outline-none transition-colors focus:border-kapruka-red"
                  maxLength={300}
                />
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold text-retail-charcoal md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.senderAnonymous}
                  onChange={(event) =>
                    updateForm("senderAnonymous", event.target.checked)
                  }
                  className="h-4 w-4 accent-kapruka-red"
                />
                Hide sender name on gift card
              </label>
            </div>
            </div>

            <aside className="order-summary-card">
              <p className="text-sm font-black text-retail-charcoal">Order summary</p>
              <div className="mt-5 space-y-3">
                {cart.map((item) => (
                  <SummaryLine
                    key={item.id}
                    label={item.name}
                    value={`LKR ${(item.priceLKR * item.quantity).toLocaleString()}`}
                  />
                ))}
                <SummaryLine label="Delivery fee" value="Checked by Kapruka" muted />
                <div className="border-t border-retail-border pt-3">
                  <SummaryLine
                    label="Total"
                    value={`LKR ${cartSubtotal.toLocaleString()}`}
                    strong
                  />
                </div>
              </div>
              {checkoutStatus === "CREATING" ? (
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-retail-gold" />
              ) : null}
              <p className="my-4 text-sm font-semibold text-retail-charcoal">
                {getCheckoutPrompt(
                  cart.length,
                  relayConnected,
                  deliveryAvailable,
                  hasRequiredCheckoutDetails,
                  checkoutStatus,
                )}
              </p>
              <button
                type="submit"
                disabled={!canCreateOrder}
                className="flex w-full items-center justify-center gap-3 rounded-[1rem] bg-kapruka-red py-4 text-base font-black text-white shadow-lg shadow-kapruka-red/20 transition-colors hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none"
              >
                {checkoutStatus === "CREATING" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CreditCard className="h-5 w-5" />
                )}
                Generate Payment Link
              </button>
              <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-retail-muted">
                <ShieldCheck className="h-4 w-4" /> Secure. No card details stored.
              </p>
            </aside>
          </form>
        ) : (
          <div className="order-summary-card mx-auto max-w-md">
            <p className="text-sm font-black text-retail-charcoal">Payment link ready</p>
            <p className="mt-2 text-sm text-retail-muted">
              Kapruka will complete payment in the browser.
            </p>
            <a
              href={checkoutLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex w-full items-center justify-center gap-3 rounded-[1rem] bg-kapruka-red py-4 text-base font-black text-white shadow-lg shadow-kapruka-red/20 transition-colors hover:bg-red-700"
            >
              <CreditCard className="h-5 w-5" />
              Pay Securely via Kapruka
            </a>
          </div>
        )}

      <div className="mt-6 grid gap-3 rounded-[1.25rem] border border-retail-border bg-white/88 p-4 sm:grid-cols-4">
        <TrustItem icon={<HeadsetIcon />} title="Dedicated support" text="We are here for you" />
        <TrustItem icon={<Gift className="h-4 w-4" />} title="100% genuine" text="Sourced with care" />
        <TrustItem icon={<MapPin className="h-4 w-4" />} title="On-time delivery" text="You can count on us" />
        <TrustItem icon={<ShieldCheck className="h-4 w-4" />} title="14-day care promise" text="For eligible products" />
      </div>
    </div>
  );
}

function JourneyCard({
  children,
  done,
  icon,
  title,
}: {
  children: ReactNode;
  done: boolean;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div
      className={`rounded-[1.2rem] border p-4 ${
        done
          ? "border-retail-gold/40 bg-retail-gold/8"
          : "border-retail-border bg-white"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full border ${
            done
              ? "border-kapruka-red bg-kapruka-red text-white"
              : "border-retail-border bg-white text-retail-gold"
          }`}
        >
          {icon}
        </span>
        <p className="text-sm font-black text-retail-charcoal">{title}</p>
      </div>
      {children}
    </div>
  );
}

function SummaryLine({
  label,
  muted,
  strong,
  value,
}: {
  label: string;
  muted?: boolean;
  strong?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className={`min-w-0 ${muted ? "text-retail-muted" : "text-retail-charcoal"}`}>
        {label}
      </span>
      <span
        className={`shrink-0 text-right ${
          strong ? "font-black text-kapruka-red" : "font-semibold text-retail-charcoal"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function TrustItem({
  icon,
  text,
  title,
}: {
  icon: ReactNode;
  text: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-retail-gold">{icon}</span>
      <span>
        <span className="block font-black text-retail-charcoal">{title}</span>
        <span className="block text-xs text-retail-muted">{text}</span>
      </span>
    </div>
  );
}

function HeadsetIcon() {
  return <Calendar className="h-4 w-4" />;
}

function getCheckoutPrompt(
  cartCount: number,
  relayConnected: boolean,
  deliveryAvailable: boolean | null,
  hasRequiredCheckoutDetails: boolean,
  checkoutStatus: string,
): string {
  if (checkoutStatus === "CREATING") return "Generating your Kapruka payment link...";
  if (!relayConnected) return "Ask Kapruka before creating a payment link.";
  if (cartCount === 0) return "Add at least one item to your order tray before checkout.";
  if (deliveryAvailable !== true) {
    return "Delivery must be checked before payment link creation.";
  }
  if (!hasRequiredCheckoutDetails) {
    return "Enter recipient, delivery, and sender details before creating a payment link.";
  }
  return "Payment link is generated only when you click.";
}
