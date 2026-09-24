/*!
 * Types for the thinking-orbs 0.3.2 engine in thinking-orbs.js (MIT, Jakub Antalik).
 * Written for Armada from the package's own dist/*.d.ts, trimmed to what the engine exports.
 */

export type EngineState = "working" | "searching" | "solving" | "listening" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";
export type ModeKey = "orbits" | "globe" | "rubik" | "wave" | "web" | "braid" | "ribbon" | "ring" | "morph";
export type PresetSize = 64 | 32 | 20;

export interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a?: number;
}
export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  white: number;
  w: number;
  a?: number;
}
export interface OrbFrame {
  dots: Dot[];
  lines: Line[];
}
export type ModeOpts = Record<string, number | undefined>;
export type ModeFrame = (size: number, t: number, opts: ModeOpts) => OrbFrame;
export interface Resolved {
  mode: ModeKey;
  speed: number;
  opts: ModeOpts;
}

export declare const MODE_FRAMES: Record<ModeKey, ModeFrame>;
export declare const STATE_TO_MODE: Record<EngineState, ModeKey>;
export declare function resolvePreset(state: EngineState, size: PresetSize): Resolved;
export declare function scaleCounts(opts: ModeOpts, scale: number): ModeOpts;
export declare function scaleRadii(opts: ModeOpts, scale: number): ModeOpts;
export declare function paintFrame(ctx: CanvasRenderingContext2D, frame: OrbFrame, dark: boolean, tint?: { r: number; g: number; b: number }): void;
