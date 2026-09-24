// Every example on the homepage comes from this file, so nothing is written twice and every number
// can be checked in one place. It is sample data, and the page labels it as an example wherever it
// shows. Where the app has its own wording (order states, roles, change rows, score notes), this uses
// it; where a number comes from the app's own code (scores, prices, the test's result), the comment
// beside it says which function produced it. Store names use the practice fleet's name parts.

export type Level = "quiet" | "mid" | "busy" | "peak";
export type Platform = "shopify" | "ebay";

export interface SampleStore {
  id: number;
  name: string;
  platform: Platform;
  level: Level;
  needsYou: boolean;
  /** Lists at least one of the four products in the price change. */
  inChange: boolean;
}

// A small seeded generator, so the server and the browser draw the same fleet.
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The practice fleet's own groups and name parts.
const GROUPS = [
  {
    key: "kitchen",
    share: 0.4,
    first: ["Copper", "Quiet", "Oak", "Salt", "Field", "Slow", "Plain", "Good", "Ember", "Hearth"],
    second: ["Pantry", "Table", "Kitchen", "Cook", "Larder", "Crumb", "Supply"],
  },
  {
    key: "fitness",
    share: 0.3,
    first: ["Iron", "Chalk", "North", "Tempo", "Steady", "Grit", "Summit", "Rally"],
    second: ["Supply", "Athletic", "Club", "Works", "Goods", "Lab"],
  },
  {
    key: "home",
    share: 0.3,
    first: ["Linen", "Juniper", "Common", "Harbor", "Slate", "Willow", "Fern", "Dune"],
    second: ["House", "Studio", "Market", "Room", "Goods", "Supply"],
  },
] as const;

export const FLEET_SIZE = 96;

function makeFleet(): (SampleStore & { group: string })[] {
  const r = prng(20260924);
  const used = new Set<string>();
  const stores: (SampleStore & { group: string })[] = [];
  for (let i = 0; i < FLEET_SIZE; i++) {
    const g = r() < 0.4 ? GROUPS[0] : r() < 0.5 ? GROUPS[1] : GROUPS[2];
    let name = "";
    do name = `${g.first[Math.floor(r() * g.first.length)]} ${g.second[Math.floor(r() * g.second.length)]}`;
    while (used.has(name));
    used.add(name);
    const x = r();
    const level: Level = x < 0.3 ? "quiet" : x < 0.66 ? "mid" : x < 0.9 ? "busy" : "peak";
    // The price change is on four kitchen products, so it reaches most kitchen stores.
    const inChange = g.key === "kitchen" && r() < 0.9;
    stores.push({ id: i, name, group: g.key, platform: r() < 0.32 ? "ebay" : "shopify", level, needsYou: false, inChange });
  }
  // Exactly three need you, spread across the map.
  for (const i of [13, 50, 83]) stores[i].needsYou = true;
  return stores;
}

export const FLEET = makeFleet();
const named = (group: string, k: number) => FLEET.filter((s) => s.group === group)[k];
const changed = (k: number) => FLEET.filter((s) => s.inChange)[k].name;

export const LEVEL_WORD: Record<Level, string> = {
  quiet: "Slower than usual",
  mid: "About usual",
  busy: "Busier than usual",
  peak: "Well above usual",
};

export const FLEET_SUMMARY = {
  stores: FLEET_SIZE,
  soldYesterday: 41280,
  profitYesterday: 17930,
  ordersYesterday: 612,
  needsYou: 3,
};

// The price change in "One change, every store". Summary wording matches the app's own
// ("Raise prices 8% on 4 products"); rows match the change page ("$24.99 → $26.99").
export const CHANGE = {
  percent: 8,
  products: 4,
  stores: FLEET.filter((s) => s.inChange).length,
  listings: 112,
  summary: "Raise prices 8% on 4 products",
  // +8%, rounded up to the next .99 the way the app keeps its endings.
  rows: [
    { product: "Linen apron", store: changed(0), before: 2499, after: 2699 },
    { product: "Oak serving board", store: changed(1), before: 3899, after: 4299 },
    { product: "Linen apron", store: changed(2), before: 2699, after: 2999 },
    { product: "Stoneware jug", store: changed(3), before: 3199, after: 3499 },
    { product: "Cotton tea towels, set of 3", store: changed(4), before: 1899, after: 2099 },
  ],
};

