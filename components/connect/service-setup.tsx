"use client";

import { ArrowUpRight, Zap } from "lucide-react";
import { useActionState, useId } from "react";
import { PendingButton } from "@/components/fx";
import { PasswordInput } from "@/components/password-input";
import { Button, buttonClass, Card, cx, inputClass, StatusPill } from "@/components/ui";
import type { FormResult } from "./cj-connect";

type Action = (prev: FormResult | null, formData: FormData) => Promise<FormResult>;

export interface ServiceView {
  on: boolean;
  from: "settings" | "pasted" | null;
  projectId: string | null;
  environment: "development" | "production" | null;
}

/**
 * Only for platform admins: switches on one-click Shopify and eBay connections for everyone by
 * pasting three values from a free Pipedream account. Armada checks them with Pipedream before
 * keeping them sealed; nobody else ever sees this box.
 */
export function ServiceSetup({ view, save, clear }: { view: ServiceView; save: Action; clear: Action }) {
  const id = useId();
  const [result, saveAction] = useActionState<FormResult | null, FormData>(save, null);
  const [cleared, clearAction] = useActionState<FormResult | null, FormData>(clear, null);
  const message = result ?? cleared;

  return (
    <Card className="mb-8 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken">
          <Zap className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold">One-click connections</h2>
            <StatusPill tone={view.on ? "ok" : "off"}>{view.on ? (view.environment === "development" ? "On, testing" : "On") : "Off"}</StatusPill>
            <span className="text-[12px] text-muted">Only you see this</span>
          </div>
          <p className="mt-1 max-w-3xl text-[14px] text-muted">
            Pipedream already has approved apps with Shopify and eBay. With it switched on, anyone presses Connect, approves on Shopify&apos;s or
            eBay&apos;s own page, and comes straight back connected, without Armada needing its own app on either. The approval page names
            Pipedream until Armada has its own. Free while testing, for up to 10 fleets; about $150 a month once customers use it.
          </p>
        </div>
      </div>

      {view.from === "settings" ? (
        <p className="mt-4 text-[13px] text-muted">It&apos;s switched on from the server settings (project {view.projectId}), so there&apos;s nothing to paste here.</p>
      ) : (
        <form action={saveAction} className="mt-5 flex flex-col gap-4">
          <ol className="grid gap-3 md:grid-cols-3">
            <li className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
              <span className="text-[14px] font-medium">1. Make a free account</span>
              <p className="text-[13px] text-muted">Sign up at Pipedream, then make a project (any name, like Armada).</p>
              <a href="https://pipedream.com/auth/signup" target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "mt-auto min-h-11 self-start md:min-h-10")}>
                Open Pipedream
                <ArrowUpRight aria-hidden className="size-4" strokeWidth={2} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
            <li className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
              <span className="text-[14px] font-medium">2. Copy three things</span>
              <p className="text-[13px] text-muted">
                The Project ID (on the project&apos;s Settings, it starts with proj_), and a Client ID and Client secret from Settings, then API, then New OAuth
                Client.
              </p>
            </li>
            <li className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
              <span className="text-[14px] font-medium">3. Paste them below</span>
              <p className="text-[13px] text-muted">Armada checks them with Pipedream first, then keeps the secret locked away.</p>
            </li>
          </ol>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-[13px]" htmlFor={`${id}-project`}>
              Project ID
              <input id={`${id}-project`} name="projectId" defaultValue={view.projectId ?? ""} placeholder="proj_…" autoComplete="off" spellCheck={false} required className={cx(inputClass, "min-h-11 md:min-h-10")} />
            </label>
            <label className="flex flex-col gap-1 text-[13px]" htmlFor={`${id}-client`}>
              Client ID
              <input id={`${id}-client`} name="clientId" autoComplete="off" spellCheck={false} required className={cx(inputClass, "min-h-11 md:min-h-10")} />
            </label>
            <label className="flex flex-col gap-1 text-[13px]" htmlFor={`${id}-secret`}>
              Client secret
              <PasswordInput id={`${id}-secret`} name="clientSecret" autoComplete="off" required className="min-h-11 md:min-h-10" />
            </label>
          </div>
          <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
            <legend className="sr-only">Who can connect</legend>
            <label className="flex min-h-11 items-center gap-2 md:min-h-8">
              <input type="radio" name="environment" value="development" defaultChecked={view.environment !== "production"} className="size-4 accent-[var(--accent)]" />
              Testing: just me, free (sign in to Pipedream in this browser first)
            </label>
            <label className="flex min-h-11 items-center gap-2 md:min-h-8">
              <input type="radio" name="environment" value="production" defaultChecked={view.environment === "production"} className="size-4 accent-[var(--accent)]" />
              Live: everyone (Pipedream&apos;s paid plan)
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <PendingButton pendingLabel="Checking with Pipedream…" orb="connecting" className={buttonClass("primary", "min-h-11 md:min-h-10")}>
              {view.on ? "Save" : "Switch on"}
            </PendingButton>
            {message ? (
              <p role={message.ok ? "status" : "alert"} className={cx("text-[13px]", message.ok ? "text-ink" : "text-negative")}>
                {message.message}
              </p>
            ) : null}
          </div>
        </form>
      )}
      {view.from === "pasted" ? (
        <form action={clearAction} className="mt-3">
          <Button type="submit" variant="quiet" className="min-h-11 md:min-h-9">
            Switch off
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
