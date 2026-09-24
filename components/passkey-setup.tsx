"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "./ui";

function guessDevice(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  return "This device";
}

export function PasskeySetup({ token, firstOwner, addingDevice }: { token: string; firstOwner: boolean; addingDevice: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/auth/register/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name }),
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options.error ?? "This link didn't work.");
      const response = await startRegistration({ optionsJSON: options });
      const res = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name, workspaceName, deviceLabel: guessDevice(), response }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Setting up the passkey didn't work.");
      router.replace("/");
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/NotAllowed|abort|cancel/i.test(message) ? "Passkey setup was cancelled." : message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="flex flex-col gap-5">
      {!addingDevice ? (
        <Field label="Your name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Davis" autoComplete="given-name" />
        </Field>
      ) : null}
      {firstOwner ? (
        <Field label="What should your fleet be called?" hint="You can change this later.">
          <input className={inputClass} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} maxLength={60} placeholder="My fleet" />
        </Field>
      ) : null}
      <Button type="submit" disabled={busy} className="min-h-11 w-full">
        {busy ? "Waiting for your device…" : addingDevice ? "Add this device" : "Create your passkey"}
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-negative">
          {error}
        </p>
      ) : null}
    </form>
  );
}
