import "server-only";
import { z } from "zod";
import { enqueueJob, onJobFinished } from "@/lib/ai/jobs";
import { asSystem, withWorkspace, type Tx } from "@/lib/db";
import type { ShopRow } from "@/lib/shops/types";
import { clip } from "@/lib/text";
import type { AiJob } from "@/lib/types";
import { SYSTEM, variantsPrompt, variantsSchema, type Candidate, type HeroCopy } from "./prompt";

// Headline tests: the AI writes three other versions of a shop's home-page headline, the owner picks
// one (and can edit it), half the shop's visitors see it, and the numbers say which one gets more
// people to add something to their bag. Making the new version the winner can be undone.

export type TestStatus = "writing" | "choosing" | "running" | "finished" | "failed" | "cancelled";

export interface AbTest {
  id: string;
  workspaceId: string;
  shopId: string;
  element: "hero";
  status: TestStatus;
  original: HeroCopy;
  candidates: Candidate[];
  variant: Candidate | null;
  split: number;
  winner: "a" | "b" | "none" | null;
  replaced: HeroCopy | null;
  undoneAt: Date | null;
  practiceRates: { a: number; b: number } | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface Counts {
  a: { visitors: number; adds: number; practice: number };
  b: { visitors: number; adds: number; practice: number };
}

const TIMEOUT_MS = 150_000;

export class TestProblem extends Error {}

async function productTitles(tx: Tx, shop: ShopRow): Promise<string[]> {
  const ids = (shop.blueprint.products ?? []).map((p) => p.productId);
  if (!ids.length) return [];
  const rows = await tx<{ title: string }[]>`select title from armada.products where id in ${tx(ids)}`;
  return rows.map((r) => r.title);
}

async function askForVersions(tx: Tx, shop: ShopRow, testId: string, current: HeroCopy, earlier: HeroCopy[]) {
  await enqueueJob(tx, {
    workspaceId: shop.workspaceId,
    kind: "ab.variants",
    input: { system: SYSTEM, prompt: variantsPrompt(shop.blueprint, current, await productTitles(tx, shop), earlier), schema: variantsSchema as never, timeoutMs: TIMEOUT_MS },
    parent: { type: "ab_test", id: testId },
  });
}

/** Starts a headline test: saves the current headline as A and asks the AI for three others. */
export async function startHeadlineTest(workspaceId: string, shopId: string, memberId: string): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${shopId} and status in ('ready', 'published')`;
    if (!shop?.blueprint.hero) throw new TestProblem("This shop isn't ready yet.");
    const [open] = await tx<{ id: string }[]>`select id from armada.ab_tests where shop_id = ${shopId} and status in ('writing', 'choosing', 'running')`;
    if (open) return open.id;
    const [test] = await tx<{ id: string }[]>`
      insert into armada.ab_tests (workspace_id, shop_id, original, created_by)
      values (${workspaceId}, ${shopId}, ${tx.json(shop.blueprint.hero as never)}, ${memberId})
      returning id`;
    await askForVersions(tx, shop, test.id, shop.blueprint.hero, []);
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'test.started', ${tx.json({ shopId, testId: test.id } as never)})`;
    return test.id;
  });
}

