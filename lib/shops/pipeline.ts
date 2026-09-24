import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { enqueueJob, onJobFinished } from "@/lib/ai/jobs";
import { fixPalette } from "@/lib/color";
import { searchCatalog } from "@/lib/catalog/search";
import { retailPrice } from "@/lib/pricing";
import { scoreProduct } from "@/lib/score";
import { clip, randomSlug, slugify, uniqueHandle } from "@/lib/text";
import type { AiJob, CatalogItem } from "@/lib/types";
import { SYSTEM, conceptPrompt, conceptSchema, pagesPrompt, pagesSchema, productsPrompt, productsSchema } from "./prompts";
import { ART_ICONS, BODY_FONTS, DISPLAY_FONTS } from "./style";
import type { Blueprint, ProgressStep, ShopBrief, ShopRow, StepKey } from "./types";

// A shop is built in three AI steps. Each finished step starts the next one, so the build
// needs no background worker: the AI helper's hand-back drives it forward.

const STEPS: { key: StepKey; label: string }[] = [
  { key: "concept", label: "Brand, look and plan" },
  { key: "products", label: "Choosing and writing products" },
  { key: "pages", label: "Pages and policies" },
];

const TIMEOUTS: Record<StepKey, number> = { concept: 180_000, products: 360_000, pages: 240_000 };

const HANDLING_DAYS = 2;
const RETURN_DAYS = 30;

export async function startShopBuild(tx: Tx, workspaceId: string, brief: ShopBrief): Promise<{ id: string; slug: string }> {
  const slug = randomSlug(10);
  const progress: ProgressStep[] = STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
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
    input: { system: SYSTEM, prompt: conceptPrompt(brief), schema: conceptSchema as never, timeoutMs: TIMEOUTS.concept },
    parent: { type: "shop", id: shop.id },
  });
  return { id: shop.id, slug };
}

// Lenient readers for AI output: trim, cap lengths, and fall back rather than fail on style.
const text = (max: number) => z.string().transform((s) => clip(s, max));
const longText = (max: number) => z.string().transform((s) => s.trim().slice(0, max));

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

const ProductOut = z.object({
  candidateId: z.string(),
  collection: z.string(),
  title: text(70),
  description: longText(1200),
  bullets: z.array(text(140)).default([]),
  seoTitle: text(70),
  seoDescription: text(160),
});

const ImaginedOut = z.object({
  collection: z.string(),
  title: text(70),
  category: text(60),
  description: longText(1200),
  bullets: z.array(text(140)).default([]),
  estimatedCostUsd: z.number(),
  icon: z.string(),
});

const Products = z.object({ products: z.array(ProductOut).default([]), imagined: z.array(ImaginedOut).default([]) });

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
});

async function setStep(tx: Tx, shopId: string, key: StepKey, state: ProgressStep["state"], note?: string) {
  const [row] = await tx<{ progress: ProgressStep[] }[]>`select progress from armada.shops where id = ${shopId}`;
  const now = new Date().toISOString();
  const progress = row.progress.map((s) =>
    s.key !== key
      ? s
      : {
          ...s,
          state,
          ...(state === "running" ? { startedAt: now } : {}),
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

async function afterConcept(tx: Tx, shop: ShopRow, output: unknown) {
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
  const candidates = await searchCatalog(tx, { source: shop.brief.source, phrases, limit: 60 });
  blueprint.candidateCount = candidates.length;
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
    candidates.length ? `${candidates.length} supplier matches to choose from` : "No close supplier matches, so this practice shop gets practice items",
  );
  await enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: "shop.products",
    input: {
      system: SYSTEM,
      prompt: productsPrompt(shop.brief, blueprint, candidates, allowImagined),
      schema: productsSchema(allowImagined) as never,
      timeoutMs: TIMEOUTS.products,
    },
    parent: { type: "shop", id: shop.id },
  });
}

