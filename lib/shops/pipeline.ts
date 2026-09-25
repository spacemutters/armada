import "server-only";
import { z } from "zod";
import { describeCjError, isFatalCjError } from "@/connectors/cj/client";
import { checkCjItem, importCjSearch } from "@/lib/catalog/cj";
import { knownCountryCode } from "@/lib/countries";
import { asSystem, withWorkspace, type Tx } from "@/lib/db";
import { enqueueJob, onJobFinished, type Deferred } from "@/lib/ai/jobs";
import { fixPalette } from "@/lib/color";
import { searchCatalog } from "@/lib/catalog/search";
import { scoreCatalogItem } from "@/lib/products/score-item";
import { randomSlug, slugify, uniqueHandle } from "@/lib/text";
import type { AiJob, CatalogItem } from "@/lib/types";
import {
  IMAGINED_ITEM,
  ProductsAnswer,
  SYSTEM,
  answerIds,
  buildProposals,
  conceptPrompt,
  conceptSchema,
  longText,
  pagesPrompt,
  pagesSchema,
  productsAsk,
  text,
} from "./prompts";
import { withCraft } from "./craft";
import { readSetsAndPairings } from "./sets";
import { startShopImages } from "./images";
import { ART_ICONS, BODY_FONTS, DISPLAY_FONTS } from "./style";
import { aiPicks, checkChoice, chooseCount, proposalTarget, stalledCjStep } from "./types";
import type { Blueprint, ProgressStep, Proposal, ShopBrief, ShopRow, StepKey } from "./types";

// A shop is built in three AI steps and one of the owner's. Each finished AI step starts the next, so
// the build needs no background worker: the AI helper's hand-back drives it forward. After the
// products step the build waits ("choosing") until the owner picks which proposed products go in.

const STEP_LABELS: Record<StepKey, string> = {
  concept: "Brand, look and plan",
  products: "Finding and writing products",
  choose: "Choose your products",
  check: "Checking shipping with CJ",
  pages: "Pages and policies",
};

/** The steps of a build, in order. Only CJ shops check real shipping, after the choice. */
function stepsFor(brief: ShopBrief): StepKey[] {
  return brief.source === "cj" ? ["concept", "products", "choose", "check", "pages"] : ["concept", "products", "choose", "pages"];
}

/** The build's steps in order, keeping what already happened. A build started before a step existed gets it, waiting. */
function withAllSteps(progress: ProgressStep[], brief: ShopBrief): ProgressStep[] {
  return stepsFor(brief).map((key) => {
    const had = progress.find((p) => p.key === key);
    return had ? { ...had, label: STEP_LABELS[key] } : { key, label: STEP_LABELS[key], state: "waiting" };
  });
}

const TIMEOUTS = { concept: 180_000, pages: 240_000 } as const;
/** The products step writes twice the shop's products, so it gets time for each (under the 12-minute stale-job line). */
const productsTimeout = (target: number) => Math.min(600_000, 240_000 + target * 10_000);

const HANDLING_DAYS = 2;
const RETURN_DAYS = 30;

/** A premium brand's price is earned partly by its terms: twice the return window, and the shop pays for returns. */
function returnTerms(feel: ShopBrief["priceFeel"]): { returnDays: number; freeReturns?: boolean } {
  return feel === "luxury" ? { returnDays: 60, freeReturns: true } : { returnDays: RETURN_DAYS };
}
/** Fewer real products than this and it isn't a shop yet; the build stops and says why. */
const MIN_CJ_PRODUCTS = 4;

const nProducts = (n: number) => `${n} ${n === 1 ? "product" : "products"}`;

const CATALOG_COLS = `id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
  ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes`;

