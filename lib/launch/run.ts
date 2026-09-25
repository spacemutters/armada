import "server-only";
import { ebayPages, nextStep, reconnectHref, type SetupStep } from "@/connectors/ebay/core";
import { isRealSupplierProduct, PRACTICE_OFF_EBAY, storeCanList } from "@/connectors/ebay/listing-core";
import { advanceEbaySetup, ebaySetupView } from "@/connectors/ebay/setup";
import { AdsProblem, launchPaused, retryWriting, startAds } from "@/lib/ads/sets";
import { helperStatus } from "@/lib/ai/jobs";
import { applyLiveEbayItems, planListing, savePreview } from "@/lib/changes/engine";
import { serviceOn } from "@/lib/connections/service";
import { appOrigin } from "@/lib/connections/types";
import { asSystem, withWorkspace } from "@/lib/db";
import { MARKUP } from "@/lib/pricing";
import { getShop } from "@/lib/shops/queries";
import type { ShopRow } from "@/lib/shops/types";
import { socialAccountsFor } from "@/lib/social/accounts";
import { kitImageUrl } from "@/lib/social/accounts/config";
import { kitFor } from "@/lib/social/accounts/connect";
import { usernameIdeas } from "@/lib/social/accounts/kit";
import { createPracticeAccount } from "@/lib/social/accounts/store";
import { latestWeekRun, PostProblem, postsForShop, scheduleAllSuggested, startWeek } from "@/lib/social/posts/queries";
import { platformLabel } from "@/lib/social/posts/schedule";
import { shopAccounts } from "@/lib/social/posts/targets";
import { checkoutStep } from "./checkout";
import {
  freshLaunchSteps,
  launchStatus,
  normalizeSteps,
  retrySteps,
  SIGN_UP_PAGES,
  type LaunchKit,
  type LaunchStatus,
  type LaunchStep,
  type LaunchStepKey,
  type LaunchView,
} from "./core";

export type { LaunchKit, LaunchView };

// Launch: one press on a finished shop, then every step Armada is allowed to do by itself.
//
//   startLaunch     the press (and pressing again: stopped steps get another go, nothing is repeated)
//   advanceLaunch   one pass over every step; the progress view calls it every few seconds while
//                   something is working, and the helper's once-a-minute sweep calls it for
//                   launches nobody is watching. A two-minute lease keeps it to one pass at a time.
//   launchView      what the progress view shows, read only
//
// Every step is safe to run again: each one looks for what it made before (the eBay change, the
// posts run, the ad set) and carries on from there. Making an account on Facebook, Instagram or
// eBay is never done by Armada; those steps become one press with everything ready to copy.

interface LaunchState {
  ebay?: { storeId?: string; changeSetId?: string; total?: number; setupTriedAt?: string; stoppedAt?: string; stopped?: { kind: string; note: string } };
  posts?: { runId?: string; scheduled?: number; past?: number; doneAt?: string };
  ads?: { setId?: string; retry?: boolean };
}

