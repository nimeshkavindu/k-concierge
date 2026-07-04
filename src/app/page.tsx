"use client";

import { useAppStore } from '@/store/app-store';
import VoiceSidebar from '@/components/VoiceSidebar';
import MainStage from '@/components/MainStage';
import CartSidebar from '@/components/CartSidebar';
import CheckoutStage from '@/components/CheckoutStage';
import { MessageCircle, PackageSearch, ShoppingBag } from 'lucide-react';

export default function Home() {
  const { activeStage, cart, setStage } = useAppStore();
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);

  return (
    <main className="app-luminous-bg min-h-dvh text-retail-charcoal lg:h-dvh lg:overflow-hidden lg:p-3">
      <div className="relative min-h-dvh w-full lg:h-full lg:min-h-0">
        <VoiceSidebar />

        <section className="app-device-shell relative min-h-dvh overflow-hidden border border-retail-border/80 bg-white shadow-2xl shadow-retail-charcoal/10 lg:ml-[5.75rem] lg:h-full lg:min-h-0 lg:rounded-[1.75rem]">
          <div className="concierge-canvas custom-scrollbar h-full overflow-y-auto px-4 pb-24 pt-5 sm:px-7 sm:pt-7 lg:px-8 lg:pb-28 lg:pt-8">
            {activeStage === 'CHECKOUT' ? <CheckoutStage /> : <MainStage />}
          </div>
          {activeStage !== 'CHECKOUT' && <CartSidebar />}
        </section>
      </div>
      <nav
        className="fixed inset-x-4 bottom-4 z-40 grid grid-cols-3 overflow-hidden rounded-[1.35rem] border border-retail-border bg-white/95 shadow-2xl shadow-retail-charcoal/15 backdrop-blur-xl lg:hidden"
        aria-label="Mobile navigation"
      >
        <button
          type="button"
          onClick={() => setStage('WELCOME')}
          className={getMobileNavClass(activeStage === 'WELCOME')}
        >
          <MessageCircle className="h-4 w-4" />
          Ask
        </button>
        <button
          type="button"
          onClick={() => setStage('PRODUCT_CATALOG')}
          className={getMobileNavClass(activeStage === 'PRODUCT_CATALOG')}
        >
          <PackageSearch className="h-4 w-4" />
          Finds
        </button>
        <button
          type="button"
          onClick={() => setStage('CHECKOUT')}
          disabled={cartCount === 0}
          className={getMobileNavClass(activeStage === 'CHECKOUT')}
        >
          <ShoppingBag className="h-4 w-4" />
          Order{cartCount > 0 ? ` ${cartCount}` : ''}
        </button>
      </nav>
    </main>
  );
}

function getMobileNavClass(isActive: boolean): string {
  return [
    "flex h-16 flex-col items-center justify-center gap-1 border-r border-retail-border text-xs font-semibold transition-colors last:border-r-0 disabled:cursor-not-allowed disabled:text-gray-400",
    isActive
      ? "bg-retail-ivory text-kapruka-red"
      : "text-retail-charcoal hover:bg-retail-gold/10",
  ].join(" ");
}
