import "server-only";
import { metaAds } from "@/connectors/meta-ads";
import { enqueueJob } from "@/lib/ai/jobs";
import { appOrigin } from "@/lib/connections/types";
import { countryCode, countryName } from "@/lib/countries";
import { pictureIndex } from "@/lib/creative/pictures";
import { withWorkspace, type Tx } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import type { ShopRow } from "@/lib/shops/types";
import { clip } from "@/lib/text";
import type { CatalogImage, ItemArt } from "@/lib/types";
import { callOffAdPictures, dropAdPictures, ensureAdPictures, isPracticeItem, photosOf, redoAdPicture, adPictureViews } from "./pictures";
import { platformFor } from "./platforms";
import { ADS_SYSTEM, adsPrompt, rewritePrompt, type AdContext } from "./prompts";
import { adRewriteSchema, adsWriteSchema, BUDGET, CARDS, cardProducts, CTAS, LIMITS, normalizeCards, type Cta } from "./schema";
import { PRACTICE_MODEL, practiceDaysDue, practiceStrengths, simulateDay } from "./simulator";
import { PlatformProblem, type AdSet, type AdVariation, type BudgetChange, type LaunchAd } from "./types";

// A shop's ads, from the first press to the last day:
//   startAds       "Make ads for <shop>": saves an ad set and asks the AI to write it ("ads.write")
//   (lib/ads/jobs) the AI's answer becomes 3 to 5 draft ads
//   updateAd / rewriteAd / removeAd / restoreAd   people stay in charge of what the AI wrote
//   launchPaused   "Create these ads — paused": practice, or the connected ad platform, all switched off
//   switchOn       the only way anything starts spending, and only from a person's press
//   pauseSet / endSet / stopEverything   stopping, always one press
//   syncPractice   practice delivery: made-up results on a practice clock, never past the cap
// Every switch-on, pause, stop and budget change is written to the audit log.

export class AdsProblem extends Error {}

