"use client";

import { useEffect } from "react";
import { writeBag } from "./cart-store";

/** After a paid checkout: the bag starts empty again. */
export function ClearBag({ slug }: { slug: string }) {
  useEffect(() => writeBag(slug, []), [slug]);
  return null;
}
