import "server-only";
import { open, seal } from "@/lib/crypto";
import { withWorkspace, type Tx } from "@/lib/db";
import type { SocialPlatform } from "@/lib/social/types";
import type { PageSetupResult } from "@/connectors/social-accounts/meta";
import { isViaService, type ViaService } from "@/connectors/pipedream/core";

// Reading and writing armada.social_accounts. Access is sealed on the way in and only opened when
// Armada is about to call the platform; nothing outside lib/social/accounts ever sees it.

export type AccountKind = "real" | "practice";
export type AccountStatus = "connected" | "needs_attention" | "practice";

export interface AccountMeta {
  /** Instagram: the Facebook Page it's linked to (Armada reaches Instagram through it). Facebook: the Page itself. */
  pageId?: string;
  pageName?: string;
  /** The profile's public link. */
  link?: string | null;
  /** Facebook: whether the Page had an Instagram professional account linked when last checked. */
  instagramLinked?: boolean;
  /** Facebook: what Armada filled in on the Page from the profile kit. */
  kit?: PageSetupResult & { at: string };
  /** Facebook: connected through the connection service (posting only). */
  viaService?: boolean;
  /** Instagram: connected through Composio's approved Instagram app. */
  viaComposio?: boolean;
  /** Pinterest: the board the shop's pins go to, and whether the account can make carousel pins. */
  boardId?: string;
  boardName?: string;
  business?: boolean;
  /** The last thing the platform refused, in plain words. */
  lastProblem?: string;
  lastProblemAt?: string;
}

export interface AccountRow {
  id: string;
  workspaceId: string;
  shopId: string;
  platform: SocialPlatform;
  kind: AccountKind;
  name: string;
  handle: string | null;
  externalId: string | null;
  status: AccountStatus;
  tokenExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  meta: AccountMeta;
  createdAt: Date;
  updatedAt: Date;
}

/** What each platform's sealed secret holds. */
export interface MetaPageSecret {
  pageToken: string;
  /** The person's long-lived Meta access (about 60 days); kept to look for newly linked Instagram accounts. */
  userToken?: string;
}
export interface TikTokSecret {
  accessToken: string;
  refreshToken: string;
}
/** Pinterest through the connection service: which account it is there, never a key. */
export type ServiceSecret = ViaService;
/** Instagram through Composio: which connection it is there, never a key. */
export interface ComposioSecret {
  composio: { connectedAccountId: string; userId: string };
}

const COLUMNS = "id, workspace_id, shop_id, platform, kind, name, handle, external_id, status, token_expires_at, refresh_expires_at, meta, created_at, updated_at";

export async function accountsForShop(workspaceId: string, shopId: string): Promise<AccountRow[]> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return [];
  return withWorkspace(
    workspaceId,
    (tx) => tx<AccountRow[]>`
      select ${tx.unsafe(COLUMNS)} from armada.social_accounts
      where shop_id = ${shopId}
      order by case platform when 'instagram' then 1 when 'facebook' then 2 when 'tiktok' then 3 else 4 end, kind`,
  );
}

/** For the shop list: how many accounts each shop has, by what they are. */
export async function accountCountsByShop(workspaceId: string): Promise<Record<string, { connected: number; attention: number; practice: number }>> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ shopId: string; status: AccountStatus; n: number }[]>`
      select shop_id, status, count(*)::int as n from armada.social_accounts group by shop_id, status`,
  );
  const out: Record<string, { connected: number; attention: number; practice: number }> = {};
  for (const r of rows) {
    const c = (out[r.shopId] ??= { connected: 0, attention: 0, practice: 0 });
    if (r.status === "connected") c.connected += r.n;
    else if (r.status === "needs_attention") c.attention += r.n;
    else c.practice += r.n;
  }
  return out;
}

/** One account with its access opened. Only for code about to call the platform. */
export async function loadAccountWithSecret<S>(tx: Tx, accountId: string, lock = false): Promise<(AccountRow & { secret: S | null }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const rows = lock
    ? await tx<(AccountRow & { secret: Buffer | null })[]>`select ${tx.unsafe(COLUMNS)}, secret from armada.social_accounts where id = ${accountId} for update`
    : await tx<(AccountRow & { secret: Buffer | null })[]>`select ${tx.unsafe(COLUMNS)}, secret from armada.social_accounts where id = ${accountId}`;
  const row = rows[0];
  if (!row) return null;
  return { ...row, secret: row.secret ? open<S>(row.secret) : null };
}

