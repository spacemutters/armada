"use client";

import { useEffect, useRef, useState } from "react";
import { RollingNumber, useGlide } from "@/components/fx";
import { REDUCE, useInView, useMedia, usePageVisible } from "./runtime";
import { INCOMING, ORDERS, ORDER_STATE, money, type SampleOrder } from "./sample";

/*
 * One orders inbox for every store. While it is on screen, four new orders arrive one at a time at
 * the top (each row opens its own space, so nothing below jumps), and the tab counts roll. It stops
 * after the fourth, and never runs offscreen, in a hidden tab, or under reduced motion.
 */

type Tab = "needs" | "new" | "ordered" | "shipped";
// The app's own tabs, in its order ("Done" is left out here).
const TABS: { key: Tab; label: string; test: (o: SampleOrder) => boolean }[] = [
  { key: "needs", label: "Needs you", test: (o) => o.state === "problem" },
  { key: "new", label: "New", test: (o) => o.state === "new" },
  { key: "ordered", label: "With the supplier", test: (o) => o.state === "ordered" },
  { key: "shipped", label: "Shipped", test: (o) => o.state === "shipped" },
];

export function OrdersDemo() {
  const reduce = useMedia(REDUCE);
  const visible = usePageVisible();
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useInView(box, { once: false, threshold: 0.4 });
  const [orders, setOrders] = useState<SampleOrder[]>(ORDERS);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const arrived = useRef(0);

  useEffect(() => {
    if (reduce || !visible || !onScreen || arrived.current >= INCOMING.length) return;
    const id = window.setInterval(() => {
      const next = INCOMING[arrived.current];
      if (!next) return window.clearInterval(id);
      arrived.current += 1;
      setFresh(next.id);
      setOrders((list) => [next, ...list]);
    }, 3200);
    return () => window.clearInterval(id);
  }, [reduce, visible, onScreen]);

  const tabs = useGlide<HTMLDivElement>(tab, { stretch: true, duration: 320 });
  const shown = orders.filter(TABS.find((t) => t.key === tab)!.test);

  return (
    <div ref={box} className="mk-panel mk-orders-panel">
      <div className="mk-panel-bar">
        <span className="mk-panel-title">Orders</span>
        <span className="mk-chip">Example</span>
        <span className="mk-panel-meta">Every store, one inbox</span>
      </div>
      <div ref={tabs} className="mk-tabs mk-glide" role="group" aria-label="Show orders">
        <span data-glide-ind="" aria-hidden className="mk-tabs-ind" />
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            data-glide-key={t.key}
            data-glide-on={tab === t.key ? "" : undefined}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="mk-num mk-muted">
              <RollingNumber value={orders.filter(t.test).length} />
            </span>
          </button>
        ))}
      </div>
      <ul className="mk-orders" aria-label="Orders, newest first">
        {shown.map((o) => (
          <li key={o.id} data-fresh={o.id === fresh ? "" : undefined} data-state={o.state}>
            <div className="mk-order">
              <span className="mk-order-tile" data-platform={o.platform} aria-hidden />
              <span className="mk-order-what">
                <span className="mk-order-item">{o.item}</span>
                <span className="mk-muted">
                  {o.store} · {o.platform === "ebay" ? "eBay" : "Shopify"}
                </span>
              </span>
              <span className="mk-order-amt mk-num">{money(o.cents)}</span>
              <span className="mk-pill mk-pill-sm" data-tone={o.state === "problem" ? "attention" : o.state === "shipped" ? "ok" : "working-still"}>
                <span className="mk-pill-mark" aria-hidden />
                {ORDER_STATE[o.state]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
