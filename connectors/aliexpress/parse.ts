import { cents, listOf } from "./sign";

// Reading AliExpress's dropshipping answers into the plain shapes Armada uses (pure, so tests can
// load it without the server). Field names follow the Open Platform as confirmed live by an
// open-source dashboard (nickcrane/aliexpress-dashboard): aliexpress.ds.text.search answers
// data.products[...] with itemId, title, itemMainPic, salePrice/targetSalePrice, evaluateRate,
// orders; aliexpress.ds.product.get answers ae_item_base_info_dto, ae_item_sku_info_dtos and
// ae_multimedia_info_dto (image_urls ";"-separated). The shipping quote (aliexpress.ds.freight.query)
// is from AliExpress's documentation and not yet confirmed live; its answer is read defensively and
// an unreadable one counts as "no quote".

export interface AeSearchItem {
  id: string;
  title: string;
  image: string | null;
  costCents: number | null;
  rating: number | null;
  orders: number | null;
  url: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const https = (u: unknown): string | null => {
  if (typeof u !== "string" || !u.trim()) return null;
  const s = u.trim();
  return s.startsWith("//") ? `https:${s}` : /^https?:\/\//.test(s) ? s : null;
};

/** The products in an unwrapped aliexpress.ds.text.search answer. */
export function parseSearch(r: Record<string, unknown>): AeSearchItem[] {
  const data = (r.data ?? r.result ?? {}) as Record<string, unknown>;
  return listOf<Record<string, unknown>>(data.products)
    .map((p) => {
      const rate = Number.parseFloat(String(p.evaluateRate ?? "").replace("%", ""));
      return {
        id: String(p.itemId ?? p.product_id ?? ""),
        title: String(p.title ?? p.subject ?? "").trim(),
        image: https(p.itemMainPic),
        // The price in the requested currency when given, else the sale price.
        costCents: cents(p.targetSalePrice ?? p.salePrice),
        // evaluateRate is "96.5%" positive feedback; scaled onto a 5-point rating for the score.
        rating: Number.isFinite(rate) ? Math.round((rate / 20) * 10) / 10 : null,
        orders: num(p.orders),
        url: https(p.itemUrl),
      };
    })
    .filter((p) => p.id && p.title);
}

export interface AeDetail {
  title: string;
  images: string[];
  costCents: number | null;
  defaultSkuId: string | null;
  skus: { id: string; costCents: number | null; label: string }[];
  categoryId: string | null;
  rating: number | null;
  reviews: number | null;
  orders: number | null;
  deliveryDays: number | null;
  /** The product page's description, as AliExpress's HTML. */
  descriptionHtml: string;
  /** Units in stock across all variants, when AliExpress says. */
  stock: number | null;
}

/** An unwrapped aliexpress.ds.product.get answer. */
export function parseDetail(r: Record<string, unknown>): AeDetail {
  const result = (r.result ?? r) as Record<string, unknown>;
  const base = (result.ae_item_base_info_dto ?? {}) as Record<string, unknown>;
  const media = (result.ae_multimedia_info_dto ?? {}) as Record<string, unknown>;
  const logistics = (result.logistics_info_dto ?? {}) as Record<string, unknown>;
  const skus = listOf<Record<string, unknown>>(result.ae_item_sku_info_dtos).map((s) => ({
    id: String(s.sku_id ?? s.id ?? ""),
    // offer_sale_price is what a buyer actually pays today; sku_price is the higher list price.
    costCents: cents(s.offer_sale_price ?? s.sku_price),
    label: String(s.sku_attr ?? s.id ?? "").slice(0, 120),
    stock: num(s.sku_available_stock ?? s.ipm_sku_stock),
  }));
  const images = String(media.image_urls ?? "")
    .split(";")
    .map((u) => https(u))
    .filter((u): u is string => Boolean(u))
    .slice(0, 8);
  // The cheapest variant is the one the listing leads with.
  const priced = skus.filter((s) => s.costCents !== null).sort((a, b) => (a.costCents ?? 0) - (b.costCents ?? 0));
  const lead = priced[0] ?? skus[0];
  return {
    title: String(base.subject ?? "").trim(),
    images,
    costCents: lead?.costCents ?? null,
    defaultSkuId: lead?.id || null,
    skus: skus.slice(0, 30).map(({ id, costCents, label }) => ({ id, costCents, label })),
    categoryId: base.category_id != null ? String(base.category_id) : null,
    rating: num(base.avg_evaluation_rating),
    reviews: num(base.evaluation_count),
    orders: num(base.sales_count),
    deliveryDays: num(logistics.delivery_time),
    descriptionHtml: String(base.detail ?? base.mobile_detail ?? ""),
    stock: skus.some((s) => s.stock !== null) ? skus.reduce((n, s) => n + (s.stock ?? 0), 0) : null,
  };
}

export interface AeFreight {
  name: string;
  priceCents: number;
  daysMin: number | null;
  daysMax: number | null;
}

/** Shipping options in an unwrapped aliexpress.ds.freight.query answer, cheapest first; [] when unreadable. */
export function parseFreight(r: Record<string, unknown>): AeFreight[] {
  const result = r.result as Record<string, unknown> | undefined;
  const options = listOf<Record<string, unknown>>(result?.delivery_options ?? r.delivery_options ?? result);
  return options
    .map((o) => {
      const fee = o.shipping_fee_cent != null ? num(o.shipping_fee_cent) : cents(o.shipping_fee_format ?? o.shipping_fee ?? o.freight_amount);
      const free = String(o.free_shipping ?? "").toLowerCase() === "true";
      const min = num(o.min_delivery_days ?? o.delivery_date_min);
      const max = num(o.max_delivery_days ?? o.delivery_date_max ?? o.delivery_time);
      return {
        name: String(o.code ?? o.service_name ?? o.company ?? "AliExpress shipping"),
        priceCents: free ? 0 : fee !== null ? Math.round(fee) : Number.NaN,
        daysMin: min,
        daysMax: max,
      };
    })
    .filter((o) => Number.isFinite(o.priceCents))
    .sort((a, b) => a.priceCents - b.priceCents);
}

/** Armada's default: the cheapest option arriving within two weeks, else the cheapest. */
export function pickFreight(options: AeFreight[]): AeFreight | null {
  return options.find((o) => o.daysMax !== null && o.daysMax <= 14) ?? options[0] ?? null;
}
