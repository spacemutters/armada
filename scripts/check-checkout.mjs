// Offline checks for checkout on Armada's own storefronts: what a bag costs (the shop's prices, never
// the browser's), what Stripe is asked for, how a paid checkout is read back, and the CJ order it
// becomes. No network, no database.
//
//   node scripts/check-checkout.mjs
//
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function tryFile(base) {
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const p = tryFile(path.join(root, specifier.slice(2)));
      if (p) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const base = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier);
      const p = tryFile(base);
      if (p && p !== base) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

let failures = 0;
const report = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail !== undefined ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
};
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const core = await import("../lib/shops/checkout-core.ts");
const sets = await import("../lib/shops/sets.ts");
const stripe = await import("../connectors/stripe/payloads.ts");
const cj = await import("../lib/orders/cj-order.ts");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const items = [
  { handle: "mug", productId: id(1), title: "Stone mug", priceCents: 2400, image: "https://cdn.test/mug.jpg", imagined: false },
  { handle: "tray", productId: id(2), title: "Oak tray", priceCents: 3600, image: "http://insecure.test/tray.jpg", imagined: false },
  { handle: "cloth", productId: id(3), title: "Linen cloth", priceCents: 1800, image: null, imagined: false },
];
const set = { handle: "morning", title: "Morning", why: "x", productHandles: ["mug", "tray"], priceCents: 5399, separateCents: 6000 };

// ---- what a bag costs ----
{
  const plan = core.planCheckout([{ handle: "mug", qty: 2, priceCents: 1 }, { handle: "cloth", qty: 1 }], items, []);
  report(plan.ok && plan.totalCents === 2 * 2400 + 1800, "prices come from the shop, never from the browser", plan);
  report(plan.ok && plan.pay.length === 2 && plan.sold.every((s) => s.productId.startsWith("00000000")), "one line per item, sold by product");
}
{
  const plan = core.planCheckout([{ handle: "mug", qty: 50 }, { handle: "mug", qty: 3 }, { handle: "ghost", qty: 1 }, { handle: "tray", qty: -2 }, { handle: "cloth", qty: 1.9 }], items, []);
  const mug = plan.ok && plan.sold.find((s) => s.productId === id(1));
  report(mug && mug.qty === core.MAX_QTY, "a quantity is capped at 20, repeats are merged", mug);
  report(plan.ok && !plan.sold.some((s) => s.productId === id(2)) && plan.sold.find((s) => s.productId === id(3))?.qty === 1, "unknown items and bad quantities are dropped; parts of a unit round down");
}
report(!core.planCheckout([], items, []).ok && !core.planCheckout("nonsense", items, []).ok, "an empty bag can't be paid for");
{
  const sample = core.planCheckout([{ handle: "x", qty: 1 }], [{ ...items[0], handle: "x", imagined: true }], []);
  report(!sample.ok && /sample/.test(sample.problem), "a practice sample can never be bought", sample);
}
{
  const bag = [{ handle: "mug", qty: 2 }, { handle: "tray", qty: 1 }, { handle: "cloth", qty: 1 }];
  const plan = core.planCheckout(bag, items, [set]);
  const bagTotal = bag.reduce((n, l) => n + items.find((i) => i.handle === l.handle).priceCents * l.qty, 0) - sets.bagSetSavings(bag, [set]).reduce((n, s) => n + s.savingCents, 0);
  report(plan.ok && plan.totalCents === bagTotal, "a complete set costs what the bag shows", `${plan.totalCents} vs ${bagTotal}`);
  report(plan.ok && plan.pay.some((p) => p.name === "Morning set" && p.unitCents === 5399 && p.qty === 1), "the set is one line at the set's price");
  report(plan.ok && plan.pay.some((p) => p.name === "Stone mug" && p.qty === 1), "the extra mug outside the set is charged on its own");
  const soldTotal = plan.ok ? plan.sold.reduce((n, s) => n + s.unitCents * s.qty, 0) : 0;
  report(Math.abs(soldTotal - plan.totalCents) <= plan.sold.length, "what was sold adds up to what was paid (within rounding)", `${soldTotal} vs ${plan.totalCents}`);
}
{
  const many = Array.from({ length: 45 }, (_, i) => ({ handle: `h${i}`, productId: id(100 + i), title: `Item ${i}`, priceCents: 1000, image: null, imagined: false }));
  const plan = core.planCheckout(many.map((m) => ({ handle: m.handle, qty: 1 })), many, []);
  report(!plan.ok, "a bag can't hold more different items than Stripe can carry", plan.ok ? "accepted" : plan.problem);
}
{
  const sold = [{ productId: id(1), title: "a", qty: 2, unitCents: 2400 }, { productId: id(2), title: "b", qty: 1, unitCents: 3339 }];
  const back = core.readSoldMetadata({ ...core.soldMetadata(sold), l7: "not-a-uuid|1|5", l8: `${id(9)}|0|5`, armada: "shop_order" });
  report(back.length === 2 && back[0].qty === 2 && back[1].unitCents === 3339, "what was sold survives the trip through Stripe; junk is skipped", back);
}