const WRITE_TIMEOUT_MS = 240_000;
const MAX_PRODUCTS_IN_PROMPT = 24;
const OPEN = ["writing", "draft", "paused", "on", "failed"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AdShopProduct {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  images: CatalogImage[];
  category: string;
  priceCents: number;
  handle: string;
  art: ItemArt | null;
  imagined: boolean;
}

export interface Target {
  platform: "practice" | "meta";
  /** Why these are practice ads, in plain words; null when they will be real. */
  reason: string | null;
  /** The shop's address; product links hang off it. */
  base: string;
  /** What previews show as the shop's address. */
  domain: string;
}

async function audit(tx: Tx, workspaceId: string, memberId: string | null, action: string, detail: Record<string, unknown>) {
  await tx`
    insert into armada.audit_log (workspace_id, member_id, action, detail)
    values (${workspaceId}, ${memberId}, ${action}, ${tx.json(detail as never)})`;
}

export async function loadShopProducts(tx: Tx, shop: ShopRow): Promise<AdShopProduct[]> {
  const refs = shop.blueprint.products ?? [];
  if (!refs.length) return [];
  const rows = await tx<{ id: string; title: string; description: string; bullets: string[]; images: CatalogImage[]; category: string; art: ItemArt | null }[]>`
    select p.id, p.title, p.description, p.bullets, p.images, p.category, c.attributes -> 'art' as art
    from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id
    where p.id in ${tx(refs.map((r) => r.productId))}`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return refs.flatMap((ref) => {
    const p = byId.get(ref.productId);
    return p ? [{ ...p, bullets: p.bullets ?? [], images: p.images ?? [], priceCents: ref.priceCents, handle: ref.handle, imagined: ref.imagined }] : [];
  });
}

const hasPhoto = (p: AdShopProduct) => photosOf(p).length > 0;

/** Whether this shop's ads can be real, and where they send people. Recomputed at launch. */
export async function targetFor(workspaceId: string, shop: ShopRow): Promise<Target> {
  const store = shop.storeId
    ? (
        await withWorkspace(
          workspaceId,
          (tx) => tx<{ mode: "practice" | "live"; domain: string | null }[]>`select mode, domain from armada.stores where id = ${shop.storeId}`,
        )
      )[0]
    : undefined;
  const liveDomain = store?.mode === "live" && store.domain ? store.domain : null;
  const base = liveDomain ? `https://${liveDomain}` : `${appOrigin()}/s/${shop.slug}`;
  const domain = liveDomain ?? new URL(appOrigin()).host;
  const practice = (why: string): Target => ({ platform: "practice", reason: `${why} Nothing is spent and the results are made up.`, base, domain });
  if (shop.brief?.source === "practice") return practice("This is a practice shop, so its ads are practice ads.");
  if (!liveDomain) return practice("This shop isn't in a real store yet, so its ads are practice ads.");
  const why = await metaAds.cannotLaunch(workspaceId);
  if (why) return practice(`${why.replace(/\.$/, "")}, so these are practice ads for now.`);
  return { platform: "meta", reason: null, base, domain };
}

function contextFor(shop: ShopRow, products: AdShopProduct[], target: Target["platform"]): AdContext {
  return {
    bp: shop.blueprint,
    country: countryName(shop.brief?.country ?? "US"),
    target: target === "practice" ? "practice" : "real",
    products: products.map((p, i) => ({
      ref: `p${i + 1}`,
      title: p.title,
      priceCents: p.priceCents,
      category: p.category,
      photos: photosOf(p).length,
      practiceItem: target === "practice" && isPracticeItem(shop, p),
      bullets: p.bullets,
      description: p.description,
    })),
  };
}

/** Products an ad can show: a real photo, or (practice ads only) a practice item Armada may picture. */
function showable(shop: ShopRow, target: Target["platform"]) {
  return (p: AdShopProduct) => hasPhoto(p) || (target === "practice" && isPracticeItem(shop, p));
}

async function readyShop(tx: Tx, shopId: string): Promise<ShopRow> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) throw new AdsProblem("That shop wasn't found.");
  const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId}`;
  if (!shop) throw new AdsProblem("That shop wasn't found.");
  if (!["ready", "published"].includes(shop.status)) throw new AdsProblem("This shop isn't finished yet. Ads can be made once it's built.");
  return shop;
}

/** Products in the order the AI saw them (p1, p2 …), so its answer maps back to the same ones. */
function inRefOrder(products: AdShopProduct[], refs: string[]): AdShopProduct[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return refs.map((id) => byId.get(id)).filter((p): p is AdShopProduct => !!p);
}

// ---------- writing ----------

/** "Make ads for <shop>": saves an ad set and asks the AI to write it. A second press finds the first. */
export async function startAds(workspaceId: string, memberId: string, shopId: string): Promise<string> {
  const shop = await withWorkspace(workspaceId, (tx) => readyShop(tx, shopId));
  const target = await targetFor(workspaceId, shop);
  return withWorkspace(workspaceId, async (tx) => {
    const [open] = await tx<{ id: string }[]>`select id from armada.ad_sets where shop_id = ${shopId} and status in ${tx(OPEN)}`;
    if (open) return open.id;
    const all = await loadShopProducts(tx, shop);
    const products = all.filter(showable(shop, target.platform)).slice(0, MAX_PRODUCTS_IN_PROMPT);
    if (!all.length) throw new AdsProblem("This shop has no products to advertise yet.");
    if (!products.length)
      throw new AdsProblem(
        target.platform === "practice" ? "None of this shop's products has a photo to show in an ad." : "Ads on Facebook and Instagram need product photos, and none of this shop's products have one.",
      );
    const audience = { countries: [countryCode(shop.brief?.country ?? "US")] };
    const [set] = await tx<{ id: string }[]>`
      insert into armada.ad_sets (workspace_id, shop_id, platform, practice_reason, created_by, product_refs, audience)
      values (${workspaceId}, ${shopId}, ${target.platform}, ${target.reason}, ${memberId},
              ${tx.json(products.map((p) => p.id) as never)}, ${tx.json(audience as never)})
      on conflict (shop_id) where status in ('writing', 'draft', 'paused', 'on', 'failed') do nothing
      returning id`;
    if (!set) {
      const [other] = await tx<{ id: string }[]>`select id from armada.ad_sets where shop_id = ${shopId} and status in ${tx(OPEN)}`;
      if (other) return other.id;
      throw new AdsProblem("Couldn't start writing the ads. Try again.");
    }
    await enqueueJob(tx, {
      workspaceId,
      kind: "ads.write",
      input: { system: ADS_SYSTEM, prompt: adsPrompt(contextFor(shop, products, target.platform)), schema: adsWriteSchema as never, timeoutMs: WRITE_TIMEOUT_MS },
      parent: { type: "ad_set", id: set.id },
    });
    await audit(tx, workspaceId, memberId, "ads.writing", { shopId, adSetId: set.id, platform: target.platform });
    return set.id;
  });
}

/** After the AI couldn't write them: asks again. */
export async function retryWriting(workspaceId: string, setId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${setId} and status = 'failed' for update`;
    if (!set) return;
    const shop = await readyShop(tx, set.shopId);
    const products = inRefOrder(await loadShopProducts(tx, shop), set.productRefs);
    if (!products.length) throw new AdsProblem("This shop has no products to advertise anymore.");
    await tx`update armada.ad_sets set status = 'writing', error = null, updated_at = now() where id = ${setId}`;
    await enqueueJob(tx, {
      workspaceId,
      kind: "ads.write",
      input: { system: ADS_SYSTEM, prompt: adsPrompt(contextFor(shop, products, set.platform === "practice" ? "practice" : "meta")), schema: adsWriteSchema as never, timeoutMs: WRITE_TIMEOUT_MS },
      parent: { type: "ad_set", id: setId },
    });
  });
}

