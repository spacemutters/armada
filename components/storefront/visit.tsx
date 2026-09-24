"use client";

import { useEffect } from "react";

/**
 * Tells Armada a shopper saw the home page or added something to the bag, for headline tests.
 * The server decides whether it counts (a running test, a genuine visitor, not the shop's owner).
 */
export function countVisit(slug: string, kind: "view" | "add") {
  const body = JSON.stringify({ slug, kind });
  try {
    if (navigator.sendBeacon?.("/api/ab", new Blob([body], { type: "application/json" }))) return;
  } catch {
    // fall through to fetch
  }
  fetch("/api/ab", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
}

export function CountView({ slug }: { slug: string }) {
  useEffect(() => countVisit(slug, "view"), [slug]);
  return null;
}
