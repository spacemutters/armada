"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cx } from "./cx";
import { prefersDark, prefersReducedMotion } from "./motion";
import { MODE_FRAMES, paintFrame, resolvePreset } from "./vendor/thinking-orbs";
import type { EngineState, ModeKey, ModeOpts, OrbFrame, PresetSize } from "./vendor/thinking-orbs";

/*
 * ThinkingOrb: a small ball of dots that says what kind of work is happening. The dots are drawn by
 * the thinking-orbs engine (MIT, Jakub Antalik, vendored in ./vendor/thinking-orbs.js); this file
 * decides which of its drawings to show for each of Armada's states and moves between them.
 *
 * - Working states animate. Resting states (idle, done, error, off) are one still drawing.
 * - When the state changes, every dot flies to its place in the next drawing (the same "dot travel"
 *   the studio and Savr use), so a build finishing reads as the orb settling, not a cut.
 * - Reduced motion: every state is one still drawing and changes are instant.
 * - One shared animation loop for every orb on the page. An orb that is scrolled away, or in a hidden
 *   tab, draws nothing. Nothing is drawn on the server: the canvas paints after it mounts.
 */

export type OrbState =
  | "idle"
  | "thinking"
  | "working"
  | "done"
  | "error"
  | "off"
  | "searching"
  | "composing"
  | "shaping"
  | "connecting"
  | "weaving"
  | "listening";

interface Look {
  engine: EngineState;
  /** A resting state: drawn once, still. */
  still: boolean;
  /** Extra drawing options (the error triangle holds the "shaping" outline on its second shape). */
  opts?: ModeOpts;
  label: string;
}

const LOOKS: Record<OrbState, Look> = {
  idle: { engine: "breathing", still: true, label: "Ready" },
  off: { engine: "breathing", still: true, label: "Off" },
  done: { engine: "breathing", still: true, label: "Done" },
  error: { engine: "shaping", still: true, opts: { shape: 1 }, label: "Stopped" },
  thinking: { engine: "solving", still: false, label: "Thinking" },
  working: { engine: "working", still: false, label: "Working" },
  searching: { engine: "searching", still: false, label: "Searching" },
  composing: { engine: "composing", still: false, label: "Writing" },
  shaping: { engine: "shaping", still: false, label: "Shaping" },
  connecting: { engine: "connecting", still: false, label: "Connecting" },
  weaving: { engine: "weaving", still: false, label: "Putting it together" },
  listening: { engine: "listening", still: false, label: "Listening" },
};

export const ORB_STATES = Object.keys(LOOKS) as OrbState[];

/** The library's own still frame (it uses t = 0.6 s for reduced motion). */
const STILL_T = 0.6;
const MORPH_MS = 850;
const STAGGER = 0.3;
const SWIRL = 0.45;

/** Each size has its own tuned design; anything between is drawn from the nearest one and scaled. */
function designFor(px: number): PresetSize {
  return px <= 24 ? 20 : px <= 44 ? 32 : 64;
}

/* ---------------- dot travel between states (ported from the studio / Savr) ---------------- */