/** "Write again" on one ad: the AI writes a different one in its place. */
export async function rewriteAd(workspaceId: string, variationId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [v] = await tx<AdVariation[]>`
      select v.* from armada.ad_variations v join armada.ad_sets s on s.id = v.ad_set_id
      where v.id = ${variationId} and v.status in ('draft', 'failed') and s.status = 'draft' for update of v`;
    if (!v) throw new AdsProblem("Only ads that haven't been created yet can be written again.");
    const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${v.adSetId}`;
    const shop = await readyShop(tx, set.shopId);
    const products = inRefOrder(await loadShopProducts(tx, shop), set.productRefs);
    const others = await tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${set.id} and id <> ${v.id} and status <> 'removed' order by position`;
    await tx`update armada.ad_variations set status = 'rewriting', error = null, updated_at = now() where id = ${v.id}`;
    await enqueueJob(tx, {
      workspaceId,
      kind: "ads.write",
      input: {
        system: ADS_SYSTEM,
        prompt: rewritePrompt(contextFor(shop, products, set.platform === "practice" ? "practice" : "meta"), v, others),
        schema: adRewriteSchema as never,
        timeoutMs: WRITE_TIMEOUT_MS,
      },
      parent: { type: "ad_variation", id: v.id },
    });
  });
}

export interface AdEdit {
  primaryText: string;
  headline: string;
  description: string;
  callToAction: string;
  cards: { headline: string; description: string; remove: boolean }[];
}

/** A person's edit to one ad's words. Marks it as written by AI and changed by a person. */
export async function updateAd(workspaceId: string, variationId: string, edit: AdEdit): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [v] = await tx<AdVariation[]>`
      select v.* from armada.ad_variations v join armada.ad_sets s on s.id = v.ad_set_id
      where v.id = ${variationId} and v.status in ('draft', 'failed') and s.status = 'draft' for update of v`;
    if (!v) throw new AdsProblem("Only ads that haven't been created yet can be changed.");
    const primaryText = clip(edit.primaryText, LIMITS.primaryText);
    const headline = clip(edit.headline, LIMITS.headline);
    if (!primaryText || !headline) throw new AdsProblem("An ad needs its words above the picture and a headline.");
    const cta: Cta = (CTAS as readonly string[]).includes(edit.callToAction) ? (edit.callToAction as Cta) : v.callToAction;
    let cards = normalizeCards(v.cards);
    let productIds = v.productIds;
    let dropped: string[] = [];
    if (v.format === "carousel") {
      const before = cards;
      cards = before
        .map((c, i) => ({ c, e: edit.cards[i] }))
        .filter(({ e }) => !e?.remove)
        .map(({ c, e }) => ({ ...c, headline: clip(e?.headline ?? c.headline, LIMITS.cardHeadline), description: clip(e?.description ?? c.description, LIMITS.cardDescription) }));
      if (cards.length < CARDS.min) throw new AdsProblem(`A carousel needs at least ${CARDS.min} cards.`);
      if (!cards.some((c) => c.kind === "product")) throw new AdsProblem("A carousel needs at least one card with a product on it.");
      productIds = cardProducts(cards);
      dropped = before.filter((c) => !cards.some((k) => k.key === c.key)).map((c) => c.key);
    }
    await tx`
      update armada.ad_variations
      set primary_text = ${primaryText}, headline = ${headline}, description = ${clip(edit.description, LIMITS.description)},
          call_to_action = ${cta}, cards = ${tx.json(cards as never)}, product_ids = ${tx.json(productIds as never)},
          written_by = 'ai_edited', status = 'draft', error = null, updated_at = now()
      where id = ${variationId}`;
    // A card taken out takes its picture with it.
    await dropAdPictures(tx, variationId, dropped);
  });
}

export async function removeAd(workspaceId: string, variationId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const done = await tx`
      update armada.ad_variations v set status = 'removed', updated_at = now()
      from armada.ad_sets s
      where v.id = ${variationId} and s.id = v.ad_set_id and s.status = 'draft' and v.status in ('draft', 'failed')`;
    // Its pictures that haven't started aren't made: nobody will see them.
    if (done.count) await callOffAdPictures(tx, variationId);
  });
}

export async function restoreAd(workspaceId: string, variationId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [v] = await tx<AdVariation[]>`
      update armada.ad_variations v set status = 'draft', updated_at = now()
      from armada.ad_sets s
      where v.id = ${variationId} and s.id = v.ad_set_id and s.status = 'draft' and v.status = 'removed'
      returning v.*`;
    if (!v) return;
    const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${v.adSetId}`;
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${set.shopId}`;
    if (shop) await ensureAdPictures(tx, shop, [v], new Map((await loadShopProducts(tx, shop)).map((p) => [p.id, p])));
  });
}

// ---------- pictures ----------

/**
 * Opening a shop's ads asks for any pictures they're still missing (ads written before pictures
 * existed, or put back). Ads being written, and finished sets, are left alone.
 */