// ---- what Stripe is asked for ----
{
  const plan = core.planCheckout([{ handle: "mug", qty: 1 }, { handle: "tray", qty: 1 }], items, []);
  const p = stripe.shopCheckoutParams({
    workspaceId: id(50), shopId: id(51), shopUrl: "https://armada.test/s/abc123", currency: "USD",
    pay: plan.pay, sold: core.soldMetadata(plan.sold), countries: core.CHECKOUT_COUNTRIES,
    shopName: "Lull Room", orderToken: "Tk_abcdefghijklmnopqrstuv",
  });
  report(p.payment_intent_data.description === "Lull Room order. Follow it at https://armada.test/s/abc123/order/Tk_abcdefghijklmnopqrstuv", "the receipt carries the link to follow the order", p.payment_intent_data.description);
  report(p.metadata.order_token === "Tk_abcdefghijklmnopqrstuv", "the order's code rides with the sale");
  report(p.mode === "payment" && JSON.stringify(p.payment_method_types) === '["card"]', "a one-off card payment, so it's paid the moment it completes");
  report(p.line_items[0].price_data.unit_amount === 2400 && p.line_items[0].price_data.currency === "usd", "amounts in cents, in dollars");
  report(JSON.stringify(p.line_items[0].price_data.product_data.images) === '["https://cdn.test/mug.jpg"]' && p.line_items[1].price_data.product_data.images === undefined, "only https pictures are sent to Stripe");
  report(p.metadata.armada === "shop_order" && p.metadata.shop_id === id(51) && typeof p.metadata.l0 === "string", "the sale is marked as a storefront order, with what was sold");
  report(p.phone_number_collection.enabled === true && p.shipping_address_collection.allowed_countries.includes("US"), "Stripe collects the address and phone the supplier needs");
  report(p.success_url === "https://armada.test/s/abc123/thanks?session={CHECKOUT_SESSION_ID}" && p.cancel_url === "https://armada.test/s/abc123/cart", "back to the shop's thank-you page, or its bag");
  report(p.shipping_options[0].shipping_rate_data.fixed_amount.amount === 0, "free shipping, as the bag says (prices include shipping)");
}