async function afterProducts(tx: Tx, shop: ShopRow, output: unknown) {
  const out = Products.parse(output);
  const blueprint = shop.blueprint;
  const brief = shop.brief;
  const collections = blueprint.collections ?? [];
  const collectionFor = (title: string) =>
    collections.find((c) => c.title.toLowerCase() === title.trim().toLowerCase()) ?? collections[0];

  // Only candidates that really exist are used. An id the AI made up is dropped, not trusted.
  const ids = [...new Set(out.products.map((p) => p.candidateId))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const items = ids.length
    ? await tx<CatalogItem[]>`
        select id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
               ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes
        from armada.catalog_items where id in ${tx(ids)}`
    : [];
  const byId = new Map(items.map((i) => [i.id, i]));

  type Chosen = { item: CatalogItem; copy: z.infer<typeof ProductOut> | z.infer<typeof ImaginedOut>; imagined: boolean };
  const chosen: Chosen[] = [];
  const seen = new Set<string>();
  for (const p of out.products) {
    const item = byId.get(p.candidateId);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    chosen.push({ item, copy: p, imagined: false });
  }

  if (brief.source === "practice") {
    for (const im of out.imagined.slice(0, Math.max(0, brief.productCount - chosen.length))) {
      const costCents = Math.round(Math.min(500, Math.max(1, im.estimatedCostUsd)) * 100);
      const icon = (ART_ICONS as readonly string[]).includes(im.icon) ? im.icon : "package";
      const [item] = await tx<CatalogItem[]>`
        insert into armada.catalog_items
          (workspace_id, source, source_id, title, description, category, images, cost_cents, ship_cents,
           ship_days_min, ship_days_max, stock, attributes)
        values (${shop.workspaceId}, 'practice', ${"imagined-" + crypto.randomUUID()}, ${im.title}, ${im.description},
                ${im.category}, '[]', ${costCents}, 499, 7, 14, 250,
                ${tx.json({ imagined: true, art: { icon, tone: "accent" } } as never)})
        returning id, workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
                  ship_days_min, ship_days_max, stock, rating, branded, retail_source, attributes`;
      chosen.push({ item, copy: im, imagined: true });
    }
  }

  if (!chosen.length) {
    await failShop(tx, shop, "products", "The AI didn't find products that fit this shop. Try a broader idea.");
    return;
  }

  const handles = new Set<string>();
  const products: NonNullable<Blueprint["products"]> = [];
  for (const { item, copy, imagined } of chosen.slice(0, brief.productCount)) {
    const priceCents = retailPrice(item.costCents, item.shipCents, brief.priceFeel);
    const { score, parts } = scoreProduct({
      priceCents,
      costCents: item.costCents,
      shipCents: item.shipCents,
      shipDaysMax: item.shipDaysMax,
      stock: item.stock,
      rating: item.rating != null ? Number(item.rating) : null,
      branded: item.branded,
      retailSource: item.retailSource,
      practice: item.source === "practice",
    });
    const [product] = await tx<{ id: string }[]>`
      insert into armada.products
        (workspace_id, catalog_item_id, title, description, bullets, images, category, cost_cents, ship_cents,
         seo_title, seo_description, score, score_parts)
      values (${shop.workspaceId}, ${item.id}, ${copy.title}, ${copy.description}, ${tx.json(copy.bullets as never)},
              ${tx.json(item.images as never)}, ${item.category}, ${item.costCents}, ${item.shipCents},
              ${"seoTitle" in copy ? copy.seoTitle : copy.title}, ${"seoDescription" in copy ? copy.seoDescription : null},
              ${score}, ${tx.json(parts as never)})
      returning id`;
    const col = collectionFor(copy.collection);
    col?.productIds.push(product.id);
    products.push({ productId: product.id, handle: uniqueHandle(copy.title, handles), collection: col?.handle ?? "", priceCents, imagined });
  }

  const mins = chosen.map((c) => c.item.shipDaysMin).filter((n): n is number => n != null);
  const maxs = chosen.map((c) => c.item.shipDaysMax).filter((n): n is number => n != null);
  blueprint.products = products;
  blueprint.collections = collections.filter((c) => c.productIds.length > 0);
  blueprint.facts = {
    country: brief.country,
    deliveryMin: mins.length ? Math.min(...mins) : 7,
    deliveryMax: maxs.length ? Math.max(...maxs) : 15,
    handlingDays: HANDLING_DAYS,
    returnDays: RETURN_DAYS,
  };
  await saveBlueprint(tx, shop.id, blueprint);
  await setStep(tx, shop.id, "products", "done", `${products.length} products written`);
  await setStep(tx, shop.id, "pages", "running");
  await enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: "shop.pages",
    input: { system: SYSTEM, prompt: pagesPrompt(blueprint), schema: pagesSchema as never, timeoutMs: TIMEOUTS.pages },
    parent: { type: "shop", id: shop.id },
  });
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
  };
  await saveBlueprint(tx, shop.id, blueprint, "ready");
  await setStep(tx, shop.id, "pages", "done");
}

onJobFinished("shop", async (tx: Tx, job: AiJob) => {
  if (job.parentType !== "shop" || !job.parentId) return;
  const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${job.parentId}`;
  if (!shop || shop.status !== "building") return;
  const step = job.kind.split(".")[1] as StepKey;
  if (job.status === "failed") {
    await failShop(tx, shop, step, "The AI couldn't finish this step, even on a second try. Start the build again.");
    return;
  }
  try {
    if (step === "concept") await afterConcept(tx, shop, job.output);
    else if (step === "products") await afterProducts(tx, shop, job.output);
    else if (step === "pages") await afterPages(tx, shop, job.output);
  } catch (e) {
    console.error("shop step failed", step, shop.id, e);
    await failShop(tx, shop, step, "The AI's answer came back in the wrong shape. Start the build again.");
  }
});

export function shopHandle(title: string): string {
  return slugify(title);
}
