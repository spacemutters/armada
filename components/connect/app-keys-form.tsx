"use client";

import { useActionState } from "react";
import { PendingButton } from "@/components/fx";
import { SecretInput } from "@/components/secret-input";
import { buttonClass, cx, inputClass } from "@/components/ui";
import type { FormResult } from "./cj-connect";

type Action = (prev: FormResult | null, formData: FormData) => Promise<FormResult>;

export interface AppKeyField {
  name: string;
  /** Plain label, e.g. "Client ID". */
  label: string;
  secret: boolean;
  /** Where it's set now. Settings made in Vercel can't be changed here. */
  source: "vercel" | "pasted" | null;
  /** For settings that aren't secret, what's saved now, to show. */
  current: string | null;
}

/**
 * Only for platform admins, on each connector's setup details: paste Armada's own app keys for that
 * platform here instead of in Vercel. Secrets are never shown back; a blank box keeps what's saved.
 */
export function AppKeysForm({ provider, name, fields, action }: { provider: string; name: string; fields: AppKeyField[]; action: Action }) {
  const [result, formAction] = useActionState<FormResult | null, FormData>(action, null);
  const editable = fields.filter((f) => f.source !== "vercel");
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="provider" value={provider} />
      <div className="text-[13px] font-medium">{name}&apos;s app keys</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1 text-[13px]">
            <span className="flex flex-wrap items-center gap-2">
              {f.label}
              <span className={cx("text-[12px]", f.source ? "text-positive" : "text-muted")}>
                {f.source === "vercel" ? "set in Vercel" : f.source === "pasted" ? "saved" : "missing"}
              </span>
            </span>
            {f.source === "vercel" ? null : f.secret ? (
              <SecretInput name={f.name} placeholder={f.source === "pasted" ? "Saved. Paste to replace" : "Paste it here"} className="min-h-11 md:min-h-10" />
            ) : (
              <input
                name={f.name}
                defaultValue={f.current ?? ""}
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                className={cx(inputClass, "min-h-11 md:min-h-10")}
              />
            )}
          </label>
        ))}
      </div>
      {editable.length ? (
        <div className="flex flex-wrap items-center gap-3">
          <PendingButton pendingLabel="Saving…" className={buttonClass("secondary", "min-h-11 md:min-h-9")}>
            Save {name}&apos;s keys
          </PendingButton>
          {result ? (
            <p role={result.ok ? "status" : "alert"} className={cx("text-[13px]", result.ok ? "text-ink" : "text-negative")}>
              {result.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
