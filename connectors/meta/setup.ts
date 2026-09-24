import "server-only";
import { appOrigin } from "@/lib/connections/types";
import { withWorkspace } from "@/lib/db";
import { explainMetaProblem, freshSteps, META_PAGES, META_STEPS, nextStep, readInstall, shopStatusNote, type SetupStep, type StepOutcome } from "./core";
import { pushCatalog } from "./catalog";
import { loadMetaSecret, MetaNotReady, requireMetaConfig, saveMetaAssets } from "./client";
import { fbeInstalls, MetaError } from "./http";

// The automatic part of opening a Facebook and Instagram shop, one step per call from the live
// setup view, saved in stores.meta.setup as it goes (same pattern as connectors/ebay/setup.ts).
// The last step is the person's: Meta requires the checkout address to be submitted in Commerce
// Manager's own checkout check, so Armada gives them the address and the button to get there.

interface FacebookStoreMeta {
  fbeExternalId: string;
  shopifyStoreId: string;
  shopifyDomain?: string | null;
  setup?: { steps: SetupStep[]; startedAt?: string; finishedAt?: string };
}

export interface MetaSetupInput {
  retry?: boolean;
  /** The person says they've done the step that's theirs (adding the checkout address). */
  confirm?: boolean;
}

interface Outcome extends StepOutcome {
  copy?: SetupStep["copy"];
  confirmLabel?: string;
}

type Ctx = { workspaceId: string; storeId: string; meta: FacebookStoreMeta; input: MetaSetupInput };

/** The address Meta sends buyers to; it hands their cart to the linked Shopify store. */
export function checkoutAddress(storeId: string): string {
  return `${appOrigin()}/api/connect/facebook/checkout/${storeId}`;
}

async function stepShop(c: Ctx): Promise<Outcome> {
  const cfg = requireMetaConfig();
  let secret = await loadMetaSecret(c.workspaceId, c.meta.fbeExternalId);
  if (!secret) throw new MetaError(401, { code: 190 });
  const fresh = readInstall(await fbeInstalls(cfg, secret.accessToken, c.meta.fbeExternalId));
  if (fresh) secret = await saveMetaAssets(c.workspaceId, secret, fresh);
  const a = secret.assets;
  if (!a.commerceId) {
    return {
      state: "needs_you",
      note: "Meta made the business but not a shop. Shops are open to businesses in the US and some other countries; Commerce Manager says what's missing.",
      action: { label: "Open Commerce Manager", href: META_PAGES.commerceManager, external: true },
    };
  }
  const where = a.igId ? "Facebook and Instagram" : "Facebook";
  const hidden = shopStatusNote(a);
  return { state: "done", note: `Shop made on ${where}.${hidden ? ` ${hidden}` : ""}` };
}

async function stepCatalog(c: Ctx): Promise<Outcome> {
  const r = await pushCatalog(c.workspaceId, c.storeId);
  const extra = [
    r.skipped.length ? `${r.skipped.length} left out (${r.skipped[0].reason.toLowerCase().replace(/\.$/, "")})` : "",
    r.refused.length ? `${r.refused.length} refused by Meta (${r.refused[0].reason.replace(/\.$/, "")})` : "",
  ].filter(Boolean);
  if (!r.sent && !r.skipped.length && !r.refused.length) {
    return { state: "done", note: `${r.shopName} has no products yet. When it does, Armada can send them across.` };
  }
  return {
    state: "done",
    note: `${r.sent} ${r.sent === 1 ? "product" : "products"} from ${r.shopName} are in the catalog${extra.length ? `; ${extra.join("; ")}` : ""}.`,
  };
}