export async function ensureShopAdPictures(workspaceId: string, shopId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return 0;
  return withWorkspace(workspaceId, async (tx) => {
    const [set] = await tx<AdSet[]>`select * from armada.ad_sets where shop_id = ${shopId} and status in ('draft', 'paused', 'on')`;
    if (!set) return 0;
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId}`;
    if (!shop) return 0;
    const variations = await tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${set.id} order by position`;
    return ensureAdPictures(tx, shop, variations, new Map((await loadShopProducts(tx, shop)).map((p) => [p.id, p])));
  });
}

/** "Make again" on one picture of an ad that hasn't been created yet: its scene, or the practice item's picture. */
export async function remakeAdPicture(workspaceId: string, variationId: string, key: string, what: "scene" | "item"): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [v] = await tx<AdVariation[]>`
      select v.* from armada.ad_variations v join armada.ad_sets s on s.id = v.ad_set_id
      where v.id = ${variationId} and v.status in ('draft', 'failed') and s.status = 'draft'`;
    if (!v) throw new AdsProblem("Pictures can be made again only before the ads are created.");
    const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${v.adSetId}`;
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${set.shopId}`;
    if (!shop) throw new AdsProblem("That shop wasn't found.");
    const products = new Map((await loadShopProducts(tx, shop)).map((p) => [p.id, p]));
    const queued = await redoAdPicture(tx, shop, v, key, what, products);
    if (!queued) throw new AdsProblem("That picture is already being made again.");
  });
}

// ---------- budget and audience ----------

export interface BudgetEdit {
  dailyDollars: number;
  days: number;
  ageMin?: number;
  ageMax?: number;
  audienceDescription?: string;
}

/**
 * Changes the daily budget and number of days (and, before the ads are made, who sees them). Once ads
 * exist, every change is audited and sent to the platform, and the cap can't drop below what's spent.
 */
