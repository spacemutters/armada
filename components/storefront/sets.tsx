"use client";

import { useState } from "react";
import { addToBag, type BagLine } from "./cart-store";
import { countVisit } from "./visit";

type Line = Omit<BagLine, "qty">;

/**
 * One press puts several products in the bag: a set, or a product with the one that goes with it.
 * The bag then shows the set's price on its own (bagSetSavings); nothing here says anything the
 * shop's own prices don't.
 */
export function AddTogether({ slug, lines, label, doneLabel = "Added to your bag", ghost = false }: { slug: string; lines: Line[]; label: string; doneLabel?: string; ghost?: boolean }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className={ghost ? "sf-button sf-button-ghost" : "sf-button"}
      onClick={() => {
        for (const l of lines) addToBag(slug, l);
        countVisit(slug, "add");
        setAdded(true);
        setTimeout(() => setAdded(false), 1600);
      }}
    >
      {added ? doneLabel : label}
    </button>
  );
}
