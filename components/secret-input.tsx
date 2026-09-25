"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cx, inputClass } from "./ui";

/**
 * A box for pasting a key or secret (Stripe, CJ, the connection service). It's a text box whose
 * characters are hidden, not a password box: Chrome and password managers offer saved passwords to
 * password boxes and would drop the person's own sign-in password in here. Show/Hide lets them
 * check what they pasted.
 */
export function SecretInput({ className, style, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-form-type="other"
        style={{ ...style, ...(shown ? {} : ({ WebkitTextSecurity: "disc" } as React.CSSProperties)) }}
        className={cx(inputClass, "pr-12", className)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? "Hide what you pasted" : "Show what you pasted"}
        title={shown ? "Hide" : "Show"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
