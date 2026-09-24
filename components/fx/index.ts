// Armada's motion effects, ported from the Thinking Orbs Studio. See README.md for each one and where it's used.
// Every effect follows the system light/dark setting through the app's tokens, goes still under
// reduced motion, cleans up after itself, and draws nothing heavy on the server.

export { ThinkingOrb, ORB_STATES, type OrbState, type ThinkingOrbProps } from "./thinking-orb";
export { BorderBeam, type BorderBeamProps } from "./border-beam";
export { ShimmerText, type ShimmerTextProps } from "./shimmer-text";
export { StatusText, type StatusTextProps } from "./status-text";
export { RollingNumber, type RollingNumberProps } from "./rolling-number";
export { Tick, type TickProps } from "./tick";
export { ProgressBar, type ProgressBarProps } from "./progress-bar";
export { HoldButton, type HoldButtonProps } from "./hold-button";
export { UndoToast, type UndoToastProps } from "./undo-toast";
export { Expand, type ExpandProps } from "./expand";
export { DecodeText, type DecodeTextProps } from "./decode-text";
export { SegmentedNav, useGlide, type SegmentedNavItem } from "./glide";
export { Loading, type LoadingProps } from "./loading";
export { PendingButton, type PendingButtonProps } from "./pending-button";
export { useReducedMotion, useDarkScheme, useMountedInBrowser } from "./motion";