interface PDot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a: number;
  ang: number;
}
interface Pair {
  a: PDot;
  b: PDot;
  fin: boolean;
  fout: boolean;
  d: number;
}
interface Travel {
  from: OrbFrame;
  to: OrbFrame;
  pairs: Pair[];
  start: number;
  geo: number;
  dir: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
// A fixed pseudo-random delay per dot, so the same change always looks the same.
const jitter = (k: number) => {
  const h = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return h - Math.floor(h);
};

function prep(frame: OrbFrame, c: number): PDot[] {
  let zmax = 1e-6;
  for (const d of frame.dots) zmax = Math.max(zmax, Math.abs(d.z));
  return frame.dots
    .map((d) => {
      let ang = Math.atan2(d.x - c, -(d.y - c));
      if (ang < 0) ang += 2 * Math.PI;
      return { x: d.x, y: d.y, z: d.z / zmax, r: d.r, white: d.white, a: d.a ?? 1, ang };
    })
    .sort((p, q) => p.ang - q.ang);
}

function plan(from: OrbFrame, to: OrbFrame, geo: number): Pair[] {
  const A = prep(from, geo / 2);
  const B = prep(to, geo / 2);
  const N = Math.max(A.length, B.length);
  const pairs: Pair[] = [];
  let prevA = -1;
  let prevB = -1;
  for (let k = 0; k < N; k++) {
    const ia = A.length ? Math.floor((k * A.length) / N) : -1;
    const ib = B.length ? Math.floor((k * B.length) / N) : -1;
    const a = ia >= 0 ? A[ia] : null;
    const b = ib >= 0 ? B[ib] : null;
    const first = (a ?? b) as PDot;
    pairs.push({ a: first, b: (b ?? a) as PDot, fin: !a || ia === prevA, fout: !b || ib === prevB, d: STAGGER * jitter(k) });
    prevA = ia;
    prevB = ib;
  }
  return pairs;
}

function blend(tr: Travel, p: number): OrbFrame {
  const c = tr.geo / 2;
  const dots: OrbFrame["dots"] = [];
  const lines: OrbFrame["lines"] = [];
  for (const pr of tr.pairs) {
    const { a, b } = pr;
    const e = easeOut(clamp((p - pr.d) / (1 - STAGGER), 0, 1));
    const from = pr.fin ? 0 : a.a;
    const to = pr.fout ? 0 : b.a;
    const alpha = from + (to - from) * e;
    if (alpha < 0.02) continue;
    let x = a.x + (b.x - a.x) * e;
    let y = a.y + (b.y - a.y) * e;
    const sw = SWIRL * Math.sin(Math.PI * e) * tr.dir;
    if (sw) {
      const cs = Math.cos(sw);
      const sn = Math.sin(sw);
      const dx = x - c;
      const dy = y - c;
      x = c + dx * cs - dy * sn;
      y = c + dx * sn + dy * cs;
    }
    dots.push({ x, y, z: a.z + (b.z - a.z) * e, r: a.r + (b.r - a.r) * e, white: a.white + (b.white - a.white) * e, a: alpha });
  }
  dots.sort((p1, p2) => p1.z - p2.z);
  const pe = easeOut(clamp(p, 0, 1));
  const fade = (list: OrbFrame["lines"], f: number) => {
    for (const l of list) {
      const la = (l.a ?? 1) * f;
      if (la >= 0.02) lines.push({ ...l, a: la });
    }
  };
  fade(tr.from.lines, 1 - pe);
  fade(tr.to.lines, pe);
  return { dots, lines };
}

/* ---------------- one shared loop for every orb on the page ---------------- */

interface Orb {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  px: number;
  geo: PresetSize;
  state: OrbState | null;
  look: Look;
  mode: ModeKey;
  speed: number;
  opts: ModeOpts;
  clock: number;
  paused: boolean;
  inverse: boolean;
  visible: boolean;
  dirty: boolean;
  travel: boolean;
  trans: Travel | null;
  last: OrbFrame | null;
  pxW: number;
  drawn: number;
}

const orbs = new Set<Orb>();
let raf = 0;
let lastTick = 0;
let swirl = 1;
let watching = false;
let seen: IntersectionObserver | null = null;
const byCanvas = new WeakMap<Element, Orb>();

function wake() {
  if (!raf && typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(tick);
}

function watchSystem() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const redraw = () => {
    for (const o of orbs) {
      o.dirty = true;
      o.trans = null;
    }
    wake();
  };
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener("change", redraw);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  if ("IntersectionObserver" in window) {
    seen = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const o = byCanvas.get(en.target);
        if (!o) continue;
        o.visible = en.isIntersecting;
        if (o.visible) {
          o.dirty = true;
          wake();
        }
      }
    });
  }
}

function moving(o: Orb, still: boolean) {
  return !still && !o.paused && !o.look.still;
}

function draw(o: Orb, now: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(o.px * dpr);
  if (o.pxW !== w) {
    o.canvas.width = w;
    o.canvas.height = w;
    o.pxW = w;
  }
  const still = prefersReducedMotion();
  const t = still || o.look.still ? STILL_T : o.clock * o.speed;
  if (o.travel) {
    o.travel = false;
    if (!still && o.last) {
      const landT = o.look.still ? STILL_T : t + (MORPH_MS / 1000) * o.speed;
      const landing = MODE_FRAMES[o.mode](o.geo, landT, o.opts);
      swirl = -swirl;
      o.trans = { from: o.last, to: landing, pairs: plan(o.last, landing, o.geo), start: now, geo: o.geo, dir: swirl };
    }
  }
  let frame: OrbFrame | null = null;
  if (o.trans) {
    const p = (now - o.trans.start) / MORPH_MS;
    if (p >= 1 || still) o.trans = null;
    else frame = blend(o.trans, Math.max(0, p));
  }
  if (!frame) frame = MODE_FRAMES[o.mode](o.geo, t, o.opts);
  const k = (dpr * o.px) / o.geo;
  o.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  o.ctx.clearRect(0, 0, o.px, o.px);
  o.ctx.setTransform(k, 0, 0, k, 0, 0);
  // Light dots on a dark surface; "inverse" is for a coloured surface such as a primary button.
  paintFrame(o.ctx, frame, prefersDark() !== o.inverse);
  o.last = frame;
  o.drawn++;
  o.canvas.dataset.drawn = String(o.drawn);
}