// ---- reading a paid checkout back ----
{
  const session = {
    object: "checkout.session", id: "cs_test_abc", mode: "payment", status: "complete", payment_status: "paid", livemode: false,
    amount_total: 6000, currency: "usd", metadata: { armada: "shop_order", workspace_id: id(50), shop_id: id(51), order_token: "Tk_abcdefghijklmnopqrstuv", l0: `${id(1)}|1|2400` },
    collected_information: { shipping_details: { name: "Sam Rivera", address: { line1: "1 Main St", line2: null, city: "Lakeland", state: "FL", postal_code: "33801", country: "US" } } },
    customer_details: { email: "sam@example.com", phone: "+18635550100", name: "Sam R", address: { country: "US" } },
  };
  const snap = stripe.readShopCheckout(session);
  report(snap && snap.paid && snap.shopId === id(51) && snap.amountTotal === 6000 && snap.country === "US" && !snap.livemode, "a paid storefront checkout is read back", snap);
  report(stripe.readShopCheckout({ ...session, payment_status: "unpaid" })?.paid === false, "an unpaid one isn't counted as paid");
  report(snap.orderToken === "Tk_abcdefghijklmnopqrstuv" && stripe.readShopCheckout({ ...session, metadata: { ...session.metadata, order_token: "../x" } }).orderToken === null, "the order's code is read back, and a bad one is refused");
  report(stripe.readShopCheckout({ ...session, mode: "subscription" }) === null && stripe.readShopCheckout({ ...session, metadata: { armada: "billing" } }) === null, "Armada's own plan billing is never read as a sale");
  report(stripe.readShopCheckout({ ...session, metadata: { armada: "shop_order", workspace_id: "x", shop_id: id(51) } }) === null, "a sale without a real workspace is refused");
  const ship = stripe.readShipTo(session);
  report(ship && ship.name === "Sam Rivera" && ship.city === "Lakeland" && ship.phone === "+18635550100" && ship.line2 === null, "the shipping address and phone come from Stripe", ship);
  report(stripe.readShipTo({ ...session, collected_information: null, shipping_details: null }) === null, "no address, no supplier order");

  // ---- the CJ order it becomes ----
  const order = cj.cjOrderInput("3f2a1b4c-0000-4000-8000-00000000abcd", ship, [{ vid: "V1", qty: 2 }], "CJPacket Ordinary");
  report(order.orderNumber === cj.cjOrderNumber("3f2a1b4c-0000-4000-8000-00000000abcd") && order.orderNumber.length === 34 && /^AR[0-9A-F]+$/.test(order.orderNumber), "one fixed CJ order number per Armada order", order.orderNumber);
  report(cj.cjOrderNumber(id(1)) !== cj.cjOrderNumber(id(2)), "different orders, different CJ order numbers");
  report(order.shippingCountry === "United States" && order.shippingZip === "33801" && order.products[0].quantity === 2 && order.sandbox === false, "the CJ order has the full address and quantities, for real", order);
  report(cj.cjAnswerProblem({ orderId: "CJ123" }) === null, "a confirmed CJ order is sent");
  report(/no shipping route/.test(cj.cjAnswerProblem({ orderId: "CJ1", logisticsMiss: true })), "a CJ order with no route isn't counted as sent");
  report(/held the order: address/.test(cj.cjAnswerProblem({ orderId: "CJ1", interceptOrderReasons: [{ reason: "address incomplete" }] })), "a CJ order CJ held says why");
  report(cj.cjAnswerProblem(null) !== null && cj.cjAnswerProblem({}) !== null, "no answer means not sent");
}

// ---- after the sale: where a CJ order stands ----
report(cj.cjOrderState({ orderStatus: "UNSHIPPED" }).state === "placed", "paid at CJ but not shipped is still being packed");
report(cj.cjOrderState({ orderStatus: "SHIPPED", trackNumber: " YT123 ", logisticName: "CJPacket" }).tracking === "YT123", "a shipped CJ order gives its tracking number and carrier");
report(cj.cjOrderState({ orderStatus: "UNPAID", trackNumber: "LX9" }).state === "shipped", "a tracking number means it has shipped");
report(cj.cjOrderState({ orderStatus: "DELIVERED" }).state === "delivered" && cj.cjOrderState({ orderStatus: "CANCELLED" }).state === "cancelled", "delivered and cancelled are read as such");
report(cj.cjOrderState(null).state === "placed", "no answer changes nothing");
report(cj.orderStatusFrom(["shipped", "placed"]) === null, "an order is on its way only once everything in it has shipped");
report(cj.orderStatusFrom(["shipped", "delivered"])?.status === "shipped" && cj.orderStatusFrom(["delivered", "delivered"])?.status === "delivered", "shipped, then delivered once it has all arrived");
report(cj.orderStatusFrom(["cancelled"])?.status === "problem", "a cancelled CJ order becomes a problem on the Orders page");
report(cj.trackingUrl("YT 1").startsWith("https://") && cj.trackingUrl("YT 1").endsWith("YT%201"), "the tracking link is a safe address");