export async function saveBudget(workspaceId: string, memberId: string, setId: string, edit: BudgetEdit): Promise<void> {
  const daily = Math.round(edit.dailyDollars);
  const days = Math.round(edit.days);
  if (!Number.isFinite(daily) || daily < BUDGET.minDaily || daily > BUDGET.maxDaily)
    throw new AdsProblem(`The daily budget has to be between $${BUDGET.minDaily} and $${BUDGET.maxDaily}.`);
  if (!Number.isFinite(days) || days < 1 || days > BUDGET.maxDays) throw new AdsProblem(`Ads can run from 1 to ${BUDGET.maxDays} days.`);
  const dailyCents = daily * 100;

  const { set, spent, daysRun } = await withWorkspace(workspaceId, async (tx) => {
    const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${setId} and status in ('draft', 'paused', 'on') for update`;
    if (!set) throw new AdsProblem("These ads can't be changed now.");
    const [r] = await tx<{ spent: number; daysRun: number }[]>`
      select coalesce(sum(spend_cents), 0)::int as spent, count(distinct day)::int as days_run from armada.ad_results_daily where ad_set_id = ${setId}`;
    return { set, spent: r.spent, daysRun: r.daysRun };
  });
  if (dailyCents * days < spent) throw new AdsProblem(`That's less than the ${formatMoney(spent, set.currency)} already spent. Choose a larger budget or more days.`);
  if (set.platform === "practice" && days < daysRun) throw new AdsProblem(`These ads have already run ${daysRun} days.`);

  const budget: BudgetChange = { dailyBudgetCents: dailyCents, days, spentCents: spent, switchedOnAt: set.switchedOnAt };
  const platform = platformFor(set.platform);
  if (platform && set.launchedAt && (set.dailyBudgetCents !== dailyCents || set.days !== days)) {
    try {
      await platform.changeBudget(workspaceId, set, budget);
    } catch (e) {
      throw new AdsProblem(e instanceof PlatformProblem ? e.message : "Couldn't change the budget on the ad platform. Nothing changed.");
    }
  }

  await withWorkspace(workspaceId, async (tx) => {
    let audience = set.audience;
    if (set.status === "draft") {
      const ageMin = Math.min(65, Math.max(18, Math.round(edit.ageMin ?? set.audience.ageMin ?? 18)));
      const ageMax = Math.min(65, Math.max(ageMin, Math.round(edit.ageMax ?? set.audience.ageMax ?? 65)));
      const description = edit.audienceDescription != null ? clip(edit.audienceDescription, LIMITS.audience) : set.audience.description;
      audience = { ...set.audience, ageMin, ageMax, description };
    }
    await tx`
      update armada.ad_sets set daily_budget_cents = ${dailyCents}, days = ${days}, audience = ${tx.json(audience as never)}, updated_at = now()
      where id = ${setId}`;
    if (set.status !== "draft" && (set.dailyBudgetCents !== dailyCents || set.days !== days)) {
      await audit(tx, workspaceId, memberId, "ads.budget_changed", {
        adSetId: setId,
        shopId: set.shopId,
        platform: set.platform,
        before: { dailyBudgetCents: set.dailyBudgetCents, days: set.days, spendCapCents: set.spendCapCents },
        after: { dailyBudgetCents: dailyCents, days, spendCapCents: dailyCents * days },
      });
    }
  });
}

// ---------- creating (switched off) ----------

function productLink(target: Target, p: AdShopProduct | undefined): string {
  return p ? `${target.base}/products/${p.handle}` : target.base;
}

/** "Create these ads — paused": builds them in practice or on the connected platform, all switched off. */
export async function launchPaused(workspaceId: string, memberId: string, setId: string): Promise<void> {
  const claimed = await withWorkspace(workspaceId, async (tx) => {
    const [set] = await tx<AdSet[]>`
      update armada.ad_sets set launching_at = now(), updated_at = now()
      where id = ${setId} and status = 'draft' and (launching_at is null or launching_at < now() - interval '10 minutes')
      returning *`;
    if (!set) {
      const [now] = await tx<{ status: string }[]>`select status from armada.ad_sets where id = ${setId}`;
      if (now && now.status !== "draft") return null; // already created by an earlier press
      throw new AdsProblem("These ads are already being created. This page updates when they're ready.");
    }
    const ads = await tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${setId} and status <> 'removed' order by position`;
    const busy = ads.find((a) => a.status === "rewriting");
    const ready = ads.filter((a) => a.status === "draft" || a.status === "failed");
    if (busy || !ready.length) {
      await tx`update armada.ad_sets set launching_at = null where id = ${setId}`;
      throw new AdsProblem(busy ? `Wait for the AI to finish writing ad ${busy.position + 1} again.` : "There are no ads left to create. Put one back or make new ads.");
    }
    const shop = await readyShop(tx, set.shopId);
    const products = await loadShopProducts(tx, shop);
    return { set, ads: ready, shop, products };
  });
  if (!claimed) return;
  const { set, ads, shop, products } = claimed;
  const release = (error: string | null) =>
    withWorkspace(workspaceId, (tx) => tx`update armada.ad_sets set launching_at = null, error = ${error}, updated_at = now() where id = ${setId}`);

  let target: Target;
  try {
    target = await targetFor(workspaceId, shop);
  } catch {
    await release(null);
    throw new AdsProblem("Couldn't check where these ads can run. Try again.");
  }

  if (target.platform === "practice") {
    const strengths = practiceStrengths(set.id, ads.length);
    await withWorkspace(workspaceId, async (tx) => {
      for (const [i, a] of ads.entries()) {
        await tx`update armada.ad_variations set status = 'created', practice_strength = ${strengths[i]}, updated_at = now() where id = ${a.id}`;
      }
      await tx`
        update armada.ad_sets
        set status = 'paused', platform = 'practice', practice_reason = ${target.reason}, launched_at = now(), launching_at = null,
            error = null, stop_reason = null, updated_at = now()
        where id = ${setId}`;
      await audit(tx, workspaceId, memberId, "ads.created_paused", { adSetId: setId, shopId: set.shopId, platform: "practice", ads: ads.length });
    });
    return;
  }

  // What runs is what was checked: the same composed pictures as the previews, each product in its real photo.
  const byId = new Map(products.map((p) => [p.id, p]));
  const index = await withWorkspace(workspaceId, (tx) => pictureIndex(tx, { shopId: shop.id, adIds: ads.map((a) => a.id) }));
  const views = new Map(ads.map((a) => [a.id, adPictureViews(shop, a, byId, index)]));
  for (const a of ads) {
    const pics = views.get(a.id) ?? [];
    const shape = a.format === "carousel" ? "square" : "portrait";
    const missing = pics.find((p) => !p.src[shape]);
    if (!pics.length || missing) {
      await release(null);
      throw new AdsProblem(
        missing?.state === "failed"
          ? `A picture in ad ${a.position + 1} couldn't be made. Press Make again on it, or take that ad out.`
          : `The pictures for ad ${a.position + 1} are still being made. Try again in a minute.`,
      );
    }
  }
  const origin = appOrigin();
  const launchAds: LaunchAd[] = ads.map((a) => {
    const pics = new Map((views.get(a.id) ?? []).map((p) => [p.key, p]));
    const first = byId.get(a.productIds[0]);
    return {
      variationId: a.id,
      format: a.format,
      primaryText: a.primaryText,
      headline: a.headline,
      description: a.description,
      callToAction: a.callToAction,
      link: a.format === "carousel" ? target.base : productLink(target, first),
      imageUrl: a.format === "single" && pics.get("main")?.src.portrait ? `${origin}${pics.get("main")!.src.portrait}` : null,
      cards: normalizeCards(a.cards).map((c) => {
        const p = c.productId ? byId.get(c.productId) : undefined;
        const pic = pics.get(c.key)?.src.square;
        return { productId: c.productId, headline: c.headline, description: c.description, link: productLink(target, p), imageUrl: pic ? `${origin}${pic}` : null };
      }),
    };
  });
  const brand = shop.blueprint.brand?.name ?? shop.niche;
  const out = await metaAds.createPaused(workspaceId, {
    name: `Armada · ${brand} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    currency: set.currency,
    countries: set.audience.countries?.length ? set.audience.countries : [countryCode(shop.brief?.country ?? "US")],
    ageMin: set.audience.ageMin ?? 18,
    ageMax: set.audience.ageMax ?? 65,
    interests: set.audience.interests ?? [],
    dailyBudgetCents: set.dailyBudgetCents,
    days: set.days,
    ads: launchAds,
  });

  await withWorkspace(workspaceId, async (tx) => {
    if (!out.ok) {
      // Anything that did get made is switched off; it's recorded so it can be found in Meta's screens.
      const leftovers = [out.external.campaignId, out.external.adSetId, ...out.ads.map((a) => a.external.adId)].filter((x): x is string => !!x);
      await tx`
        update armada.ad_sets set launching_at = null, error = ${out.problem ?? "Couldn't create the ads."},
          external = ${tx.json({ ...set.external, leftovers: [...(set.external.leftovers ?? []), ...leftovers] } as never)}, updated_at = now()
        where id = ${setId}`;
      await audit(tx, workspaceId, memberId, "ads.create_failed", { adSetId: setId, shopId: set.shopId, platform: "meta", problem: out.problem, leftovers });
      return;
    }
    for (const a of out.ads) {
      await tx`update armada.ad_variations set status = 'created', external = ${tx.json(a.external as never)}, updated_at = now() where id = ${a.variationId}`;
    }
    await tx`
      update armada.ad_sets
      set status = 'paused', platform = 'meta', practice_reason = null, external = ${tx.json(out.external as never)},
          launched_at = now(), launching_at = null, error = null, stop_reason = null, updated_at = now()
      where id = ${setId}`;
    await audit(tx, workspaceId, memberId, "ads.created_paused", { adSetId: setId, shopId: set.shopId, platform: "meta", ads: out.ads.length, campaignId: out.external.campaignId });
  });
  if (!out.ok) throw new AdsProblem(out.problem ?? "Couldn't create the ads.");
}

// ---------- switching on and off ----------

async function spentAndDays(tx: Tx, setId: string): Promise<{ spent: number; daysRun: number }> {
  const [r] = await tx<{ spent: number; daysRun: number }[]>`
    select coalesce(sum(spend_cents), 0)::int as spent, count(distinct day)::int as days_run from armada.ad_results_daily where ad_set_id = ${setId}`;
  return r;
}

/** "Switch on": the only way ads start spending. Only a person's press calls this. */
export async function switchOn(workspaceId: string, memberId: string, setId: string): Promise<void> {
  const { set, ads, spent, daysRun } = await withWorkspace(workspaceId, async (tx) => {
    const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${setId} and status = 'paused' and launched_at is not null`;
    if (!set) throw new AdsProblem("These ads can't be switched on right now.");
    const ads = await tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${setId} and status = 'created' order by position`;
    return { set, ads, ...(await spentAndDays(tx, setId)) };
  });
  if (!ads.length) throw new AdsProblem("There are no ads here to switch on.");
  if (spent >= set.spendCapCents) throw new AdsProblem("These ads have spent their whole budget. Raise the daily budget or add days first.");
  if (set.platform === "practice" && daysRun >= set.days) throw new AdsProblem("These ads have run all their days. Add days first.");

  const platform = platformFor(set.platform);
  if (platform) {
    try {
      await platform.switchOn(workspaceId, set, ads, { dailyBudgetCents: set.dailyBudgetCents, days: set.days, spentCents: spent, switchedOnAt: set.switchedOnAt });
    } catch (e) {
      throw new AdsProblem(e instanceof PlatformProblem ? e.message : "Couldn't switch the ads on. They are still off.");
    }
  }
  await withWorkspace(workspaceId, async (tx) => {
    // The practice clock picks up where it stopped: one practice day per minute from here.
    const backdate = daysRun * PRACTICE_MODEL.minutesPerDay * 60_000;
    await tx`
      update armada.ad_sets
      set status = 'on', switched_on_at = coalesce(switched_on_at, now()), switched_on_by = ${memberId},
          clock_started_at = ${set.platform === "practice" ? new Date(Date.now() - backdate) : null},
          stop_reason = null, error = null, updated_at = now()
      where id = ${setId} and status = 'paused'`;
    await audit(tx, workspaceId, memberId, "ads.switched_on", {
      adSetId: setId,
      shopId: set.shopId,
      platform: set.platform,
      practice: set.platform === "practice",
      dailyBudgetCents: set.dailyBudgetCents,
      days: set.days,
      spendCapCents: set.spendCapCents,
      spentSoFarCents: spent,
    });
  });
}

/** Pauses one shop's ads. Practice results up to now are kept. */
export async function pauseSet(workspaceId: string, memberId: string, memberName: string, setId: string, reason?: string): Promise<void> {
  const [set] = await withWorkspace(workspaceId, (tx) => tx<AdSet[]>`select * from armada.ad_sets where id = ${setId} and status = 'on'`);
  if (!set) return;
  if (set.platform === "practice") await syncPractice(workspaceId, [setId]);
  const platform = platformFor(set.platform);
  if (platform) {
    try {
      await platform.pause(workspaceId, set);
    } catch (e) {
      throw new AdsProblem(e instanceof PlatformProblem ? `${e.message} The ads may still be on; pause them in Meta's own screens to be sure.` : "Couldn't reach the ad platform. The ads may still be on.");
    }
  }
  await withWorkspace(workspaceId, async (tx) => {
    const done = await tx`
      update armada.ad_sets set status = 'paused', clock_started_at = null, stop_reason = ${reason ?? `Paused by ${memberName}`}, updated_at = now()
      where id = ${setId} and status = 'on'`;
    // A practice set can finish on its own during the catch-up above; then there's nothing to pause.
    if (done.count) await audit(tx, workspaceId, memberId, "ads.paused", { adSetId: setId, shopId: set.shopId, platform: set.platform, reason: reason ?? "by a person" });
  });
}

/** Ends a shop's ads for good (they stay visible with their results). */
export async function endSet(workspaceId: string, memberId: string, memberName: string, setId: string): Promise<void> {
  const [set] = await withWorkspace(workspaceId, (tx) => tx<AdSet[]>`select * from armada.ad_sets where id = ${setId} and status in ('paused', 'on')`);
  if (!set) return;
  if (set.status === "on") await pauseSet(workspaceId, memberId, memberName, setId);
  await withWorkspace(workspaceId, async (tx) => {
    await tx`
      update armada.ad_sets set status = 'stopped', clock_started_at = null, stopped_at = now(), stop_reason = ${`Ended by ${memberName}`}, updated_at = now()
      where id = ${setId} and status = 'paused'`;
    await audit(tx, workspaceId, memberId, "ads.stopped", { adSetId: setId, shopId: set.shopId, platform: set.platform });
  });
}

/** Throws away ads that were never created (writing, draft, or the AI couldn't write them). */
export async function discardSet(workspaceId: string, memberId: string, setId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [open] = await tx<{ id: string }[]>`
      select id from armada.ad_sets where id = ${setId} and status in ('writing', 'draft', 'failed') and launched_at is null and launching_at is null`;
    if (open) for (const v of await tx<{ id: string }[]>`select id from armada.ad_variations where ad_set_id = ${setId}`) await callOffAdPictures(tx, v.id);
    const [gone] = await tx<{ shopId: string }[]>`
      delete from armada.ad_sets where id = ${setId} and status in ('writing', 'draft', 'failed') and launched_at is null and launching_at is null
      returning shop_id`;
    if (gone) await audit(tx, workspaceId, memberId, "ads.discarded", { adSetId: setId, shopId: gone.shopId });
  });
}