/** Asks the AI for three more versions, different from the ones already shown. */
export async function writeMoreVersions(workspaceId: string, testId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [test] = await tx<AbTest[]>`select * from armada.ab_tests where id = ${testId} and status in ('choosing', 'failed')`;
    if (!test) return;
    const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${test.shopId}`;
    await tx`update armada.ab_tests set status = 'writing', error = null, updated_at = now() where id = ${testId}`;
    await askForVersions(tx, shop, testId, test.original, test.candidates);
  });
}

const Version = z.object({
  idea: z.string().transform((s) => clip(s, 110)),
  headline: z.string().transform((s) => clip(s, 70)),
  subhead: z.string().transform((s) => clip(s, 170)),
  cta: z.string().transform((s) => clip(s, 28)),
});
const Versions = z.object({ versions: z.array(Version).min(1) });

const same = (x: HeroCopy, y: HeroCopy) => x.headline.trim().toLowerCase() === y.headline.trim().toLowerCase();

onJobFinished("ab", async (tx: Tx, job: AiJob) => {
  if (job.parentType !== "ab_test" || !job.parentId) return;
  const [test] = await tx<AbTest[]>`select * from armada.ab_tests where id = ${job.parentId}`;
  if (!test || test.status !== "writing") return;
  if (job.status === "failed") {
    await tx`
      update armada.ab_tests set status = 'failed', error = 'The AI couldn''t write the versions, even on a second try.', updated_at = now()
      where id = ${test.id}`;
    return;
  }
  const parsed = Versions.safeParse(job.output);
  const fresh = parsed.success ? parsed.data.versions.filter((v) => v.headline && !same(v, test.original)) : [];
  if (!fresh.length) {
    await tx`update armada.ab_tests set status = 'failed', error = 'The AI''s answer came back in the wrong shape.', updated_at = now() where id = ${test.id}`;
    return;
  }
  await tx`update armada.ab_tests set status = 'choosing', candidates = ${tx.json(fresh as never)}, updated_at = now() where id = ${test.id}`;
});

/** Starts showing B to half the shop's visitors. */
export async function runTest(workspaceId: string, testId: string, variant: Candidate): Promise<void> {
  // Made-up rates, used only if the owner adds practice visitors: A around 2.5 to 4%, and B anywhere
  // from a quarter worse to a third better, so practice results can come out either way.
  const a = 0.025 + Math.random() * 0.015;
  const b = a * (0.75 + Math.random() * 0.6);
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.ab_tests
      set status = 'running', variant = ${tx.json(variant as never)}, practice_rates = ${tx.json({ a, b } as never)},
          started_at = now(), updated_at = now()
      where id = ${testId} and status = 'choosing'`,
  );
}

/**
 * Adds made-up visitors to a running test so the owner can see how results read before real
 * traffic arrives. They are stored as practice, shown as practice, and can be cleared.
 */
export async function addPracticeVisitors(workspaceId: string, testId: string, count: number): Promise<void> {
  const n = Math.max(1, Math.min(20_000, Math.round(count)));
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      with t as (select id, workspace_id, split, practice_rates from armada.ab_tests where id = ${testId} and status = 'running'),
      seen as (
        insert into armada.ab_events (test_id, workspace_id, visitor, kind, variant, practice)
        select t.id, t.workspace_id, 'practice-' || gen_random_uuid(), 'view', case when random() * 100 < t.split then 'b' else 'a' end, true
        from t, generate_series(1, ${n})
        returning test_id, workspace_id, visitor, variant
      )
      insert into armada.ab_events (test_id, workspace_id, visitor, kind, variant, practice)
      select seen.test_id, seen.workspace_id, seen.visitor, 'add', seen.variant, true
      from seen, t
      where random() < (t.practice_rates ->> seen.variant)::float8`,
  );
}

export async function clearPracticeVisitors(workspaceId: string, testId: string): Promise<void> {
  await withWorkspace(workspaceId, (tx) => tx`delete from armada.ab_events where test_id = ${testId} and practice`);
}

/** Ends a test. Choosing B puts the new headline on the shop and remembers the old one for undo. */
export async function finishTest(workspaceId: string, memberId: string, testId: string, winner: "a" | "b" | "none"): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [test] = await tx<AbTest[]>`select * from armada.ab_tests where id = ${testId} and status = 'running' for update`;
    if (!test) return;
    if (winner === "b" && test.variant) {
      const [shop] = await tx<ShopRow[]>`select * from armada.shops where id = ${test.shopId} for update`;
      const next: HeroCopy = { headline: test.variant.headline, subhead: test.variant.subhead, cta: test.variant.cta };
      await tx`
        update armada.shops set blueprint = jsonb_set(blueprint, '{hero}', ${tx.json(next as never)}), updated_at = now()
        where id = ${test.shopId}`;
      await tx`update armada.ab_tests set replaced = ${tx.json((shop.blueprint.hero ?? test.original) as never)} where id = ${testId}`;
    }
    await tx`update armada.ab_tests set status = 'finished', winner = ${winner}, finished_at = now(), updated_at = now() where id = ${testId}`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'test.finished', ${tx.json({ testId, shopId: test.shopId, winner } as never)})`;
  });
}

