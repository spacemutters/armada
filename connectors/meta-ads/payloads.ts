// What Armada sends Meta to create ads. Pure (no network, no database) so scripts/check-ads.mjs can
// check every create payload without a Meta account.
//
// The rule: everything that can spend money (campaign, ad set, ad) is created PAUSED. Only a person's
// "Switch on" (switchOn in ./client.ts) changes that. Ad creatives have no on/off of their own; they
// carry no status at all.
//
// Checked against Meta's Marketing API reference on 2026-09-24 (current version v26.0, released
// 2026-07-29): campaigns need name, objective (OUTCOME_*) and special_ad_categories, and since v24.0
// is_adset_budget_sharing_enabled whenever the budget sits on the ad set; OUTCOME_TRAFFIC pairs with
// LINK_CLICKS; status on create may only be ACTIVE or PAUSED; carousels are link_data.child_attachments
// (2 to 10 cards, each with its own link, name, description and image_hash); the Instagram account
// goes in object_story_spec.instagram_user_id.

export const META_STATUS_PAUSED = "PAUSED" as const;

export interface MetaCard {
  link: string;
  headline: string;
  description: string;
  imageHash: string;
}

export interface MetaAdInput {
  /** Armada's variation id, used in the names so a person can find it in Meta's own screens. */
  variationId: string;
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
  description: string;
  callToAction: "SHOP_NOW" | "LEARN_MORE" | "ORDER_NOW" | "BUY_NOW";
  /** Where a single-photo ad (and a carousel's end) sends people. */
  link: string;
  /** Single-photo ads: the photo. */
  imageHash?: string;
  cards: MetaCard[];
}

export interface MetaPlan {
  name: string;
  countries: string[];
  ageMin: number;
  ageMax: number;
  /** Interest ids found with Meta's targeting search; empty means broad. */
  interests: { id: string; name: string }[];
  /** The hard ceiling on spend, in the ad account currency's smallest unit. */
  lifetimeBudgetMinor: number;
  startTime: Date;
  endTime: Date;
  pageId: string;
  instagramUserId?: string;
}

/** The campaign: traffic to the shop, budget on the ad set, never shared between ad sets. */
export function campaignPayload(plan: MetaPlan): Record<string, unknown> {
  return {
    name: plan.name,
    objective: "OUTCOME_TRAFFIC",
    special_ad_categories: [],
    buying_type: "AUCTION",
    is_adset_budget_sharing_enabled: false,
    status: META_STATUS_PAUSED,
  };
}

/** The ad set: who sees it, and a lifetime budget that is a hard cap on spend. */
export function adSetPayload(plan: MetaPlan, campaignId: string): Record<string, unknown> {
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: plan.countries },
    age_min: plan.ageMin,
    age_max: plan.ageMax,
    // Stated either way so Meta never has to guess (it must be explicit for some ad categories since v26.0).
    targeting_automation: { advantage_audience: 0 },
  };
  if (plan.interests.length) targeting.flexible_spec = [{ interests: plan.interests }];
  return {
    name: `${plan.name} · audience`,
    campaign_id: campaignId,
    lifetime_budget: plan.lifetimeBudgetMinor,
    start_time: plan.startTime.toISOString(),
    end_time: plan.endTime.toISOString(),
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting,
    status: META_STATUS_PAUSED,
  };
}

/** The ad's look and words: a single photo, or a carousel with one card per product. */
export function creativePayload(plan: MetaPlan, ad: MetaAdInput): Record<string, unknown> {
  const cta = (link: string) => ({ type: ad.callToAction, value: { link } });
  const linkData: Record<string, unknown> =
    ad.format === "carousel"
      ? {
          link: ad.link,
          message: ad.primaryText,
          child_attachments: ad.cards.map((c) => ({
            link: c.link,
            name: c.headline,
            description: c.description,
            image_hash: c.imageHash,
            call_to_action: cta(c.link),
          })),
          multi_share_optimized: true,
          multi_share_end_card: false,
          call_to_action: cta(ad.link),
        }
      : {
          link: ad.link,
          message: ad.primaryText,
          name: ad.headline,
          description: ad.description,
          image_hash: ad.imageHash,
          call_to_action: cta(ad.link),
        };
  const story: Record<string, unknown> = { page_id: plan.pageId, link_data: linkData };
  if (plan.instagramUserId) story.instagram_user_id = plan.instagramUserId;
  return { name: `${plan.name} · ${ad.variationId.slice(0, 8)}`, object_story_spec: story };
}

/** The ad itself, joining the ad set and the creative. */
export function adPayload(plan: MetaPlan, ad: MetaAdInput, adSetId: string, creativeId: string): Record<string, unknown> {
  return {
    name: `${plan.name} · ${ad.variationId.slice(0, 8)}`,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status: META_STATUS_PAUSED,
  };
}

/** A budget change on the ad set (never touches on/off). */
export function budgetPayload(lifetimeBudgetMinor: number, endTime: Date): Record<string, unknown> {
  return { lifetime_budget: lifetimeBudgetMinor, end_time: endTime.toISOString() };
}
