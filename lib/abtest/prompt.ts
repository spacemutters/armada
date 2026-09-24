import { SYSTEM } from "@/lib/shops/prompts";
import type { Blueprint } from "@/lib/shops/types";

// What the AI is asked when it writes other versions of a shop's home-page headline. It gets the
// same honesty rules as the shop builder, plus the facts it may lean on, and must say in plain words
// what each version is trying. Each version has to try a different idea, not reword the same one.

export { SYSTEM };

export interface HeroCopy {
  headline: string;
  subhead: string;
  cta: string;
}

export interface Candidate extends HeroCopy {
  /** What this version tries, in plain words, e.g. "Leads with the problem instead of the product". */
  idea: string;
}

const str = { type: "string" } as const;

export const variantsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["versions"],
  properties: {
    versions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["idea", "headline", "subhead", "cta"],
        properties: { idea: str, headline: str, subhead: str, cta: str },
      },
    },
  },
} as const;

export function variantsPrompt(bp: Blueprint, current: HeroCopy, productTitles: string[], earlier: HeroCopy[] = []): string {
  const facts = bp.facts
    ? [
        `Ships to: ${bp.facts.country}`,
        `Delivery: ${bp.facts.deliveryMin} to ${bp.facts.deliveryMax} business days after a ${bp.facts.handlingDays}-day handling time`,
        `Returns: accepted within ${bp.facts.returnDays} days`,
      ]
    : [];
  return `You are writing other versions of a shop's home-page headline so the owner can test which one gets more visitors to add something to their bag.

The shop
- Name: ${bp.brand?.name}
- Tagline: ${bp.brand?.tagline}
- Voice: ${bp.brand?.voice}
- Who it's for: ${bp.brand?.audience}
- What it promises: ${(bp.valueProps ?? []).map((v) => `${v.title} (${v.body})`).join("; ")}
- Collections: ${(bp.collections ?? []).map((c) => c.title).join(", ")}
- Some of its products: ${productTitles.slice(0, 12).join("; ")}
${facts.length ? `- Facts you may use: ${facts.join("; ")}` : "- There are no delivery or returns facts yet, so don't mention delivery times or returns."}

The current version (A)
- Headline: ${current.headline}
- Subhead: ${current.subhead}
- Button: ${current.cta}
${earlier.length ? `\nVersions already suggested, which you must not repeat or lightly reword:\n${earlier.map((e) => `- ${e.headline} / ${e.subhead}`).join("\n")}\n` : ""}
Write three versions. Each one must try a genuinely different idea from A and from each other, for example: lead with the problem the shopper has; lead with a concrete detail of the products; name who it's for; make the button say exactly what happens next. Keep the shop's voice.

For each version:
- idea: what it tries, in one plain sentence a shop owner would understand, at most 12 words, no jargon.
- headline: at most 8 words.
- subhead: at most 20 words.
- cta: the button label, at most 3 words.

Only use facts listed above. No prices, discounts, free shipping, guarantees, numbers of customers, reviews or urgency ("limited", "today only") unless they are listed as facts.`;
}
