"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/*
 * The homepage's client plumbing: loading the three vendored libraries on demand, and the small
 * hooks the demos share. The libraries live in public/marketing/vendor/ exactly as published, licence
 * banners included (built from the effects studio's packages). Nothing here runs on the server, and
 * nothing heavy loads with the first paint: each library is fetched only when the part of the page
 * that uses it is about to be seen, and never under reduced motion.
 */

declare global {
  interface Window {
    Lenis?: LenisCtor;
    gsap?: Gsap;
    ScrollTrigger?: ScrollTriggerStatic;
    VANTA?: { WAVES: (opts: Record<string, unknown>) => VantaEffect };
    THREE?: unknown;
  }
}

// Only the parts of each library's API the page uses.
export interface LenisInstance {
  on(event: "scroll", cb: () => void): () => void;
  raf(time: number): void;
  scrollTo(target: string | number | HTMLElement, opts?: { offset?: number; duration?: number; immediate?: boolean }): void;
  destroy(): void;
}
type LenisCtor = new (opts: Record<string, unknown>) => LenisInstance;

export interface GsapTimeline {
  to(target: object, vars: Record<string, unknown>, position?: number | string): GsapTimeline;
  progress(): number;
  kill(): void;
}
export interface Gsap {
  registerPlugin(...plugins: unknown[]): void;
  ticker: { add(cb: (time: number) => void): void; remove(cb: (time: number) => void): void; lagSmoothing(n: number): void };
  timeline(vars?: Record<string, unknown>): GsapTimeline;
}
export interface ScrollTriggerInstance {
  progress: number;
  kill(): void;
}
export interface ScrollTriggerStatic {
  create(vars: Record<string, unknown>): ScrollTriggerInstance;
  update(): void;
  refresh(): void;
}
export interface VantaEffect {
  req: number;
  prevNow: number;
  animationLoop(): void;
  resize(): void;
  destroy(): void;
}

const VENDOR = "/marketing/vendor/";
const loading = new Map<string, Promise<void>>();

/** Adds a vendored script once; later calls share the same promise. */
export function loadVendor(file: "lenis.js" | "gsap.js" | "vanta-waves.js"): Promise<void> {
  const src = VENDOR + file;
  let p = loading.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loading.delete(src);
        s.remove();
        reject(new Error("Could not load " + file));
      };
      document.head.appendChild(s);
    });
    loading.set(src, p);
  }
  return p;
}

// The page's smooth scroller while it runs, so links inside the page can glide with it.
let activeLenis: LenisInstance | null = null;
export function setLenis(l: LenisInstance | null) {
  activeLenis = l;
}
/** Scroll the page to a point, gliding with smooth scroll when it is on. */
export function scrollPageTo(top: number) {
  if (activeLenis) activeLenis.scrollTo(top, { duration: 1.1 });
  else window.scrollTo({ top, behavior: window.matchMedia(REDUCE).matches ? "auto" : "smooth" });
}

let gsapReady: Promise<{ gsap: Gsap; ScrollTrigger: ScrollTriggerStatic }> | null = null;

/** GSAP with ScrollTrigger registered. */
export function getGsap() {
  if (!gsapReady) {
    gsapReady = loadVendor("gsap.js").then(() => {
      const gsap = window.gsap;
      const ScrollTrigger = window.ScrollTrigger;
      if (!gsap || !ScrollTrigger) throw new Error("GSAP did not load");
      gsap.registerPlugin(ScrollTrigger);
      return { gsap, ScrollTrigger };
    });
    gsapReady.catch(() => (gsapReady = null));
  }
  return gsapReady;
}

function media(query: string) {
  return {
    subscribe(cb: () => void) {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    read: () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches,
  };
}
const never = () => false;
const queries = new Map<string, ReturnType<typeof media>>();

/** A media query, read live. False on the server and during hydration. */
export function useMedia(query: string): boolean {
  let m = queries.get(query);
  if (!m) queries.set(query, (m = media(query)));
  return useSyncExternalStore(m.subscribe, m.read, never);
}

export const REDUCE = "(prefers-reduced-motion: reduce)";
/** Wide screens with a mouse or trackpad: where the scroll-driven showpiece and smooth scroll run. */
export const DESK = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

/**
 * True once the element has come within `margin` of the screen (and stays true when `once`).
 * With `once: false` it follows the element in and out, which the demos use to pause offscreen.
 */
export function useInView(ref: RefObject<Element | null>, { margin = "0px", once = true, threshold = 0 } = {}): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setSeen(true));
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          if (once) io.disconnect();
        } else if (!once) setSeen(false);
      },
      { rootMargin: margin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, once, threshold]);
  return seen;
}

/**
 * Calls `onChange(inside)` from the observer itself each time the element comes into or leaves the
 * area (the screen, grown or shrunk by `margin`), for demos that start their own clocks.
 */
export function useInViewEvent(ref: RefObject<Element | null>, { margin = "0px", threshold = 0 }, onChange: (inside: boolean) => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => latest.current(e.isIntersecting), { rootMargin: margin, threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, threshold]);
}

/** A tab that is hidden stops every demo clock. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => document.visibilityState !== "hidden",
    () => true,
  );
}