export async function startShopBuild(tx: Tx, workspaceId: string, brief: ShopBrief): Promise<{ id: string; slug: string }> {
  const slug = randomSlug(10);
  const progress: ProgressStep[] = stepsFor(brief).map((key, i) => ({
    key,
    label: STEP_LABELS[key],
    state: i === 0 ? "running" : "waiting",
    ...(i === 0 ? { startedAt: new Date().toISOString() } : {}),
  }));
  const [shop] = await tx<{ id: string }[]>`
    insert into armada.shops (workspace_id, slug, status, niche, brief, progress)
    values (${workspaceId}, ${slug}, 'building', ${brief.niche}, ${tx.json(brief as never)}, ${tx.json(progress as never)})
    returning id`;
  await enqueueJob(tx, {
    workspaceId,
    kind: "shop.concept",
    input: { system: withCraft(SYSTEM, ["brand", "conversion"]), prompt: conceptPrompt(brief), schema: conceptSchema as never, timeoutMs: TIMEOUTS.concept },
    parent: { type: "shop", id: shop.id },
  });
  return { id: shop.id, slug };
}

const Concept = z.object({
  brandName: text(24),
  alternativeNames: z.array(text(24)).default([]),
  tagline: text(70),
  voice: text(220),
  audience: text(220),
  palette: z.record(z.string(), z.string()),
  fonts: z.object({ display: z.string(), body: z.string() }),
  hero: z.object({ headline: text(70), subhead: text(170), cta: text(28) }),
  valueProps: z.array(z.object({ title: text(48), body: text(160) })).min(1),
  collections: z.array(z.object({ title: text(32), description: text(180), keywords: z.array(text(30)).default([]) })).min(1),
  searchTerms: z.array(text(30)).min(1),
  monogramIcon: z.string(),
});

const Pages = z.object({
  about: longText(3000),
  faq: z.array(z.object({ question: text(160), answer: longText(700) })).default([]),
  shippingPage: longText(4000),
  contactPage: longText(1500),
  refundPolicy: longText(5000),
  shippingPolicy: longText(5000),
  announcement: text(70),
  footerBlurb: text(200),
  seoTitle: text(70),
  seoDescription: text(160),
  sets: z.array(z.unknown()).default([]),
  pairings: z.array(z.unknown()).default([]),
});

async function setStep(tx: Tx, shopId: string, key: StepKey, state: ProgressStep["state"], note?: string) {
  const [row] = await tx<{ progress: ProgressStep[]; brief: ShopBrief }[]>`select progress, brief from armada.shops where id = ${shopId}`;
  const now = new Date().toISOString();
  const progress = withAllSteps(row.progress, row.brief).map((s) =>
    s.key !== key
      ? s
      : {
          ...s,
          state,
          ...(state === "running" || state === "needs-you" ? { startedAt: now } : {}),
          ...(state === "done" || state === "failed" ? { finishedAt: now } : {}),
          ...(note ? { note } : {}),
        },
  );
  await tx`update armada.shops set progress = ${tx.json(progress as never)}, updated_at = now() where id = ${shopId}`;
}

async function saveBlueprint(tx: Tx, shopId: string, blueprint: Blueprint, status?: ShopRow["status"]) {
  await tx`
    update armada.shops
    set blueprint = ${tx.json(blueprint as never)}, status = coalesce(${status ?? null}, status), updated_at = now()
    where id = ${shopId}`;
}

async function failShop(tx: Tx, shop: ShopRow, step: StepKey, message: string) {
  await setStep(tx, shop.id, step, "failed", message);
  await tx`update armada.shops set status = 'failed', error = ${message}, updated_at = now() where id = ${shop.id}`;
}

function enqueueProducts(tx: Tx, shop: ShopRow, blueprint: Blueprint, candidates: CatalogItem[], allowImagined: boolean) {
  const ask = productsAsk(shop.brief, blueprint, candidates, allowImagined);
  return enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: "shop.products",
    input: { system: withCraft(SYSTEM, ["conversion"]), prompt: ask.prompt, schema: ask.schema as never, timeoutMs: productsTimeout(ask.target) },
    parent: { type: "shop", id: shop.id },
  });
}

