"use client";

import { useActionState, useState } from "react";
import { PendingButton } from "@/components/fx";
import { buttonClass } from "@/components/ui";
import type { FormResult } from "./cj-connect";

type Action = (prev: FormResult | null, formData: FormData) => Promise<FormResult>;

/**
 * Disconnect, asked once: the first press opens a short note saying what disconnecting does, with
 * Disconnect and Keep it connected. Nothing changes until the second press.
 */
export function DisconnectButton({ action, provider, accountKey, name, consequence }: { action: Action; provider: string; accountKey: string; name: string; consequence: string }) {
  const [asking, setAsking] = useState(false);
  const [result, formAction] = useActionState<FormResult | null, FormData>(action, null);

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={buttonClass("quiet", "min-h-11 px-3 md:min-h-9")} aria-label={`Disconnect ${name}`}>
        Disconnect
      </button>
    );
  }

  return (
    <form action={formAction} className="basis-full rounded-xl border border-line bg-sunken p-3.5" aria-label={`Disconnect ${name}?`}>
      <p className="text-[13px]">
        <span className="font-medium">Disconnect {name}?</span> <span className="text-muted">{consequence}</span>
      </p>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="key" value={accountKey} />
      <div className="mt-3 flex flex-wrap gap-2">
        <PendingButton pendingLabel="Disconnecting…" variant="secondary" className={buttonClass("secondary", "min-h-11 text-negative md:min-h-9")}>
          Disconnect
        </PendingButton>
        <button type="button" onClick={() => setAsking(false)} className={buttonClass("quiet", "min-h-11 md:min-h-9")}>
          Keep it connected
        </button>
      </div>
      {result && !result.ok ? (
        <p role="alert" className="mt-2 text-[13px] text-negative">
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