/** Puts the original headline back after the new version was made the winner. */
export async function undoWinner(workspaceId: string, memberId: string, testId: string): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [test] = await tx<AbTest[]>`
      select * from armada.ab_tests where id = ${testId} and status = 'finished' and winner = 'b' and replaced is not null and undone_at is null for update`;
    if (!test) return;
    await tx`
      update armada.shops set blueprint = jsonb_set(blueprint, '{hero}', ${tx.json(test.replaced as never)}), updated_at = now()
      where id = ${test.shopId}`;
    await tx`update armada.ab_tests set undone_at = now(), updated_at = now() where id = ${testId}`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'test.undone', ${tx.json({ testId, shopId: test.shopId } as never)})`;
  });
}

export async function cancelTest(workspaceId: string, testId: string): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.ab_tests set status = 'cancelled', finished_at = now(), updated_at = now()
      where id = ${testId} and status in ('writing', 'choosing', 'running', 'failed')`,
  );
}

// ---------- reading ----------

export async function testsForShop(workspaceId: string, shopId: string): Promise<AbTest[]> {
  return withWorkspace(workspaceId, (tx) => tx<AbTest[]>`select * from armada.ab_tests where shop_id = ${shopId} order by created_at desc limit 20`);
}

export async function countsFor(workspaceId: string, testIds: string[]): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (!testIds.length) return out;
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ testId: string; variant: "a" | "b"; views: number; adds: number; practice: number }[]>`
      select test_id, variant,
             count(*) filter (where kind = 'view')::int as views,
             count(*) filter (where kind = 'add')::int as adds,
             count(*) filter (where kind = 'view' and practice)::int as practice
      from armada.ab_events where test_id in ${tx(testIds)}
      group by test_id, variant`,
  );
  for (const id of testIds) out.set(id, { a: { visitors: 0, adds: 0, practice: 0 }, b: { visitors: 0, adds: 0, practice: 0 } });
  for (const r of rows) out.get(r.testId)![r.variant] = { visitors: r.views, adds: r.adds, practice: r.practice };
  return out;
}

// ---------- the storefront side ----------

export interface LiveTest {
  id: string;
  split: number;
  variant: HeroCopy;
}

export async function runningTestForShop(shopId: string): Promise<LiveTest | null> {
  const rows = await asSystem(
    (tx) => tx<{ id: string; split: number; variant: Candidate }[]>`
      select id, split, variant from armada.ab_tests where shop_id = ${shopId} and status = 'running' and variant is not null limit 1`,
  );
  return rows[0] ? { id: rows[0].id, split: rows[0].split, variant: rows[0].variant } : null;
}

/**
 * Counts a storefront visitor. A view is counted once per visitor per test; an add to the bag only
 * counts for a visitor who saw the headline, and in the version they saw.
 */
export async function recordVisit(slug: string, visitor: string, kind: "view" | "add", versionFor: (testId: string, split: number) => "a" | "b"): Promise<boolean> {
  return asSystem(async (tx) => {
    const [t] = await tx<{ id: string; workspaceId: string; split: number }[]>`
      select t.id, t.workspace_id, t.split from armada.ab_tests t join armada.shops s on s.id = t.shop_id
      where s.slug = ${slug} and t.status = 'running' limit 1`;
    if (!t) return false;
    if (kind === "view") {
      await tx`
        insert into armada.ab_events (test_id, workspace_id, visitor, kind, variant)
        values (${t.id}, ${t.workspaceId}, ${visitor}, 'view', ${versionFor(t.id, t.split)})
        on conflict do nothing`;
      return true;
    }
    const inserted = await tx`
      insert into armada.ab_events (test_id, workspace_id, visitor, kind, variant)
      select test_id, workspace_id, visitor, 'add', variant from armada.ab_events
      where test_id = ${t.id} and visitor = ${visitor} and kind = 'view'
      on conflict do nothing`;
    return inserted.count > 0;
  });
}