export interface RealAccountInput {
  shopId: string;
  platform: SocialPlatform;
  name: string;
  handle: string | null;
  externalId: string;
  secret: MetaPageSecret | TikTokSecret | ComposioSecret | ServiceSecret;
  tokenExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  meta: AccountMeta;
  memberId: string | null;
  /** "needs_attention" when the platform connected it without everything Armada needs. */
  status?: "connected" | "needs_attention";
}

/** Connects (or reconnects) a shop's real account on one platform. Connecting again updates the same row. */
export async function saveRealAccount(tx: Tx, workspaceId: string, a: RealAccountInput): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into armada.social_accounts
      (workspace_id, shop_id, platform, kind, name, handle, external_id, status, secret, token_expires_at, refresh_expires_at, meta, connected_by)
    values (${workspaceId}, ${a.shopId}, ${a.platform}, 'real', ${a.name}, ${a.handle}, ${a.externalId}, ${a.status ?? "connected"},
            ${seal(a.secret)}, ${a.tokenExpiresAt ?? null}, ${a.refreshExpiresAt ?? null}, ${tx.json(a.meta as never)}, ${a.memberId})
    on conflict (shop_id, platform, kind) do update set
      name = excluded.name, handle = excluded.handle, external_id = excluded.external_id, status = excluded.status,
      secret = excluded.secret, token_expires_at = excluded.token_expires_at, refresh_expires_at = excluded.refresh_expires_at,
      meta = excluded.meta, connected_by = excluded.connected_by, updated_at = now()
    returning id`;
  await tx`
    insert into armada.audit_log (workspace_id, member_id, action, detail)
    values (${workspaceId}, ${a.memberId}, 'social.connected', ${tx.json({ shopId: a.shopId, platform: a.platform, name: a.name, handle: a.handle } as never)})`;
  return row.id;
}

/** Stores renewed access (TikTok's daily renewal). */
export async function saveRenewedSecret(tx: Tx, accountId: string, secret: TikTokSecret, tokenExpiresAt: Date, refreshExpiresAt: Date): Promise<void> {
  await tx`
    update armada.social_accounts
    set secret = ${seal(secret)}, token_expires_at = ${tokenExpiresAt}, refresh_expires_at = ${refreshExpiresAt}, updated_at = now()
    where id = ${accountId}`;
}

/** Marks a real account as needing the person (the platform stopped accepting Armada's access). */
export async function markNeedsAttention(workspaceId: string, accountId: string, problem: string): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.social_accounts
      set status = 'needs_attention', updated_at = now(),
          meta = meta || ${tx.json({ lastProblem: problem, lastProblemAt: new Date().toISOString() } as never)}
      where id = ${accountId} and kind = 'real'`,
  );
}

/** Remembers the last refusal without changing the status (a picture problem, a daily limit). */
export async function noteProblem(workspaceId: string, accountId: string, problem: string): Promise<void> {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      update armada.social_accounts
      set meta = meta || ${tx.json({ lastProblem: problem, lastProblemAt: new Date().toISOString() } as never)}, updated_at = now()
      where id = ${accountId}`,
  );
}

export async function updateMeta(tx: Tx, accountId: string, patch: AccountMeta): Promise<void> {
  await tx`update armada.social_accounts set meta = meta || ${tx.json(patch as never)}, updated_at = now() where id = ${accountId}`;
}

/** A practice account for one platform: behaves like a connected one, and its posts stay in Armada. */
export async function createPracticeAccount(
  workspaceId: string,
  memberId: string,
  shop: { id: string; name: string; handle: string },
  platform: SocialPlatform,
): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into armada.social_accounts (workspace_id, shop_id, platform, kind, name, handle, status, meta, connected_by)
      values (${workspaceId}, ${shop.id}, ${platform}, 'practice', ${shop.name}, ${shop.handle}, 'practice', '{}', ${memberId})
      on conflict (shop_id, platform, kind) do update set updated_at = now()
      returning id`;
    await tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, 'social.practice_created', ${tx.json({ shopId: shop.id, platform } as never)})`;
    return row.id;
  });
}

/**
 * Removes a shop's account from Armada (its practice posts go with it). `realToo` false leaves real
 * accounts alone, for people who may only remove practice ones.
 */
export async function removeAccount(workspaceId: string, memberId: string, accountId: string, realToo: boolean): Promise<AccountRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = realToo
      ? await tx<AccountRow[]>`delete from armada.social_accounts where id = ${accountId} returning ${tx.unsafe(COLUMNS)}`
      : await tx<AccountRow[]>`delete from armada.social_accounts where id = ${accountId} and kind = 'practice' returning ${tx.unsafe(COLUMNS)}`;
    if (row) {
      await tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${workspaceId}, ${memberId}, 'social.removed', ${tx.json({ shopId: row.shopId, platform: row.platform, kind: row.kind, name: row.name } as never)})`;
    }
    return row ?? null;
  });
}

