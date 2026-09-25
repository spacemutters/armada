import "server-only";
import { ae } from "./client";
import { parseDetail, parseFreight, parseSearch, type AeDetail, type AeFreight, type AeSearchItem } from "./parse";

// AliExpress's dropshipping calls. Each sends one request through the account's speed lane and reads
// the answer with connectors/aliexpress/parse.ts.

export { pickFreight, type AeDetail, type AeFreight, type AeSearchItem } from "./parse";

export async function searchProducts(workspaceId: string, keyword: string, opts: { country?: string; pageSize?: number } = {}): Promise<AeSearchItem[]> {
  return parseSearch(
    await ae(workspaceId, "aliexpress.ds.text.search", {
      keyWord: keyword,
      local: "en_US",
      countryCode: opts.country ?? "US",
      currency: "USD",
      pageIndex: 1,
      pageSize: Math.min(50, opts.pageSize ?? 20),
    }),
  );
}

export async function productDetail(workspaceId: string, productId: string, country = "US"): Promise<AeDetail> {
  return parseDetail(await ae(workspaceId, "aliexpress.ds.product.get", { product_id: productId, ship_to_country: country, target_currency: "USD", target_language: "en" }));
}

/** Shipping options for one unit to `country`, cheapest first; [] when AliExpress gives no quote. */
export async function freightOptions(workspaceId: string, productId: string, skuId: string | null, country = "US"): Promise<AeFreight[]> {
  return parseFreight(
    await ae(workspaceId, "aliexpress.ds.freight.query", {
      queryDeliveryReq: JSON.stringify({
        quantity: 1,
        shipToCountry: country,
        productId,
        ...(skuId ? { selectedSkuId: skuId } : {}),
        language: "en_US",
        currency: "USD",
        locale: "en_US",
      }),
    }),
  );
}
