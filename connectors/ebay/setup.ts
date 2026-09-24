import "server-only";
import { withWorkspace } from "@/lib/db";
import {
  addressFromIdentity,
  cleanPostalCode,
  EBAY_DEFAULTS,
  EBAY_STEPS,
  ebayPages,
  explainEbayProblem,
  freshSteps,
  fulfillmentPolicyBody,
  locationBody,
  MARKETPLACE_COUNTRY,
  MARKETPLACE_CURRENCY,
  nextStep,
  paymentPolicyBody,
  pickShippingService,
  reconnectHref,
  returnPolicyBody,
  type EbayAddress,
  type EbayEnv,
  type EbayShippingService,
  type SetupStep,
  type StepOutcome,
} from "./core";
import { ebayCall, EbayNotReady } from "./client";
import { EbayError } from "./http";

// The automatic part of opening an eBay store. The live setup view calls advanceEbaySetup() once
// per step; each call does one step and saves where it got to in stores.meta.setup, so a closed
// tab, a slow eBay, or a step only the seller can do never loses progress. Every step checks what
// already exists first, so running one twice changes nothing the second time.

interface EbayStoreMeta {
  ebayUserId: string;
  ebayUsername: string;
  marketplaceId: string;
  env: EbayEnv;
  setup?: { steps: SetupStep[]; startedAt?: string; finishedAt?: string };
  policies?: { paymentPolicyId?: string; returnPolicyId?: string; fulfillmentPolicyId?: string };
  locationKey?: string;
  shippingService?: string;
  sellingLimit?: { amount?: { value?: string; currency?: string }; quantity?: number };
}

export interface SetupInput {
  /** Run the current step again even though it last needed the person or failed. */
  retry?: boolean;
  /** An answer to the step's question (the ZIP code items ship from). */
  postalCode?: string;
}

interface Outcome extends StepOutcome {
  ask?: SetupStep["ask"];
  patch?: Partial<EbayStoreMeta>;
}

const ACCOUNT = "/sell/account/v1";

type Ctx = { workspaceId: string; storeId: string; meta: EbayStoreMeta; input: SetupInput };

const call = <T,>(c: Ctx, opts: Parameters<typeof ebayCall>[2]) => ebayCall<T>(c.workspaceId, c.meta.ebayUserId, opts);

async function stepSeller(c: Ctx): Promise<Outcome> {
  const p = await call<{ sellerRegistrationCompleted?: boolean; sellingLimit?: EbayStoreMeta["sellingLimit"] }>(c, { path: `${ACCOUNT}/privilege` });
  if (!p?.sellerRegistrationCompleted) {
    return {
      state: "needs_you",
      note: "This eBay account isn't set up to sell yet. eBay asks for your name, address and where your payouts go; it takes a few minutes.",
      action: { label: "Finish on eBay", href: ebayPages(c.meta.env).sell, external: true },
    };
  }
  const lim = p.sellingLimit;
  const note =
    lim?.quantity && lim.amount?.value
      ? `This account can sell up to ${lim.quantity} items or ${Number(lim.amount.value).toLocaleString("en-US", { style: "currency", currency: lim.amount.currency ?? "USD", maximumFractionDigits: 0 })} a month for now; eBay raises that as sales go well.`
      : "This account can sell.";
  return { state: "done", note, patch: { sellingLimit: lim } };
}

async function optedIn(c: Ctx): Promise<boolean> {
  const r = await call<{ programs?: { programType?: string }[] }>(c, { path: `${ACCOUNT}/program/get_opted_in_programs` });
  return (r?.programs ?? []).some((p) => p.programType === "SELLING_POLICY_MANAGEMENT");
}

async function stepPolicies(c: Ctx): Promise<Outcome> {
  if (await optedIn(c)) return { state: "done", note: "Business policies are on." };
  try {
    await call(c, { method: "POST", path: `${ACCOUNT}/program/opt_in`, body: { programType: "SELLING_POLICY_MANAGEMENT" } });
  } catch (e) {
    // Asking twice is harmless; eBay may answer that the request is already in.
    if (!(e instanceof EbayError) || e.status >= 500) throw e;
  }
  if (await optedIn(c)) return { state: "done", note: "Business policies are on." };
  // eBay can take a while to record the switch. If policies can already be read, it has taken.
  try {
    await call(c, { path: `${ACCOUNT}/payment_policy`, query: { marketplace_id: c.meta.marketplaceId } });
    return { state: "done", note: "Business policies are on." };
  } catch (e) {
    if (e instanceof EbayError) {
      const why = explainEbayProblem({ status: e.status, errors: e.errors, env: c.meta.env, storeId: c.storeId });
      if (why.state === "later" || e.status === 400 || e.status === 403) {
        return { state: "later", note: "Asked eBay to switch on business policies. eBay says that can take up to a day; come back here and press Try again." };
      }
    }
    throw e;
  }
}