// ---- wiring (read as text) ----
const webhook = read("lib/billing/webhook.ts");
report(/readShopCheckout\(obj\)[\s\S]{0,400}asSystem\(async \(tx\) => \{\s*await recordShopOrder\(tx, sale\);\s*await tx`insert into armada\.stripe_events/.test(webhook), "a paid sale and its Stripe event are saved together, once");
const checkout = read("lib/shops/checkout.ts");
report(/on conflict \(store_id, external_id\) do nothing/.test(checkout), "the same checkout can't become two orders");
report(/brief\?\.source === "practice"\) return \{ open: false, why: "practice" \}/.test(checkout), "practice shops never take payments");
report(/paymentsWorkspace\(\)\) !== workspaceId/.test(checkout), "only the workspace that connected Stripe takes payments into it");
report(/live \? "live" : "practice"/.test(checkout), "test payments land on a practice store, so they're never bought for real");
report(/confirmShopCheckout[\s\S]{0,500}snap\.shopId !== shop\.id \|\| !snap\.paid/.test(checkout), "the thank-you page only thanks for a paid checkout of this shop");
const send = read("lib/orders/send.ts");
const reserve = send.indexOf("insert into armada.supplier_orders (workspace_id, order_line_id, supplier, external_id, cost_cents, status)\n      values (${workspaceId}, ${l.id}, 'cj', null");
report(reserve > 0 && reserve < send.indexOf("await createOrder("), "each line is reserved before CJ is asked, so two presses can't buy twice");
report(/mode !== "practice" && platform !== "armada"[\s\S]{0,200}NOT_AUTOMATIC/.test(send), "other live stores say to order by hand instead of pretending");
report(!/PS-[\s\S]{0,80}'cj'|"cj" : /.test(send), "a practice number is never passed off as a CJ order");
report(/giveUp[\s\S]{0,300}delete from armada\.supplier_orders[\s\S]{0,120}external_id is null/.test(send), "a refused CJ order lets go of its reservation, so it can be sent again");
const track = read("lib/orders/track.ts");
report(/having max\(updated_at\) < now\(\) - interval '30 minutes'/.test(track), "each CJ order is checked at most every 30 minutes");
report(/case when \$\{RANK\[s\.state\]\}::int >/.test(track), "a CJ order's status never moves back");
report(/syncCjOrders\(\)/.test(read("app/api/helper/claim/route.ts")), "the helper's sweep checks CJ orders");
const orderPage = read("lib/shops/order-status.ts");
report(/ORDER_TOKEN\.test\(token\)/.test(orderPage) && /o\.lookup_token = \$\{token\} and s\.platform = 'armada' and s\.shop_id = \$\{shopId\}/.test(orderPage), "a shopper's order page needs its code, and this shop");
report(!/address|line1|email|phone/i.test(orderPage.replace(/\/\/.*$/gm, "")), "the order page never shows the address or contact details");
report(/lookup_token\)\s*values[\s\S]{0,200}snap\.orderToken/.test(checkout), "the order keeps its code");
// ---- a real shop's contact email ----
const contact = read("lib/shops/contact.ts");
report(/source === "practice"\) return \{ email: supportEmail\(shop\.blueprint\), real: false \}/.test(contact), "practice shops keep their reserved example address");
report(/if \(row\?\.supportEmail\)[\s\S]{0,120}ownerEmail/.test(contact), "real shops use the contact email from Settings, else the owner's sign-in email");
report(/if \(!\(await shopContactEmail\(shop\)\)\.real\) return \{ open: false, why: "contact" \}/.test(checkout), "a real shop takes no payment until shoppers have somewhere real to write");
for (const f of ["app/s/[slug]/pages/[page]/page.tsx", "app/s/[slug]/policies/[policy]/page.tsx"]) {
  const src = read(f);
  report(/shopContactEmail\(data\.shop\)/.test(src) && !/supportEmail\(bp\)/.test(src), `${f.split("/").slice(-3, -1).join("/")} shows the shop's real contact email`);
}
const launch = read("lib/launch/checkout.ts");
report(/if \(!contact\.real\)[\s\S]{0,300}Add a contact email[\s\S]{0,400}await openShopCheckout/.test(launch), "Launch asks for a contact email before opening checkout, and says which one shoppers see");
report(/if \(!pay\.connected\)[\s\S]{0,1000}await openShopCheckout/.test(launch), "Launch opens checkout only once payments are connected");
report(fs.existsSync(path.join(root, "supabase/migrations/0024_shop_checkout.sql")) && /'armada'/.test(read("supabase/migrations/0024_shop_checkout.sql")), "the database knows a shop's own store");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checkout checks passed");
process.exit(failures ? 1 : 0);
