"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BorderBeam } from "./fx/border-beam";
import { ShimmerText } from "./fx/shimmer-text";
import { ThinkingOrb } from "./fx/thinking-orb";
import { Button } from "./ui";

export function PasskeySignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const options = await fetch("/api/auth/login/options", { method: "POST" }).then((r) => r.json());
      const response = await startAuthentication({ optionsJSON: options });
      const res = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Sign-in didn't work. Try again.");
      router.replace("/");
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(/NotAllowed|abort|cancel/i.test(message) ? "Sign-in was cancelled." : message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* While the device asks for a fingerprint or face, a light travels round the button. */}
      <BorderBeam active={busy} className="w-full">
        <Button onClick={signIn} disabled={busy} aria-busy={busy || undefined} className="min-h-11 w-full" style={busy ? { opacity: 1, cursor: "progress" } : undefined}>
          {busy ? (
            <>
              <ThinkingOrb state="connecting" size={16} decorative ink="inverse" />
              <ShimmerText tone="current">Waiting for your device…</ShimmerText>
            </>
          ) : (
            "Sign in with your passkey"
          )}
        </Button>
      </BorderBeam>
      {error ? (
        <p role="alert" className="text-[13px] text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
