// Offline checks for the AliExpress supplier connection. No network, no account.
//
//   node scripts/check-aliexpress.mjs
//
// 1. Signing: parameters sorted by name and joined as name+value, system calls prefixed with their
//    path, HMAC-SHA256 with the app secret, upper-case hex. Checked against an independent
//    computation here, and the request address carries exactly the signed parameters.
// 2. Unwrapping: the answer shapes confirmed live (text.search's "<method>_response" with code "00",
//    product.get's rsp_code "200", resp_result/resp_code) come out as their payload; error answers
//    throw with AliExpress's own words.
// 3. Reading: search results, product details and shipping quotes become Armada's shapes, with
//    prices in cents, ratings on a 5-point scale and junk dropped.
//
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";

// The app's files import each other without ".ts" (the bundler adds it); do the same here.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}

const sign = await import("../connectors/aliexpress/sign.ts");
const parse = await import("../connectors/aliexpress/parse.ts");

// ---- 1. Signing ----
{
  const params = { method: "aliexpress.ds.product.get", app_key: "12345", timestamp: 1700000000000, sign_method: "sha256", product_id: "1005001", simplify: true };
  const expectedString = "app_key12345methodaliexpress.ds.product.getproduct_id1005001sign_methodsha256simplifytruetimestamp1700000000000";
  report(sign.signString(params) === expectedString, "business call: sorted name+value string");
  const expected = createHmac("sha256", "secret").update(expectedString, "utf8").digest("hex").toUpperCase();
  report(sign.sign("secret", params) === expected, "business call: HMAC-SHA256, upper-case hex");

  const sys = { app_key: "12345", timestamp: 1700000000000, sign_method: "sha256", code: "abc" };
  report(sign.signString(sys, "/auth/token/create") === "/auth/token/createapp_key12345codeabcsign_methodsha256timestamp1700000000000", "system call: path goes first");

  report(sign.signString({ a: "1", b: null, c: undefined, d: "" }) === "a1d", "empty values are signed, missing ones are not");
  report(sign.signString({ B: "1", a: "2", _x: "3" }) === "B1_x3a2", "sort is by character code, as AliExpress does");

  const url = new URL(sign.requestUrl("12345", "secret", "aliexpress.ds.text.search", { keyWord: "lamp & shade" }, 1700000000000));
  report(url.origin + url.pathname === "https://api-sg.aliexpress.com/sync", "business calls go to /sync");
  const q = Object.fromEntries(url.searchParams);
  const { sign: sent, ...signed } = q;
  report(q.keyWord === "lamp & shade", "values survive the address encoding");
  report(sent === sign.sign("secret", signed), "the address carries exactly what was signed");
  report(q.method === "aliexpress.ds.text.search" && q.simplify === "true" && q.sign_method === "sha256", "method, simplify and sign_method are sent");

  const sysUrl = new URL(sign.requestUrl("12345", "secret", "/auth/token/create", { code: "abc" }, 1700000000000));
  report(sysUrl.pathname === "/rest/auth/token/create" && !sysUrl.searchParams.has("method"), "system calls go to /rest/<path> with no method");
  const { sign: sysSent, ...sysSigned } = Object.fromEntries(sysUrl.searchParams);
  report(sysSent === sign.sign("secret", sysSigned, "/auth/token/create"), "system call signature includes its path");
}

// ---- 2. Unwrapping ----
{
  const search = sign.unwrap({ aliexpress_ds_text_search_response: { code: "00", msg: "ok", data: { products: { selection_search_product: [{ itemId: "1" }] } } }, request_id: "x" });
  report(Array.isArray(parse.parseSearch(search)) && search.data !== undefined, "text.search wrapper beside a request_id");
  const detail = sign.unwrap({ aliexpress_ds_product_get_response: { rsp_code: "200", rsp_msg: "Call succeeds", result: { ae_item_base_info_dto: { subject: "X" } } } });
  report(detail.result?.ae_item_base_info_dto?.subject === "X", "product.get with rsp_code 200");
  const cat = sign.unwrap({ aliexpress_ds_category_get_response: { resp_result: { resp_code: 200, resp_msg: "ok", result: { categories: [] } } } });
  report(Array.isArray(cat.result?.categories), "resp_result with resp_code 200");

  const throws = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return e;
    }
  };
  const e1 = throws(() => sign.unwrap({ error_response: { code: "IllegalAccessToken", msg: "The specified access token is invalid" } }));
  report(e1 instanceof sign.AliexpressError && e1.code === "IllegalAccessToken" && /invalid/.test(e1.message), "error_response throws with its words");
  const e2 = throws(() => sign.unwrap({ aliexpress_ds_product_get_response: { rsp_code: "402", rsp_msg: "product not found" } }));
  report(e2 instanceof sign.AliexpressError && /not found/.test(e2.message), "rsp_code other than 200 throws");
  const e3 = throws(() => sign.unwrap({ code: "IncompleteSignature", msg: "The request signature does not conform to platform standards", request_id: "y" }));
  report(e3 instanceof sign.AliexpressError && e3.code === "IncompleteSignature", "a gateway refusal at the top level throws");
  const e4 = throws(() => sign.unwrap(null));
  report(e4 instanceof sign.AliexpressError, "an empty answer throws instead of crashing");
}

