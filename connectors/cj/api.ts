import "server-only";
import { cj } from "./client";

// CJ's product, shipping and order calls, turned into the plain shapes Armada uses.
// Field names follow CJ's API v2 documentation.

export interface CjListProduct {
  id: string;
  nameEn: string;
  sku: string;
  bigImage: string;
  sellPrice: string;
  listedNum?: number;
  warehouseInventoryNum?: number;
  threeCategoryName?: string;
  oneCategoryName?: string;
  description?: string;
  deliveryCycle?: string;
  addMarkStatus?: number;
  supplierName?: string;
}

export interface CjVariant {
  vid: string;
  variantSku: string;
  variantNameEn?: string;
  variantImage?: string;
  variantKey?: string;
  variantSellPrice?: number | string;
  variantWeight?: number;
}

export interface CjProductDetail {
  pid: string;
  productNameEn: string;
  productSku: string;
  bigImage?: string;
  // The docs say string[], but CJ's own examples also show JSON text; listOf() takes either.
  productImageSet?: string[] | string;
  productWeight?: number | string;
  categoryName?: string;
  materialNameEnSet?: string[];
  packingNameEnSet?: string[];
  materialNameEn?: string;
  packingNameEn?: string;
  productKeyEn?: string;
  description?: string;
  sellPrice?: string;
  suggestSellPrice?: string;
  listedNum?: number;
  variants?: CjVariant[];
}

export interface FreightOption {
  name: string;
  priceCents: number;
  daysMin: number | null;
  daysMax: number | null;
}

/** "8.13-8.62" or "8.13" → the higher number, in cents. Costs are judged on the dearer end. */
export function priceToCents(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const nums = String(value)
    .split(/[-~]/)
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
  return nums.length ? Math.round(Math.max(...nums) * 100) : null;
}

/** CJ descriptions are HTML with images; keep only readable text. */
export function plainText(html: string | undefined, max = 1500): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}

/** A list CJ may send as an array, JSON text ("[\"a\",\"b\"]") or comma-separated text. Blanks dropped. */
export function listOf(value: string[] | string | undefined | null): string[] {
  if (!value) return [];
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else {
    const text = value.trim();
    try {
      const parsed = JSON.parse(text);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      items = text.split(",");
    }
  }
  return items.map((s) => String(s ?? "").trim()).filter(Boolean);
}

/** A number CJ may send as text or a range ("1500.0", "120-180"): the highest value. */
export function numberOf(value: number | string | undefined | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const nums = String(value ?? "")
    .split(/[-~]/)
    .map((s) => Number.parseFloat(s))
    .filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) : null;
}

export function parseDays(aging: string | undefined): { min: number | null; max: number | null } {
  const nums = (aging ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (!nums.length) return { min: null, max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Product search. CJ nests results as data.content[].productList; accept a flat list too. */
export async function searchProducts(
  workspaceId: string,
  opts: { keyword: string; page?: number; size?: number; countryCode?: string },
): Promise<CjListProduct[]> {
  // Category names only come back when asked for with enable_category.
  const data = await cj<{ content?: ({ productList?: CjListProduct[] } | CjListProduct)[] }>(workspaceId, "GET", "/product/listV2", {
    query: {
      keyWord: opts.keyword,
      page: opts.page ?? 1,
      size: Math.min(100, opts.size ?? 20),
      countryCode: opts.countryCode,
      features: ["enable_description", "enable_category"],
    },
  });
  const content = data?.content ?? [];
  return content.flatMap((c) => ("productList" in c && Array.isArray(c.productList) ? c.productList : "id" in c ? [c as CjListProduct] : []));
}

export async function productDetail(workspaceId: string, pid: string): Promise<CjProductDetail> {
  return cj<CjProductDetail>(workspaceId, "GET", "/product/query", { query: { pid } });
}

/** Shipping options for one unit of a variant. Cheapest first. */
export async function freightOptions(workspaceId: string, vid: string, to: string, from = "CN"): Promise<FreightOption[]> {
  const data = await cj<
    { logisticName: string; logisticPrice: number; logisticAging: string; totalPostageFee?: number; taxesFee?: number; clearanceOperationFee?: number }[]
  >(workspaceId, "POST", "/logistic/freightCalculate", {
    body: { startCountryCode: from, endCountryCode: to, products: [{ quantity: 1, vid }] },
  });
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return (data ?? [])
    .map((o) => {
      const d = parseDays(o.logisticAging);
      // CJ also lists taxes, customs clearance and a total. Whether the total already includes the
      // taxes isn't documented, so take whichever is higher: shipping is never understated.
      const cost = Math.max(num(o.logisticPrice) + num(o.taxesFee) + num(o.clearanceOperationFee), num(o.totalPostageFee));
      return { name: o.logisticName, priceCents: Math.round(cost * 100), daysMin: d.min, daysMax: d.max };
    })
    .filter((o) => Number.isFinite(o.priceCents))
    .sort((a, b) => a.priceCents - b.priceCents);
}

/** The option Armada uses by default: the cheapest that arrives within two weeks, else the cheapest. */
export function pickFreight(options: FreightOption[]): FreightOption | null {
  return options.find((o) => o.daysMax !== null && o.daysMax <= 14) ?? options[0] ?? null;
}

export interface CjOrderInput {
  orderNumber: string;
  shippingCountryCode: string;
  shippingCountry: string;
  shippingProvince: string;
  shippingCity: string;
  shippingZip?: string;
  shippingAddress: string;
  shippingAddress2?: string;
  shippingCustomerName: string;
  shippingPhone?: string;
  email?: string;
  logisticName: string;
  fromCountryCode?: string;
  products: { vid: string; quantity: number; storeLineItemId?: string }[];
  sandbox: boolean;
}

/**
 * Places an order with CJ, paid from the CJ balance. `orderNumber` must be unique per sale, which
 * CJ also enforces, so a repeat can't create a second order. Sandbox orders cost nothing.
 */
export async function createOrder(
  workspaceId: string,
  o: CjOrderInput,
): Promise<{ orderId: string; orderStatus?: string; actualPayment?: number | string; interceptOrderReasons?: unknown[]; logisticsMiss?: boolean }> {
  // Never re-sent after a timeout: the first attempt may have placed (and paid for) the order.
  // The caller looks the order up by orderNumber instead, and treats intercept reasons or a
  // missing shipping method as not placed.
  return cj(workspaceId, "POST", "/shopping/order/createOrderV2", {
    retryTimeouts: false,
    body: {
      orderNumber: o.orderNumber,
      shippingCountryCode: o.shippingCountryCode,
      shippingCountry: o.shippingCountry,
      shippingProvince: o.shippingProvince,
      shippingCity: o.shippingCity,
      shippingZip: o.shippingZip,
      shippingAddress: o.shippingAddress,
      shippingAddress2: o.shippingAddress2,
      shippingCustomerName: o.shippingCustomerName,
      shippingPhone: o.shippingPhone,
      email: o.email,
      logisticName: o.logisticName,
      fromCountryCode: o.fromCountryCode ?? "CN",
      payType: 2,
      isSandbox: o.sandbox ? 1 : 0,
      products: o.products,
    },
  });
}

export async function trackInfo(workspaceId: string, trackingNumbers: string[]) {
  return cj<{ trackingNumber: string; trackingStatus: string; logisticName: string; deliveryDay?: string; lastTrackNumber?: string }[]>(
    workspaceId,
    "GET",
    "/logistic/trackInfo",
    { query: { trackNumber: trackingNumbers } },
  );
}
