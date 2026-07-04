"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAppStore, type Product, type ProductStatus } from "@/store/app-store";
import {
  ROUTE_FILTERS,
  getLabeledProducts,
  getRouteCounts,
  getRouteSubtitle,
  type LabeledProduct,
  type RouteFilter,
  type RouteLabel,
} from "@/lib/product-routes";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Eye,
  Gift,
  Heart,
  Loader2,
  MapPin,
  Mic,
  PackageSearch,
  Plus,
  Search,
  ShieldCheck,
  Truck,
  WalletCards,
} from "lucide-react";

/* eslint-disable @next/next/no-img-element */

const SUGGESTED_PROMPTS = [
  "Birthday gift under Rs. 5,000",
  "Flowers tomorrow",
  "Tea gifts",
  "Cute gift for her",
] as const;

const INTENT_FIELDS = ["Recipient", "Occasion", "Budget", "Delivery", "Taste"] as const;

type IntentSignals = Record<(typeof INTENT_FIELDS)[number], string | null>;

export default function MainStage() {
  const {
    activeStage,
    activeRouteFilter,
    agentVoiceStatus,
    assistantSummary,
    closeProductDetail,
    lastUserIntent,
    latestAssistantReply,
    productDetailOpen,
    productStatus,
    products,
    relayConnected,
    requestAddToCart,
    requestAssistantText,
    requestVoiceToggle,
    selectedProductId,
    setRouteFilter,
    setSelectedProduct,
    voiceError,
  } = useAppStore();
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const intentText = prompt || lastUserIntent || "";
  const intentSignals = useMemo(() => getIntentSignals(intentText), [intentText]);
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const submitPrompt = async (value: string) => {
    const normalized = value.trim();
    if (!normalized || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await requestAssistantText(normalized);
      setPrompt("");
    } catch (error) {
      console.error("[voice-ui]", "primary_prompt.submit_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt(prompt);
  };

  const handleVoiceToggle = () => {
    void requestVoiceToggle().catch((error) => {
      console.error("[voice-ui]", "primary_prompt.voice_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    });
  };

  const isBusy =
    isSubmitting ||
    agentVoiceStatus === "CONNECTING" ||
    agentVoiceStatus === "RECORDING" ||
    agentVoiceStatus === "TRANSCRIBING" ||
    agentVoiceStatus === "THINKING";
  const showWelcome = activeStage === "WELCOME" && productStatus === "idle";

  useEffect(() => {
    if (!productDetailOpen || !selectedProductId) return;

    const selectedElement =
      document.getElementById("selected-product-panel") ??
      document.getElementById(`product-card-${selectedProductId}`);
    if (typeof selectedElement?.scrollIntoView !== "function") return;

    selectedElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [productDetailOpen, selectedProductId]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col">
      {showWelcome ? (
        <WelcomeScreen
          agentVoiceStatus={agentVoiceStatus}
          handleSubmit={handleSubmit}
          handleVoiceToggle={handleVoiceToggle}
          intentSignals={intentSignals}
          isSubmitting={isSubmitting}
          latestAssistantReply={latestAssistantReply}
          productStatus={productStatus}
          prompt={prompt}
          setPrompt={setPrompt}
          submitPrompt={submitPrompt}
          voiceError={voiceError}
        />
      ) : (
        <ProductDiscovery
          assistantSummary={assistantSummary}
          activeRouteFilter={activeRouteFilter}
          closeProductDetail={closeProductDetail}
          handleSubmit={handleSubmit}
          handleVoiceToggle={handleVoiceToggle}
          isBusy={isBusy}
          isSubmitting={isSubmitting}
          lastUserIntent={lastUserIntent}
          latestAssistantReply={latestAssistantReply}
          productDetailOpen={productDetailOpen}
          products={products}
          productStatus={productStatus}
          prompt={prompt}
          relayConnected={relayConnected}
          requestAddToCart={requestAddToCart}
          selectedProduct={selectedProduct}
          selectedProductId={selectedProductId}
          setPrompt={setPrompt}
          setRouteFilter={setRouteFilter}
          setSelectedProduct={setSelectedProduct}
          submitPrompt={submitPrompt}
          voiceError={voiceError}
        />
      )}
    </div>
  );
}

function WelcomeScreen({
  agentVoiceStatus,
  handleSubmit,
  handleVoiceToggle,
  intentSignals,
  isSubmitting,
  latestAssistantReply,
  productStatus,
  prompt,
  setPrompt,
  submitPrompt,
  voiceError,
}: {
  agentVoiceStatus: string;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleVoiceToggle: () => void;
  intentSignals: IntentSignals;
  isSubmitting: boolean;
  latestAssistantReply: string | null;
  productStatus: ProductStatus;
  prompt: string;
  setPrompt: (value: string) => void;
  submitPrompt: (value: string) => Promise<void>;
  voiceError: string | null;
}) {
  return (
    <section className="home-screen soft-reveal flex min-h-[calc(100dvh-8rem)] flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-kapruka-red">
            Kapruka
          </p>
          <h1 className="text-xl font-semibold text-retail-charcoal">
            Concierge
          </h1>
        </div>
        <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-retail-border bg-white px-3 py-1.5 text-xs font-semibold text-retail-charcoal shadow-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {getCompactStatus(productStatus, agentVoiceStatus)}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-7 text-center lg:py-10">
        <h2 className="display-serif text-4xl leading-none text-retail-charcoal sm:text-5xl lg:text-6xl">
          What are you looking for?
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-retail-muted sm:text-base">
          {latestAssistantReply ||
            "Share the moment, your budget, and preferences. I'll bring you the best options."}
        </p>

        <AssistantPrompt
          handleSubmit={handleSubmit}
          handleVoiceToggle={handleVoiceToggle}
          isSubmitting={isSubmitting}
          prompt={prompt}
          setPrompt={setPrompt}
          variant="hero"
        />
        <VoicePromptError message={voiceError} />

        <p className="mt-3 text-[0.68rem] font-semibold text-retail-muted">
          Try something like
        </p>
        <SuggestedPrompts isSubmitting={isSubmitting} submitPrompt={submitPrompt} />

        <IntentConstellation intentSignals={intentSignals} />

        <p className="mt-5 flex items-center justify-center gap-2 text-xs font-medium text-retail-muted">
          <ShieldCheck className="h-4 w-4 text-retail-gold" />
          Your details are safe with us
        </p>
      </div>
    </section>
  );
}

function AssistantPrompt({
  handleSubmit,
  handleVoiceToggle,
  isSubmitting,
  prompt,
  setPrompt,
  variant,
}: {
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleVoiceToggle: () => void;
  isSubmitting: boolean;
  prompt: string;
  setPrompt: (value: string) => void;
  variant: "hero" | "compact";
}) {
  return (
    <form
      onSubmit={handleSubmit}
      className={`luminous-input mx-auto flex w-full items-center gap-2 border border-retail-border bg-white shadow-xl shadow-retail-charcoal/10 ${
        variant === "hero"
          ? "mt-8 max-w-[42rem] rounded-[1.6rem] p-2"
          : "max-w-[36rem] rounded-full px-2 py-1.5"
      }`}
    >
      <Search
        className="ml-2 h-5 w-5 shrink-0 text-retail-muted"
        aria-hidden="true"
      />
      <label className="sr-only" htmlFor="shopping-assistant-prompt">
        What are you looking for?
      </label>
      <input
        id="shopping-assistant-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={isSubmitting}
        placeholder="Tell me what you need..."
        className={`min-w-0 flex-1 bg-transparent px-2 font-medium text-retail-charcoal outline-none placeholder:text-retail-muted ${
          variant === "hero" ? "py-4 text-base" : "py-2 text-sm"
        }`}
        maxLength={1000}
      />
      <button
        type="button"
        onClick={handleVoiceToggle}
        aria-label="Tap to speak"
        className={`flex shrink-0 items-center justify-center gap-2 border border-retail-border bg-white font-bold text-kapruka-red transition-colors hover:border-kapruka-red/30 ${
          variant === "hero"
            ? "h-12 rounded-full px-4 text-sm"
            : "h-10 w-10 rounded-full"
        }`}
      >
        <Mic className="h-4 w-4" />
        {variant === "hero" && <span className="hidden sm:inline">Tap to speak</span>}
      </button>
      <button
        type="submit"
        disabled={!prompt.trim() || isSubmitting}
        className={`flex shrink-0 items-center justify-center gap-2 rounded-full bg-kapruka-red font-black text-white transition-colors hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500 ${
          variant === "hero" ? "h-12 px-4 text-sm" : "h-10 px-3 text-xs"
        }`}
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}
      </button>
    </form>
  );
}

function VoicePromptError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      className="mx-auto mt-3 max-w-[42rem] rounded-full border border-kapruka-red/20 bg-kapruka-red/5 px-4 py-2 text-center text-xs font-semibold leading-5 text-kapruka-red"
      role="alert"
    >
      {message}
    </p>
  );
}

function SuggestedPrompts({
  isSubmitting,
  submitPrompt,
}: {
  isSubmitting: boolean;
  submitPrompt: (value: string) => Promise<void>;
}) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-2">
      {SUGGESTED_PROMPTS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => void submitPrompt(suggestion)}
          disabled={isSubmitting}
          className="rounded-full border border-retail-border bg-white px-3 py-2 text-xs font-semibold text-retail-charcoal shadow-sm transition-colors hover:border-kapruka-red/30 hover:text-kapruka-red disabled:opacity-60 sm:text-sm"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

function IntentConstellation({ intentSignals }: { intentSignals: IntentSignals }) {
  const nodeConfig = {
    Recipient: {
      icon: Gift,
      className: "lg:left-1/2 lg:top-0 lg:-translate-x-1/2",
    },
    Occasion: {
      icon: Calendar,
      className: "lg:left-0 lg:top-[34%]",
    },
    Budget: {
      icon: WalletCards,
      className: "lg:right-0 lg:top-[34%]",
    },
    Delivery: {
      icon: Truck,
      className: "lg:bottom-0 lg:left-[9%]",
    },
    Taste: {
      icon: Heart,
      className: "lg:bottom-0 lg:right-[9%]",
    },
  } as const;

  return (
    <section
      className="intent-constellation-map relative mt-7 w-full max-w-[44rem] lg:h-[18rem]"
      aria-label="Intent constellation"
    >
      <div className="constellation-lines hidden lg:block" aria-hidden="true" />
      <div className="constellation-core hidden lg:flex" aria-hidden="true">
        <Gift className="h-10 w-10" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:block">
        {INTENT_FIELDS.map((field) => {
          const { className, icon: Icon } = nodeConfig[field];
          const value = intentSignals[field];
          return (
            <div
              key={field}
              className={`intent-orbit-node rounded-[1.25rem] border border-retail-border bg-white/88 p-3 text-left shadow-sm lg:absolute lg:w-[11.5rem] ${className}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-retail-gold" />
                <span className="text-xs font-bold lowercase text-retail-charcoal">
                  {field}
                </span>
              </div>
              <p className="mt-1 text-xs text-retail-muted">
                {value || getIntentFallback(field)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProductDiscovery({
  activeRouteFilter,
  assistantSummary,
  closeProductDetail,
  handleSubmit,
  handleVoiceToggle,
  isBusy,
  isSubmitting,
  lastUserIntent,
  latestAssistantReply,
  productDetailOpen,
  products,
  productStatus,
  prompt,
  relayConnected,
  requestAddToCart,
  selectedProduct,
  selectedProductId,
  setPrompt,
  setRouteFilter,
  setSelectedProduct,
  submitPrompt,
  voiceError,
}: {
  activeRouteFilter: RouteFilter;
  assistantSummary: string | null;
  closeProductDetail: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleVoiceToggle: () => void;
  isBusy: boolean;
  isSubmitting: boolean;
  lastUserIntent: string | null;
  latestAssistantReply: string | null;
  productDetailOpen: boolean;
  products: Product[];
  productStatus: ProductStatus;
  prompt: string;
  relayConnected: boolean;
  requestAddToCart: (productId: string, quantity?: number) => void;
  selectedProduct: Product | null;
  selectedProductId: string | null;
  setPrompt: (value: string) => void;
  setRouteFilter: (route: RouteFilter) => void;
  setSelectedProduct: (productId: string | null) => void;
  submitPrompt: (value: string) => Promise<void>;
  voiceError: string | null;
}) {
  const activeRoute = activeRouteFilter;
  const setActiveRoute = setRouteFilter;
  const labeledProducts = useMemo<LabeledProduct[]>(
    () => getLabeledProducts(products),
    [products],
  );
  const routeCounts = useMemo(() => getRouteCounts(labeledProducts), [labeledProducts]);

  if (productStatus === "searching") {
    return (
      <ResultsShell
        handleSubmit={handleSubmit}
        handleVoiceToggle={handleVoiceToggle}
        isSubmitting={isSubmitting}
        lastUserIntent={lastUserIntent}
        prompt={prompt}
        setPrompt={setPrompt}
        voiceError={voiceError}
      >
        <SearchingState lastUserIntent={lastUserIntent} isBusy={isBusy} />
      </ResultsShell>
    );
  }

  if (productStatus === "empty") {
    return null;
  }

  if (productStatus === "error") {
    return (
      <ResultsShell
        handleSubmit={handleSubmit}
        handleVoiceToggle={handleVoiceToggle}
        isSubmitting={isSubmitting}
        lastUserIntent={lastUserIntent}
        prompt={prompt}
        setPrompt={setPrompt}
        voiceError={voiceError}
      >
        <section className="mx-auto max-w-xl rounded-[1.25rem] border border-kapruka-red/20 bg-white p-8 text-center shadow-sm">
          <h3 className="text-xl font-black text-retail-charcoal">
            Search needs another try.
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-retail-muted">
            {voiceError || "The assistant could not finish the request. Try again with a shorter phrase."}
          </p>
        </section>
      </ResultsShell>
    );
  }

  if (products.length === 0) {
    return (
      <ResultsShell
        handleSubmit={handleSubmit}
        handleVoiceToggle={handleVoiceToggle}
        isSubmitting={isSubmitting}
        lastUserIntent={lastUserIntent}
        prompt={prompt}
        setPrompt={setPrompt}
        voiceError={voiceError}
      >
        <section className="mx-auto max-w-xl rounded-[1.25rem] border border-dashed border-retail-border bg-white/70 p-8 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-retail-muted" />
          <h3 className="mt-4 text-xl font-black text-retail-charcoal">
            No query yet.
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-retail-muted">
            Ask Kapruka for a product, gift idea, or delivery need.
          </p>
        </section>
      </ResultsShell>
    );
  }

  const visibleItems =
    activeRoute === "All"
      ? labeledProducts
      : labeledProducts.filter((item) => item.routeLabel === activeRoute);
  const selectedLabeledItem = selectedProduct
    ? labeledProducts.find((item) => item.product.id === selectedProduct.id) ?? null
    : null;
  const selectedProductMatchesRoute =
    selectedLabeledItem &&
    (activeRoute === "All" || selectedLabeledItem.routeLabel === activeRoute);
  const selectedItem = selectedProductMatchesRoute ? selectedLabeledItem : null;
  const heroItem = selectedItem ?? visibleItems[0] ?? null;
  const secondaryItems = heroItem
    ? visibleItems.filter((item) => item.product.id !== heroItem.product.id)
    : [];
  const selectedProductVisible = Boolean(selectedProductMatchesRoute);

  return (
    <ResultsShell
      handleSubmit={handleSubmit}
      handleVoiceToggle={handleVoiceToggle}
      isSubmitting={isSubmitting}
      lastUserIntent={lastUserIntent}
      prompt={prompt}
      setPrompt={setPrompt}
      voiceError={voiceError}
    >
      <section className="results-reveal space-y-5" aria-label="Curated product results">
        <div className="results-heading-grid">
          <AssistantReplyPanel
            lastUserIntent={lastUserIntent}
            responseText={
              latestAssistantReply || assistantSummary || "I found a few thoughtful options."
            }
            visibleCount={visibleItems.length}
            totalCount={products.length}
            activeRoute={activeRoute}
          />
          <RouteTabs
            activeRoute={activeRoute}
            counts={routeCounts}
            onRouteChange={setActiveRoute}
          />
        </div>

        {productDetailOpen && selectedProductVisible && selectedItem && (
          <ProductFocus
            product={selectedItem.product}
            relayConnected={relayConnected}
            routeLabel={selectedItem.routeLabel}
            onAdd={() => requestAddToCart(selectedItem.product.id, 1)}
            onClose={closeProductDetail}
          />
        )}

        {heroItem ? (
          <div className="product-results-grid">
            <HeroProduct
              product={heroItem.product}
              relayConnected={relayConnected}
              routeLabel={heroItem.routeLabel}
              onAdd={() => requestAddToCart(heroItem.product.id, 1)}
              onSelect={() => setSelectedProduct(heroItem.product.id)}
            />

            <div className="product-side-grid">
              {secondaryItems.slice(0, 5).map((item, index) => (
                <ProductCard
                  key={item.product.id}
                  product={item.product}
                  index={index}
                  isSelected={item.product.id === selectedProductId}
                  relayConnected={relayConnected}
                  routeLabel={item.routeLabel}
                  onAdd={() => requestAddToCart(item.product.id, 1)}
                  onSelect={() => setSelectedProduct(item.product.id)}
                />
              ))}
              {secondaryItems.length === 0 && <RouteHintCard activeRoute={activeRoute} />}
            </div>
          </div>
        ) : (
          <FilteredEmptyState
            activeRoute={activeRoute}
            onShowAll={() => setActiveRoute("All")}
          />
        )}

        <SuggestedPrompts isSubmitting={isSubmitting} submitPrompt={submitPrompt} />
        <TrustStrip />
      </section>
    </ResultsShell>
  );
}

function ResultsShell({
  children,
  handleSubmit,
  handleVoiceToggle,
  isSubmitting,
  lastUserIntent,
  prompt,
  setPrompt,
  voiceError,
}: {
  children: ReactNode;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleVoiceToggle: () => void;
  isSubmitting: boolean;
  lastUserIntent: string | null;
  prompt: string;
  setPrompt: (value: string) => void;
  voiceError: string | null;
}) {
  return (
    <div className="results-screen space-y-6">
      <div className="results-toolbar">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-retail-border bg-white text-retail-muted">
            <Search className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-retail-muted">
              Curated reveal
            </p>
            <p className="truncate text-sm font-semibold text-retail-charcoal">
              {lastUserIntent || "New search"}
            </p>
          </div>
        </div>
        <AssistantPrompt
          handleSubmit={handleSubmit}
          handleVoiceToggle={handleVoiceToggle}
          isSubmitting={isSubmitting}
          prompt={prompt}
          setPrompt={setPrompt}
          variant="compact"
        />
      </div>
      <VoicePromptError message={voiceError} />
      {children}
    </div>
  );
}

function AssistantReplyPanel({
  activeRoute,
  lastUserIntent,
  responseText,
  totalCount,
  visibleCount,
}: {
  activeRoute: RouteFilter;
  lastUserIntent: string | null;
  responseText: string;
  totalCount: number;
  visibleCount: number;
}) {
  return (
    <section className="assistant-reply-panel" aria-label="Assistant response">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kapruka-red/8 text-kapruka-red">
          <Gift className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-retail-gold">
            Assistant reply
          </p>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-retail-charcoal">
            {responseText}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-retail-muted">
            <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-retail-charcoal shadow-sm">
              {activeRoute === "All" ? `${totalCount} options` : `${visibleCount} ${activeRoute}`}
            </span>
            <span>{lastUserIntent || "Curated for your request"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function RouteTabs({
  activeRoute,
  counts,
  onRouteChange,
}: {
  activeRoute: RouteFilter;
  counts: Record<RouteFilter, number>;
  onRouteChange: (route: RouteFilter) => void;
}) {
  return (
    <div className="route-filter-panel" aria-label="Product filters">
      {ROUTE_FILTERS.map((route) => {
        const count = counts[route];
        const isActive = route === activeRoute;
        return (
          <button
            key={route}
            type="button"
            onClick={() => onRouteChange(route)}
            aria-pressed={isActive}
            className={`route-filter-button ${
              isActive
                ? "border-kapruka-red bg-kapruka-red text-white shadow-lg shadow-kapruka-red/15"
                : "border-retail-border bg-white text-retail-charcoal"
            }`}
          >
            <span className="text-xs font-black">{route}</span>
            <span
              className={`text-[0.65rem] ${
                isActive ? "text-white/78" : "text-retail-muted"
              }`}
            >
              {getRouteSubtitle(route)} · {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SearchingState({
  isBusy,
  lastUserIntent,
}: {
  isBusy: boolean;
  lastUserIntent: string | null;
}) {
  return (
    <section className="searching-cinema mx-auto max-w-3xl overflow-hidden rounded-[1.5rem] border border-retail-gold/25 bg-white p-7 shadow-xl shadow-retail-charcoal/5">
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-retail-gold/10 text-retail-gold shadow-[0_0_0_10px_rgba(246,196,83,0.12)]">
          {isBusy ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <PackageSearch className="h-6 w-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-retail-gold">
            Searching Kapruka
          </p>
          <h3 className="mt-1 text-2xl font-black text-retail-charcoal">
            {lastUserIntent ? `Curating for "${lastUserIntent}"` : "Curating options"}
          </h3>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {["Understanding request", "Searching Kapruka", "Curating options"].map((step) => (
              <div
                key={step}
                className="rounded-full border border-retail-border bg-white px-3 py-2 text-xs font-bold text-retail-muted"
              >
                {step}
              </div>
            ))}
          </div>
          <div className="curated-shimmer mt-5 h-1.5 overflow-hidden rounded-full bg-retail-border" />
        </div>
      </div>
    </section>
  );
}

function HeroProduct({
  onAdd,
  onSelect,
  product,
  relayConnected,
  routeLabel,
}: {
  onAdd: () => void;
  onSelect: () => void;
  product: Product;
  relayConnected: boolean;
  routeLabel: RouteLabel;
}) {
  return (
    <article
      id={`product-card-${product.id}`}
      className="hero-product-card product-card-enter relative overflow-hidden rounded-[1.75rem] border border-retail-gold bg-retail-charcoal shadow-2xl shadow-retail-charcoal/20"
    >
      <img
        src={product.imageUrl || "/api/placeholder/700/850"}
        alt={product.name}
        className="h-[28rem] w-full object-cover lg:h-[31rem]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/78 via-black/18 to-transparent" />
      <span className="absolute left-5 top-5 rounded-full border border-retail-gold/50 bg-retail-gold/90 px-3 py-1.5 text-xs font-black text-white shadow-sm">
        {routeLabel === "Romantic" ? "Most loved" : routeLabel}
      </span>
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <p className="mb-2 w-fit rounded-full border border-white/25 bg-white/14 px-3 py-1 text-xs font-bold text-white/90 backdrop-blur">
          Found for your request
        </p>
        <h3 className="display-serif text-3xl leading-none">
          {product.name}
        </h3>
        <p className="mt-2 text-sm leading-5 text-white/85">
          Fresh picks selected for your request.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-black">{formatPrice(product.priceLKR)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Same-day delivery
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSelect}
              className="flex h-11 items-center justify-center gap-2 rounded-full border border-white/35 bg-black/25 px-4 text-sm font-black text-white backdrop-blur transition-colors hover:bg-white hover:text-retail-charcoal"
              aria-label={`View details for ${product.name}`}
            >
              <Eye className="h-4 w-4" />
              Details
            </button>
            <button
              type="button"
              onClick={onAdd}
              disabled={!relayConnected}
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-kapruka-red px-5 text-sm font-black text-white transition-colors hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductCard({
  isSelected,
  index,
  onAdd,
  onSelect,
  product,
  relayConnected,
  routeLabel,
}: {
  isSelected: boolean;
  index: number;
  onAdd: () => void;
  onSelect: () => void;
  product: Product;
  relayConnected: boolean;
  routeLabel: RouteLabel;
}) {
  return (
    <article
      id={`product-card-${product.id}`}
      className={`product-card-enter overflow-hidden rounded-[1.2rem] border bg-white shadow-lg shadow-retail-charcoal/5 transition-transform hover:-translate-y-0.5 ${
        isSelected
          ? "border-retail-gold ring-2 ring-retail-gold/20"
          : "border-retail-border"
      }`}
      style={{ animationDelay: `${Math.min(index * 70, 420)}ms` }}
    >
      <div className="relative aspect-[4/3] bg-retail-gray">
        <img
          src={product.imageUrl || "/api/placeholder/400/360"}
          alt={product.name}
          className="h-full w-full object-cover"
        />
        <span className="absolute left-3 top-3 rounded-full bg-white/92 px-2.5 py-1 text-[0.68rem] font-black text-kapruka-red shadow-sm">
          {routeLabel}
        </span>
      </div>
      <div className="p-4">
        <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-kapruka-red">
          {routeLabel}
        </p>
        <h3 className="mt-2 line-clamp-2 min-h-10 text-sm font-black leading-tight text-retail-charcoal">
          {product.name}
        </h3>
        <p className="mt-3 font-black text-retail-charcoal">
          {formatPrice(product.priceLKR)}
        </p>
        <p className="mt-1 flex items-center gap-1 text-[0.7rem] font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          1-2 days delivery
        </p>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={onAdd}
            disabled={!relayConnected}
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-kapruka-red text-sm font-black text-white transition-colors hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500"
          >
            Add
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onSelect}
            className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-retail-border bg-white px-3 text-sm font-black text-retail-charcoal transition-colors hover:border-kapruka-red/30 hover:text-kapruka-red"
            aria-label={`View details for ${product.name}`}
          >
            <Eye className="h-4 w-4" />
            Details
          </button>
        </div>
      </div>
    </article>
  );
}

function FilteredEmptyState({
  activeRoute,
  onShowAll,
}: {
  activeRoute: RouteFilter;
  onShowAll: () => void;
}) {
  return (
    <section className="rounded-[1.25rem] border border-dashed border-retail-border bg-white/78 p-8 text-center">
      <PackageSearch className="mx-auto h-8 w-8 text-retail-muted" />
      <h3 className="mt-4 text-xl font-black text-retail-charcoal">
        No {activeRoute.toLowerCase()} picks here yet.
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-retail-muted">
        Try All to review every option from this response, or ask for a more specific style.
      </p>
      <button
        type="button"
        onClick={onShowAll}
        className="mt-5 rounded-full bg-kapruka-red px-4 py-2 text-sm font-black text-white transition-colors hover:bg-red-700"
      >
        Show all
      </button>
    </section>
  );
}

function RouteHintCard({ activeRoute }: { activeRoute: RouteFilter }) {
  return (
    <div className="min-h-40 rounded-[1.2rem] border border-dashed border-retail-border bg-white/70 p-5 text-sm leading-6 text-retail-muted">
      {activeRoute === "All"
        ? "Ask for another occasion, city, or budget to unlock more routes."
        : `Only one ${activeRoute.toLowerCase()} pick is available in this response.`}
    </div>
  );
}

function ProductFocus({
  onAdd,
  onClose,
  product,
  relayConnected,
  routeLabel,
}: {
  onAdd: () => void;
  onClose: () => void;
  product: Product;
  relayConnected: boolean;
  routeLabel: RouteLabel;
}) {
  return (
    <section
      id="selected-product-panel"
      className="focused-product-shell"
      aria-label="Focused product details"
    >
      <div className="focused-product-media">
        <img
          src={product.imageUrl || "/api/placeholder/700/700"}
          alt={product.name}
          className="h-full w-full object-cover"
        />
        <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-1.5 text-xs font-black text-kapruka-red shadow-sm">
          {routeLabel}
        </span>
      </div>
      <div className="focused-product-content">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-retail-gold">
          Selected for review
        </p>
        <h3 className="display-serif mt-2 text-3xl leading-none text-retail-charcoal sm:text-4xl">
          {product.name}
        </h3>
        <p className="mt-3 text-2xl font-black text-kapruka-red">
          {formatPrice(product.priceLKR)}
        </p>
        <p className="mt-3 max-w-xl text-sm leading-6 text-retail-muted">
          A {routeLabel.toLowerCase()} Kapruka pick with delivery-ready ordering and
          secure checkout.
        </p>
        <div className="focused-product-facts">
          <span>
            <CheckCircle2 className="h-4 w-4" />
            Available option
          </span>
          <span>
            <Truck className="h-4 w-4" />
            Delivery ready
          </span>
          <span>
            <ShieldCheck className="h-4 w-4" />
            Secure checkout
          </span>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onAdd}
            disabled={!relayConnected}
            className="flex h-11 items-center justify-center gap-2 rounded-full bg-kapruka-red px-5 text-sm font-black text-white transition-colors hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500"
          >
            <Plus className="h-4 w-4" />
            Add to cart
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-full border border-retail-border bg-white px-5 text-sm font-black text-retail-charcoal transition-colors hover:border-retail-gold/40 hover:text-retail-gold"
          >
            Close
          </button>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  return (
    <div className="grid gap-2 rounded-[1.25rem] border border-retail-border bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
      <SignalPill icon={<Truck className="h-4 w-4" />} title="Same-day delivery" text="Across Colombo and suburbs" />
      <SignalPill icon={<Gift className="h-4 w-4" />} title="Trusted by 2M+" text="Genuine products and brands" />
      <SignalPill icon={<MapPin className="h-4 w-4" />} title="Islandwide delivery" text="On time, every time" />
      <SignalPill icon={<ShieldCheck className="h-4 w-4" />} title="Secure payments" text="Protected checkout" />
    </div>
  );
}

function SignalPill({
  icon,
  text,
  title,
}: {
  icon: ReactNode;
  text: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[1rem] px-3 py-2">
      <span className="text-retail-gold">{icon}</span>
      <span>
        <span className="block text-xs font-black text-retail-charcoal">{title}</span>
        <span className="block text-[0.68rem] text-retail-muted">{text}</span>
      </span>
    </div>
  );
}

function getIntentSignals(text: string): IntentSignals {
  const lowerText = text.toLowerCase();
  return {
    Recipient: extractRecipient(lowerText),
    Occasion: extractOccasion(lowerText),
    Budget: extractBudget(text),
    Delivery: extractDelivery(lowerText),
    Taste: extractTaste(lowerText),
  };
}

function extractRecipient(text: string): string | null {
  if (/\bgirlfriend|wife|her|gf\b/.test(text)) return "For her";
  if (/\bboyfriend|husband|him\b/.test(text)) return "For him";
  if (/\bmother|mom|mum|amma\b/.test(text)) return "Mother";
  if (/\bfather|dad|thaththa\b/.test(text)) return "Father";
  if (/\bfriend|colleague|office\b/.test(text)) return "Friend";
  return null;
}

function extractOccasion(text: string): string | null {
  if (text.includes("birthday")) return "Birthday";
  if (text.includes("anniversary")) return "Anniversary";
  if (text.includes("thank")) return "Thank you";
  if (text.includes("love") || text.includes("romantic")) return "Romantic";
  return null;
}

function extractBudget(text: string): string | null {
  const match = text.match(/(?:rs\.?|lkr|under|below)\s*([0-9,]+)/i);
  return match ? `Under Rs. ${match[1]}` : null;
}

function extractDelivery(text: string): string | null {
  if (text.includes("tomorrow")) return "Tomorrow";
  if (text.includes("today")) return "Today";
  if (text.includes("deliver") || text.includes("delivery")) return "Any city";
  return null;
}

function extractTaste(text: string): string | null {
  if (text.includes("flower") || text.includes("bouquet") || text.includes("rose")) return "Flowers";
  if (text.includes("cake")) return "Cake";
  if (text.includes("tea")) return "Tea gifts";
  if (text.includes("cute")) return "Cute";
  if (text.includes("premium")) return "Premium";
  return null;
}

function getIntentFallback(field: (typeof INTENT_FIELDS)[number]): string {
  if (field === "Recipient") return "For her";
  if (field === "Occasion") return "Birthday";
  if (field === "Budget") return "Under Rs. 5,000";
  if (field === "Delivery") return "Any city";
  return "Elegant and classy";
}

function getCompactStatus(
  productStatus: ProductStatus,
  agentVoiceStatus: string,
): string {
  if (agentVoiceStatus === "CONNECTING") return "Connecting";
  if (agentVoiceStatus === "LIVE_CONNECTING") return "Live connecting";
  if (agentVoiceStatus === "RECORDING") return "Recording";
  if (agentVoiceStatus === "TRANSCRIBING") return "Transcribing";
  if (agentVoiceStatus === "THINKING") return "Thinking";
  if (productStatus === "searching") return "Searching Kapruka";
  if (productStatus === "ready") return "Found options";
  if (agentVoiceStatus === "LIVE") return "Live";
  return "Ready";
}

function formatPrice(price: number): string {
  return `LKR ${price.toLocaleString()}`;
}