interface LaunchRow {
  shopId: string;
  workspaceId: string;
  startedBy: string | null;
  status: LaunchStatus;
  steps: LaunchStep[];
  state: LaunchState;
  leaseUntil: Date | null;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

/** A shop can launch once it's built: it has its brand and look, and its store works. */
export function launchable(shop: Pick<ShopRow, "status" | "blueprint">): boolean {
  return ["ready", "published"].includes(shop.status) && Boolean(shop.blueprint.brand && shop.blueprint.theme);
}

const brandOf = (shop: ShopRow) => shop.blueprint.brand?.name || shop.niche;
const OOPS = "Something went wrong on Armada's side. Press Try again.";
const HELPER_OFF = "Waiting for the AI helper on your computer to come back on; it carries on by itself then.";

async function audit(workspaceId: string, memberId: string | null, action: string, detail: Record<string, unknown>) {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, ${action}, ${tx.json(detail as never)})`,
  );
}

async function loadRow(workspaceId: string, shopId: string): Promise<LaunchRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return null;
  const rows = await withWorkspace(workspaceId, (tx) => tx<LaunchRow[]>`select * from armada.shop_launches where shop_id = ${shopId}`);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- the press

/** The Launch press. Pressing it again picks up where the launch is and gives stopped steps another go. */
export async function startLaunch(workspaceId: string, shopId: string, memberId: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const shop = await getShop(workspaceId, shopId);
  if (!shop) return { ok: false, problem: "That shop wasn't found." };
  if (!launchable(shop)) return { ok: false, problem: "This shop isn't finished yet. Launch works once the shop builder is done." };
  const again = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx<LaunchRow[]>`select * from armada.shop_launches where shop_id = ${shopId} for update`;
    if (!row) {
      await tx`
        insert into armada.shop_launches (shop_id, workspace_id, started_by, status, steps)
        values (${shopId}, ${workspaceId}, ${memberId}, 'working', ${tx.json(freshLaunchSteps() as never)})
        on conflict (shop_id) do nothing`;
      return false;
    }
    const before = normalizeSteps(row.steps);
    const steps = retrySteps(before);
    const state: LaunchState = { ...row.state };
    const failed = new Set(before.filter((s) => s.state === "failed").map((s) => s.key));
    // A press means "try now": eBay's account checks run again straight away.
    if (state.ebay) state.ebay = { ...state.ebay, stoppedAt: undefined, stopped: undefined, setupTriedAt: undefined };
    if (failed.has("ebay") && state.ebay) state.ebay = { storeId: state.ebay.storeId };
    if (failed.has("posts")) delete state.posts;
    if (failed.has("ads")) state.ads = { ...state.ads, retry: true };
    await tx`
      update armada.shop_launches
      set steps = ${tx.json(steps as never)}, state = ${tx.json(state as never)}, status = 'working', finished_at = null,
          started_by = coalesce(started_by, ${memberId}), updated_at = now()
      where shop_id = ${shopId}`;
    return true;
  });
  await audit(workspaceId, memberId, again ? "launch.pressed_again" : "launch.started", { shopId, brand: brandOf(shop) });
  return { ok: true };
}

// ---------------------------------------------------------------- one pass

interface Ctx {
  workspaceId: string;
  shop: ShopRow;
  memberId: string | null;
  state: LaunchState;
  deadline: number;
  helperOnline: boolean;
}

type Outcome = Pick<LaunchStep, "state" | "note" | "actions" | "ask" | "progress">;

const now = () => new Date().toISOString();
const minutesSince = (iso: string | undefined) => (iso ? (Date.now() - Date.parse(iso)) / 60_000 : Infinity);

// ---- the shop's own store

async function storeStep(c: Ctx): Promise<Outcome> {
  const url = `${appOrigin()}/s/${c.shop.slug}`;
  return {
    state: "done",
    note: `Open at ${url.replace(/^https?:\/\//, "")}: the shop's own pages, products and bag.`,
    actions: [{ label: "Open the shop", href: `/s/${c.shop.slug}`, external: true }],
  };
}

// ---- eBay

interface EbayStoreRow {
  id: string;
  name: string;
  status: string;
  currency: string;
  meta: { env?: "production" | "sandbox"; policies?: Record<string, string>; locationKey?: string; marketplaceId?: string };
}

async function ebayStore(c: Ctx): Promise<EbayStoreRow | null> {
  const rows = await withWorkspace(
    c.workspaceId,
    (tx) => tx<EbayStoreRow[]>`
      select id, name, status, currency, meta from armada.stores
      where platform = 'ebay' and mode = 'live' and status <> 'disconnected'
      order by (id = ${c.state.ebay?.storeId ?? "00000000-0000-0000-0000-000000000000"}) desc, (status = 'connected') desc, created_at
      limit 1`,
  );
  return rows[0] ?? null;
}

/** The account's setup, run forward as far as it goes by itself. Returns the step in the way, if any. */
async function runEbaySetup(c: Ctx, store: EbayStoreRow): Promise<SetupStep | null> {
  let view = await ebaySetupView(c.workspaceId, store.id);
  if (!view) return null;
  let retried = false;
  for (let i = 0; i < 10 && Date.now() < c.deadline; i++) {
    const next = nextStep(view.steps);
    if (!next) return null;
    if (next.state === "waiting") {
      view = (await advanceEbaySetup(c.workspaceId, store.id)) ?? view;
      continue;
    }
    // A step that needed the person (or eBay) is tried again every few minutes, and on each press.
    if (!retried && next.key !== "account" && minutesSince(c.state.ebay?.setupTriedAt) > 3) {
      retried = true;
      c.state.ebay = { ...c.state.ebay, setupTriedAt: now() };
      view = (await advanceEbaySetup(c.workspaceId, store.id, { retry: true })) ?? view;
      continue;
    }
    return next;
  }
  return nextStep(view.steps);
}

const SETUP_ASK: Record<string, string> = {
  account: "Sign in to eBay again",
  seller: "Finish selling sign-up on eBay",
  location: "Say where items ship from",
};

async function ebayStep(c: Ctx, prev: LaunchStep): Promise<Outcome> {
  const refs = c.shop.blueprint.products ?? [];
  const sources = refs.length
    ? await withWorkspace(
        c.workspaceId,
        (tx) => tx<{ id: string; title: string; source: string | null }[]>`
          select p.id, p.title, c.source from armada.products p left join armada.catalog_items c on c.id = p.catalog_item_id
          where p.id in ${tx(refs.map((r) => r.productId))}`,
      )
    : [];
  const sourceOf = new Map(sources.map((s) => [s.id, s.source]));
  const titleOf = new Map(sources.map((s) => [s.id, s.title]));
  const real = refs.filter((r) => isRealSupplierProduct({ imagined: r.imagined, source: sourceOf.get(r.productId) ?? null }));
  if (!real.length) {
    return {
      state: "skipped",
      note:
        c.shop.brief?.source === "practice"
          ? "This is a practice shop, and practice items can't go on real eBay. Shops built from a real supplier (CJ or AliExpress) are listed there."
          : PRACTICE_OFF_EBAY,
    };
  }

  const store = await ebayStore(c);
  if (!store) {
    return {
      state: "needs-you",
      ask: "Connect eBay",
      note: "Connect your eBay account and Armada lists the shop's supplier products there. eBay's own page asks you to sign in, or to make an account.",
      actions: [{ label: "Connect eBay", href: "/api/connect/ebay/start?purpose=connect", external: true, primary: true }],
    };
  }
  c.state.ebay = { ...c.state.ebay, storeId: store.id };
  if (store.currency !== "USD") {
    return { state: "skipped", note: `This eBay account sells in ${store.currency}, and the shop's prices are in dollars, so its products stay off it for now.` };
  }

  // The account's own setup (business policies, terms, ship-from place) first.
  if (store.status !== "connected" || !storeCanList(store.meta)) {
    const blocked = await runEbaySetup(c, store);
    if (blocked) {
      const setupLink = { label: "Open the eBay setup", href: `/stores/new/setup/${store.id}` };
      if (blocked.state === "later") return { state: "waiting", note: blocked.note ?? "eBay is finishing this account's setup.", actions: [setupLink] };
      if (blocked.state === "waiting") return { state: "working", note: "Setting up the eBay account: business policies, terms and where items ship from." };
      return {
        state: "needs-you",
        ask: SETUP_ASK[blocked.key] ?? "Finish the eBay setup",
        note: blocked.note ?? "The eBay account's setup needs you.",
        actions: [...(blocked.action ? [{ ...blocked.action, primary: true }] : []), setupLink],
      };
    }
  }
  const [ready] = await withWorkspace(c.workspaceId, (tx) => tx<EbayStoreRow[]>`select id, name, status, currency, meta from armada.stores where id = ${store.id}`);
  if (!ready || !storeCanList(ready.meta)) {
    return { state: "needs-you", ask: "Finish the eBay setup", note: "The eBay account's setup isn't finished.", actions: [{ label: "Open the eBay setup", href: `/stores/new/setup/${store.id}`, primary: true }] };
  }

  // The listings: one change, previewed and approved by the Launch press, undone in one press.
  let changeSetId = c.state.ebay.changeSetId;
  if (!changeSetId) {
    if (!c.memberId) return { state: "failed", note: "The person who pressed Launch isn't on this team any more. Press Try again." };
    const brand = brandOf(c.shop);
    const practiceLeftOut = refs
      .filter((r) => !real.includes(r))
      .map((r) => ({ storeName: ready.name, productTitle: titleOf.get(r.productId) ?? r.handle, reason: PRACTICE_OFF_EBAY }));
    const made = await withWorkspace(c.workspaceId, async (tx) => {
      const { planned, skipped } = await planListing(tx, real.map((r) => r.productId), [ready.id], MARKUP[c.shop.brief?.priceFeel ?? "mid"] ?? MARKUP.mid);
      const id = await savePreview(tx, c.workspaceId, c.memberId!, "launch_ebay", `List ${brand} on eBay (${ready.name})`, planned, {
        shopId: c.shop.id,
        storeId: ready.id,
        launch: true,
        skipped: [...skipped, ...practiceLeftOut],
      });
      // Pressing Launch was the approval.
      await tx`update armada.change_sets set status = 'running', approved_at = now() where id = ${id}`;
      return { id, total: planned.length };
    });
    changeSetId = made.id;
    c.state.ebay = { ...c.state.ebay, changeSetId, total: made.total };
    await audit(c.workspaceId, c.memberId, "launch.ebay_change", { shopId: c.shop.id, changeSetId, storeId: ready.id, products: made.total });
  }

  // Publish a few each pass. After the whole account was stopped (signed out, not able to sell),
  // wait a couple of minutes (or for the next press) before trying again.
  const stopped = c.state.ebay.stopped;
  if (!(stopped && minutesSince(c.state.ebay.stoppedAt) < 2)) {
    const r = await applyLiveEbayItems(c.workspaceId, changeSetId, { max: 3, deadline: c.deadline });
    c.state.ebay = { ...c.state.ebay, stopped: r.stopped, stoppedAt: r.stopped ? now() : undefined };
  }

  const [counts] = await withWorkspace(
    c.workspaceId,
    (tx) => tx<{ total: number; done: number; pending: number; notListed: number; reason: string | null; undone: boolean }[]>`
      select count(*)::int as total, count(*) filter (where status = 'done')::int as done,
             exists (select 1 from armada.change_sets where id = ${changeSetId} and status = 'undone') as undone,
             count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status in ('failed', 'skipped'))::int as not_listed,
             (select error from armada.change_items where change_set_id = ${changeSetId} and status in ('failed', 'skipped') and error is not null limit 1) as reason
      from armada.change_items where change_set_id = ${changeSetId}`,
  );
  const see = { label: "See the listings", href: `/changes/${changeSetId}` };
  const progress = { done: counts.done, total: counts.total };
  if (counts.undone) return { state: "done", note: `You took these listings down with Undo, so they're off ${ready.name}.`, actions: [see] };
  if (counts.pending > 0) {
    const s = c.state.ebay.stopped;
    if (s && s.kind !== "busy") {
      const action =
        s.kind === "account"
          ? { label: "Finish on eBay", href: ebayPages(ready.meta.env ?? "production").sell, external: true, primary: true }
          : s.kind === "reconnect"
            ? { label: "Sign in to eBay", href: reconnectHref(ready.id), primary: true }
            : { label: "Open the eBay setup", href: `/stores/new/setup/${ready.id}`, primary: true };
      return { state: "needs-you", ask: s.kind === "account" ? "Finish selling sign-up on eBay" : action.label, note: s.note, actions: [action, see], progress };
    }
    return {
      state: "working",
      note: `Listing on ${ready.name}: ${counts.done} of ${counts.total} listed.${s ? ` ${s.note}` : ""}`,
      progress,
      actions: [see],
    };
  }
  if (!counts.total) {
    return { state: "done", note: `Nothing new to list on ${ready.name}. ${counts.reason ?? "Every product is already there."}`.trim(), actions: [see] };
  }
  if (!counts.done) {
    return { state: "skipped", note: `None of the products could go on eBay: ${counts.reason ?? "eBay didn't take them."}`, actions: [see], progress };
  }
  void prev;
  return {
    state: "done",
    note: `${counts.done} listed on ${ready.name}.${counts.notListed ? ` ${counts.notListed} couldn't be: ${counts.reason ?? "see the list"}` : ""} One press on Undo takes them all down.`,
    actions: [see],
    progress,
  };
}

// ---- Facebook Page and Instagram

const CONNECT_ROUTE: Record<"facebook" | "instagram", string> = { facebook: "facebook_page", instagram: "instagram" };

async function socialStep(c: Ctx, platform: "facebook" | "instagram"): Promise<Outcome> {
  const accounts = (await socialAccountsFor(c.workspaceId, c.shop.id)).filter((a) => a.platform === platform);
  const title = platform === "facebook" ? "Facebook" : "Instagram";
  const real = accounts.find((a) => a.status === "connected");
  if (real) {
    const who = platform === "facebook" || !real.handle ? real.name : `@${real.handle.replace(/^@/, "")}`;
    return { state: "done", note: `Connected as ${who}. The shop's posts go straight to it.` };
  }
  const connectHref = `/api/connect/${CONNECT_ROUTE[platform]}/start?shop=${c.shop.id}`;
  const attention = accounts.find((a) => a.status === "needs_attention");
  if (attention) {
    return {
      state: "needs-you",
      ask: `Connect ${title} again`,
      note: `${title} stopped accepting Armada's access. One press connects it again.`,
      actions: [{ label: "Connect it again", href: connectHref, external: true, primary: true }],
    };
  }
  if (c.shop.brief?.source === "practice") {
    // A practice shop posts to practice accounts only; making one needs nobody.
    if (!accounts.some((a) => a.status === "practice")) {
      if (!c.memberId) return { state: "failed", note: "The person who pressed Launch isn't on this team any more. Press Try again." };
      const name = brandOf(c.shop);
      await createPracticeAccount(c.workspaceId, c.memberId, { id: c.shop.id, name, handle: usernameIdeas(name, "instagram")[0] ?? "practice.shop" }, platform);
    }
    return {
      state: "done",
      note: `A practice ${title} account is ready. Its posts stay in Armada and never reach ${title}.`,
      actions: [{ label: "See it", href: `/social/connect?shop=${c.shop.id}#${platform}` }],
    };
  }
  if (platform === "facebook") {
    return {
      state: "needs-you",
      ask: "Make its Facebook Page",
      note: "No app is allowed to make a Facebook Page for you, so this press is yours: make the Page on Facebook with the name, description and pictures below, then press Connect it.",
      actions: [
        { label: "Make the Page on Facebook", href: SIGN_UP_PAGES.facebook, external: true, primary: true },
        { label: "Connect it", href: connectHref, external: true },
      ],
    };
  }
  return {
    state: "needs-you",
    ask: "Make its Instagram",
    note: "No app is allowed to make an Instagram account for you, so this press is yours: sign up with the details below and switch the account to professional (Settings, then Account type and tools). Then press Connect it.",
    actions: [
      { label: "Make the account on Instagram", href: SIGN_UP_PAGES.instagram, external: true, primary: true },
      { label: "Connect it", href: connectHref, external: true },
    ],
  };
}

// ---- Pinterest (one press through the connection service; Pinterest's page also signs people up)

async function pinterestStep(c: Ctx): Promise<Outcome> {
  const accounts = (await socialAccountsFor(c.workspaceId, c.shop.id)).filter((a) => a.platform === "pinterest");
  const real = accounts.find((a) => a.status === "connected");
  if (real) return { state: "done", note: `Connected as ${real.handle ? `@${real.handle}` : real.name}. Posts are pinned to the shop's board.` };
  const connectHref = `/api/connect/pinterest/start?shop=${c.shop.id}`;
  if (accounts.some((a) => a.status === "needs_attention")) {
    return {
      state: "needs-you",
      ask: "Connect Pinterest again",
      note: "Pinterest needs one more press.",
      actions: [{ label: "Connect it again", href: `/social/connect?shop=${c.shop.id}#pinterest` , primary: true }],
    };
  }
  if (c.shop.brief?.source === "practice") {
    if (!accounts.some((a) => a.status === "practice")) {
      if (!c.memberId) return { state: "failed", note: "The person who pressed Launch isn't on this team any more. Press Try again." };
      const name = brandOf(c.shop);
      await createPracticeAccount(c.workspaceId, c.memberId, { id: c.shop.id, name, handle: usernameIdeas(name, "instagram")[0] ?? "practice.shop" }, "pinterest");
    }
    return { state: "done", note: "A practice Pinterest account is ready. Its posts stay in Armada.", actions: [{ label: "See it", href: `/social/connect?shop=${c.shop.id}#pinterest` }] };
  }
  if (!(await serviceOn())) return { state: "skipped", note: "Pinterest isn't switched on in Armada yet." };
  return {
    state: "needs-you",
    ask: "Connect Pinterest",
    note: "One press, then approve on Pinterest. Armada makes the shop a board.",
    actions: [{ label: "Connect Pinterest", href: connectHref, external: true, primary: true }],
  };
}

// ---- the first week of posts

async function postsStep(c: Ctx, prev: LaunchStep): Promise<Outcome> {
  if (prev.state === "done" && c.state.posts?.doneAt) return prev;
  const { eligible, practiceShop } = await shopAccounts(c.workspaceId, c.shop.id);
  // A real shop's posts go to its real accounts; a practice shop's to its practice ones.
  const targets = practiceShop ? eligible : eligible.filter((a) => a.status === "connected");
  if (!targets.length) {
    return {
      state: "waiting",
      note: practiceShop ? "Starts by itself once the practice accounts are ready." : "Starts by itself once Facebook or Instagram is connected.",
    };
  }
  const st = (c.state.posts ??= {});
  const see = { label: "See the posts", href: `/social?shop=${c.shop.id}` };
  if (!c.memberId) return { state: "failed", note: "The person who pressed Launch isn't on this team any more. Press Try again." };
  try {
    if (!st.runId) {
      const posts = await postsForShop(c.workspaceId, c.shop.id);
      const out = posts.filter((p) => ["scheduled", "posting", "posted"].includes(p.status));
      if (out.length) {
        st.doneAt = now();
        st.scheduled = out.length;
        return { state: "done", note: `${out.length} ${out.length === 1 ? "post is" : "posts are"} already scheduled or out.`, actions: [see] };
      }
      if (!posts.some((p) => p.status === "draft" && !p.rewriting)) {
        st.runId = await startWeek(c.workspaceId, c.shop.id, c.memberId, [...new Set(targets.map((a) => a.platform))]);
        return { state: "working", note: c.helperOnline ? "The AI is writing the first week of carousel posts." : HELPER_OFF };
      }
    } else {
      const run = await latestWeekRun(c.workspaceId, c.shop.id);
      if (!run) {
        st.runId = undefined;
        return { state: "working", note: "Starting the posts again." };
      }
      st.runId = run.id;
      if (run.status === "writing") return { state: "working", note: c.helperOnline ? "The AI is writing the first week of carousel posts." : HELPER_OFF };
      if (run.status !== "done") return { state: "failed", note: `${run.error ?? "The AI couldn't write the posts this time."} Press Try again.` };
    }
    const r = await scheduleAllSuggested(c.workspaceId, c.shop.id, targets.map((a) => a.id), appOrigin());
    st.scheduled = r.scheduled;
    st.past = r.past;
    st.doneAt = now();
    const where = [...new Set(targets.map((a) => platformLabel(a.platform)))].join(" and ");
    const practice = practiceShop ? " practice" : "";
    return {
      state: "done",
      note: r.scheduled
        ? `${r.scheduled} ${r.scheduled === 1 ? "post is" : "posts are"} scheduled on the${practice} ${where} ${targets.length === 1 ? "account" : "accounts"}, each at the time the AI picked.${r.past ? ` ${r.past} missed ${r.past === 1 ? "its" : "their"} time; give ${r.past === 1 ? "it" : "them"} a new one in Social posts.` : ""}`
        : "The posts' times had already passed, so none were scheduled. Give them new times in Social posts.",
      actions: [see],
    };
  } catch (e) {
    if (e instanceof PostProblem) return { state: "failed", note: e.message };
    throw e;
  }
}

// ---- ads

async function adsStep(c: Ctx): Promise<Outcome> {
  if (!c.memberId) return { state: "failed", note: "The person who pressed Launch isn't on this team any more. Press Try again." };
  const st = (c.state.ads ??= {});
  const see = { label: "See the ads", href: `/ads/${c.shop.id}` };
  try {
    st.setId ??= await startAds(c.workspaceId, c.memberId, c.shop.id);
    const read = async () =>
      (
        await withWorkspace(
          c.workspaceId,
          (tx) => tx<{ status: string; platform: string; error: string | null }[]>`select status, platform, error from armada.ad_sets where id = ${st.setId!}`,
        )
      )[0];
    let set = await read();
    if (!set) {
      st.setId = undefined;
      return { state: "working", note: "Starting the ads again." };
    }
    if (set.status === "failed") {
      if (!st.retry) return { state: "failed", note: `${set.error ?? "The AI couldn't write the ads."} Press Try again.`, actions: [see] };
      st.retry = false;
      await retryWriting(c.workspaceId, st.setId);
      set = (await read()) ?? set;
    }
    if (set.status === "writing") return { state: "working", note: c.helperOnline ? "The AI is writing the ads." : HELPER_OFF };
    if (set.status === "draft") {
      // Created switched off. Only a person's press in Ads ever switches them on.
      await launchPaused(c.workspaceId, c.memberId, st.setId);
      set = (await read()) ?? set;
      if (set.status === "draft") return { state: "working", note: "Creating the ads, switched off." };
    }
    if (set.status === "paused") {
      return {
        state: "done",
        note:
          set.platform === "practice"
            ? "Practice ads are ready and switched off. Nothing is spent; switch them on in Ads to watch practice results."
            : "The ads are ready on Meta and switched off. Nothing is spent until you press Switch on in Ads.",
        actions: [see],
      };
    }
    if (set.status === "on") return { state: "done", note: "You switched the ads on in Ads.", actions: [see] };
    return { state: "done", note: "The ads were stopped in Ads.", actions: [see] };
  } catch (e) {
    if (e instanceof AdsProblem) {
      // Another press is creating them right now: that's work under way, not a problem.
      if (/already being created/i.test(e.message)) return { state: "working", note: "Creating the ads, switched off." };
      return { state: "failed", note: e.message, actions: [see] };
    }
    throw e;
  }
}

const RUNNERS: Record<LaunchStepKey, (c: Ctx, prev: LaunchStep) => Promise<Outcome>> = {
  store: storeStep,
  checkout: (c) => checkoutStep(c.workspaceId, c.shop),
  ebay: ebayStep,
  facebook: (c) => socialStep(c, "facebook"),
  instagram: (c) => socialStep(c, "instagram"),
  pinterest: pinterestStep,
  posts: postsStep,
  ads: adsStep,
};

/**
 * One pass over every step. Returns the view afterwards. If another pass holds the lease (a second
 * tab, the helper's sweep), this one only reads.
 */
export async function advanceLaunch(workspaceId: string, shopId: string, opts: { budgetMs?: number } = {}): Promise<LaunchView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return null;
  const [row] = await withWorkspace(
    workspaceId,
    (tx) => tx<LaunchRow[]>`
      update armada.shop_launches set lease_until = now() + interval '2 minutes'
      where shop_id = ${shopId} and (lease_until is null or lease_until < now())
      returning *`,
  );
  if (!row) return launchView(workspaceId, shopId);
  const release = () => withWorkspace(workspaceId, (tx) => tx`update armada.shop_launches set lease_until = null where shop_id = ${shopId}`);
  try {
    const shop = await getShop(workspaceId, shopId);
    if (!shop) {
      await release();
      return null;
    }
    const helper = await helperStatus().catch(() => ({ online: true }));
    const c: Ctx = {
      workspaceId,
      shop,
      memberId: row.startedBy,
      state: structuredClone(row.state ?? {}),
      deadline: Date.now() + (opts.budgetMs ?? 40_000),
      helperOnline: helper.online,
    };
    const before = normalizeSteps(row.steps);
    const steps: LaunchStep[] = [];
    for (const prev of before) {
      let out: Outcome;
      try {
        out = await RUNNERS[prev.key](c, prev);
      } catch (e) {
        console.error("launch step failed", prev.key, shopId, e);
        out = { state: "failed", note: OOPS };
      }
      const next: LaunchStep = { key: prev.key, label: prev.label, state: out.state, note: out.note, actions: out.actions, ask: out.ask, progress: out.progress };
      if (next.state === "done" || next.state === "skipped") next.finishedAt = prev.state === next.state && prev.finishedAt ? prev.finishedAt : now();
      steps.push(next);
    }
    const status = launchStatus(steps);
    await withWorkspace(
      workspaceId,
      (tx) => tx`
        update armada.shop_launches
        set steps = ${tx.json(steps as never)}, state = ${tx.json(c.state as never)}, status = ${status}, updated_at = now(),
            finished_at = ${status === "done" ? (row.finishedAt ?? new Date()) : null}, lease_until = null
        where shop_id = ${shopId}`,
    );
    // The record: each step's arrival at a new state, and the launch finishing.
    for (const s of steps) {
      const was = before.find((b) => b.key === s.key);
      if (was?.state !== s.state && s.state !== "working" && s.state !== "waiting") {
        await audit(workspaceId, null, "launch.step", { shopId, step: s.key, state: s.state, note: s.note ?? null });
      }
    }
    if (status === "done" && row.status !== "done") await audit(workspaceId, null, "launch.done", { shopId });
    return viewOf(workspaceId, shop, { ...row, steps, status, state: c.state, finishedAt: status === "done" ? (row.finishedAt ?? new Date()) : null }, helper.online);
  } catch (e) {
    await release().catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- reading

async function viewOf(workspaceId: string, shop: ShopRow, row: LaunchRow, helperOnline: boolean): Promise<LaunchView> {
  const steps = normalizeSteps(row.steps);
  const wantsKit = steps.some((s) => (s.key === "facebook" || s.key === "instagram") && s.state === "needs-you");
  let kit: LaunchKit | null = null;
  if (wantsKit) {
    const { kit: k, link } = await kitFor(workspaceId, shop);
    kit = {
      name: brandOf(shop),
      pageAbout: k.facebook.about,
      website: k.facebook.website,
      instagramBio: k.instagram.bio,
      username: k.instagram.usernames[0] ?? null,
      link,
      avatarUrl: kitImageUrl(shop.slug, "avatar"),
      coverUrl: kitImageUrl(shop.slug, "cover"),
    };
  }
  return {
    shopId: shop.id,
    status: row.status,
    steps,
    startedAt: new Date(row.startedAt).toISOString(),
    finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
    helperOnline,
    kit,
  };
}

/** What the progress view shows. Null when the shop hasn't been launched. */
export async function launchView(workspaceId: string, shopId: string): Promise<LaunchView | null> {
  const row = await loadRow(workspaceId, shopId);
  if (!row) return null;
  const shop = await getShop(workspaceId, shopId);
  if (!shop) return null;
  const helper = await helperStatus().catch(() => ({ online: true }));
  return viewOf(workspaceId, shop, row, helper.online);
}

/**
 * The helper's once-a-minute sweep: launches nobody is watching carry on (the AI finished the
 * posts, eBay has room for more listings, the person connected an account in another tab).
 */
export async function advanceOpenLaunches(budgetMs = 100_000): Promise<number> {
  const rows = await asSystem(
    (tx) => tx<{ shopId: string; workspaceId: string }[]>`
      select shop_id, workspace_id from armada.shop_launches
      where status <> 'done' and (lease_until is null or lease_until < now())
        and updated_at < now() - interval '45 seconds' and started_at > now() - interval '30 days'
      order by updated_at limit 8`,
  );
  const deadline = Date.now() + budgetMs;
  let n = 0;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    await advanceLaunch(r.workspaceId, r.shopId, { budgetMs: 25_000 }).catch((e) => console.error("launch sweep failed", r.shopId, e));
    n++;
  }
  return n;
}
