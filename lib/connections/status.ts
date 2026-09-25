import "server-only";
import { isPdProvider } from "@/connectors/pipedream/core";
import { withWorkspace } from "@/lib/db";
import type { Role } from "@/lib/types";
import { CONNECTORS, type Connector } from "./registry";
import { loadAppKeys } from "@/lib/app-keys";
import { serviceOn } from "./service";
import type { Provider } from "./types";

// Where each connection stands for one workspace, read from armada.credentials (never the sealed
// secret) and the live rows in armada.stores. Used by the Connections page and the "Open a new
// store" page.
//
// Conventions every connector follows so this can read them (the eBay and Facebook work too):
// - A store platform's accounts are its live rows in armada.stores. Each row points at its
//   credential (provider 'shopify' for Shopify, 'ebay' for eBay, 'meta' for Facebook) by the
//   credential's label, found in credentialLabelFor(): meta.credentialLabel, else eBay's
//   meta.ebayUserId, else Facebook's meta.fbeExternalId, else the store's domain (Shopify's label).
//   The credential's status and meta.lastError override the store's.
// - CJ is the credential ('cj', label '').
// - Ad accounts are credentials: Meta's is provider 'meta' with label 'ads' (a Facebook shop's
//   'meta' credential has meta.kind = 'shop'), then 'google' and 'tiktok'. meta.account,
//   meta.name or meta.personName names the account.
// - Callbacks send people back to /connections?connected=<provider> (Shopify adds &store=<id>),
//   or /connections?problem=<code>&provider=<provider> with a code from PROBLEMS below.

export type ProviderState = "connected" | "needs_attention" | "not_connected" | "coming_soon";
export type AccountStatus = "connected" | "needs_attention" | "setting_up" | "disconnected";

export interface ConnectedAccount {
  /** What a disconnect names: a store's id, or the credential's label. */
  key: string;
  name: string;
  /** A second line: the store's address, the account's email. */
  detail: string | null;
  status: AccountStatus;
  since: Date | null;
  storeId: string | null;
  /** The store's permanent address, for "connect again". */
  domain: string | null;
  /** What's wrong, in plain words, when it needs attention or was disconnected elsewhere. */
  problem: string | null;
  testAccount: boolean;
}

export interface ProviderStatus {
  provider: Provider;
  connector: Connector;
  available: boolean;
  /** How Connect works right now: Armada's own approved app, the connection service's, or neither. */
  via: "own" | "service" | null;
  state: ProviderState;
  /** Everything ever connected that's still listed, newest problems first. */
  accounts: ConnectedAccount[];
  /** How many accounts are connected (or setting up). */
  connectedCount: number;
}

/** The credentials.provider value behind each connector. */
export const CREDENTIAL_PROVIDER: Record<Provider, string> = {
  shopify: "shopify",
  ebay: "ebay",
  facebook: "meta",
  cj: "cj",
  aliexpress: "aliexpress",
  printful: "printful",
  printify: "printify",
  meta_ads: "meta",
  google_ads: "google",
  tiktok_ads: "tiktok",
};

const STORE_PLATFORM: Partial<Record<Provider, "shopify" | "ebay" | "facebook">> = { shopify: "shopify", ebay: "ebay", facebook: "facebook" };

/** Only the owner and managers connect and disconnect accounts. */
export function canManageConnections(role: Role): boolean {
  return role === "owner" || role === "manager";
}

interface StoreRow {
  id: string;
  platform: string;
  name: string;
  domain: string | null;
  status: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}
interface CredentialRow {
  provider: string;
  label: string;
  status: string;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The label of the credential behind a live store row (see the conventions above). */
export function credentialLabelFor(store: { domain: string | null; meta: Record<string, unknown> }): string | null {
  return str(store.meta.credentialLabel) ?? str(store.meta.ebayUserId) ?? str(store.meta.fbeExternalId) ?? store.domain;
}

/** Whether a 'meta' credential is the ad account's rather than a Facebook shop's. */
export function isMetaAdsCredential(c: { label: string; meta: Record<string, unknown> }): boolean {
  return c.meta.kind !== "shop" && (c.label === "ads" || c.meta.purpose === "ads");
}

const date = (v: unknown, fallback: Date) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : fallback);

function storeAccount(s: StoreRow, cred: CredentialRow | undefined): ConnectedAccount {
  let status: AccountStatus = s.status === "needs_attention" ? "needs_attention" : s.status === "setting_up" ? "setting_up" : s.status === "disconnected" ? "disconnected" : "connected";
  let problem: string | null = null;
  if (cred?.status === "needs_attention" && status !== "disconnected") {
    status = "needs_attention";
    problem = str(cred.meta.lastError);
  }
  if (status === "disconnected") {
    problem = s.meta.removedInShopifyAt
      ? "This store removed Armada in Shopify."
      : s.meta.deletedByEbay
        ? "eBay closed this account's connection."
        : s.meta.stillInShopify && s.meta.viaService
          ? "Disconnected. To remove the connection from the store too: in Shopify, open Settings, then Apps, and remove Pipedream."
          : s.meta.stillInShopify
          ? "Disconnected. Armada couldn't reach Shopify to take itself off the store, so remove it there too: in Shopify, open Settings, then Apps."
          : "Disconnected. Its products and orders stay in Armada.";
  }
  const primary = str(s.meta.primaryDomain);
  return {
    key: s.id,
    name: s.name,
    detail: primary && primary !== s.domain ? `${primary} · ${s.domain ?? ""}`.replace(/ · $/, "") : s.domain,
    status,
    since: date(s.meta.connectedAt, s.createdAt),
    storeId: s.id,
    domain: s.domain,
    problem,
    testAccount: s.meta.devStore === true || s.meta.sandbox === true,
  };
}