async function stepCheckout(c: Ctx): Promise<Outcome> {
  const shop = c.meta.shopifyDomain ?? "your Shopify store";
  if (c.input.confirm) return { state: "done", note: `Buyers pay on ${shop}. Meta checks the address from time to time.` };
  return {
    state: "needs_you",
    note: `Last step, on Meta's side: in Commerce Manager's settings, paste this checkout address into Meta's checkout check. Buyers then pay on ${shop}.`,
    copy: { label: "Checkout address", value: checkoutAddress(c.storeId) },
    action: { label: "Open Commerce Manager", href: META_PAGES.commerceManager, external: true },
    confirmLabel: "I've added it",
  };
}

const RUNNERS: Record<string, (c: Ctx) => Promise<Outcome>> = {
  business: async () => ({
    state: "needs_you",
    note: "Meta's setup window didn't finish. Set the shop up again.",
    action: { label: "Set it up again", href: "/stores/new#facebook" },
  }),
  shop: stepShop,
  catalog: stepCatalog,
  checkout: stepCheckout,
  ready: async () => ({ state: "done", note: "Ready. Products listed on the Shopify store can be sent to the shop." }),
};

export interface MetaSetupView {
  storeId: string;
  name: string;
  platform: "facebook";
  status: string;
  steps: SetupStep[];
  finished: boolean;
}

async function load(workspaceId: string, storeId: string) {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string; name: string; status: string; meta: FacebookStoreMeta }[]>`
      select id, name, status, meta from armada.stores where id = ${storeId} and platform = 'facebook' and mode = 'live'`,
  );
  return rows[0] ?? null;
}

export async function metaSetupView(workspaceId: string, storeId: string): Promise<MetaSetupView | null> {
  const s = await load(workspaceId, storeId);
  if (!s) return null;
  const steps = s.meta.setup?.steps ?? freshSteps(META_STEPS);
  return { storeId: s.id, name: s.name, platform: "facebook", status: s.status, steps, finished: !nextStep(steps) };
}

export async function advanceMetaSetup(workspaceId: string, storeId: string, input: MetaSetupInput = {}): Promise<MetaSetupView | null> {
  const s = await load(workspaceId, storeId);
  if (!s) return null;
  const steps: SetupStep[] = (s.meta.setup?.steps ?? freshSteps(META_STEPS)).map((x) => ({ ...x }));
  const step = nextStep(steps);
  const view = (status: string, finished: boolean): MetaSetupView => ({ storeId: s.id, name: s.name, platform: "facebook", status, steps, finished });
  if (!step) return view(s.status, true);
  const confirming = input.confirm && step.key === "checkout";
  if (step.state !== "waiting" && !input.retry && !confirming) return view(s.status, false);

  let out: Outcome;
  try {
    out = await RUNNERS[step.key]({ workspaceId, storeId, meta: s.meta, input });
  } catch (e) {
    if (e instanceof MetaNotReady) out = { state: "failed", note: "Armada's Facebook connection is switched off right now. Try again later." };
    else if (e instanceof MetaError) out = explainMetaProblem(e.status, e.body ?? { message: e.message });
    else {
      console.error("Facebook shop setup step failed", step.key, e);
      out = { state: "failed", note: "Something went wrong on Armada's side. Try again in a minute." };
    }
  }

  Object.assign(step, {
    state: out.state,
    note: out.note,
    action: out.action,
    copy: out.copy,
    confirmLabel: out.confirmLabel,
    finishedAt: out.state === "done" ? new Date().toISOString() : undefined,
  });
  const finished = !nextStep(steps);
  const status = finished ? "connected" : "setting_up";
  const setup = { ...s.meta.setup, steps, ...(finished ? { finishedAt: new Date().toISOString() } : {}) };
  await withWorkspace(workspaceId, async (tx) => {
    await tx`update armada.stores set meta = meta || ${tx.json({ setup } as never)}, status = ${status} where id = ${storeId}`;
    if (finished) {
      await tx`
        insert into armada.audit_log (workspace_id, action, detail)
        values (${workspaceId}, 'facebook.setup_finished', ${tx.json({ storeId } as never)})`;
    }
  });
  return view(status, finished);
}