/** Finds Armada's policy by name, or makes it. */
async function ensurePolicy(
  c: Ctx,
  kind: "payment_policy" | "return_policy" | "fulfillment_policy",
  listKey: "paymentPolicies" | "returnPolicies" | "fulfillmentPolicies",
  idKey: "paymentPolicyId" | "returnPolicyId" | "fulfillmentPolicyId",
  body: { name: string },
): Promise<{ id: string; reused: boolean }> {
  const list = await call<Record<string, { name?: string; [k: string]: unknown }[] | undefined>>(c, { path: `${ACCOUNT}/${kind}`, query: { marketplace_id: c.meta.marketplaceId } });
  const found = (list?.[listKey] ?? []).find((p) => p.name === body.name);
  if (found && typeof found[idKey] === "string") return { id: found[idKey] as string, reused: true };
  const made = await call<Record<string, unknown>>(c, { method: "POST", path: `${ACCOUNT}/${kind}`, body });
  const id = made?.[idKey];
  if (typeof id !== "string") throw new EbayError(502, [{ message: "eBay didn't return the new policy" }]);
  return { id, reused: false };
}

async function stepPayment(c: Ctx): Promise<Outcome> {
  const { id, reused } = await ensurePolicy(c, "payment_policy", "paymentPolicies", "paymentPolicyId", paymentPolicyBody(c.meta.marketplaceId));
  return {
    state: "done",
    note: reused ? "Using the payment terms Armada made before." : "Buyers pay straight away; eBay takes cards and wallets.",
    patch: { policies: { ...c.meta.policies, paymentPolicyId: id } },
  };
}

async function stepReturns(c: Ctx): Promise<Outcome> {
  const { id } = await ensurePolicy(c, "return_policy", "returnPolicies", "returnPolicyId", returnPolicyBody(c.meta.marketplaceId));
  return {
    state: "done",
    note: `Returns accepted for ${EBAY_DEFAULTS.returnDays} days; the buyer pays return postage. You can change this in Seller Hub.`,
    patch: { policies: { ...c.meta.policies, returnPolicyId: id } },
  };
}

async function stepDelivery(c: Ctx): Promise<Outcome> {
  const currency = MARKETPLACE_CURRENCY[c.meta.marketplaceId] ?? "USD";
  const services = await call<{ shippingServices?: EbayShippingService[] }>(c, {
    path: `/sell/metadata/v1/shipping/marketplace/${c.meta.marketplaceId}/get_shipping_services`,
  });
  const service = pickShippingService(services?.shippingServices ?? []);
  if (!service) return { state: "failed", note: "eBay didn't offer an everyday delivery service for this marketplace. Set delivery up in Seller Hub, then press Try again." };
  const { id } = await ensurePolicy(c, "fulfillment_policy", "fulfillmentPolicies", "fulfillmentPolicyId", fulfillmentPolicyBody(c.meta.marketplaceId, service, currency));
  return {
    state: "done",
    note: `Free ${service.description ?? "standard"} delivery, handed to the carrier within ${EBAY_DEFAULTS.handlingDays} business days.`,
    patch: { policies: { ...c.meta.policies, fulfillmentPolicyId: id }, shippingService: service.code },
  };
}