/**
 * The one stop button: pauses every ad that is on, in every shop, on every platform. Returns the shops
 * whose platform couldn't be reached (their ads may still be on, and the page says so).
 */
export async function stopEverything(workspaceId: string, memberId: string, memberName: string): Promise<{ paused: number; failed: string[] }> {
  const on = await withWorkspace(
    workspaceId,
    (tx) => tx<(AdSet & { brand: string | null })[]>`
      select s.*, sh.blueprint -> 'brand' ->> 'name' as brand
      from armada.ad_sets s join armada.shops sh on sh.id = s.shop_id where s.status = 'on'`,
  );
  let paused = 0;
  const failed: string[] = [];
  for (const set of on) {
    try {
      await pauseSet(workspaceId, memberId, memberName, set.id, `Stopped with “Stop every ad” by ${memberName}`);
      paused++;
    } catch {
      failed.push(set.brand ?? "A shop");
    }
  }
  await withWorkspace(workspaceId, (tx) => audit(tx, workspaceId, memberId, "ads.stop_everything", { paused, failed }));
  return { paused, failed };
}

// ---------- practice delivery ----------

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Runs practice delivery up to now for practice ads that are on: one made-up day per practice-clock
 * minute, never past the spend cap, stopping on the last day or at the cap. Safe to call on every
 * page view: each day is written once.
 */
