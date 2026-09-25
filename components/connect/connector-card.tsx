import { ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { RollingNumber, Tick } from "@/components/fx";
import { ButtonLink, cx, StatusPill, type Tone } from "@/components/ui";
import { CJ_KEY_PAGE } from "@/connectors/cj/info";
import { SHOPIFY_API_VERSION, SHOPIFY_PATHS, SHOPIFY_SCOPES } from "@/connectors/shopify/config";
import { connectHref, openNewHref, type Connector } from "@/lib/connections/registry";
import type { ConnectedAccount, ProviderStatus } from "@/lib/connections/status";
import { hasEnv, type Provider } from "@/lib/connections/types";
import { timeAgo } from "@/lib/text";
import { CardShell } from "./card-shell";
import { CjConnect, type FormResult } from "./cj-connect";
import { ConnectLink } from "./connect-link";
import { CopyField } from "./copy-field";
import { DisconnectButton } from "./disconnect";
import { PlatformMark } from "./marks";
import { ShopifyConnect } from "./shopify-connect";

// The Connections page's pieces: one card per connector, the accounts under it, its one primary
// action, and (for platform admins) exactly what switches it on. The page loads the data and passes
// in its two server actions.

type FormAction = (prev: FormResult | null, formData: FormData) => Promise<FormResult>;
export interface CardActions {
  connectCj: FormAction;
  disconnect: FormAction;
}

const STATE: Record<ProviderStatus["state"], { tone: Tone; label: string }> = {
  connected: { tone: "ok", label: "Connected" },
  needs_attention: { tone: "attention", label: "Needs you" },
  not_connected: { tone: "off", label: "Not connected" },
  coming_soon: { tone: "off", label: "Coming soon" },
};

const ACCOUNT_PILL: Record<ConnectedAccount["status"], { tone: Tone; label: string } | null> = {
  connected: null,
  needs_attention: { tone: "attention", label: "Needs you" },
  setting_up: { tone: "working", label: "Setting up" },
  disconnected: { tone: "off", label: "Disconnected" },
};

// What one connected thing is called, for "Connected to 3 stores" and "Connect another store".
const NOUN: Record<Provider, [one: string, many: string]> = {
  shopify: ["store", "stores"],
  ebay: ["eBay account", "eBay accounts"],
  facebook: ["Facebook shop", "Facebook shops"],
  cj: ["account", "accounts"],
  aliexpress: ["account", "accounts"],
  meta_ads: ["ad account", "ad accounts"],
  google_ads: ["ad account", "ad accounts"],
  tiktok_ads: ["ad account", "ad accounts"],
};

// Short names for buttons ("Connect eBay", "Opening Facebook…").
const SHORT: Partial<Record<Provider, string>> = { facebook: "Facebook" };

function consequence(provider: Provider, kind: Connector["kind"]): string {
  if (provider === "shopify") return "Armada takes itself off the store in Shopify and stops keeping it in step. Its products and orders stay here.";
  if (provider === "cj") return "The shop builder and product search go back to the practice catalog, and sales stop being ordered from CJ. You can connect again any time.";
  if (provider === "aliexpress") return "Product search stops showing AliExpress. Products you already added stay. You can connect again any time.";
  if (kind === "store") return "Armada stops keeping it in step. Its products and orders stay here.";
  return "Armada stops managing ads on this account. Ads already running keep running on the platform.";
}

/** The note at the top after coming back from a platform: done (with a check that draws itself) or what went wrong. */
export function ConnectBanner({ tone, title, body, action }: { tone: "done" | "problem"; title: string; body?: string; action?: ReactNode }) {
  return (
    <div
      role={tone === "done" ? "status" : "alert"}
      className={cx("mb-6 flex items-center gap-3 rounded-2xl border px-4 py-3", tone === "done" ? "border-line bg-raised" : "border-attention/40 bg-attention-soft")}
    >
      {tone === "done" ? (
        <Tick size={22} look="filled" draw className="shrink-0 text-positive" />
      ) : (
        <span aria-hidden className="size-2.5 shrink-0 rotate-45 rounded-[1px] bg-attention" />
      )}
      <p className="min-w-0 flex-1 text-[14px]">
        <span className={tone === "done" ? "font-medium" : undefined}>{title}</span>
        {body ? <span className="text-muted"> {body}</span> : null}
      </p>
      {action}
      <Link href="/connections" scroll={false} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-sunken hover:text-ink md:size-8">
        <X aria-hidden className="size-4" strokeWidth={2} />
      </Link>
    </div>
  );
}

/** One group of connectors (Stores, Supplier, Ads) with its heading and how many are connected. */
export function ConnectorGroup({
  kind,
  title,
  about,
  items,
  canManage,
  admin,
  origin,
  typedShop,
  actions,
  rollIn = false,
}: {
  kind: Connector["kind"];
  title: string;
  about: string;
  items: ProviderStatus[];
  canManage: boolean;
  admin: boolean;
  origin: string;
  typedShop: string;
  actions: CardActions;
  rollIn?: boolean;
}) {
  const count = items.reduce((n, s) => n + s.connectedCount, 0);
  return (
    <section aria-labelledby={`group-${kind}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={`group-${kind}`} className="text-[17px] font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-[13px] text-muted">{about}</p>
        </div>
        {count ? (
          <p className="tabular text-[13px] text-muted">
            <RollingNumber value={count} rollIn={rollIn} /> connected
          </p>
        ) : null}
      </div>
      {/* grid-cols-1 sizes columns as minmax(0, 1fr), so a long store address can't widen a card past the screen. */}
      <div className={cx("grid grid-cols-1 gap-4", kind === "store" ? "md:grid-cols-2 xl:grid-cols-3" : kind === "ads" ? "md:grid-cols-3" : "")}>
        {items.map((s) => (
          <ConnectorCard key={s.provider} s={s} canManage={canManage} admin={admin} origin={origin} typedShop={typedShop} actions={actions} />
        ))}
      </div>
    </section>
  );
}

export function ConnectorCard({
  s,
  canManage,
  admin,
  origin,
  typedShop,
  actions,
}: {
  s: ProviderStatus;
  canManage: boolean;
  admin: boolean;
  origin: string;
  typedShop: string;
  actions: CardActions;
}) {
  const c = s.connector;
  const headingId = `connect-${c.provider}-name`;
  const state = STATE[s.state];
  const [noun, nouns] = NOUN[c.provider];
  const active = s.accounts.filter((a) => a.status !== "disconnected");
  const working = active.filter((a) => a.status === "connected" || a.status === "setting_up");
  const firstProblem = active.find((a) => a.status === "needs_attention");

  let headline: ReactNode = null;
  if (s.state === "needs_attention") {
    // The account's own row says exactly what's wrong; the headline only says which one.
    const text = firstProblem ? `${firstProblem.name} needs you.` : `One of your ${nouns} needs you.`;
    headline = <p className="mt-1 text-[14px] text-attention">{text}</p>;
  } else if (working.length === 1) {
    headline = (
      <p className="mt-1 text-[14px]">
        Connected as <span className="font-medium">{working[0].name}</span>
      </p>
    );
  } else if (working.length > 1) {
    headline = (
      <p className="tabular mt-1 text-[14px]">
        Connected to <RollingNumber value={working.length} /> {nouns}
      </p>
    );
  }

  return (
    <CardShell id={`connect-${c.provider}`} labelledBy={headingId}>
      <div className="flex items-start gap-4">
        <PlatformMark provider={c.provider} dim={s.state === "coming_soon"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <h3 id={headingId} className="text-[16px] font-semibold tracking-tight">
              {c.name}
            </h3>
            <StatusPill tone={state.tone}>{state.label}</StatusPill>
          </div>
          {headline}
          <p className={cx("mt-1 text-muted", headline ? "text-[13px]" : "text-[14px]")}>{c.blurb}</p>
        </div>
      </div>

      {s.accounts.length ? (
        <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label={`Connected ${nouns}`}>
          {s.accounts.map((a) => (
            <AccountRow key={a.key} s={s} a={a} canManage={canManage} disconnect={actions.disconnect} />
          ))}
        </ul>
      ) : null}

      <Actions s={s} canManage={canManage} typedShop={typedShop} noun={noun} connectCj={actions.connectCj} />

      {admin && (!s.available || c.method !== "key") ? <AdminSetup c={c} origin={origin} open={!s.available} /> : null}
    </CardShell>
  );
}

/**
 * One connected account. The name keeps its room (the actions wrap underneath on a narrow card);
 * a working account's Disconnect sits beside it, and an account that needs something gets its
 * problem and "Connect again" on their own lines.
 */
function AccountRow({ s, a, canManage, disconnect }: { s: ProviderStatus; a: ConnectedAccount; canManage: boolean; disconnect: FormAction }) {
  const pill = ACCOUNT_PILL[a.status];
  const second = [a.detail, a.status === "disconnected" ? null : `Connected ${timeAgo(a.since)}`].filter(Boolean).join(" · ");
  const reconnect = canManage && s.available && s.provider === "shopify" && a.domain && (a.status === "needs_attention" || a.status === "disconnected");
  const canDisconnect = canManage && a.status !== "disconnected";
  const disconnectButton = canDisconnect ? (
    <DisconnectButton action={disconnect} provider={s.provider} accountKey={a.key} name={a.name} consequence={consequence(s.provider, s.connector.kind)} />
  ) : null;
  const who = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx("truncate text-[14px] font-medium group-hover:underline", a.status === "disconnected" && "text-muted")}>{a.name}</span>
        {a.testAccount ? <span className="shrink-0 rounded-full border border-line px-2 text-[12px] font-normal text-muted">Test</span> : null}
      </span>
      {second ? <span className="block truncate text-[13px] text-muted">{second}</span> : null}
    </>
  );
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      {a.storeId && a.status !== "disconnected" ? (
        <Link href={`/stores/${a.storeId}`} className="group flex min-h-11 min-w-0 flex-1 basis-40 flex-col justify-center rounded-lg md:min-h-0">
          {who}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 basis-40 flex-col justify-center">{who}</div>
      )}
      {pill ? <StatusPill tone={pill.tone}>{pill.label}</StatusPill> : null}
      {!reconnect ? disconnectButton : null}
      {a.problem ? <p className={cx("basis-full text-[13px]", a.status === "needs_attention" ? "text-attention" : "text-muted")}>{a.problem}</p> : null}
      {reconnect ? (
        <div className="flex basis-full flex-wrap items-center gap-2">
          <ConnectLink href={connectHref("shopify", { shop: a.domain as string })} busyLabel="Opening Shopify…" variant="secondary" className="md:min-h-9">
            Connect again
          </ConnectLink>
          {disconnectButton}
        </div>
      ) : null}
    </li>
  );
}

function Actions({ s, canManage, typedShop, noun, connectCj }: { s: ProviderStatus; canManage: boolean; typedShop: string; noun: string; connectCj: FormAction }) {
  const c = s.connector;
  if (!s.available) {
    return <p className="mt-5 text-[13px] text-muted">It switches on here by itself when it&apos;s ready.</p>;
  }
  if (!canManage) return null;

  if (c.provider === "shopify") {
    return (
      <div className="mt-5">
        <ShopifyConnect defaultShop={typedShop} startCollapsed={s.connectedCount > 0 && !typedShop} />
      </div>
    );
  }

  if (c.method === "key") {
    if (s.state === "connected") return null;
    return (
      <div className="mt-5">
        <CjConnect action={connectCj} keyPage={CJ_KEY_PAGE} again={s.state === "needs_attention"} />
      </div>
    );
  }

  // Platforms with their own sign-in and approval (eBay, Facebook): one press there and back.
  const short = SHORT[c.provider] ?? c.name;
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <ConnectLink href={connectHref(c.provider)} busyLabel={`Opening ${short}…`}>
        {s.connectedCount ? `Connect another ${noun}` : `Connect ${short}`}
      </ConnectLink>
      {c.canOpenNew ? (
        <ButtonLink href={openNewHref(c.provider)} variant="secondary" className="min-h-11 md:min-h-10">
          Open a new {noun}
        </ButtonLink>
      ) : null}
    </div>
  );
}

/** Only platform admins: exactly what to set up on the platform's side, and which server settings are in place. */
function AdminSetup({ c, origin, open }: { c: Connector; origin: string; open: boolean }) {
  return (
    <details open={open} className="mt-5 rounded-xl border border-dashed border-line-strong">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-2 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
        <ShieldCheck aria-hidden className="size-4 text-muted" strokeWidth={1.75} />
        {open ? `What switches ${c.name} on` : "Setup details"}
        <span className="font-normal text-muted">Only platform admins see this.</span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-[13px] text-muted">{c.ownerSetup}</p>
        {c.provider === "shopify" ? <CopyField label="App address (Shopify calls it App URL)" value={origin + SHOPIFY_PATHS.start} /> : null}
        {c.callbackPath ? <CopyField label="Return address (Redirect URL)" value={origin + c.callbackPath} /> : null}
        {c.provider === "shopify" ? (
          <>
            <CopyField label="Permissions to ask for (Scopes)" value={SHOPIFY_SCOPES.join(",")} />
            <CopyField label="Privacy notices address (all three compliance topics)" value={origin + SHOPIFY_PATHS.compliance} />
            <p className="text-[13px] text-muted">
              Choose notices version {SHOPIFY_API_VERSION}. Each store is asked to tell Armada when it removes Armada, by itself, as the store connects.
            </p>
          </>
        ) : null}
        {c.requiredEnv.length ? (
          <div>
            <div className="text-[13px] font-medium">Settings in Vercel</div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {c.requiredEnv.map((name) => {
                const set = hasEnv([name]);
                return (
                  <li key={name} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span aria-hidden className={cx("size-2 shrink-0 rounded-full", set ? "bg-positive" : "border border-muted")} />
                    <code className="font-mono text-[12.5px]">{name}</code>
                    <span className="text-muted">{set ? "set" : "missing"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