function credentialAccount(c: CredentialRow, fallbackName: string): ConnectedAccount {
  const status: AccountStatus = c.status === "needs_attention" ? "needs_attention" : c.status === "disconnected" ? "disconnected" : "connected";
  return {
    key: c.label,
    name: str(c.meta.account) ?? str(c.meta.name) ?? str(c.meta.personName) ?? (c.label && c.label !== "ads" ? c.label : fallbackName),
    detail: str(c.meta.email),
    status,
    since: date(c.meta.connectedAt, c.createdAt),
    storeId: null,
    domain: null,
    problem: status === "needs_attention" ? str(c.meta.lastError) : null,
    testAccount: c.meta.isSandbox === true || c.meta.sandbox === true,
  };
}

const ORDER: Record<AccountStatus, number> = { needs_attention: 0, disconnected: 1, setting_up: 2, connected: 3 };

function summarize(connector: Connector, accounts: ConnectedAccount[], service = false): ProviderStatus {
  const own = connector.available();
  // Shopify and eBay also connect through the connection service when Armada has no app of its own there.
  const via = own ? "own" : service && isPdProvider(connector.provider) ? "service" : null;
  const available = via !== null;
  const active = accounts.filter((a) => a.status !== "disconnected");
  const connectedCount = active.filter((a) => a.status === "connected" || a.status === "setting_up").length;
  const state: ProviderState = active.some((a) => a.status === "needs_attention")
    ? "needs_attention"
    : connectedCount
      ? "connected"
      : available
        ? "not_connected"
        : "coming_soon";
  accounts.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0));
  return { provider: connector.provider, connector, available, via, state, accounts, connectedCount };
}

/** Every connector's status for this workspace, in the registry's order. */
export async function connectionStatus(workspaceId: string): Promise<ProviderStatus[]> {
  // Pasted app keys reach this server before the cards read them.
  await loadAppKeys().catch(() => {});
  const service = await serviceOn();
  const { stores, creds } = await withWorkspace(workspaceId, async (tx) => {
    const stores = await tx<StoreRow[]>`
      select id, platform, name, domain, status, meta, created_at
      from armada.stores where mode = 'live' and platform in ('shopify', 'ebay', 'facebook')
      order by created_at`;
    const creds = await tx<CredentialRow[]>`
      select provider, label, status, meta, created_at, updated_at from armada.credentials order by created_at`;
    return { stores, creds };
  });

  return CONNECTORS.map((c) => {
    const platform = STORE_PLATFORM[c.provider];
    const credProvider = CREDENTIAL_PROVIDER[c.provider];
    if (platform) {
      const accounts = stores
        .filter((s) => s.platform === platform)
        .map((s) => {
          const label = credentialLabelFor(s);
          return storeAccount(s, label ? creds.find((k) => k.provider === credProvider && k.label === label) : undefined);
        });
      return summarize(c, accounts, service);
    }
    const mine = creds.filter((k) => {
      if (k.provider !== credProvider) return false;
      if (c.provider === "cj") return k.label === "";
      if (c.provider === "meta_ads") return isMetaAdsCredential(k);
      return true;
    });
    return summarize(c, mine.map((k) => credentialAccount(k, c.name)), service);
  });
}

/** One connector's status. */
export async function providerStatus(workspaceId: string, provider: Provider): Promise<ProviderStatus | undefined> {
  return (await connectionStatus(workspaceId)).find((s) => s.provider === provider);
}

/**
 * Plain words for why a connection round trip stopped, by the code a callback puts in
 * ?problem=<code>. "{name}" becomes the platform's name. Unknown codes show nothing, so a link
 * can't put made-up words on the page.
 */
export const PROBLEMS: Record<string, string> = {
  off: "{name} isn't switched on in Armada yet.",
  role: "Only the owner or a manager can connect accounts.",
  expired: "That took a little too long, so the link ran out. Press Connect again.",
  browser: "Finish connecting in the browser where you're signed in to Armada, then press Connect again.",
  link: "{name} sent back something Armada couldn't check, so nothing was connected. Press Connect again.",
  refused: "{name} didn't give Armada access. Press Connect again and approve on {name}'s page.",
  denied: "You chose not to connect. Nothing was changed.",
  unreachable: "Couldn't reach {name} just now. Try again in a minute.",
  failed: "Something went wrong while connecting {name}. Try again in a minute.",
  approval: "{name} asked for a fresh approval. Press Connect again.",
  paused: "{name} has paused this account, usually because of its plan or bill.",
  scopes: "{name} approved less than Armada needs, so nothing was connected. Press Connect again and approve the whole list.",
  elsewhere: "This store is already connected to another Armada team. To move it here, remove Armada from the store in Shopify (Settings, then Apps), then connect again.",
  address_empty: "Type your store's address first. It ends in .myshopify.com.",
  address_custom: "That's your shop's own web address. Use the one that ends in .myshopify.com: in Shopify, open Settings, then Domains.",
  address: "That doesn't look like a Shopify store address. It looks like yourstore.myshopify.com.",
};

export function problemMessage(code: string | null | undefined, providerName: string): string | null {
  if (!code || !Object.hasOwn(PROBLEMS, code)) return null;
  return PROBLEMS[code].replaceAll("{name}", providerName);
}