async function afterConcept(tx: Tx, shop: ShopRow, output: unknown, defer: (work: Deferred) => void) {
  const c = Concept.parse(output);
  const { palette, changed } = fixPalette(c.palette);
  const used = new Set<string>();
  const blueprint: Blueprint = {
    brand: {
      name: c.brandName,
      alternativeNames: c.alternativeNames,
      tagline: c.tagline,
      voice: c.voice,
      audience: c.audience,
      monogramIcon: (ART_ICONS as readonly string[]).includes(c.monogramIcon) ? c.monogramIcon : "shopping-bag",
    },
    theme: {
      palette,
      fonts: {
        display: (DISPLAY_FONTS as readonly string[]).includes(c.fonts.display) ? c.fonts.display : "Fraunces",
        body: (BODY_FONTS as readonly string[]).includes(c.fonts.body) ? c.fonts.body : "Inter",
      },
      contrastFixes: changed,
    },
    hero: c.hero,
    valueProps: c.valueProps.slice(0, 3),
    collections: c.collections.slice(0, 4).map((col) => ({ ...col, handle: uniqueHandle(col.title, used), productIds: [] })),
    searchTerms: c.searchTerms,
  };

  const phrases = [...c.searchTerms, ...c.collections.flatMap((col) => col.keywords), shop.niche];

  if (shop.brief.source === "cj") {
    // Real products: search CJ after this answer is saved, in the account's speed lane.
    await saveBlueprint(tx, shop.id, blueprint);
    await setStep(tx, shop.id, "concept", "done");
    await setStep(tx, shop.id, "products", "running", "Searching CJ's catalog");
    defer(() => cjCandidates(shop.workspaceId, shop.id));
    return;
  }

  const candidates = await searchCatalog(tx, { source: shop.brief.source, phrases, limit: 60 });
  blueprint.candidateCount = candidates.length;
  blueprint.candidateIds = candidates.map((i) => i.id);
  const allowImagined = shop.brief.source === "practice";
  if (!candidates.length && !allowImagined) {
    await saveBlueprint(tx, shop.id, blueprint);
    await failShop(tx, shop, "products", "No supplier products matched this idea. Try describing what the shop sells in plainer words.");
    return;
  }

  await saveBlueprint(tx, shop.id, blueprint);
  await setStep(tx, shop.id, "concept", "done");
  await setStep(
    tx,
    shop.id,
    "products",
    "running",
    candidates.length
      ? `${candidates.length} supplier ${candidates.length === 1 ? "match" : "matches"} to choose from`
      : "No close supplier matches, so this practice shop gets practice items",
  );
  await enqueueProducts(tx, shop, blueprint, candidates, allowImagined);
}

/**
 * The AI's answer becomes cards for the owner to choose from; no products are made yet. When there is
 * nothing to choose between (the AI found no more than the shop needs), all of them go straight in.
 */
async function afterProducts(tx: Tx, shop: ShopRow, output: unknown, defer: (work: Deferred) => void) {
  const answer = ProductsAnswer.parse(output);
  const { brief, blueprint } = shop;
  const allowImagined = brief.source === "practice";
  // The same count the prompt asked for (candidateCount is saved when the candidates are handed over).
  const target = proposalTarget(brief.productCount, blueprint.candidateCount ?? blueprint.candidateIds?.length ?? 60, allowImagined);

  // Only candidates that really exist, were shown to the AI and aren't branded are looked up at all.
  const ids = answerIds(answer, blueprint.candidateIds);
  const items = ids.length
    ? await tx<CatalogItem[]>`
        select ${tx.unsafe(CATALOG_COLS)} from armada.catalog_items
        where id in ${tx(ids)} and source = ${brief.source} and not branded`
    : [];
  const proposals = buildProposals(answer, new Map(items.map((i) => [i.id, i])), {
    target,
    allowImagined,
    source: brief.source,
    priceFeel: brief.priceFeel,
    collections: blueprint.collections ?? [],
    shown: blueprint.candidateIds,
  });

  if (!proposals.length) {
    await failShop(tx, shop, "products", "The AI didn't find products that fit this shop. Try a broader idea.");
    return;
  }
  if (brief.source === "cj" && proposals.length < MIN_CJ_PRODUCTS) {
    await failShop(
      tx,
      shop,
      "products",
      `Only ${nProducts(proposals.length)} from CJ fit this shop, and a shop needs at least ${MIN_CJ_PRODUCTS}. Try a broader idea.`,
    );
    return;
  }

  const need = chooseCount(brief.productCount, proposals.length);
  if (proposals.length <= need) {
    // Nothing to choose between: every product the AI found goes in, as before.
    await setStep(tx, shop.id, "products", "done", `${nProducts(proposals.length)} written`);
    await setStep(
      tx,
      shop.id,
      "choose",
      "done",
      `The AI found ${proposals.length} that fit${proposals.length < brief.productCount ? ` (not ${brief.productCount})` : ""}, so all of them are in`,
    );
    await buildWithChosen(tx, shop, blueprint, proposals, { offered: proposals.length, chosen: proposals.length, by: "all" }, defer);
    return;
  }

  const next: Blueprint = { ...blueprint, proposals };
  delete next.candidateIds;
  await saveBlueprint(tx, shop.id, next, "choosing");
  await setStep(tx, shop.id, "products", "done", `${nProducts(proposals.length)} written for you to choose from`);
  await setStep(tx, shop.id, "choose", "needs-you", `Waiting for you: choose ${nProducts(need)}`);
}