function tick(now: number) {
  raf = 0;
  const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0;
  lastTick = now;
  const still = prefersReducedMotion();
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  let again = false;
  for (const o of orbs) {
    const live = moving(o, still);
    // The clock also runs while dots are in flight, so a flight lands exactly where it is aimed.
    if (live || o.trans) o.clock += dt;
    if (o.visible && !hidden && (live || o.trans || o.travel || o.dirty)) {
      draw(o, now);
      o.dirty = false;
    }
    if (o.visible && !hidden && (live || o.trans)) again = true;
  }
  if (again) raf = requestAnimationFrame(tick);
  else lastTick = 0;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") {
      lastTick = 0;
      wake();
    }
  });
}

function setState(o: Orb, state: OrbState, travel: boolean) {
  const look = LOOKS[state] ?? LOOKS.working;
  if (state === o.state) return;
  const r = resolvePreset(look.engine, o.geo);
  o.state = state;
  o.look = look;
  o.mode = r.mode;
  o.speed = r.speed;
  o.opts = look.opts ? { ...r.opts, ...look.opts } : r.opts;
  o.travel = travel && !!o.last && !prefersReducedMotion();
  o.dirty = true;
  wake();
}

interface OrbHandle {
  set(state: OrbState): void;
  pause(paused: boolean): void;
  ink(inverse: boolean): void;
  destroy(): void;
}

function createOrb(canvas: HTMLCanvasElement, px: number, state: OrbState, paused: boolean, inverse: boolean): OrbHandle | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  watchSystem();
  const geo = designFor(px);
  const o: Orb = {
    canvas,
    ctx,
    px,
    geo,
    state: null,
    look: LOOKS.idle,
    mode: "ring",
    speed: 1,
    opts: {},
    clock: 6, // the library's drawings look settled a few seconds in
    paused,
    inverse,
    visible: !seen,
    dirty: true,
    travel: false,
    trans: null,
    last: null,
    pxW: 0,
    drawn: 0,
  };
  setState(o, state, false);
  orbs.add(o);
  byCanvas.set(canvas, o);
  seen?.observe(canvas);
  wake();
  return {
    set: (s) => setState(o, s, true),
    pause: (p) => {
      o.paused = p;
      o.dirty = true;
      wake();
    },
    ink: (inv) => {
      if (o.inverse === inv) return;
      o.inverse = inv;
      o.dirty = true;
      wake();
    },
    destroy: () => {
      orbs.delete(o);
      seen?.unobserve(canvas);
      byCanvas.delete(canvas);
    },
  };
}

export interface ThinkingOrbProps {
  /** What the work is. Resting states (idle, done, error, off) are still; the rest animate. */
  state?: OrbState;
  /** Size in CSS pixels, 16 to 96. */
  size?: number;
  /** Words for screen readers. Defaults to a plain word for the state. */
  label?: string;
  /** Hide from screen readers when the words beside it already say the same thing. */
  decorative?: boolean;
  /** Freeze on the current drawing. */
  paused?: boolean;
  /** "inverse" draws dark dots in dark mode and light dots in light mode, for a coloured surface such as a primary button. */
  ink?: "auto" | "inverse";
  className?: string;
  style?: CSSProperties;
}

/** A small ball of dots that shows what kind of work is happening, and settles when it's done. */
export function ThinkingOrb({ state = "working", size = 20, label, decorative = false, paused = false, ink = "auto", className, style }: ThinkingOrbProps) {
  const px = Math.round(clamp(size, 12, 128));
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<OrbHandle | null>(null);
  const latest = useRef({ state, paused, inverse: ink === "inverse" });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const h = createOrb(canvas, px, latest.current.state, latest.current.paused, latest.current.inverse);
    handle.current = h;
    return () => {
      h?.destroy();
      handle.current = null;
    };
  }, [px]);

  useEffect(() => {
    latest.current = { state, paused, inverse: ink === "inverse" };
    handle.current?.set(state);
    handle.current?.pause(paused);
    handle.current?.ink(ink === "inverse");
  }, [state, paused, ink]);

  const look = LOOKS[state] ?? LOOKS.working;
  return (
    <canvas
      ref={ref}
      width={px}
      height={px}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : (label ?? look.label)}
      data-state={state}
      className={cx("shrink-0", className)}
      style={{ width: px, height: px, display: "block", opacity: state === "off" ? 0.5 : 1, transition: "opacity 300ms ease", ...style }}
    />
  );
}