// A shop the builder made in Armada's own tests (see .shots/14-shop-ready.png).
export const BUILT_SHOP = {
  idea: "Home workout gear for small apartments",
  brand: "Alcove",
  tagline: "Training gear that fits the room you have",
  otherNames: ["Floorspace", "Stillroom"],
  headline: "Train at home, even in a studio",
  subhead: "A short range of compact, foldable and stackable gear for small apartments, chosen to store away between sessions.",
  cta: "Shop the range",
  fonts: { display: "Familjen Grotesk", body: "Work Sans" },
  palette: [
    { role: "Page", hex: "#f3f4f2" },
    { role: "Cards", hex: "#e4e8e5" },
    { role: "Text", hex: "#1c2422" },
    { role: "Quiet text", hex: "#55605b" },
    { role: "Buttons", hex: "#2f5d62" },
  ],
  products: 12,
  collections: ["Strength", "Floor work", "Cardio and balance", "Fold and store"],
  steps: [
    { label: "Brand, look and plan", took: "52s" },
    { label: "Choosing and writing products", took: "1m 38s" },
    { label: "Pages and policies", took: "44s" },
  ],
  // What the one status line says while each step runs.
  status: [
    ["Reading the idea", "Naming the brand", "Choosing a palette and fonts"],
    ["Searching the catalog", "Scoring what fits", "Writing product pages"],
    ["Writing the About page", "Drafting refund and shipping policies"],
  ],
};

// A batch: ten shops from one idea, each with its own look. Colours are page / ink / button.
export const BATCH = [
  { brand: "Alcove", page: "#f3f4f2", ink: "#1c2422", button: "#2f5d62" },
  { brand: "Floorspace", page: "#f6f1ea", ink: "#2a211b", button: "#9a4a2c" },
  { brand: "Stillroom", page: "#1d2126", ink: "#eef0ee", button: "#c9b27c" },
  { brand: "Rally Works", page: "#eef2f6", ink: "#141b24", button: "#1f4fd1" },
  { brand: "Tempo Lab", page: "#f4efe6", ink: "#1f1c17", button: "#3c5a3a" },
  { brand: "Steady Club", page: "#161a1f", ink: "#e9edf2", button: "#e0775a" },
  { brand: "Summit Goods", page: "#eef1ec", ink: "#18201a", button: "#5a6b2f" },
  { brand: "North Supply", page: "#f7f4f0", ink: "#221d19", button: "#6d3f5c" },
  { brand: "Grit Athletic", page: "#20211f", ink: "#f0efe9", button: "#b8c4c9" },
  { brand: "Chalk Room", page: "#f2f3f5", ink: "#16181c", button: "#40464f" },
];

// The 1–100 score, part by part. Each product below was run through lib/score.ts scoreProduct()
// with its price from lib/pricing.ts retailPrice(cost, shipping, "mid"); the scores, the notes and the
// measured/estimated flags are exactly what those functions return. Weights are lib/score.ts WEIGHTS.
export interface ScorePart {
  name: string;
  weight: number;
  value: number;
  measured: boolean;
  note: string;
}
export interface ScoredProduct {
  title: string;
  collection: string;
  score: number;
  band: "Strong" | "Worth testing" | "Weak";
  landed: number;
  price: number;
  keeps: number;
  shippingConfirmed: boolean;
  parts: ScorePart[];
}
const COMPETITION: ScorePart = { name: "Competition", weight: 15, value: 0.5, measured: false, note: "Not checked yet. Needs eBay's market data." };
export const SCORED: ScoredProduct[] = [
  {
    title: "Folding weight bench",
    collection: "Fold and store",
    score: 81,
    band: "Strong",
    landed: 6299,
    price: 17699,
    keeps: 8202,
    shippingConfirmed: true,
    parts: [
      { name: "Margin", weight: 30, value: 1, measured: true, note: "46% left after supplier cost, shipping, fees and a starting ad cost" },
      { name: "Demand", weight: 25, value: 0.72, measured: true, note: "140 stores already sell this through the supplier" },
      COMPETITION,
      { name: "Shipping", weight: 15, value: 0.85, measured: true, note: "Arrives in up to 9 days" },
      { name: "Stock", weight: 15, value: 0.86, measured: true, note: "212 in stock at the supplier" },
    ],
  },
  {
    title: "Doorway pull-up bar",
    collection: "Strength",
    score: 69,
    band: "Worth testing",
    landed: 2299,
    price: 6499,
    keeps: 3007,
    shippingConfirmed: true,
    parts: [
      { name: "Margin", weight: 30, value: 1, measured: true, note: "46% left after supplier cost, shipping, fees and a starting ad cost" },
      { name: "Demand", weight: 25, value: 0.5, measured: true, note: "30 stores already sell this through the supplier" },
      COMPETITION,
      { name: "Shipping", weight: 15, value: 0.62, measured: true, note: "Arrives in up to 12 days" },
      { name: "Stock", weight: 15, value: 0.67, measured: true, note: "64 in stock at the supplier" },
    ],
  },
  {
    title: "Balance board",
    collection: "Cardio and balance",
    score: 60,
    band: "Worth testing",
    landed: 2650,
    price: 7499,
    keeps: 3477,
    shippingConfirmed: false,
    parts: [
      { name: "Margin", weight: 30, value: 1, measured: false, note: "About 46% left, with shipping estimated until the supplier confirms it" },
      {
        name: "Demand",
        weight: 25,
        value: 0.4,
        measured: false,
        note: "Estimated from the supplier's rating. Live demand needs eBay's market data.",
      },
      COMPETITION,
      { name: "Shipping", weight: 15, value: 0.4, measured: false, note: "Shipping time not confirmed yet" },
      { name: "Stock", weight: 15, value: 0.4, measured: false, note: "The supplier gave no stock level" },
    ],
  },
];

