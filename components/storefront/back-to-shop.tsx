"use client";

import { usePathname } from "next/navigation";

export function BackToShop() {
  const pathname = usePathname();
  const base = pathname.split("/").slice(0, 3).join("/") || "/";
  return (
    <a href={base} className="sf-button mt-10">
      Back to the shop
    </a>
  );
}
