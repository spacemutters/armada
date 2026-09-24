"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cx, inputClass } from "./ui";

/**
 * A password box with a Show/Hide switch, so people can check what they typed. The switch is a real
 * button (keyboard and screen readers get "Show password" / "Hide password") and 44px to press.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={shown ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cx(inputClass, "pr-12", className)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        {shown ? <EyeOff aria-hidden className="size-[18px]" strokeWidth={1.8} /> : <Eye aria-hidden className="size-[18px]" strokeWidth={1.8} />}
      </button>
    </div>
  );
}
