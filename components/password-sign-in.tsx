"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PasswordInput } from "./password-input";
import { Button, inputClass } from "./ui";

/** The second way in: email and password. Passkeys stay the main way. */
export function PasswordSignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Sign-in didn't work. Try again.");
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Sign-in didn't work. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={signIn} className="flex flex-col gap-4" aria-labelledby="password-sign-in-title">
      <h2 id="password-sign-in-title" className="text-[15px] font-semibold">
        Sign in with email and password
      </h2>
      <div>
        <label htmlFor="sign-in-email" className="text-[14px] font-medium">
          Email
        </label>
        <input
          id="sign-in-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          className={`${inputClass} mt-1.5 min-h-11`}
        />
      </div>
      <div>
        <label htmlFor="sign-in-password" className="text-[14px] font-medium">
          Password
        </label>
        <div className="mt-1.5">
          <PasswordInput id="sign-in-password" name="password" autoComplete="current-password" required maxLength={256} className="min-h-11" />
        </div>
      </div>
      <Button type="submit" variant="secondary" disabled={busy} className="min-h-11 w-full">
        {busy ? "Signing in…" : "Sign in with password"}
      </Button>
      <p role="alert" className="text-[13px] text-negative empty:hidden">
        {error ?? ""}
      </p>
    </form>
  );
}
