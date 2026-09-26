import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { HoldButton } from "@/components/fx";
import { SecretInput } from "@/components/secret-input";
import { Card, cx, PageHeader, StatusPill } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { isBillingAdmin, readNote } from "@/lib/billing/access";
import { standingFrom, usageFor, type PlanStanding } from "@/lib/billing/entitlements";
import { PAID_PLANS, planByKey, PLANS, plansVersion, priceCents, PRICING_STATUS, type LimitFeature } from "@/lib/billing/plans";
import { stripeConnection, type StripeConnection } from "@/lib/billing/settings";
import { confirmCheckout, currentSubscription } from "@/lib/billing/subscriptions";
import { appOrigin } from "@/lib/connections/types";
import { asSystem } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { choosePlan, connectStripeAction, disconnectStripeAction, manageBilling, refreshStripeAction, setPlansOpenAction } from "./actions";
import { PendingButton } from "./pending-button";
import { PlanPicker } from "./plan-picker";

export const metadata = { title: "Plan and billing" };

// Plan and billing: what this fleet pays for, the plans side by side, and (for platform admins only)
// the one-step Stripe connection at the bottom. Only the workspace owner can change the plan.

const STRIPE_KEYS_PAGE = "https://dashboard.stripe.com/apikeys";

/** What the restricted key needs, as Stripe's key screen names it. Keep in step with connectors/stripe/client.ts. */
const WRITE_PERMISSIONS = ["Products", "Prices", "Checkout Sessions", "Customer portal", "Webhook Endpoints", "Customers"];
const READ_PERMISSIONS = ["Subscriptions"];

function day(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

function Notice({ tone, children }: { tone: "ok" | "attention" | "error" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-[14px]",
        tone === "attention" ? "border-attention/40 bg-attention-soft" : tone === "error" ? "border-negative/40 bg-raised" : "border-line bg-raised",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "mt-[7px] size-2 shrink-0",
          tone === "ok" && "rounded-full bg-positive",
          tone === "attention" && "rotate-45 bg-attention",
          tone === "error" && "bg-negative",
          tone === "info" && "rounded-full border border-muted",
        )}
      />
      <div className={cx("min-w-0", tone === "attention" && "text-attention")}>{children}</div>
    </div>
  );
}

// ---------- Your plan ----------

function standingLine(s: PlanStanding): ReactNode {
  if (!s.paying) return "Free, for as long as you like. Nothing is charged.";
  const cents = s.interval ? priceCents(s.plan, s.interval) : 0;
  const price = `${formatMoney(cents)} ${s.interval === "year" ? "a year" : "a month"}`;
  if (s.endsAt) return `Ends on ${day(s.endsAt)}. You won't be charged again.`;
  if (s.trialEndsAt) {
    const builds = s.plan.trialLimits.shopBuildsPerMonth;
    return `Free until ${day(s.trialEndsAt)}, then ${price}.${builds != null ? ` The trial includes ${builds} shop builds.` : ""}`;
  }
  return `${price}. Renews on ${day(s.renewsAt)}.`;
}

const USAGE: { feature: LimitFeature; label: string }[] = [
  { feature: "stores", label: "Real stores" },
  { feature: "products", label: "Products in real stores" },
  { feature: "shopBuildsPerMonth", label: "Shop builds this month" },
  { feature: "headlineTests", label: "Headline tests this month" },
  { feature: "seats", label: "People" },
];

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  if (limit === 0) {
    return (
      <div className="min-w-0">
        <div className="text-[13px] text-muted">{label}</div>
        <div className="mt-1 text-[17px] font-semibold">
          {used > 0 ? used.toLocaleString("en-US") : "None"}
          <span className="font-normal text-muted"> · not in this plan</span>
        </div>
      </div>
    );
  }
  const full = limit !== null && used >= limit;
  const share = limit === null ? 0 : Math.min(1, used / limit);
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="tabular mt-1 text-[17px] font-semibold">
        {used.toLocaleString("en-US")}
        <span className="font-normal text-muted"> {limit === null ? "· no limit" : `of ${limit.toLocaleString("en-US")}`}</span>
      </div>
      {limit !== null ? (
        <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-sunken">
          <div className={cx("h-full rounded-full", full ? "bg-attention" : "")} style={{ width: `${share * 100}%`, background: full ? undefined : "var(--tile-busy)" }} />
        </div>
      ) : null}
      {full ? <div className="mt-1 text-[12px] text-attention">At your plan&apos;s limit</div> : null}
    </div>
  );
}

