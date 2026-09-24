"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PasswordInput } from "./password-input";
import { Button, inputClass } from "./ui";

/**
 * The admin setup link's form: the person picks their own email and password (never sent to anyone
 * but Armada), and lands signed in as the owner and platform admin.
 */
export function AdminSetup({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/admin-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          name: String(form.get("name") ?? ""),
          workspaceName: String(form.get("workspaceName") ?? ""),
          email: String(form.get("email") ?? ""),
          password,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That didn't work. Try again.");
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "That didn't work. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-[14px] font-medium">
          Your name
          <input name="name" defaultValue="Davis" maxLength={60} className={`${inputClass} min-h-11 font-normal`} />
        </label>
        <label className="grid gap-1.5 text-[14px] font-medium">
          Name for your fleet
          <input name="workspaceName" defaultValue="Armada" maxLength={60} className={`${inputClass} min-h-11 font-normal`} />
        </label>
      </div>
      <label className="grid gap-1.5 text-[14px] font-medium">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          className={`${inputClass} min-h-11 font-normal`}
        />
      </label>
      <label className="grid gap-1.5 text-[14px] font-medium">
        Password
        <PasswordInput name="password" required minLength={8} maxLength={256} autoComplete="new-password" className="min-h-11 font-normal" />
      </label>
      <label className="grid gap-1.5 text-[14px] font-medium">
        Password again
        <PasswordInput name="confirm" required minLength={8} maxLength={256} autoComplete="new-password" className="min-h-11 font-normal" />
      </label>
      <Button type="submit" disabled={busy} className="min-h-11 w-full">
        {busy ? "Setting up…" : "Make my admin account"}
      </Button>
      <p role="alert" className="text-[13px] text-negative empty:hidden">
        {error ?? ""}
      </p>
      <p className="text-[13px] text-muted">This link works once. Afterwards, sign in on the sign-in page with this email and password.</p>
    </form>
  );
}