// Headline test: the shop's original and the first new version are real output from Armada's test
// run (.shots/ab/06-running.png); the other two versions are written for this page in the same shape.
// Numbers: readTest({1240, 41}, {1226, 66}) → b_better, chance 0.9943, about 12,600 visitors needed each.
export const HEADLINE_TEST = {
  brand: "Evenfall",
  original: {
    headline: "A quieter bedroom, one thing at a time",
    subhead: "A small range of bedding, light and sound for winding down and sleeping through the night.",
    cta: "Shop the range",
  },
  candidates: [
    {
      headline: "Percale sheets, blackout curtains, white noise",
      subhead: "Plus a bedside lamp, notebook and candle. Eight things chosen for a clear job in the bedroom.",
      cta: "See the range",
      idea: "Leads with concrete products the shopper can picture.",
    },
    {
      headline: "Sleep through the night, starting tonight",
      subhead: "Bedding, light and sound picked to make one room darker and quieter.",
      cta: "Shop the range",
      idea: "Promises the outcome, not the products.",
    },
    {
      headline: "Eight things for a darker, quieter room",
      subhead: "Sheets, curtains, a lamp and a little white noise. Nothing you don't need.",
      cta: "See all eight",
      idea: "A small, finite range feels easy to choose from.",
    },
  ],
  a: { visitors: 1240, adds: 41 },
  b: { visitors: 1226, adds: 66 },
  chancePercent: 99,
  neededEach: 12600,
  verdict: "The new version is winning: 5.4% of its visitors add something to their bag, against 3.3% for the original.",
};

// Order states and their words are the app's own (app/(app)/orders/page.tsx).
export interface SampleOrder {
  id: string;
  store: string;
  platform: Platform;
  item: string;
  cents: number;
  state: "new" | "ordered" | "shipped" | "problem";
}

const store = (group: string, k: number) => named(group, k)?.name ?? "Copper Pantry";
const plat = (group: string, k: number): Platform => named(group, k)?.platform ?? "shopify";

export const ORDERS: SampleOrder[] = [
  { id: "o1", store: store("kitchen", 2), platform: plat("kitchen", 2), item: "Oak serving board", cents: 4299, state: "new" },
  { id: "o2", store: store("fitness", 1), platform: plat("fitness", 1), item: "Resistance band set", cents: 5399, state: "new" },
  { id: "o8", store: store("home", 0), platform: plat("home", 0), item: "Linen napkins, set of 4", cents: 3299, state: "new" },
  { id: "o9", store: store("kitchen", 3), platform: plat("kitchen", 3), item: "Stoneware jug", cents: 3499, state: "new" },
  { id: "o3", store: store("home", 3), platform: plat("home", 3), item: "Brass table lamp", cents: 6199, state: "problem" },
  { id: "o4", store: store("kitchen", 5), platform: plat("kitchen", 5), item: "Linen apron × 2", cents: 5398, state: "ordered" },
  { id: "o5", store: store("fitness", 4), platform: plat("fitness", 4), item: "Foam roller", cents: 3999, state: "ordered" },
  { id: "o6", store: store("kitchen", 7), platform: plat("kitchen", 7), item: "Stoneware jug", cents: 3499, state: "shipped" },
  { id: "o7", store: store("home", 1), platform: plat("home", 1), item: "Linen cushion cover", cents: 2899, state: "shipped" },
];

// Orders that arrive one at a time while the inbox is on screen.
export const INCOMING: SampleOrder[] = [
  { id: "n1", store: store("home", 5), platform: plat("home", 5), item: "Cotton throw, oat", cents: 6899, state: "new" },
  { id: "n2", store: store("fitness", 6), platform: plat("fitness", 6), item: "Doorway pull-up bar", cents: 6499, state: "new" },
  { id: "n3", store: store("kitchen", 9), platform: plat("kitchen", 9), item: "Cotton tea towels, set of 3", cents: 2099, state: "new" },
  { id: "n4", store: store("fitness", 2), platform: plat("fitness", 2), item: "Speed jump rope", cents: 3099, state: "new" },
];

export const ORDER_STATE: Record<SampleOrder["state"], string> = {
  new: "New",
  ordered: "With supplier",
  shipped: "Shipped",
  problem: "Stuck",
};

// Role wording is the app's own (app/(app)/settings/page.tsx), except the owner's line.
export const ROLES = [
  { name: "Owner", does: "Can do everything, and invites the team" },
  { name: "Manager", does: "Can approve changes, orders and ads" },
  { name: "Assistant", does: "Can prepare changes for approval" },
  { name: "Viewer", does: "Can look, not change" },
];

export function money(cents: number, whole = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}
