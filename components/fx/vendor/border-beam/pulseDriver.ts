/*!
 * border-beam 1.4.0, by Jakub Antalik.
 * https://libraries.dev/beam  https://www.npmjs.com/package/border-beam
 * https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/border-beam
 *
 * packages/border-beam/src/pulseDriver.ts at commit 6464670 (the source of the published 1.4.0 build),
 * unchanged.
 * Armada's BorderBeam (components/fx/border-beam.tsx) wraps it.
 *
 * MIT License
 *
 * Copyright (c) 2026 Jakub Antalik
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/* eslint-disable -- the library's own code, kept as published */
import type { PulseDriverConfig } from './styles';

/**
 * Shared breathing driver for the Pulse effects.
 *
 * The pulse breathing (size / drift / per-quadrant opacity / height) and the
 * slow hue drift used to run as ~15 per-instance CSS `@property` keyframe
 * animations at the display refresh rate (60–120 Hz). Because each value feeds
 * the painted gradients/filters, that repainted the breathing layers 60–120×/s.
 *
 * The motion is very slow (1.6–6.4 s periods), so instead every registered
 * instance is driven from a SINGLE shared requestAnimationFrame loop throttled
 * to ~30 fps. This halves the paint frequency on 60 Hz displays and quarters it
 * on 120 Hz, with no perceptible change to the breathing.
 *
 * Each oscillator ping-pongs a CSS custom property between `a` and `b` with an
 * ease-in-out (cosine) curve over `period` seconds, offset by `delay` seconds so
 * otherwise-identical oscillators desync (matching the former CSS keyframes +
 * animation-delay).
 */

interface PulseInstance {
  el: HTMLElement;
  config: PulseDriverConfig;
}

const instances = new Set<PulseInstance>();
let rafId: number | null = null;
let lastFrame = 0;

// ~30 fps. Subtract a small slack so a frame that lands a hair early still runs.
const FRAME_INTERVAL = 1000 / 30 - 2;

const TWO_PI = Math.PI * 2;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Cosine ease-in-out factor in [0, 1]: 0 at phase 0/1, 1 at phase 0.5. */
function pingPong(phase: number): number {
  return (1 - Math.cos(TWO_PI * phase)) / 2;
}

function frame(ts: number): void {
  rafId = requestAnimationFrame(frame);

  if (ts - lastFrame < FRAME_INTERVAL) return;
  lastFrame = ts;

  const tSec = ts / 1000;

  instances.forEach(({ el, config }) => {
    for (const osc of config.oscillators) {
      // Match CSS animation-delay semantics: a positive delay starts later.
      const phase = (tSec - osc.delay) / osc.period;
      const value = osc.a + (osc.b - osc.a) * pingPong(phase);
      el.style.setProperty(
        osc.prop,
        osc.unit === 'px' ? `${value.toFixed(2)}px` : value.toFixed(4)
      );
    }

    if (config.hue) {
      const { prop, range, period, continuous } = config.hue;
      // `continuous` rotates a full circle (0→range, looping) so every color
      // sweeps through every edge; otherwise drift between -range and +range.
      const value = continuous
        ? ((tSec / period) % 1) * range
        : -range + 2 * range * pingPong(tSec / period);
      el.style.setProperty(prop, `${value.toFixed(2)}deg`);
    }
  });
}

function startLoop(): void {
  if (rafId == null) {
    lastFrame = 0;
    rafId = requestAnimationFrame(frame);
  }
}

function stopLoopIfIdle(): void {
  if (instances.size === 0 && rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/**
 * Register an element to be driven by the shared pulse loop.
 *
 * @returns a cleanup function that unregisters the instance (and stops the
 *          shared loop once no instances remain).
 */
export function registerPulseInstance(
  el: HTMLElement,
  config: PulseDriverConfig
): () => void {
  const instance: PulseInstance = { el, config };
  instances.add(instance);
  startLoop();

  return () => {
    instances.delete(instance);
    stopLoopIfIdle();
  };
}
