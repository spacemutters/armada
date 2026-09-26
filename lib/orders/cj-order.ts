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

export type SupplierState = "placed" | "shipped" | "delivered" | "cancelled";

/**
 * Where a CJ order stands, from CJ's order detail: shipped once it has a tracking number or says so,
 * delivered or cancelled when CJ says so, otherwise still placed (paid, being packed).
 */
export function cjOrderState(d: { orderStatus?: unknown; trackNumber?: unknown; logisticName?: unknown } | null): {
  state: SupplierState;
  tracking: string | null;
  carrier: string | null;
} {
  const status = String(d?.orderStatus ?? "").toUpperCase();
  const tracking = typeof d?.trackNumber === "string" && d.trackNumber.trim() ? d.trackNumber.trim() : null;
  const carrier = typeof d?.logisticName === "string" && d.logisticName.trim() ? d.logisticName.trim() : null;
  if (/CANCEL|CLOSED|REFUND/.test(status)) return { state: "cancelled", tracking, carrier };
  if (/DELIVERED|COMPLETE|FINISH/.test(status)) return { state: "delivered", tracking, carrier };
  if (/SHIPPED|SHIPPING|TRANSIT/.test(status) && !/UNSHIPPED/.test(status)) return { state: "shipped", tracking, carrier };
  if (tracking) return { state: "shipped", tracking, carrier };
  return { state: "placed", tracking: null, carrier };
}

/** An order's status from its supplier orders, or null when it shouldn't change. */
export function orderStatusFrom(states: string[]): { status: "shipped" | "delivered" | "problem"; problem?: string } | null {
  if (!states.length) return null;
  if (states.every((s) => s === "cancelled")) return { status: "problem", problem: "CJ cancelled this order. Check it in CJ." };
  if (states.every((s) => s === "delivered")) return { status: "delivered" };
  if (states.every((s) => s === "shipped" || s === "delivered")) return { status: "shipped" };
  return null;
}

/** Where a shopper follows a parcel: a tracker that reads any carrier's number. */
export const trackingUrl = (tracking: string) => `https://t.17track.net/en#nums=${encodeURIComponent(tracking)}`;

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