/**
 * Makes the chosen products (and the catalog rows for chosen practice items the AI imagined), then
 * carries on exactly as the build always has: CJ shops confirm real shipping for these products,
 * then pages; practice shops go straight to pages. Prices come from the pricing rules.
 */
async function buildWithChosen(
  tx: Tx,
  shop: ShopRow,
  blueprint: Blueprint,
  chosen: Proposal[],
  choice: NonNullable<Blueprint["choice"]>,
  defer: (work: Deferred) => void,
) {
  const brief = shop.brief;
  const collections = (blueprint.collections ?? []).map((c) => ({ ...c, productIds: [] as string[] }));
  // Real items are read again, so prices use today's numbers and nothing branded slips in.
  const realIds = chosen.map((p) => p.catalogItemId).filter((id): id is string => Boolean(id));
  const items = realIds.length
    ? await tx<CatalogItem[]>`
        select ${tx.unsafe(CATALOG_COLS)} from armada.catalog_items
        where id in ${tx(realIds)} and source = ${brief.source} and not branded`
    : [];
  const byId = new Map(items.map((i) => [i.id, i]));

  const handles = new Set<string>();
  const products: NonNullable<Blueprint["products"]> = [];
  const used: CatalogItem[] = [];
  for (const p of chosen) {
    let item: CatalogItem | undefined;
    if (p.imagined) {
      if (brief.source !== "practice") continue;
      const icon = p.icon && (ART_ICONS as readonly string[]).includes(p.icon) ? p.icon : "package";
      [item] = await tx<CatalogItem[]>`
        insert into armada.catalog_items
          (workspace_id, source, source_id, title, description, category, images, cost_cents, ship_cents,
           ship_days_min, ship_days_max, stock, attributes)
        values (${shop.workspaceId}, 'practice', ${"imagined-" + crypto.randomUUID()}, ${p.title}, ${p.description},
                ${p.imagined.category}, '[]', ${p.imagined.costCents}, ${IMAGINED_ITEM.shipCents},
                ${IMAGINED_ITEM.shipDaysMin}, ${IMAGINED_ITEM.shipDaysMax}, ${IMAGINED_ITEM.stock},
                ${tx.json({ imagined: true, art: { icon, tone: "accent" } } as never)})
        returning ${tx.unsafe(CATALOG_COLS)}`;
    } else if (p.catalogItemId) {
      item = byId.get(p.catalogItemId);
    }
    if (!item) continue;
    const { priceCents, shipCents, score, parts } = scoreCatalogItem(item, brief.priceFeel);
    const [product] = await tx<{ id: string }[]>`
      insert into armada.products
        (workspace_id, catalog_item_id, title, description, bullets, images, category, cost_cents, ship_cents,
         seo_title, seo_description, score, score_parts)
      values (${shop.workspaceId}, ${item.id}, ${p.title}, ${p.description}, ${tx.json(p.bullets as never)},
              ${tx.json(item.images as never)}, ${item.category}, ${item.costCents}, ${shipCents},
              ${p.seoTitle}, ${p.seoDescription}, ${score}, ${tx.json(parts as never)})
      returning id`;
    const col = collections.find((c) => c.handle === p.collection) ?? collections[0];
    col?.productIds.push(product.id);
    products.push({ productId: product.id, handle: uniqueHandle(p.title, handles), collection: col?.handle ?? "", priceCents, imagined: Boolean(p.imagined) });
    used.push(item);
  }

  const next: Blueprint = { ...blueprint, products, collections: collections.filter((c) => c.productIds.length > 0), choice };
  delete next.proposals;
  delete next.candidateIds;

  if (!products.length) {
    await saveBlueprint(tx, shop.id, next);
    await failShop(tx, shop, "choose", "None of the chosen products could be added. Build the shop again.");
    return;
  }

  if (brief.source === "cj") {
    if (products.length < MIN_CJ_PRODUCTS) {
      await saveBlueprint(tx, shop.id, next);
      await failShop(tx, shop, "choose", `Only ${nProducts(products.length)} from CJ could be added, and a shop needs at least ${MIN_CJ_PRODUCTS}. Try a broader idea.`);
      return;
    }
    // Prices wait until CJ confirms each chosen product's real cost and shipping.
    await saveBlueprint(tx, shop.id, next, "building");
    await setStep(tx, shop.id, "check", "running", `Checking real shipping costs and times for ${nProducts(products.length)} with CJ`);
    defer(() => cjCheckChosen(shop.workspaceId, shop.id));
    return;
  }

  const mins = used.map((i) => i.shipDaysMin).filter((n): n is number => n != null);
  const maxs = used.map((i) => i.shipDaysMax).filter((n): n is number => n != null);
  next.facts = {
    country: brief.country,
    deliveryMin: mins.length ? Math.min(...mins) : 7,
    deliveryMax: maxs.length ? Math.max(...maxs) : 15,
    handlingDays: HANDLING_DAYS,
    ...returnTerms(brief.priceFeel),
  };
  await saveBlueprint(tx, shop.id, next, "building");
  await setStep(tx, shop.id, "pages", "running");
  await enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: "shop.pages",
    input: { system: withCraft(SYSTEM, ["conversion"]), prompt: pagesPrompt(next, await productList(tx, next)), schema: pagesSchema as never, timeoutMs: TIMEOUTS.pages },
    parent: { type: "shop", id: shop.id },
  });
}

