"use client";

import { useRef, useState } from "react";
import { Tick } from "@/components/fx";
import { buttonClass } from "@/components/ui";

/** Copies one piece of the profile kit. Says "Copied" with a tick, or asks the person to select it if the browser won't allow copying. */
export function CopyButton({ text, label = "Copy", what }: { text: string; label?: string; what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older browsers and some embedded views: copy through a hidden text box.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2400);
  }

  return (
    <button type="button" onClick={copy} className={buttonClass("secondary", "min-h-11 shrink-0 md:min-h-9")} aria-label={state === "idle" ? `${label} ${what}` : undefined}>
      {state === "copied" ? (
        <>
          <Tick size={14} look="plain" draw />
          Copied
        </>
      ) : state === "failed" ? (
        "Select it to copy"
      ) : (
        label
      )}
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? `${what} copied` : state === "failed" ? "Copying isn't allowed here. Select the text and copy it." : ""}
      </span>
    </button>
  );
}