async function identityAddress(c: Ctx): Promise<EbayAddress | null> {
  try {
    return addressFromIdentity(await call(c, { host: "apiz", path: "/commerce/identity/v1/user/" }));
  } catch (e) {
    if (e instanceof EbayError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

async function stepLocation(c: Ctx): Promise<Outcome> {
  const key = EBAY_DEFAULTS.locationKey;
  const path = `/sell/inventory/v1/location/${key}`;
  try {
    await call(c, { path });
    return { state: "done", note: "Using the ship-from place Armada set up before.", patch: { locationKey: key } };
  } catch (e) {
    if (!(e instanceof EbayError) || e.status !== 404) throw e;
  }
  const country = MARKETPLACE_COUNTRY[c.meta.marketplaceId] ?? "US";
  let address: EbayAddress | null = null;
  if (c.input.postalCode !== undefined) {
    const zip = cleanPostalCode(c.input.postalCode);
    if (!zip) {
      return { state: "needs_you", note: "That doesn't look like a ZIP or postal code. Type the one items ship from.", ask: { field: "postalCode", label: "ZIP or postal code" } };
    }
    address = { postalCode: zip, country };
  } else {
    address = await identityAddress(c);
  }
  if (!address) {
    return {
      state: "needs_you",
      note: "eBay needs the place items ship from. Armada couldn't read your address from eBay.",
      ask: { field: "postalCode", label: "ZIP or postal code items ship from", hint: "Your own, or your supplier's warehouse if it's in the same country." },
    };
  }
  try {
    await call(c, { method: "POST", path, body: locationBody(address) });
  } catch (e) {
    // Made already (a second tab got there first).
    if (!(e instanceof EbayError) || !(e.status === 409 || e.errors.some((x) => x.errorId === 25803))) throw e;
  }
  const where = [address.city, address.stateOrProvince, address.postalCode].filter(Boolean).join(", ");
  return { state: "done", note: `Items ship from ${where || address.country}. Listings from overseas warehouses can say their own place.`, patch: { locationKey: key } };
}

const RUNNERS: Record<string, (c: Ctx) => Promise<Outcome>> = {
  account: async (c) => ({
    state: "needs_you",
    note: "Sign in to eBay again so Armada can carry on.",
    action: { label: "Sign in to eBay", href: reconnectHref(c.storeId) },
  }),
  seller: stepSeller,
  policies: stepPolicies,
  payment: stepPayment,
  returns: stepReturns,
  delivery: stepDelivery,
  location: stepLocation,
  ready: async () => ({ state: "done", note: "Ready. Products you list here use these terms." }),
};

export interface SetupView {
  storeId: string;
  name: string;
  platform: "ebay" | "facebook";
  status: string;
  steps: SetupStep[];
  finished: boolean;
}

async function load(workspaceId: string, storeId: string) {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string; name: string; status: string; meta: EbayStoreMeta }[]>`
      select id, name, status, meta from armada.stores where id = ${storeId} and platform = 'ebay' and mode = 'live'`,
  );
  return rows[0] ?? null;
}

export async function ebaySetupView(workspaceId: string, storeId: string): Promise<SetupView | null> {
  const s = await load(workspaceId, storeId);
  if (!s) return null;
  const steps = s.meta.setup?.steps ?? freshSteps(EBAY_STEPS);
  return { storeId: s.id, name: s.name, platform: "ebay", status: s.status, steps, finished: !nextStep(steps) };
}

/** Runs the next unfinished step (or retries a blocked one when asked) and saves the result. */
export async function advanceEbaySetup(workspaceId: string, storeId: string, input: SetupInput = {}): Promise<SetupView | null> {
  const s = await load(workspaceId, storeId);
  if (!s) return null;
  const steps: SetupStep[] = (s.meta.setup?.steps ?? freshSteps(EBAY_STEPS)).map((x) => ({ ...x }));
  const step = nextStep(steps);
  if (!step) return { storeId: s.id, name: s.name, platform: "ebay", status: s.status, steps, finished: true };
  const answering = input.postalCode !== undefined && step.key === "location";
  if (step.state !== "waiting" && !input.retry && !answering) return { storeId: s.id, name: s.name, platform: "ebay", status: s.status, steps, finished: false };

  const ctx: Ctx = { workspaceId, storeId, meta: s.meta, input };
  let out: Outcome;
  try {
    out = await RUNNERS[step.key](ctx);
  } catch (e) {
    if (e instanceof EbayNotReady) out = { state: "failed", note: "Armada's eBay connection is switched off right now. Try again later." };
    else if (e instanceof EbayError) out = explainEbayProblem({ status: e.status, errors: e.errors, env: s.meta.env, storeId });
    else {
      console.error("eBay setup step failed", step.key, e);
      out = { state: "failed", note: "Something went wrong on Armada's side. Try again in a minute." };
    }
  }

  Object.assign(step, { state: out.state, note: out.note, action: out.action, ask: out.ask, finishedAt: out.state === "done" ? new Date().toISOString() : undefined });
  const finished = !nextStep(steps);
  const setup = { ...s.meta.setup, steps, ...(finished ? { finishedAt: new Date().toISOString() } : {}) };
  const status = finished ? "connected" : "setting_up";
  await withWorkspace(workspaceId, async (tx) => {
    await tx`
      update armada.stores
      set meta = meta || ${tx.json({ ...(out.patch ?? {}), setup } as never)}, status = ${status}
      where id = ${storeId}`;
    if (finished) {
      await tx`
        insert into armada.audit_log (workspace_id, action, detail)
        values (${workspaceId}, 'ebay.setup_finished', ${tx.json({ storeId } as never)})`;
    }
  });
  return { storeId: s.id, name: s.name, platform: "ebay", status, steps, finished };
}