export type ChooseResult = { ok: true } | { ok: false; problem: string };

/**
 * The owner's choice: exactly the shop's count of the proposed products, or the AI's own top ones.
 * Then the build carries on by itself. A second press (or a shop no longer waiting) changes nothing.
 * Slow follow-up work (CJ's shipping check) is handed to `defer` once the choice is saved.
 */
export async function chooseShopProducts(
  workspaceId: string,
  shopId: string,
  pick: { ai: true } | { ids: unknown[] },
  defer: (work: Deferred) => void,
): Promise<ChooseResult> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return { ok: false, problem: "This shop isn't here any more." };
  const deferred: Deferred[] = [];
  const result = await withWorkspace(workspaceId, async (tx): Promise<ChooseResult> => {
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId} for update`;
    if (!shop) return { ok: false, problem: "This shop isn't here any more." };
    if (shop.status !== "choosing") return { ok: true };
    const proposals = shop.blueprint.proposals ?? [];
    const need = chooseCount(shop.brief.productCount, proposals.length);
    const checked = "ai" in pick ? ({ ok: true, ids: aiPicks(proposals, need) } as const) : checkChoice(proposals, pick.ids, need);
    if (!checked.ok) return checked;
    const picked = new Set(checked.ids);
    // The shop lists them in the AI's order, best fit first.
    const chosen = proposals.filter((p) => picked.has(p.id)).sort((a, b) => a.rank - b.rank);
    const by = "ai" in pick ? "ai" : "you";
    await setStep(
      tx,
      shop.id,
      "choose",
      "done",
      by === "ai" ? `The AI picked ${chosen.length} of the ${proposals.length}` : `You chose ${chosen.length} of the ${proposals.length}`,
    );
    await buildWithChosen(tx, shop, shop.blueprint, chosen, { offered: proposals.length, chosen: chosen.length, by }, (w) => deferred.push(w));
    return { ok: true };
  });
  for (const work of deferred) defer(work);
  return result;
}

/** The shop's products by handle, for the pages step to make sets and pairs from. */
async function productList(tx: Tx, bp: Blueprint): Promise<{ handle: string; title: string; collection: string }[]> {
  const refs = bp.products ?? [];
  if (!refs.length) return [];
  const rows = await tx<{ id: string; title: string }[]>`select id, title from armada.products where id in ${tx(refs.map((r) => r.productId))}`;
  const title = new Map(rows.map((r) => [r.id, r.title]));
  const collection = new Map((bp.collections ?? []).map((c) => [c.handle, c.title]));
  return refs.map((r) => ({ handle: r.handle, title: title.get(r.productId) ?? r.handle, collection: collection.get(r.collection) ?? "" }));
}

async function afterPages(tx: Tx, shop: ShopRow, output: unknown) {
  const p = Pages.parse(output);
  const blueprint: Blueprint = {
    ...shop.blueprint,
    pages: { about: p.about, faq: p.faq, shipping: p.shippingPage, contact: p.contactPage },
    policies: { refund: p.refundPolicy, shipping: p.shippingPolicy },
    announcement: p.announcement,
    footerBlurb: p.footerBlurb,
    seo: { title: p.seoTitle, description: p.seoDescription },
    // Sets and pairs, checked against the shop's own products and priced by the rules.
    ...readSetsAndPairings({ sets: p.sets, pairings: p.pairings }, shop.blueprint.products ?? [], shop.brief.priceFeel === "luxury" ? "whole" : "cents"),
  };
  await saveBlueprint(tx, shop.id, blueprint, "ready");
  await setStep(tx, shop.id, "pages", "done");
  // Brand pictures, made with ChatGPT once the collections are final (the new blueprint, not the old one).
  await startShopImages(tx, { ...shop, blueprint });
}

// ---------- the CJ path: real products, real shipping ----------

/**
 * Locks the shop and confirms it's still being built, as the last step before a CJ step writes its
 * result. A build that was stopped, finished or picked up elsewhere meanwhile is left alone.
 */
async function stillBuilding(tx: Tx, shopId: string): Promise<boolean> {
  const [s] = await tx<{ status: string }[]>`select status from armada.shops where id = ${shopId} for update`;
  return s?.status === "building";
}

async function loadBuildingShop(workspaceId: string, shopId: string): Promise<ShopRow | null> {
  const rows = await withWorkspace(workspaceId, (tx) => tx<ShopRow[]>`select * from armada.shops where id = ${shopId}`);
  return rows[0] && rows[0].status === "building" ? rows[0] : null;
}

/** Searches CJ with the AI's search terms, then hands the real candidates to the AI to propose from. */
async function cjCandidates(workspaceId: string, shopId: string) {
  const shop = await loadBuildingShop(workspaceId, shopId);
  if (!shop) return;
  const bp = shop.blueprint;
  const phrases = [...(bp.searchTerms ?? []), ...(bp.collections ?? []).flatMap((c) => c.keywords)];
  let items: CatalogItem[];
  try {
    items = await importCjSearch(workspaceId, phrases, { maxPhrases: 6, perPhrase: 20 });
  } catch (e) {
    await withWorkspace(workspaceId, (tx) => failShop(tx, shop, "products", describeCjError(e)));
    return;
  }
  const candidates = items.filter((i) => !i.branded).slice(0, 60);
  await withWorkspace(workspaceId, async (tx) => {
    if (!(await stillBuilding(tx, shop.id))) return;
    if (candidates.length < MIN_CJ_PRODUCTS) {
      await failShop(
        tx,
        shop,
        "products",
        candidates.length
          ? `CJ only had ${nProducts(candidates.length)} for this idea, and a shop needs at least ${MIN_CJ_PRODUCTS}. Try a broader idea, in plainer words.`
          : "CJ had nothing for this idea. Try describing what the shop sells in plainer words.",
      );
      return;
    }
    const next: Blueprint = { ...bp, candidateCount: candidates.length, candidateIds: candidates.map((i) => i.id) };
    await saveBlueprint(tx, shop.id, next);
    await setStep(tx, shop.id, "products", "running", `${nProducts(candidates.length)} from CJ to choose from`);
    await enqueueProducts(tx, shop, next, candidates, false);
  });
}

/**
 * Checks every chosen product with CJ (photos, variants, real shipping to the shop's country),
 * then sets prices from the confirmed costs and writes delivery facts for the pages step.
 * A product CJ can't price is left out rather than guessed.
 */
async function cjCheckChosen(workspaceId: string, shopId: string) {
  const shop = await loadBuildingShop(workspaceId, shopId);
  if (!shop) return;
  const bp = shop.blueprint;
  const country = knownCountryCode(shop.brief.country);
  if (!country) {
    await withWorkspace(workspaceId, (tx) => failShop(tx, shop, "check", `Armada doesn't know “${shop.brief.country}” as a country, so it can't get real shipping quotes. Build it again with the country's full name.`));
    return;
  }
  const refs = bp.products ?? [];
  const links = refs.length
    ? await withWorkspace(
        workspaceId,
        (tx) => tx<{ id: string; catalogItemId: string }[]>`select id, catalog_item_id from armada.products where id in ${tx(refs.map((r) => r.productId))}`,
      )
    : [];
  const catalogFor = new Map(links.map((l) => [l.id, l.catalogItemId]));

  const checked = new Map<string, CatalogItem>();
  let lastError: unknown = null;
  for (const [n, ref] of refs.entries()) {
    const catalogId = catalogFor.get(ref.productId);
    if (!catalogId) continue;
    try {
      const item = await checkCjItem(workspaceId, catalogId, country);
      if (item.shipDaysMax != null && !item.branded) checked.set(ref.productId, item);
    } catch (e) {
      lastError = e;
      if (isFatalCjError(e)) break;
    }
    // Progress on screen, and a fresh timestamp so the stall check below leaves a live run alone.
    await withWorkspace(workspaceId, (tx) => setStep(tx, shopId, "check", "running", `Checked ${n + 1} of ${refs.length} products with CJ`));
  }

  await withWorkspace(workspaceId, async (tx) => {
    if (!(await stillBuilding(tx, shop.id))) return;
    // A build started before the choosing step existed checked shipping inside its products step.
    const [now] = await tx<{ progress: ProgressStep[] }[]>`select progress from armada.shops where id = ${shop.id}`;
    if (now.progress.find((s) => s.key === "products")?.state === "running") await setStep(tx, shop.id, "products", "done");
    if (!now.progress.some((s) => s.key === "choose")) await setStep(tx, shop.id, "choose", "done", "Chosen by the AI");

    if (checked.size < MIN_CJ_PRODUCTS) {
      await failShop(
        tx,
        shop,
        "check",
        lastError
          ? describeCjError(lastError)
          : `CJ could confirm shipping for only ${nProducts(checked.size)}, and a shop needs at least ${MIN_CJ_PRODUCTS}. Try the build again, or a broader idea.`,
      );
      return;
    }
    const kept: NonNullable<Blueprint["products"]> = [];
    for (const ref of refs) {
      const item = checked.get(ref.productId);
      if (!item) continue;
      const { priceCents, score, parts } = scoreCatalogItem(item, shop.brief.priceFeel);
      await tx`
        update armada.products set cost_cents = ${item.costCents}, ship_cents = ${item.shipCents}, images = ${tx.json(item.images as never)},
          category = ${item.category}, score = ${score}, score_parts = ${tx.json(parts as never)}, updated_at = now()
        where id = ${ref.productId}`;
      kept.push({ ...ref, priceCents });
    }
    const keptIds = new Set(kept.map((k) => k.productId));
    const items = [...checked.values()];
    const next: Blueprint = {
      ...bp,
      products: kept,
      collections: (bp.collections ?? [])
        .map((c) => ({ ...c, productIds: c.productIds.filter((id) => keptIds.has(id)) }))
        .filter((c) => c.productIds.length > 0),
      facts: {
        country: shop.brief.country,
        deliveryMin: Math.min(...items.map((i) => i.shipDaysMin ?? i.shipDaysMax ?? 7)),
        deliveryMax: Math.max(...items.map((i) => i.shipDaysMax ?? 15)),
        handlingDays: HANDLING_DAYS,
        ...returnTerms(shop.brief.priceFeel),
      },
    };
    await saveBlueprint(tx, shop.id, next);
    const dropped = refs.length - kept.length;
    await setStep(
      tx,
      shop.id,
      "check",
      "done",
      `${nProducts(kept.length)} with shipping confirmed by CJ${dropped ? `. ${dropped} left out because CJ couldn't confirm ${dropped === 1 ? "it" : "them"}` : ""}`,
    );
    await setStep(tx, shop.id, "pages", "running");
    await enqueueJob(tx, {
      workspaceId,
      kind: "shop.pages",
      input: { system: withCraft(SYSTEM, ["conversion"]), prompt: pagesPrompt(next, await productList(tx, next)), schema: pagesSchema as never, timeoutMs: TIMEOUTS.pages },
      parent: { type: "shop", id: shop.id },
    });
  });
}

