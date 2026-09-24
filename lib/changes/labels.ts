import type { Tone } from "@/components/ui";

export const CHANGE_STATUS: Record<string, { tone: Tone; label: string }> = {
  preview: { tone: "attention", label: "Waiting for you" },
  running: { tone: "working", label: "Running" },
  done: { tone: "ok", label: "Done" },
  partial: { tone: "attention", label: "Partly done" },
  failed: { tone: "error", label: "Failed" },
  undone: { tone: "off", label: "Undone" },
  cancelled: { tone: "off", label: "Cancelled" },
};
