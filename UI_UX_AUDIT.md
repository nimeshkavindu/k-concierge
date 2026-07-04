
# Kapruka AI Agent UI/UX Audit

Date: 2026-06-26

## Scope

This audit reviews the current user-facing Next.js application: layout, voice/text shopping entry points, product browsing, cart, delivery, checkout, accessibility, error handling, and end-to-end user flows.

Primary files reviewed:

- `src/app/page.tsx`
- `src/app/globals.css`
- `src/components/VoiceSidebar.tsx`
- `src/components/MainStage.tsx`
- `src/components/CartSidebar.tsx`
- `src/components/CheckoutStage.tsx`
- `src/store/app-store.ts`
- `src/lib/voice-contracts.ts`

This is a code-based UI/UX audit. It does not include moderated user testing or visual browser screenshots.

## Executive Summary

The app has a strong security and architecture direction: browser UI, server relay, Gemini model adapters, server-owned cart, and Kapruka MCP access isolated from the browser. The main UX problem is that the interface still behaves like a voice-first prototype, while the product is now a mixed text/voice shopping assistant.

The biggest user-facing risks are:

- The app is effectively desktop-only because the layout uses fixed viewport panels.
- Text chat exists, but the welcome screen and control hierarchy still tell users to use voice.
- Checkout depends on the agent checking delivery first, with no manual fallback.
- Voice, text, connection, and recording states are conflated, which can show misleading "Listening" UI during text-only sessions.
- Product, cart, and checkout flows lack normal e-commerce affordances such as quantity controls, remove item, product detail, no-results states, and clear retry paths.

## UX Scorecard

| Area | Rating | Notes |
| --- | --- | --- |
| First-run clarity | Needs work | Welcome copy says microphone only, despite text chat being available. |
| Text shopping | Partial | Text input exists but is visually secondary and tied to the "voice" area. |
| Voice shopping | Partial | Voice lifecycle exists, but connection and recording states are not clearly separated. |
| Product discovery | Basic | Search results render, but no filters, pagination, stock, details, or empty/error distinction. |
| Cart | Basic | Cart mirrors relay state but does not allow edit/remove/quantity changes. |
| Checkout | Risky | Payment link creation is gated correctly, but delivery and details flow is fragile. |
| Mobile readiness | Poor | Fixed `w-1/4`, `w-3/4`, `h-screen`, and absolute cart panel will not work well on mobile. |
| Accessibility | Partial | Some labels and live regions exist, but focus states, screen reader behavior, and semantic states need work. |
| Error recovery | Weak | Errors show in sidebar only and usually do not provide recovery actions. |
| Trust and confidence | Medium | Secure checkout copy exists, but order/payment summary lacks delivery fee, expiry, and details. |

## Current User Flows

### Flow 1: Text Shopping

1. User lands on home screen.
2. User sees "Tap the microphone to start shopping with your voice."
3. User may discover the small text input in the left sidebar.
4. User types a request such as "I need a cute gift for my girlfriend."
5. Browser requests `/api/voice-session` if not connected.
6. Browser opens websocket relay.
7. Relay sends the text to Gemini Flash.
8. Gemini may call relay tools such as `search_products`.
9. Relay fetches products from Kapruka MCP.
10. UI switches to product catalog and shows results.

UX issues:

- The welcome copy discourages text users.
- Text input is small and located inside a voice-branded control panel.
- The user cannot tell whether the assistant is thinking, searching Kapruka, or waiting on Gemini.
- If Gemini times out before calling `search_products`, the product area never changes meaningfully.

### Flow 2: Voice Shopping

1. User clicks the microphone button.
2. Browser requests `/api/voice-session`.
3. Browser opens websocket relay.
4. Browser requests microphone permission.
5. Audio capture begins.
6. Relay lazy-opens Gemini Live.
7. Gemini Live may respond with audio, transcript, or tool calls.
8. Tool calls update products, cart, or delivery status.

UX issues:

- The microphone button controls multiple concepts: connect, start recording, stop recording, and stop session.
- `isListening` is currently derived from `isConnected && IDLE`, which can imply listening during text-only sessions.
- There is no explicit microphone permission recovery path.
- "Agent Speaking", "Searching Kapruka", and "Listening" are helpful, but they need clearer mode separation.

### Flow 3: Product Search And Add To Cart

1. Product catalog shows search results.
2. User can click `Add to Cart`.
3. Relay validates the product ID against current search results.
4. Relay updates server-side cart.
5. UI mirrors cart state.

UX issues:

