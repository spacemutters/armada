# components/fx

Motion for Armada, ported from Davis's Thinking Orbs Studio. Import from `@/components/fx` (or a single file, e.g. `@/components/fx/thinking-orb`).

Rules every component here follows:

- Motion shows state (something is running, changed, or finished). Never decoration for its own sake, and one signature moment per screen.
- Colours come only from the tokens in `app/globals.css`, so everything follows the system light/dark setting. No theme switch.
- Reduced motion (`prefers-reduced-motion: reduce`): a calm, still end state. The change still happens; only the travel goes.
- Nothing heavy on the server. Canvas drawing and animation loops start after mount, pause when scrolled away or in a hidden tab, and stop on unmount.
- Plain words in anything a person reads (labels, screen-reader text).

Server components can render every component below. `ShimmerText`, `Tick` and `Loading` are plain server-safe code; the rest are client components. Hooks and `ORB_STATES` are for client components only.

Licences: `vendor/thinking-orbs.js` (thinking-orbs 0.3.2, the React-free engine chunk) and `vendor/border-beam/*` (border-beam 1.4.0 source) are MIT, by Jakub Antalik, and keep their licence banner at the top. Everything else is the studio's own motion kit, rewritten for React; it is original code.

## Components

| Component | What it is | Props | Used in |
|---|---|---|---|
| `ThinkingOrb` | A ball of dots that shows what kind of work is happening. Working states animate; resting states are one still drawing; changing state flies the dots to the next drawing. | `state` (`idle` `thinking` `working` `done` `error` `off`, plus the engine's `searching` `composing` `shaping` `connecting` `weaving` `listening`), `size` (px, 16 to 96; 20, 32 and 64 are the tuned designs, others are drawn from the nearest and scaled), `label`, `decorative`, `paused`, `ink` (`auto`, or `inverse` on a primary button), `className`, `style` | Sidebar and phone header AI helper status (`components/app-nav.tsx`); the running build step, one drawing per step (`components/shop-progress.tsx`); passkey buttons while waiting for the device; inside every `PendingButton`; the search button while searching; "shops are being built" and the "Build a shop with AI" card on Home; the Shop builder's empty state; `Loading` |
| `BorderBeam` | A light that travels round the border of what it wraps while something runs; fades out when it stops. A still ring under reduced motion. Grey by default. | `active`, `size` (`md` `sm` `line` `pulse-inner`), `tone` (`mono`, or `accent` for the library's blue "ocean" colours), `radius`, `strength`, `className`, `style` | The running build step; the Find products search box while a search runs (`app/(app)/products/search-box.tsx`); passkey buttons while waiting; the Build it button while the build starts |
| `ShimmerText` | A soft highlight sweeps across words that are still being worked on. Sweeps between the quiet-text and text colours, so it stays readable. | `active`, `tone` (`muted`, or `current` for coloured buttons), `as`, `className` | The running build step; "Naming the brand…" (build page and Shop builder cards); every waiting button label; `Loading` |
| `StatusText` | A status whose words slide up and out as new ones rise in, with the width easing to fit. | `text`, `shimmer`, `announce`, `wrap`, `className` | Sidebar "AI helper on / working / off"; the build step's note |
| `RollingNumber` | Digits roll like a counter when a number changes. Takes formatted text (`"$2,351"`) or a number. The server renders the finished number; screen readers hear it once. | `value`, `rollIn` (roll up from zero on first appearance), `stagger`, `className` | `Stat` in `components/ui.tsx` (Home's four numbers roll in; the store page's roll on change); `SegmentedNav` counts (Orders tabs) |
| `Tick` | A check mark that draws itself once when something finishes. | `size`, `look` (`circled` `filled` `plain`), `draw`, `weight`, `label`, `className` | Finished build steps (drawn only for a step that finished while you watched) |
| `ProgressBar` | An honest progress bar: real numbers when known, a gentle creep towards (never past) the end of the running stretch, "taking longer than usual" past 1.6x the usual time, a quick finish, a hatched bar when stopped. | `value`, `creepTo`, `since`, `expected`, `status` (`idle` `running` `done` `failed`), `label`, `className` | Shop build progress |
| `HoldButton` | Press and hold to confirm; the fill sweeps across as you hold and drains if you let go. Mouse, touch, or Space/Enter held. Submits its form when the hold completes; an ordinary submit button without scripts. | button props, `children`, `doneLabel`, `duration`, `onConfirm`, `hint` | "Approve and apply" on a change preview (`app/(app)/changes/[id]/page.tsx`) |
| `PendingButton` | A submit button that shows a small orb and shimmering words while its form is being sent, instead of freezing. Optional border light. | button props, `children`, `pendingLabel`, `variant` (`primary` `secondary`), `beam`, `orb` | Build it, Build it again, Put it in a practice store, Start a practice fleet (Home and Stores), Add chosen to your products, See the preview (list and reprice), Send chosen to the supplier, Cancel and Undo this change |
| `UndoToast` | A note that slides up after something changed, with an Undo button and a ring that drains while the chance lasts. Pointing at it or focusing it pauses it; swipe, Escape or the cross closes it. | `message`, `actionLabel`, `action` (server action) or `onAction`, `duration`, `clearParam`, `onClose` | After a change is applied (with Undo) or undone (`app/(app)/changes/[id]/page.tsx`, fed by `?done=` from `changes/actions.ts`) |
| `Expand` | A row that opens to show more; the height eases open and the content fades in after. Closed content can't be tabbed into. | `summary`, `children`, `defaultOpen`, `className`, `buttonClassName` | "Left out" on a change (open by default when three or fewer) |
| `DecodeText` | Letters flicker and lock in, left to right, for a word that has just been decided. Letters keep their width, so nothing moves. Never plays during the first page load. | `text`, `onMount`, `duration`, `charset`, `order`, `className` | The brand name the moment the AI names it during a build |
| `SegmentedNav` | Links as one segmented control; the highlight slides to the page you picked (the kit's tab bar). | `items` (`key`, `href`, `label`, `count`), `active`, `label`, `className` | Products tabs, Orders tabs |
| `useGlide` | The slide behind `SegmentedNav`, for custom markup: returns a ref for the (positioned) container, which holds one `data-glide-ind` element and items marked `data-glide-key`; an item can mark a child `data-glide-target`. | `(activeKey, { stretch, duration })` | The sidebar and the phone tab bar in `components/app-nav.tsx` |
| `Loading` | A calm loading view (orb and a line of words) that only fades in if loading takes more than about a third of a second. | `label`, `state`, `className` | `app/(app)/changes/loading.tsx`, `app/(app)/stores/[id]/loading.tsx` |

Hooks: `useReducedMotion()`, `useDarkScheme()`, `useMountedInBrowser()` (false while hydrating server HTML, so an entrance can play for content that arrives while you watch but not on the first page load).

Not in this folder but part of the same pass: `StatusPill`'s mark eases between shapes when a status changes (`components/ui.tsx`), fleet tiles ease to new brightness (`components/fleet-map.tsx`), and a store's daily sales bars rise once when the page opens (`armada-rise` in `app/globals.css`).

## Left out, on purpose

- Liquid gooey (MIT): its melt and bounce are playful; nothing in Armada needed a shape that melts, and the one candidate (the price-change field) reads better as a plain number.
- Metal, image and voice (MIT): shiny chrome, photo shaders and a microphone glow. Armada has no voice input, product photos should be shown as they are, and both shaders need WebGL for decoration.
- Lenis, GSAP and Vanta: the homepage's to use, not the signed-in app's. GSAP is not MIT.
- Kit pieces with no honest place in Armada yet: sources (citations), send (a chat send button), tools (AI tool-call chips), reorder, island, card-to-page.
- No loading view for whole sections that have tabs or a search on the page (Products, Orders): it would replace the page while a tab or search loads, hiding the moving tab highlight and the search light.
