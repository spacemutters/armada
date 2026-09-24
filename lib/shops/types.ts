import type { Palette } from "@/lib/color";
import type { PriceFeel } from "@/lib/pricing";

export interface ShopBrief {
  niche: string;
  audience: string;
  country: string;
  priceFeel: PriceFeel;
  productCount: number;
  look: string;
  source: "practice" | "cj";
}

export type StepKey = "concept" | "products" | "pages";
export type StepState = "waiting" | "running" | "done" | "failed";

export interface ProgressStep {
  key: StepKey;
  label: string;
  state: StepState;
  startedAt?: string;
  finishedAt?: string;
  note?: string;
}

export interface Blueprint {
  brand?: {
    name: string;
    alternativeNames: string[];
    tagline: string;
    voice: string;
    audience: string;
    monogramIcon: string;
  };
  theme?: { palette: Palette; fonts: { display: string; body: string }; contrastFixes: string[] };
  hero?: { headline: string; subhead: string; cta: string };
  valueProps?: { title: string; body: string }[];
  collections?: { handle: string; title: string; description: string; keywords: string[]; productIds: string[] }[];
  searchTerms?: string[];
  products?: { productId: string; handle: string; collection: string; priceCents: number; imagined: boolean }[];
  pages?: {
    about: string;
    faq: { question: string; answer: string }[];
    shipping: string;
    contact: string;
  };
  policies?: { refund: string; shipping: string };
  announcement?: string;
  footerBlurb?: string;
  seo?: { title: string; description: string };
  facts?: { country: string; deliveryMin: number; deliveryMax: number; handlingDays: number; returnDays: number };
  candidateCount?: number;
}

export interface ShopRow {
  id: string;
  workspaceId: string;
  slug: string;
  status: "draft" | "building" | "ready" | "publishing" | "published" | "failed";
  niche: string;
  brief: ShopBrief;
  blueprint: Blueprint;
  storeId: string | null;
  progress: ProgressStep[];
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}
