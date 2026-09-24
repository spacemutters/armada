"use client";

import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { useDarkScheme, useReducedMotion } from "./motion";
import styles from "./fx.module.css";
import { BorderBeam as Beam } from "./vendor/border-beam";

export interface BorderBeamProps {
  children: ReactNode;
  /** Run the light. Turning it off fades it out. */
  active?: boolean;
  /**
   * The library's presets: "md" travels round a card's whole border, "sm" suits small pill buttons,
   * "line" travels along the bottom edge only, "pulse-inner" breathes inside the border instead of travelling.
   */
  size?: "md" | "sm" | "line" | "pulse-inner";
  /** "mono" is grey light (the default, calm everywhere); "accent" uses the library's blue "ocean" colours. */
  tone?: "mono" | "accent";
  /** Corner radius in px. Left out, it copies the radius of the first child. */
  radius?: number;
  /** 0 to 1, how strong the light is. */
  strength?: number;
  className?: string;
  style?: CSSProperties;
}

// The library clips its wrapper to the corner radius, which would also clip a child's focus ring.
// Its own layers clip themselves, so the wrapper can let the ring show.
const LET_FOCUS_SHOW = '[data-beam="{id}"] { overflow: visible; }';

/**
 * A light that travels round the border of whatever it wraps, while something is running.
 * The light is border-beam 1.4.0 by Jakub Antalik (MIT, vendored). With reduced motion it is a still ring.
 */
// The library draws its grey light at half strength; on Armada's quiet surfaces that all but vanishes,
// so the grey light gets back most of what it gives up (the library multiplies these variables in).
const MONO_LIFT = { "--beam-stroke-opacity": 1.9, "--beam-inner-opacity": 1.5, "--beam-bloom-opacity": 1.6 } as CSSProperties;

export function BorderBeam({ children, active = true, size = "md", tone = "mono", radius, strength = 1, className, style }: BorderBeamProps) {
  const reduced = useReducedMotion();
  const dark = useDarkScheme();
  return (
    <Beam
      active={active && !reduced}
      size={size}
      colorVariant={tone === "accent" ? "ocean" : "mono"}
      theme={dark ? "dark" : "light"}
      borderRadius={radius}
      strength={strength}
      css={LET_FOCUS_SHOW}
      className={cx(styles.beam, reduced && active && styles.beamStill, className)}
      style={tone === "mono" ? { ...MONO_LIFT, ...style } : style}
      data-fx-beam={active ? "on" : "off"}
    >
      {children}
    </Beam>
  );
}
