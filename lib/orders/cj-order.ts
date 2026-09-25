import type { CjOrderInput } from "@/connectors/cj/api";
import type { ShipTo } from "@/connectors/stripe/payloads";

// The pure half of placing a storefront order with CJ: the order form from the address Stripe
// collected, and CJ's answer in plain words. Type imports only, so scripts/check-checkout.mjs loads it.

/** CJ's order number for an Armada order: unique per order, which CJ also enforces, so a repeat can't buy twice. */
export function cjOrderNumber(orderId: string): string {
  return `AR${orderId.replace(/-/g, "").toUpperCase()}`;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function cjOrderInput(orderId: string, ship: ShipTo, items: { vid: string; qty: number }[], logisticName: string): CjOrderInput {
  return {
    orderNumber: cjOrderNumber(orderId),
    shippingCountryCode: ship.country,
    shippingCountry: countryName(ship.country),
    shippingProvince: ship.state,
    shippingCity: ship.city,
    shippingZip: ship.postalCode || undefined,
    shippingAddress: ship.line1,
    shippingAddress2: ship.line2 ?? undefined,
    shippingCustomerName: ship.name,
    shippingPhone: ship.phone ?? undefined,
    email: ship.email ?? undefined,
    logisticName,
    products: items.map((i) => ({ vid: i.vid, quantity: i.qty })),
    sandbox: false,
  };
}

/** What CJ's answer means: null when the order was placed, otherwise why not, in plain words. */
export function cjAnswerProblem(r: { orderId?: unknown; interceptOrderReasons?: unknown[]; logisticsMiss?: boolean } | null): string | null {
  if (!r || typeof r.orderId !== "string" || !r.orderId) return "CJ didn't confirm the order.";
  if (r.logisticsMiss) return "CJ has no shipping route for this address.";
  if (Array.isArray(r.interceptOrderReasons) && r.interceptOrderReasons.length) {
    const first = r.interceptOrderReasons[0] as { reason?: unknown; message?: unknown } | string;
    const why = typeof first === "string" ? first : typeof first?.reason === "string" ? first.reason : typeof first?.message === "string" ? first.message : "";
    return `CJ held the order${why ? `: ${why}` : ""}.`;
  }
  return null;
}
