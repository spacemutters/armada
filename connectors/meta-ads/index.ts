import "server-only";
import type { AdPlatform, AdSet, AdVariation, BudgetChange, LaunchInput, LaunchOutput, ResultRow } from "@/lib/ads/types";
import { actionCount, ADD_TO_CART, create, findInterests, MetaProblem, pause, PURCHASE, readInsights, switchOn, updateAdSet, uploadImage } from "./client";
import { markMetaProblem, metaConnection, metaSession } from "./connection";
import { metaAdsInfo } from "./info";
import { adPayload, adSetPayload, budgetPayload, campaignPayload, creativePayload, type MetaAdInput, type MetaPlan } from "./payloads";

// Facebook and Instagram ads through Meta. Everything is created switched off (payloads.ts); a
// person's "Switch on" is the only thing that calls switchOn.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Meta budgets are in the currency's smallest unit; Armada's are cents, which match for two-decimal currencies. */
const minor = (cents: number) => Math.round(cents);

async function withProblemNoted<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof MetaProblem) await markMetaProblem(workspaceId, e.message, e.signedOut).catch(() => undefined);
    throw e;
  }
}

function capFor(b: BudgetChange): number {
  return Math.max(b.dailyBudgetCents * b.days, b.spentCents + b.dailyBudgetCents);
}

function endFor(b: BudgetChange, from = new Date()): Date {
  const start = b.switchedOnAt ? new Date(b.switchedOnAt) : from;
  const end = new Date(start.getTime() + b.days * DAY_MS);
  // Always leave at least a day to run, or Meta refuses the change.
  return end.getTime() - Date.now() < DAY_MS ? new Date(Date.now() + DAY_MS) : end;
}