// ---- 3. Reading ----
{
  const items = parse.parseSearch({
    data: {
      products: [
        { itemId: "1005006", title: " Ceramic Pour-Over Set ", itemMainPic: "//ae01.alicdn.com/kf/a.jpg", salePrice: "12.40", targetSalePrice: "11.99", evaluateRate: "96.0%", orders: "2,340", itemUrl: "https://www.aliexpress.com/item/1005006.html" },
        { itemId: "1005007", title: "Range priced lamp", salePrice: "3.10-8.75", evaluateRate: "", orders: null },
        { itemId: "", title: "no id" },
        { itemId: "9", title: "" },
      ],
    },
  });
  report(items.length === 2, "search drops items with no id or title", `${items.length}`);
  const a = items[0];
  report(a.title === "Ceramic Pour-Over Set" && a.costCents === 1199, "search: trimmed title, target price in cents", `${a.costCents}`);
  report(a.image === "https://ae01.alicdn.com/kf/a.jpg", "search: protocol-less photo gets https");
  report(a.rating === 4.8, "search: 96% positive becomes 4.8 of 5", `${a.rating}`);
  report(a.orders === 2340, "search: '2,340' orders reads as 2340", `${a.orders}`);
  report(items[1].costCents === 875 && items[1].rating === null && items[1].orders === null, "search: a price range costs at its top; blanks stay unknown");

  const d = parse.parseDetail({
    result: {
      ae_item_base_info_dto: { subject: "Ceramic Pour-Over Set", category_id: 100, avg_evaluation_rating: "4.7", evaluation_count: "812", sales_count: "5000", detail: "<p>Hand glazed</p>" },
      ae_multimedia_info_dto: { image_urls: "https://ae01.alicdn.com/1.jpg;https://ae01.alicdn.com/2.jpg;;not-a-url" },
      ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [
        { sku_id: "A", offer_sale_price: "14.20", sku_price: "20.00", sku_attr: "14:white", sku_available_stock: 30 },
        { sku_id: "B", offer_sale_price: "12.10", sku_price: "18.00", sku_attr: "14:black", sku_available_stock: "12" },
      ] },
      logistics_info_dto: { delivery_time: 9 },
    },
  });
  report(d.title === "Ceramic Pour-Over Set" && d.images.length === 2, "detail: title and only real photo addresses");
  report(d.costCents === 1210 && d.defaultSkuId === "B", "detail: leads with the cheapest variant's sale price", `${d.costCents} ${d.defaultSkuId}`);
  report(d.skus.length === 2 && !("stock" in d.skus[0]), "detail: variants listed without internal fields");
  report(d.stock === 42 && d.rating === 4.7 && d.reviews === 812 && d.orders === 5000 && d.deliveryDays === 9, "detail: stock summed, rating, reviews, sales, delivery");
  report(d.descriptionHtml.includes("Hand glazed"), "detail: description kept");
  const empty = parse.parseDetail({});
  report(empty.costCents === null && empty.images.length === 0 && empty.stock === null, "detail: an empty answer reads as unknowns, not zeros");

  const f = parse.parseFreight({
    result: {
      delivery_options: { delivery_option_d_t_o: [
        { code: "CAINIAO_STANDARD", shipping_fee_cent: "399", min_delivery_days: 12, max_delivery_days: 20 },
        { code: "AE_PREMIUM", shipping_fee_format: "$6.50", min_delivery_days: 5, max_delivery_days: 9 },
        { code: "FREE_SLOW", free_shipping: "true", max_delivery_days: 35 },
        { code: "BROKEN" },
      ] },
    },
  });
  report(f.length === 3 && f[0].name === "FREE_SLOW" && f[0].priceCents === 0, "freight: unreadable options dropped, cheapest first");
  const pick = parse.pickFreight(f);
  report(pick?.name === "AE_PREMIUM" && pick.priceCents === 650, "freight: picks the cheapest arriving within two weeks", pick?.name);
  report(parse.pickFreight([]) === null, "freight: no options means no quote");
  report(parse.parseFreight({}).length === 0, "freight: an empty answer means no quote");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll AliExpress checks passed");
process.exit(failures ? 1 : 0);