export async function syncPractice(workspaceId: string, setIds?: string[]): Promise<void> {
  const sets = await withWorkspace(
    workspaceId,
    (tx) => tx<AdSet[]>`
      select * from armada.ad_sets where status = 'on' and platform = 'practice' ${setIds?.length ? tx`and id in ${tx(setIds)}` : tx``}`,
  );
  for (const s of sets) {
    await withWorkspace(workspaceId, async (tx) => {
      const [set] = await tx<AdSet[]>`select * from armada.ad_sets where id = ${s.id} and status = 'on' for update`;
      if (!set) return;
      const due = practiceDaysDue(set.clockStartedAt, Date.now(), 0, set.days);
      let { spent, daysRun } = await spentAndDays(tx, set.id);
      if (due <= daysRun && spent < set.spendCapCents) return;
      const ads = await tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${set.id} and status = 'created' order by position`;
      const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${set.shopId}`;
      const prices = new Map((shop?.blueprint.products ?? []).map((p) => [p.productId, p.priceCents]));
      const shown = ads.flatMap((a) => a.productIds).map((id) => prices.get(id)).filter((x): x is number => x != null);
      const avgOrderCents = shown.length ? Math.round(shown.reduce((x, y) => x + y, 0) / shown.length) : 3000;
      const firstDay = new Date(set.switchedOnAt ?? set.launchedAt ?? set.createdAt);
      let stop: string | null = null;
      for (let d = daysRun + 1; d <= due && !stop; d++) {
        const rows = simulateDay({
          seed: set.id,
          dayIndex: d,
          totalDays: set.days,
          dailyBudgetCents: set.dailyBudgetCents,
          capCents: set.spendCapCents,
          spentSoFarCents: spent,
          avgOrderCents,
          ads: ads.map((a) => ({ id: a.id, strength: a.practiceStrength ?? 1 })),
        });
        const day = isoDay(new Date(firstDay.getTime() + (d - 1) * DAY_MS));
        for (const r of rows) {
          await tx`
            insert into armada.ad_results_daily (workspace_id, ad_set_id, variation_id, day, practice, impressions, reach, clicks, add_to_carts, purchases, spend_cents, sales_cents)
            values (${workspaceId}, ${set.id}, ${r.variationId}, ${day}, true, ${r.impressions}, ${r.reach}, ${r.clicks}, ${r.addToCarts}, ${r.purchases}, ${r.spendCents}, ${r.salesCents})
            on conflict (variation_id, day) do nothing`;
          spent += r.spendCents;
        }
        daysRun = d;
        if (spent >= set.spendCapCents) stop = `Reached its spending cap of ${formatMoney(set.spendCapCents, set.currency)}`;
        else if (d >= set.days) stop = `Ran all ${set.days} days`;
      }
      if (!stop && spent >= set.spendCapCents) stop = `Reached its spending cap of ${formatMoney(set.spendCapCents, set.currency)}`;
      if (stop) {
        await tx`
          update armada.ad_sets set status = 'stopped', clock_started_at = null, stopped_at = now(), stop_reason = ${stop}, updated_at = now()
          where id = ${set.id}`;
        await audit(tx, workspaceId, null, "ads.finished", { adSetId: set.id, shopId: set.shopId, platform: "practice", reason: stop, spentCents: spent });
      }
    });
  }
}