export async function recordPracticePost(workspaceId: string, accountId: string, post: { caption: string; slides: { imageUrl: string; alt: string }[] }): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into armada.practice_social_posts (workspace_id, account_id, caption, slides)
      values (${workspaceId}, ${accountId}, ${post.caption}, ${tx.json(post.slides as never)})
      returning id`;
    return row.id;
  });
}

export interface PracticePost {
  id: string;
  accountId: string;
  caption: string;
  slides: { imageUrl: string; alt: string }[];
  createdAt: Date;
}

export async function practicePostsFor(workspaceId: string, accountIds: string[], perAccount = 3): Promise<{ posts: PracticePost[]; counts: Record<string, number> }> {
  if (!accountIds.length) return { posts: [], counts: {} };
  return withWorkspace(workspaceId, async (tx) => {
    const posts = await tx<PracticePost[]>`
      select id, account_id, caption, slides, created_at from (
        select p.*, row_number() over (partition by account_id order by created_at desc) as n
        from armada.practice_social_posts p where account_id in ${tx(accountIds)}
      ) t where n <= ${perAccount} order by created_at desc`;
    const counts = await tx<{ accountId: string; n: number }[]>`
      select account_id, count(*)::int as n from armada.practice_social_posts where account_id in ${tx(accountIds)} group by account_id`;
    return { posts, counts: Object.fromEntries(counts.map((c) => [c.accountId, c.n])) };
  });
}

// ---------- choosing among several Pages ----------

export interface PageChoice {
  id: string;
  name: string;
  instagram: string | null;
}

export async function savePageChoices(
  workspaceId: string,
  c: { shopId: string; memberId: string | null; wanted: "facebook" | "instagram"; secret: unknown; choices: PageChoice[] },
): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    await tx`delete from armada.social_page_choices where shop_id = ${c.shopId} or expires_at < now()`;
    const [row] = await tx<{ id: string }[]>`
      insert into armada.social_page_choices (workspace_id, shop_id, member_id, wanted, secret, choices)
      values (${workspaceId}, ${c.shopId}, ${c.memberId}, ${c.wanted}, ${seal(c.secret)}, ${tx.json(c.choices as never)})
      returning id`;
    return row.id;
  });
}

export async function pendingPageChoices(workspaceId: string, shopId: string): Promise<{ id: string; wanted: "facebook" | "instagram"; choices: PageChoice[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return null;
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string; wanted: "facebook" | "instagram"; choices: PageChoice[] }[]>`
      select id, wanted, choices from armada.social_page_choices
      where shop_id = ${shopId} and expires_at > now() order by created_at desc limit 1`,
  );
  return rows[0] ?? null;
}

/** Uses up a pending choice and returns its opened access. */
export async function takePageChoices<S>(tx: Tx, choiceId: string, shopId: string): Promise<{ wanted: "facebook" | "instagram"; secret: S; choices: PageChoice[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(choiceId)) return null;
  const [row] = await tx<{ wanted: "facebook" | "instagram"; secret: Buffer; choices: PageChoice[] }[]>`
    delete from armada.social_page_choices where id = ${choiceId} and shop_id = ${shopId} and expires_at > now()
    returning wanted, secret, choices`;
  return row ? { wanted: row.wanted, secret: open<S>(row.secret), choices: row.choices } : null;
}

export async function dropPageChoices(workspaceId: string, shopId: string): Promise<void> {
  await withWorkspace(workspaceId, (tx) => tx`delete from armada.social_page_choices where shop_id = ${shopId}`);
}

/** The connection-service accounts this workspace's shops already use for a platform, so a new one can be told apart. */
export async function serviceAccountIds(workspaceId: string, platform: SocialPlatform, exceptRow?: string): Promise<Set<string>> {
  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ id: string; secret: Buffer | null }[]>`select id, secret from armada.social_accounts where platform = ${platform} and kind = 'real'`,
  );
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.id === exceptRow) continue;
    try {
      const s = r.secret ? open<unknown>(r.secret) : null;
      if (isViaService(s)) ids.add(s.accountId);
    } catch {
      // Sealed with an older key: can't be one of these.
    }
  }
  return ids;
}
