"use client";

import { ArrowUpRight, ClipboardPaste } from "lucide-react";
import { useActionState, useId, useRef, useSyncExternalStore } from "react";
import { PendingButton } from "@/components/fx";
import { SecretInput } from "@/components/secret-input";
import { buttonClass } from "@/components/ui";
import { useCardBusy } from "./card-shell";

export interface FormResult {
  ok: boolean;
  message: string;
}

type Action = (prev: FormResult | null, formData: FormData) => Promise<FormResult>;

const noSubscribe = () => () => {};
const clipboardReadable = () => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

/**
 * CJ has no approval screen, so connecting is a guided paste: open CJ's key page in a new tab,
 * paste the key, connect. Armada checks the key with CJ before keeping it; CJ's refusals come back
 * in plain words under the steps.
 */
export function CjConnect({ action, keyPage, again = false }: { action: Action; keyPage: string; again?: boolean }) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const { setBusyKey } = useCardBusy();
  const [result, formAction] = useActionState<FormResult | null, FormData>(async (prev, formData) => {
    try {
      return await action(prev, formData);
    } finally {
      setBusyKey(null);
    }
  }, null);
  const canPaste = useSyncExternalStore(noSubscribe, clipboardReadable, () => false);

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text && field.current) field.current.value = text;
    } catch {
      // The browser said no to reading the clipboard; typing or pasting by hand still works.
    }
    field.current?.focus();
  };

  return (
    <form action={formAction} onSubmit={() => setBusyKey(id)} className="flex flex-col gap-3">
      <ol className="grid gap-3 md:grid-cols-3">
        <li className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
          <Step n={1} title="Copy your key from CJ" />
          <p className="text-[13px] text-muted">
            On CJ&apos;s page, press &ldquo;Add API&rdquo;, choose API Key, and copy the key it makes. If CJ asks, add its free API app first.
          </p>
          <a href={keyPage} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "mt-auto min-h-11 self-start md:min-h-10")}>
            Open CJ&apos;s key page
            <ArrowUpRight aria-hidden className="size-4" strokeWidth={2} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
        <li className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
          <Step n={2} title="Paste it here" htmlFor={`${id}-key`} />
          <div className="mt-auto flex gap-2">
            <div className="min-w-0 flex-1">
              <SecretInput
                ref={field}
                id={`${id}-key`}
                name="apiKey"
                required
                minLength={10}
                maxLength={300}
                placeholder="Your CJ key"
                className="min-h-11 md:min-h-10"
              />
            </div>
            {canPaste ? (
              <button type="button" onClick={paste} className={buttonClass("secondary", "min-h-11 shrink-0 px-3 md:min-h-10")}>
                <ClipboardPaste aria-hidden className="size-4" strokeWidth={2} />
                Paste
              </button>
            ) : null}
          </div>
        </li>
        <li className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
          <Step n={3} title={again ? "Connect CJ again" : "Connect"} />
          <p className="text-[13px] text-muted">Armada checks the key with CJ, then keeps it locked away. Disconnect any time.</p>
          <PendingButton pendingLabel="Checking with CJ…" orb="connecting" className={buttonClass("primary", "mt-auto min-h-11 self-start md:min-h-10")}>
            {again ? "Connect CJ again" : "Connect CJ"}
          </PendingButton>
        </li>
      </ol>
      {result && !result.ok ? (
        <p role="alert" className="text-[13px] text-negative">
          {result.message}
        </p>
      ) : null}
    </form>
  );
}

function Step({ n, title, htmlFor }: { n: number; title: string; htmlFor?: string }) {
  const Title = htmlFor ? "label" : "span";
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised text-[12px] font-semibold">
        {n}
      </span>
      <Title {...(htmlFor ? { htmlFor } : {})} className="text-[14px] font-medium">
        <span className="sr-only">Step {n}: </span>
        {title}
      </Title>
    </span>
  );
}