- Product cards only show image, name, and price.
- No stock status, delivery constraints, category, product detail URL, or "view details".
- No quantity selector before adding.
- No no-results state.
- Empty product list always says "Searching the catalog...", even when no search is active or search failed.
- Product cards use `/api/placeholder/...` as a fallback, but no placeholder route is visible in the reviewed code.

### Flow 4: Cart

1. Cart appears as a right-side absolute panel once an item is added.
2. Cart displays product image, name, price, and quantity.
3. User clicks `Proceed to Checkout`.

UX issues:

- Cart cannot be closed.
- Cart cannot remove items or adjust quantities.
- Cart overlays the right side of the stage and can obscure content.
- Cart is always `w-80`, which is not responsive.
- Gift-card prompt says "Tell the agent your message", but checkout also has a gift message field. This duplicates and may confuse.

### Flow 5: Delivery Check

1. User must ask the assistant to check delivery.
2. Gemini calls `check_delivery_constraints`.
3. Relay calls Kapruka MCP and stores delivery result.
4. Store sets active stage to `CHECKOUT`.

UX issues:

- There is no manual city/date fallback.
- Users may not know they must ask the assistant to check delivery.
- Auto-navigating to checkout after delivery check can be jarring.
- If delivery fails, the user has no direct UI to change city/date.

### Flow 6: Checkout And Payment Link

1. User reaches checkout.
2. Checkout shows order total, delivery city/date, and delivery message.
3. User fills recipient, phone, address, location type, sender, instructions, gift message.
4. Button is enabled only when cart, relay, delivery, and required fields are valid.
5. User clicks `Generate Payment Link`.
6. Relay calls Kapruka MCP `kapruka_create_order`.
7. Relay validates payment URL.
8. UI shows `Pay Securely via Kapruka`.

UX issues:

- Required fields are not marked as required visually beyond native validation.
- Phone format is not explained.
- Button disabled state relies on a general prompt instead of field-specific guidance.
- No confirmation step before creating the payment link.
- No display of delivery fee, grand total, payment link expiry, or order reference.
- No way to revise delivery city/date from checkout.

## Severity-Ranked Findings

### Critical

#### 1. The app is not mobile-ready

Evidence:

- Root layout uses `h-screen w-screen overflow-hidden`.
- Sidebar is hard-coded as `w-1/4`.
- Main stage is hard-coded as `w-3/4`.
- Cart is an absolute `w-80` right panel.

Impact:

Mobile and narrow desktop users will have cramped or hidden controls. This is especially problematic because shopping and checkout often happen on mobile.

Recommendation:

Move to a responsive app shell:

- Desktop: left assistant rail, central product area, right cart drawer.
- Tablet: collapsible assistant drawer and cart drawer.
- Mobile: bottom tab/navigation or stacked views with full-screen assistant/chat and cart sheets.

#### 2. Text chat is undersold and visually treated as secondary

Evidence:

- Welcome screen says: "Tap the microphone to start shopping with your voice."
- Sidebar branding says "Kapruka Live".
- Text input helper says "Type when voice is not available."

Impact:

Users who cannot or do not want to speak may not understand that text is a first-class option.

Recommendation:

Reposition the product as "Ask Kapruka" rather than "Kapruka Live". First screen should show a prominent text input with voice as an adjacent mode.

#### 3. Delivery check is assistant-only with no manual fallback

Evidence:

- Checkout requires `deliveryAvailable === true`.
- The only way to set delivery is the relay delivery event from Gemini tool use.
- Checkout copy says "Ask the agent to check delivery..."

Impact:

If Gemini does not call the delivery tool, users cannot complete checkout even if they know their city/date.

Recommendation:

Add manual delivery controls:

- Delivery city search/select.
- Date picker.
- `Check Delivery` button.
- Agent can still fill these fields conversationally.

#### 4. Voice connection state is conflated with listening state

Evidence:

- `isListening = isConnected && agentVoiceStatus === "IDLE"`.
- Text chat also creates a relay connection.

Impact:

After a text-only session, the UI can imply voice is listening even though microphone capture never started.

Recommendation:

Split state into:

- `relayConnected`
- `voiceRecording`
- `assistantThinking`
- `assistantSpeaking`
- `textModeActive`

### High

#### 5. Product empty/loading/error states are ambiguous

Evidence:

- `products.length === 0` renders "Searching the catalog..." in product catalog.

Impact:

Users cannot distinguish loading, no results, failed search, or no search yet.

Recommendation:

Represent product state explicitly:

- `idle`
- `loading`
- `success`
- `empty`
- `error`

#### 6. Cart lacks expected e-commerce controls

Evidence:

- Cart displays quantity but does not allow editing or removal.

Impact:

