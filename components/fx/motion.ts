"use client";

import { useSyncExternalStore } from "react";

// Live reads of the two system settings every effect follows: reduced motion and light/dark.
// Both return the server's answer (false) during hydration, so the first client render matches
// the HTML, then update if the device says otherwise.

function media(query: string) {
  return {
    subscribe(onChange: () => void) {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    read() {
      return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
    },
  };
}

const reduce = media("(prefers-reduced-motion: reduce)");
const dark = media("(prefers-color-scheme: dark)");
const never = () => false;
const noop = () => () => {};
const yes = () => true;

/** True when the device asks for reduced motion. Effects then show a calm, still end state. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(reduce.subscribe, reduce.read, never);
}

/** True when the system is in dark mode (Armada follows the system; there is no app switch). */
export function useDarkScheme(): boolean {
  return useSyncExternalStore(dark.subscribe, dark.read, never);
}

/**
 * False while React is hydrating server HTML, true for anything mounted in the browser afterwards.
 * Lets an entrance play for content that arrives while you watch, but not for the first page load.
 */
export function useMountedInBrowser(): boolean {
  return useSyncExternalStore(noop, yes, never);
}

/** One-off check for code that runs in effects and event handlers. */
export function prefersReducedMotion(): boolean {
  return reduce.read();
}

export function prefersDark(): boolean {
  return dark.read();
}