// ---------- real results ----------

const RESULTS_EVERY_MS = 10 * 60 * 1000;

/** Reads a real platform's own numbers for a set (at most every ten minutes) and ends it after its last day. */
export async function syncRealResults(workspaceId: string, setId: string): Promise<void> {
  const [set] = await withWorkspace(workspaceId, (tx) => tx<AdSet[]>`select * from armada.ad_sets where id = ${setId} and platform <> 'practice' and launched_at is not null`);
  if (!set) return;
  const platform = platformFor(set.platform);
  if (!platform) return;
  if (set.resultsSyncedAt && Date.now() - new Date(set.resultsSyncedAt).getTime() < RESULTS_EVERY_MS) return;
  const ads = await withWorkspace(workspaceId, (tx) => tx<AdVariation[]>`select * from armada.ad_variations where ad_set_id = ${setId} and status = 'created'`);
  let result: Awaited<ReturnType<typeof platform.readResults>>;
  try {
    result = await platform.readResults(workspaceId, set, ads);
  } catch {
    await withWorkspace(workspaceId, (tx) => tx`update armada.ad_sets set results_synced_at = now() where id = ${setId}`);
    return;
  }
  await withWorkspace(workspaceId, async (tx) => {
    for (const r of result.rows) {
      await tx`
        insert into armada.ad_results_daily (workspace_id, ad_set_id, variation_id, day, practice, impressions, reach, clicks, add_to_carts, purchases, spend_cents, sales_cents)
        values (${workspaceId}, ${setId}, ${r.variationId}, ${r.day}, false, ${r.impressions}, ${r.reach}, ${r.clicks}, ${r.addToCarts}, ${r.purchases}, ${r.spendCents}, ${r.salesCents})
        on conflict (variation_id, day) do update set
          impressions = excluded.impressions, reach = excluded.reach, clicks = excluded.clicks, add_to_carts = excluded.add_to_carts,
          purchases = excluded.purchases, spend_cents = excluded.spend_cents, sales_cents = excluded.sales_cents, updated_at = now()`;
    }
    const external = { ...set.external, reach: result.reachTotal ?? set.external.reach };
    await tx`update armada.ad_sets set external = ${tx.json(external as never)}, results_synced_at = now() where id = ${setId}`;
    const ended = set.status === "on" && set.switchedOnAt && Date.now() > new Date(set.switchedOnAt).getTime() + set.days * DAY_MS;
    if (ended) {
      await tx`update armada.ad_sets set status = 'stopped', stopped_at = now(), stop_reason = ${`Ran all ${set.days} days`}, updated_at = now() where id = ${setId}`;
      await audit(tx, workspaceId, null, "ads.finished", { adSetId: setId, shopId: set.shopId, platform: set.platform, reason: "ran its days" });
    }
  });
}