Users must rely on the assistant to correct cart mistakes, which is slower and less trustworthy.

Recommendation:

Add relay-backed controls:

- Increase/decrease quantity.
- Remove item.
- Clear cart.
- Confirm cart after assistant-driven changes.

#### 7. Checkout form validation is too implicit

Evidence:

- Button disables until fields are valid.
- Prompt is general.
- No per-field error messages.

Impact:

Users may not know which field is blocking checkout.

Recommendation:

Add inline validation and helper text:

- Phone format examples: `0771234567` or `+94771234567`.
- Required field indicators.
- Error text under invalid fields.
- Button remains clickable enough to reveal errors, or disabled state lists missing fields.

#### 8. Error messages are isolated to the sidebar

Evidence:

- `voiceError` renders only in `VoiceSidebar`.

Impact:

If product search, cart, delivery, or checkout fails, the user may be looking at the main stage and miss the error.

Recommendation:

Add contextual error regions:

- Product catalog error banner.
- Checkout error banner.
- Cart mutation error toast/banner.
- Retry buttons for model or MCP timeouts.

#### 9. Cart panel can obscure the main workspace

Evidence:

- Cart uses `absolute right-0 top-0 z-20`.
- Main section still uses centered max width without accounting for cart width.

Impact:

Product cards or checkout content may be hidden behind the cart panel.

Recommendation:

Reserve layout space for the cart on desktop or use a drawer with visible open/close state.

#### 10. Debug logging is useful now but risky for production

Evidence:

- Browser and relay logs include text previews and flow details.

Impact:

This is helpful during debugging but may expose user shopping intent, recipient-adjacent content, or internal flow details in production logs.

Recommendation:

Gate verbose logs behind an env flag:

- `NEXT_PUBLIC_DEBUG_VOICE=true` for browser logs.
- `VOICE_RELAY_DEBUG=true` for relay logs.

### Medium

#### 11. Product cards need more trust and context

Current fields:

- Image
- Name
- Price

Missing fields:

- Stock status
- Delivery relevance
- Category
- Product URL/details
- Variant info
- Rating or trust indicators if available

Recommendation:

Add "View Details" and expose stock/category from normalized MCP output if available.

#### 12. No product pagination or follow-up discovery controls

Impact:

MCP supports pagination, but UI only shows the current result set.

Recommendation:

Support:

- "Show more"
- Related searches
- Category chips
- Price sort/filter if model/tool returns options

#### 13. Chat history is useful but too small and passive

Evidence:

- Chat history max height is `max-h-48`.
- No auto-scroll behavior is visible.
- No timestamps, retry, or message status.

Recommendation:

Make the assistant/chat panel a primary surface:

- Larger scrollable transcript.
- Auto-scroll to latest message.
- Message status: sending, searching, done, failed.
- Retry failed message.

#### 14. Welcome screen lacks strong product orientation

Evidence:

- Current welcome has one heading and voice-only instruction.

Recommendation:

First screen should include:

- Large text prompt.
- Voice button as secondary input mode.
- Suggested prompts:
  - "Birthday gift under Rs. 5,000"
  - "Flowers delivered tomorrow to Colombo 03"
  - "Tea gifts for overseas delivery"

#### 15. Checkout hides critical payment/order context

Missing:

- Delivery fee
- Grand total
- Link expiry
- Order reference after creation
- Payment URL host preview

Recommendation:

Show a clear order summary before and after payment link creation.

#### 16. Active stage model is too coarse

Current stages:

- `WELCOME`
- `PRODUCT_CATALOG`
- `CART`
- `CHECKOUT`

Issue:

There is no explicit state for delivery, loading, error, no results, payment created, or chat-only exploration.

Recommendation:

Use richer state:

- `home`
- `results`
- `productDetail`
- `cart`
- `delivery`
- `checkout`
- `paymentReady`

Or keep stage simple but add per-domain status fields.

### Low

#### 17. Styling is clean but generic

The UI is restrained and functional, which fits a shopping assistant, but it still feels like a scaffold:

- Inter/system typography.
- Basic red/gray palette.
- Generic cards and panels.
- Minimal Kapruka-specific merchandising feel.

Recommendation:

Add more brand-specific commerce cues:

- Kapruka red as accent, not dominant.
- Better product imagery treatment.
- Compact retail density.
- Gift-oriented prompt chips and category shortcuts.

#### 18. Inconsistent copy around "voice", "live", and "agent"

Examples:

- "Kapruka Live"
- "Start Voice Shopping"
- "Type when voice is not available"
- "Ask the agent..."

Recommendation:

Standardize terms:

