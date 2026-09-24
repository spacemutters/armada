import "server-only";
import crypto from "node:crypto";
import type { Tx } from "@/lib/db";
import type { Role } from "@/lib/types";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface Invite {
  id: string;
  workspaceId: string | null;
  memberId: string | null;
  role: Role;
  expiresAt: Date;
  usedAt: Date | null;
}

/** An unused, unexpired invite for this token, or null. Must run in system mode. */
export async function findOpenInvite(tx: Tx, token: string): Promise<Invite | null> {
  const rows = await tx<Invite[]>`
    select id, workspace_id, member_id, role, expires_at, used_at
    from armada.invites
    where token_hash = ${hashToken(token)} and used_at is null and expires_at > now()`;
  return rows[0] ?? null;
}

/** Creates a one-time link token. Must run in system mode. */
export async function createInvite(
  tx: Tx,
  opts: { workspaceId?: string; memberId?: string; role?: Role; hours?: number },
): Promise<string> {
  const token = newToken();
  await tx`
    insert into armada.invites (workspace_id, member_id, role, token_hash, expires_at)
    values (${opts.workspaceId ?? null}, ${opts.memberId ?? null}, ${opts.role ?? "owner"},
            ${hashToken(token)}, now() + make_interval(hours => ${opts.hours ?? 72}))`;
  return token;
}