// ---------- The Stripe connection (platform admins) ----------

function KeyForm({ replacing }: { replacing: boolean }) {
  return (
    <form action={connectStripeAction} className="flex flex-col gap-2">
      <label htmlFor="stripe-key" className="text-[14px] font-medium">
        {replacing ? "New restricted key" : "Restricted key"}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <SecretInput id="stripe-key" name="key" required maxLength={300} placeholder="rk_live_… or rk_test_…" className="min-h-11 font-mono" />
        </div>
        <PendingButton pendingLabel="Setting up Stripe…" beam>
          {replacing ? "Connect with this key" : "Connect Stripe"}
        </PendingButton>
      </div>
      <p className="text-[13px] text-muted">
        Armada checks the key with Stripe, then sets up your plans, Stripe&apos;s billing page for your customers, and the address Stripe reports payments to. It keeps the key
        encrypted and never shows it again.
      </p>
    </form>
  );
}

function PermissionList({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map((p) => (
        <li key={p} className="rounded-lg border border-line bg-sunken px-2.5 py-1 text-[13px] font-medium">
          {p}
        </li>
      ))}
    </ul>
  );
}

function ConnectSteps() {
  return (
    <ol className="flex flex-col gap-5">
      <li className="flex gap-3">
        <span aria-hidden className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-[12px] font-semibold">
          1
        </span>
        <div className="min-w-0 text-[14px]">
          <p>
            In Stripe, open API keys and press <span className="font-medium">Create restricted key</span>.{" "}
            <a href={STRIPE_KEYS_PAGE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent underline-offset-2 hover:underline">
              Open Stripe&apos;s API keys
              <ArrowUpRight aria-hidden className="size-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
          <p className="mt-1 text-[13px] text-muted">To try everything first without real money, switch Stripe to a test sandbox and make the key there.</p>
        </div>
      </li>
      <li className="flex gap-3">
        <span aria-hidden className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-[12px] font-semibold">
          2
        </span>
        <div className="min-w-0 text-[14px]">
          <p>Name it Armada. Set these to Write:</p>
          <PermissionList items={WRITE_PERMISSIONS} />
          <p className="mt-3">and this to Read:</p>
          <PermissionList items={READ_PERMISSIONS} />
          <p className="mt-2 text-[13px] text-muted">Leave everything else as None. If Stripe lists Accounts, Read lets Armada show your business name; it&apos;s optional.</p>
        </div>
      </li>
      <li className="flex gap-3">
        <span aria-hidden className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-[12px] font-semibold">
          3
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-3 text-[14px]">Press Create key, copy it, and paste it here.</p>
          <KeyForm replacing={false} />
        </div>
      </li>
    </ol>
  );
}

function StripeAdmin({ connection, paying }: { connection: StripeConnection | null; paying: number }) {
  const outdated = connection && connection.plansVersion !== plansVersion();
  const missing = connection ? PAID_PLANS.filter((p) => !connection.priceIds[p.key]?.month || !connection.priceIds[p.key]?.year) : [];
  return (
    <Card id="stripe" className="mt-12 scroll-mt-6 p-5 md:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Stripe</h2>
        {connection ? (
          <StatusPill tone={connection.livemode ? "ok" : "attention"}>{connection.livemode ? "Live" : "Test mode"}</StatusPill>
        ) : (
          <StatusPill tone="off">Not connected</StatusPill>
        )}
      </div>
      <p className="mb-5 text-[13px] text-muted">Only platform admins see this. Payments go straight to your Stripe account.</p>
      {PRICING_STATUS && !/^approved/i.test(PRICING_STATUS) ? (
        <Notice tone="info">
          The prices on this page are the pricing research&apos;s recommendation, not yet approved by you. Stripe is set up with whatever the page shows when you connect or
          update.
        </Notice>
      ) : null}

      {!connection ? (
        <ConnectSteps />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-[15px]">
            Connected to <span className="font-semibold">{connection.accountName ?? "your Stripe account"}</span>{" "}
            <span className="text-muted">({connection.livemode ? "live mode" : "test mode: no real money moves"})</span>
          </p>

          <form action={setPlansOpenAction} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">{connection.plansOpen ? "Paid plans are open" : "Paid plans are closed"}</p>
              <p className="text-[13px] text-muted">
                {connection.plansOpen
                  ? "Fleet owners can choose a paid plan and pay."
                  : "Fleets see the plans but can't choose a paid one yet. The pricing research suggests opening them once a real store connection works."}
              </p>
            </div>
            <input type="hidden" name="open" value={connection.plansOpen ? "no" : "yes"} />
            <button
              type="submit"
              role="switch"
              aria-checked={connection.plansOpen}
              aria-label="Let fleets choose paid plans"
              className={cx(
                "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors",
                connection.plansOpen ? "border-accent bg-accent" : "border-line-strong bg-sunken",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "inline-block size-6 rounded-full bg-raised shadow transition-transform",
                  connection.plansOpen ? "translate-x-7" : "translate-x-1",
                )}
              />
            </button>
          </form>

          {connection.lastError ? (
            <Notice tone="attention">
              <p>{connection.lastError}</p>
              <p className="mt-1 text-[13px]">Last seen {day(connection.lastErrorAt)}.</p>
            </Notice>
          ) : null}
          {outdated || missing.length ? (
            <Notice tone="attention">
              Prices in Armada changed since Stripe was set up. Press <span className="font-medium">Update plans in Stripe</span> so new sign-ups pay the new prices.
            </Notice>
          ) : null}

          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-[14px] sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted">Plans in Stripe</dt>
            <dd>
              {PAID_PLANS.map((p) => `${p.name} ${formatMoney(p.monthlyCents)} a month or ${formatMoney(p.yearlyCents)} a year`).join(" · ")}
            </dd>
            <dt className="text-muted">Payments reported to</dt>
            <dd className="break-all">{new URL(appOrigin()).host}</dd>
            <dt className="text-muted">Connected</dt>
            <dd>
              {day(connection.connectedAt)}
              {connection.connectedByName ? ` by ${connection.connectedByName}` : ""}
            </dd>
            <dt className="text-muted">Paying fleets</dt>
            <dd className="tabular">{paying.toLocaleString("en-US")}</dd>
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <form action={refreshStripeAction}>
              <PendingButton variant="secondary" pendingLabel="Updating plans…">
                Update plans in Stripe
              </PendingButton>
            </form>
          </div>

          <details className="group rounded-xl border border-line p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-[14px] font-medium md:min-h-9">Replace the key</summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-[13px] text-muted">
                Use a key from the same Stripe account. To go live, connect a live key.
              </p>
              <KeyForm replacing />
            </div>
          </details>

          <details className="rounded-xl border border-line p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-[14px] font-medium md:min-h-9">Disconnect Stripe</summary>
            <div className="mt-3 flex flex-col gap-3 text-[14px]">
              <p>
                {paying > 0
                  ? `${paying.toLocaleString("en-US")} ${paying === 1 ? "fleet pays" : "fleets pay"} through Stripe right now. Stripe keeps charging them, but Armada stops hearing about renewals and cancellations.`
                  : "No fleet pays through Stripe right now."}{" "}
                Plans and prices stay in Stripe.
              </p>
              <form action={disconnectStripeAction}>
                <HoldButton
                  hint="Press and hold to disconnect Stripe"
                  doneLabel="Disconnecting…"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line-strong bg-raised px-4 text-[14px] font-medium md:min-h-10"
                >
                  Hold to disconnect
                </HoldButton>
              </form>
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}

// ---------- The page ----------

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [connection, admin, note] = await Promise.all([
    stripeConnection(),
    isBillingAdmin(session.memberId),
    readNote(typeof sp.note === "string" ? sp.note : undefined),
  ]);

  // Catch up with Stripe when its news may not have arrived yet: right after checkout, or when the
  // saved period has already ended (a renewal we haven't heard about).
  let joined: string | null = null;
  if (connection && sp.checkout === "done" && typeof sp.session === "string") {
    try {
      const snap = await confirmCheckout(session.workspaceId, sp.session);
      joined = planByKey(snap?.planKey)?.name ?? null;
    } catch {
      joined = null;
    }
  }
  const sub = await currentSubscription(session.workspaceId, Boolean(connection));
  const standing = standingFrom(sub);
  const [usage, paying] = await Promise.all([
    usageFor(session.workspaceId),
    admin
      ? asSystem((tx) => tx<{ n: number }[]>`select count(*)::int as n from armada.subscriptions where status in ('trialing', 'active', 'past_due')`).then((r) => r[0].n)
      : Promise.resolve(0),
  ]);
  const isOwner = session.role === "owner";
  const canManage = isOwner && Boolean(connection) && Boolean(sub?.stripeCustomerId);

  return (
    <>
      <PageHeader title="Plan and billing" subtitle="What your fleet pays for, and what each plan includes." />

      {note ? <Notice tone={note.tone === "ok" ? "ok" : "error"}>{note.text}</Notice> : null}
      {joined ? <Notice tone="ok">You&apos;re on {joined} now. Thank you.</Notice> : null}
      {sp.checkout === "cancelled" ? <Notice tone="info">Nothing changed. You&apos;re still on {standing.plan.name}.</Notice> : null}
      {!connection ? (
        <Notice tone="info">
          Billing isn&apos;t switched on yet, so every fleet is on Practice for now and nothing is charged.
          {admin ? (
            <>
              {" "}
              <a href="#stripe" className="font-medium text-accent underline-offset-2 hover:underline">
                Connect Stripe below
              </a>{" "}
              to switch it on.
            </>
          ) : null}
        </Notice>
      ) : null}
      {standing.paymentProblem && isOwner ? (
        <Notice tone="attention">
          <p>Your last payment didn&apos;t go through. Stripe will try again; update your card to keep {standing.plan.name}.</p>
          {canManage ? (
            <form action={manageBilling} className="mt-2">
              <input type="hidden" name="flow" value="card" />
              <PendingButton variant="secondary" pendingLabel="Opening Stripe…">
                Update card
              </PendingButton>
            </form>
          ) : null}
        </Notice>
      ) : null}

      <Card className="p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="text-[13px] text-muted">Your plan</div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="text-[30px] leading-tight font-semibold tracking-tight">{standing.plan.name}</h2>
              {standing.trialEndsAt ? <StatusPill tone="ok">Free trial</StatusPill> : null}
              {standing.endsAt ? <StatusPill tone="attention">Ending</StatusPill> : null}
              {standing.status === "past_due" ? <StatusPill tone="attention">Payment due</StatusPill> : null}
            </div>
            <p className="mt-1 max-w-xl text-[15px] text-muted">{standingLine(standing)}</p>
          </div>
          {canManage ? (
            <form action={manageBilling} className="flex flex-col items-start gap-1 sm:items-end">
              <PendingButton variant="secondary" pendingLabel="Opening Stripe…">
                Manage billing
              </PendingButton>
              <span className="text-[13px] text-muted">Card, invoices, or cancelling</span>
            </form>
          ) : null}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 md:grid-cols-3 lg:grid-cols-5">
          {USAGE.map((u) => (
            <UsageMeter key={u.feature} label={u.label} used={usage[u.feature]} limit={standing.limits[u.feature]} />
          ))}
        </div>
      </Card>

      <section aria-labelledby="plans" className="mt-12">
        {connection && !isOwner ? <p className="mb-4 text-[14px] text-muted">Only the fleet&apos;s owner can change the plan.</p> : null}
        {!connection?.plansOpen && !standing.paying ? (
          <p className="mb-4 text-[14px] text-muted">
            Paid plans open soon. Until then, everything on Practice is free.
            {admin && connection ? " (You can still choose one to try the checkout, because you're an admin.)" : ""}
          </p>
        ) : null}
        <PlanPicker
          plans={[...PLANS]}
          current={{ planKey: standing.plan.key, interval: standing.interval, paying: standing.paying, ending: Boolean(standing.endsAt) }}
          canChoose={isOwner && Boolean(connection) && (Boolean(connection?.plansOpen) || admin || standing.paying)}
          trialEligible={!sub}
          choose={choosePlan}
        />
      </section>

      {admin ? <StripeAdmin connection={connection} paying={paying} /> : null}
    </>
  );
}