- Product name: "Kapruka Assistant"
- Input modes: "Chat" and "Voice"
- Statuses: "Connected", "Listening", "Searching", "Speaking"

#### 19. Some visual nesting is heavy

Checkout contains multiple bordered panels inside a centered card. This is usable, but could feel dense once more fields and validation are added.

Recommendation:

Split checkout into clear sections:

- Order summary
- Delivery
- Recipient
- Sender and gift message
- Payment link

## Accessibility Findings

### Good

- Icon-only mic and send buttons have accessible labels.
- Voice status has an `aria-live` region.
- Text input has an `sr-only` label.
- Checkout inputs are associated with labels.

### Needs Improvement

- Focus styles are often removed with `outline-none` without a strong visible replacement.
- Product add buttons should include product names in accessible labels.
- Navigation buttons should expose current state with `aria-current` or `aria-pressed`.
- Chat history live region may be too broad; screen readers could receive repeated content.
- Cart drawer lacks landmark/labeling and close control.
- Disabled checkout button may block users from discovering missing-field errors.

Recommended accessibility fixes:

- Add consistent focus rings.
- Add `aria-current="page"` to active nav item.
- Add `aria-label={`Add ${product.name} to cart`}`.
- Use a focused polite live region for only the newest assistant/status message.
- Give cart drawer `aria-label="Shopping cart"`.
- Add visible field-level validation.

## Recommended Target Experience

### Desktop

Recommended layout:

- Left rail: brand, mode switch, compact status.
- Center: primary shopping workspace with search prompt, products, delivery, checkout.
- Right drawer/panel: cart and order summary.

Primary first-screen action:

- Large text input: "What are you shopping for?"
- Mic button beside input.
- Suggested prompt chips below.

### Mobile

Recommended layout:

- Top header with brand and cart icon.
- Main content as full-width stage.
- Bottom input bar for chat and mic.
- Cart opens as full-screen sheet.
- Checkout uses a step-by-step form.

## Recommended Roadmap

### P0: Fix Flow Blockers

1. Add manual delivery city/date controls and `Check Delivery` action.
2. Split `relayConnected` from `voiceRecording`.
3. Replace "voice-only" welcome copy with text-first shopping prompt.
4. Add explicit product loading/empty/error states.
5. Add cart remove and quantity controls.

### P1: Improve Checkout Trust

1. Add field-level validation.
2. Show delivery fee, grand total, and payment link expiry.
3. Add editable delivery section in checkout.
4. Add checkout error banner and retry action.
5. Add confirmation summary before payment-link generation.

### P2: Improve Discovery And Commerce UX

1. Add product detail view or product links.
2. Add filters, sort, and "show more".
3. Add stock/category badges.
4. Add suggested prompt chips.
5. Improve empty states and recommendation copy.

### P3: Polish And Production Readiness

1. Make the layout responsive.
2. Gate debug logs behind env flags.
3. Improve focus states and screen reader behavior.
4. Use `next/image` or a defined image component strategy.
5. Add visual regression checks for desktop and mobile.

## Suggested User Flow Redesign

### First-Time Shopping

1. User lands on page.
2. Sees prominent text input: "What are you shopping for?"
3. Can type or tap mic.
4. Suggested prompts offer immediate examples.
5. Search results appear in the main workspace.
6. Cart opens as a drawer only when needed.

### Gift Shopping

1. User asks for a gift.
2. Assistant asks clarifying questions only if needed:
   - Occasion
   - Budget
   - Delivery city/date
3. Results show gift-relevant cards.
4. User can add, remove, or adjust items manually.
5. Checkout carries gift message forward.

### Delivery And Checkout

1. User picks or confirms city/date.
2. UI checks delivery directly.
3. Checkout form is unlocked after delivery check.
4. User fills recipient/sender details.
5. UI shows final summary.
6. User clicks `Generate Payment Link`.
7. UI shows payment link, expiry, and order reference if available.

## Acceptance Criteria For Next UX Pass

- App is usable at 390px mobile width without horizontal overflow.
- User can complete text-only product search without seeing voice-only instructions.
- User can manually check delivery without relying on Gemini.
- Cart supports remove and quantity changes.
- Checkout shows field-level errors.
- Product results distinguish loading, empty, and error.
- Text-only relay connection never shows "Listening".
- Debug logs can be disabled for production.
- Keyboard user can navigate all controls with visible focus states.

## Bottom Line

The underlying architecture is strong, but the UI needs to graduate from a voice demo into a dependable shopping assistant. The next best investment is not visual polish; it is flow control: text-first entry, manual delivery fallback, clear product states, editable cart, and checkout validation. Once those are solid, visual refinement and responsive layouts will have a much stronger foundation.