export const metaAds: AdPlatform = {
  key: "meta",
  name: "Facebook and Instagram",

  async cannotLaunch(workspaceId) {
    if (!metaAdsInfo.available()) return "Facebook and Instagram ads are coming soon.";
    const conn = await metaConnection(workspaceId);
    if (!conn) return "Connect a Meta ad account first.";
    if (conn.status === "needs_attention") return "Meta signed Armada out. Connect the ad account again.";
    if (!conn.adAccountId) return "Your Meta sign-in has no ad account Armada can use.";
    if (!conn.adAccounts.find((a) => a.id === conn.adAccountId)?.active) return "The chosen Meta ad account can't run ads right now. Check it in Meta.";
    if (!conn.pageId) return "Ads on Facebook and Instagram need a Facebook Page. Make one in Meta, then connect again.";
    return null;
  },

  async createPaused(workspaceId, input: LaunchInput): Promise<LaunchOutput> {
    const out: LaunchOutput = { ok: false, external: {}, ads: [] };
    try {
      await withProblemNoted(workspaceId, async () => {
        const { token, conn } = await metaSession(workspaceId);
        const account = conn.adAccounts.find((a) => a.id === conn.adAccountId);
        if (!account || !conn.pageId) throw new MetaProblem("Choose an ad account and a Facebook Page first.");
        if (account.currency !== input.currency) throw new MetaProblem(`Your ad account uses ${account.currency}; Armada's ad budgets are in ${input.currency} for now.`);
        out.external = { accountId: account.id, accountName: account.name, pageId: conn.pageId };

        // Photos first: if one can't be sent, nothing has been created yet.
        const hashes = new Map<string, string>();
        const photo = async (url: string | null) => {
          if (!url) throw new MetaProblem("Every ad on Facebook and Instagram needs a product photo. Remove or rewrite the ads without one.");
          if (!hashes.has(url)) hashes.set(url, await uploadImage(token, account.id, url));
          return hashes.get(url)!;
        };
        const ads: MetaAdInput[] = [];
        for (const a of input.ads) {
          ads.push({
            variationId: a.variationId,
            format: a.format,
            primaryText: a.primaryText,
            headline: a.headline,
            description: a.description,
            callToAction: a.callToAction,
            link: a.link,
            imageHash: a.format === "single" ? await photo(a.imageUrl) : undefined,
            cards: a.format === "carousel" ? await Promise.all(a.cards.map(async (c) => ({ link: c.link, headline: c.headline, description: c.description, imageHash: await photo(c.imageUrl) }))) : [],
          });
        }

        const page = conn.pages.find((p) => p.id === conn.pageId);
        const now = new Date();
        const plan: MetaPlan = {
          name: input.name,
          countries: input.countries,
          ageMin: input.ageMin,
          ageMax: input.ageMax,
          interests: await findInterests(token, input.interests),
          lifetimeBudgetMinor: minor(input.dailyBudgetCents * input.days),
          startTime: now,
          endTime: new Date(now.getTime() + input.days * DAY_MS),
          pageId: conn.pageId,
          instagramUserId: page?.instagramUserId ?? undefined,
        };

        out.external.campaignId = await create(token, account.id, "campaigns", campaignPayload(plan));
        out.external.adSetId = await create(token, account.id, "adsets", adSetPayload(plan, out.external.campaignId));
        for (const ad of ads) {
          const creativeId = await create(token, account.id, "adcreatives", creativePayload(plan, ad));
          const adId = await create(token, account.id, "ads", adPayload(plan, ad, out.external.adSetId, creativeId));
          out.ads.push({ variationId: ad.variationId, external: { creativeId, adId } });
        }
      });
      out.ok = true;
    } catch (e) {
      out.problem = e instanceof MetaProblem ? e.message : "Something went wrong while making the ads on Meta. Nothing was switched on.";
    }
    return out;
  },

  async switchOn(workspaceId, set: AdSet, ads: AdVariation[], budget: BudgetChange) {
    await withProblemNoted(workspaceId, async () => {
      const { token } = await metaSession(workspaceId);
      const adIds = ads.map((a) => a.external.adId).filter((x): x is string => !!x);
      if (!set.external.campaignId || !set.external.adSetId || !adIds.length) throw new MetaProblem("These ads aren't on Meta yet.");
      const fresh = { ...budget, switchedOnAt: null };
      await switchOn(token, { campaignId: set.external.campaignId, adSetId: set.external.adSetId, adIds }, { lifetimeBudgetMinor: minor(capFor(budget)), endTime: endFor(fresh) });
    });
  },

  async pause(workspaceId, set: AdSet) {
    await withProblemNoted(workspaceId, async () => {
      if (!set.external.campaignId) return;
      const { token } = await metaSession(workspaceId);
      await pause(token, set.external.campaignId);
    });
  },

  async changeBudget(workspaceId, set: AdSet, budget: BudgetChange) {
    await withProblemNoted(workspaceId, async () => {
      if (!set.external.adSetId) return;
      const { token } = await metaSession(workspaceId);
      await updateAdSet(token, set.external.adSetId, budgetPayload(minor(capFor(budget)), endFor(budget)));
    });
  },

  async readResults(workspaceId, set: AdSet, ads: AdVariation[]) {
    return withProblemNoted(workspaceId, async () => {
      if (!set.external.campaignId || !set.launchedAt) return { rows: [], reachTotal: null };
      const { token } = await metaSession(workspaceId);
      const byAd = new Map(ads.filter((a) => a.external.adId).map((a) => [a.external.adId!, a.id]));
      const { daily, reachTotal } = await readInsights(token, set.external.campaignId, new Date(set.launchedAt));
      const rows: ResultRow[] = [];
      for (const r of daily) {
        const variationId = byAd.get(r.ad_id);
        if (!variationId) continue;
        const purchases = actionCount(r.actions, PURCHASE);
        rows.push({
          variationId,
          day: r.date_start,
          impressions: Number(r.impressions) || 0,
          reach: Number(r.reach) || 0,
          clicks: Number(r.inline_link_clicks) || 0,
          addToCarts: actionCount(r.actions, ADD_TO_CART),
          purchases,
          spendCents: Math.round((Number(r.spend) || 0) * 100),
          salesCents: Math.round(actionCount(r.action_values, PURCHASE) * 100),
        });
      }
      return { rows, reachTotal };
    });
  },
};