/**
 * The CJ steps run after a response, so a server cut-off can stop one halfway. Any CJ build whose
 * search or shipping check has sat still for six minutes with no AI job pending is picked up again.
 * Both steps are safe to repeat: checked products are remembered and the search only refreshes the
 * catalog. A shop waiting for its owner to choose is never picked up: its status is 'choosing', and
 * stalledCjStep says no to anything waiting on a person even if that ever changed.
 * Called from the AI helper's poll, which runs every few seconds while the helper is on.
 */
export async function resumeStalledCjBuilds(): Promise<void> {
  const quiet = await asSystem(
    (tx) => tx<{ id: string; workspaceId: string; status: string; brief: ShopBrief; progress: ProgressStep[]; hasProducts: boolean }[]>`
      update armada.shops s set updated_at = now()
      where s.status = 'building' and s.brief ->> 'source' = 'cj' and s.updated_at < now() - interval '6 minutes'
        and exists (select 1 from jsonb_array_elements(s.progress) p where p ->> 'key' in ('products', 'check') and p ->> 'state' = 'running')
        and not exists (select 1 from jsonb_array_elements(s.progress) p where p ->> 'state' = 'needs-you')
        and not exists (select 1 from armada.ai_jobs j where j.parent_type = 'shop' and j.parent_id = s.id and j.status in ('queued', 'running'))
      returning s.id, s.workspace_id, s.status, s.brief, s.progress, (s.blueprint ? 'products') as has_products`,
  );
  for (const s of quiet) {
    const step = stalledCjStep(s);
    if (!step) continue;
    try {
      await (step === "check" ? cjCheckChosen(s.workspaceId, s.id) : cjCandidates(s.workspaceId, s.id));
    } catch (e) {
      console.error("resuming CJ build failed", s.id, e);
    }
  }
}

onJobFinished("shop", async (tx: Tx, job: AiJob, defer) => {
  if (job.parentType !== "shop" || !job.parentId) return;
  const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${job.parentId}`;
  if (!shop || shop.status !== "building") return;
  const step = job.kind.split(".")[1] as StepKey;
  if (job.status === "failed") {
    await failShop(tx, shop, step, "The AI couldn't finish this step, even on a second try. Start the build again.");
    return;
  }
  try {
    if (step === "concept") await afterConcept(tx, shop, job.output, defer);
    else if (step === "products") await afterProducts(tx, shop, job.output, defer);
    else if (step === "pages") await afterPages(tx, shop, job.output);
  } catch (e) {
    console.error("shop step failed", step, shop.id, e);
    await failShop(tx, shop, step, "The AI's answer came back in the wrong shape. Start the build again.");
  }
});

export function shopHandle(title: string): string {
  return slugify(title);
}
