import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { asSystem, withWorkspace } from "@/lib/db";
import type { Provider } from "./types";

// One-time state tokens for round trips through a platform's own sign-in. The raw token goes to the
// platform and comes back on the callback; only its hash is stored. A token works once, for 15
// minutes, and says which workspace and person started the round trip and why.

const hash = (s: string) => createHash("sha256").update(s).digest("base64url");

export interface StateDetail {
  /** Where to send the person when it's done, e.g. "/connections" or "/stores/new". */
  returnTo?: string;
  [key: string]: unknown;
}

export async function createState(
  workspaceId: string,
  memberId: string,
  provider: Provider,
  purpose: "connect" | "open",
  detail: StateDetail = {},
): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      insert into armada.oauth_states (state_hash, workspace_id, member_id, provider, purpose, detail)
      values (${hash(state)}, ${workspaceId}, ${memberId}, ${provider}, ${purpose}, ${tx.json(detail as never)})`,
  );
  return state;
}

export interface ConsumedState {
  workspaceId: string;
  memberId: string | null;
  provider: Provider;
  purpose: "connect" | "open";
  detail: StateDetail;
}

/**
 * Uses up a state token from a callback. Returns null if it's unknown, already used, expired, or
 * for a different platform. The callback doesn't carry a session it can trust, so the token is
 * what says whose workspace this is.
 */
export async function consumeState(state: string | null | undefined, provider: Provider): Promise<ConsumedState | null> {
  if (!state || state.length > 200) return null;
  const rows = await asSystem(
    (tx) => tx<ConsumedState[]>`
      update armada.oauth_states set used_at = now()
      where state_hash = ${hash(state)} and provider = ${provider} and used_at is null and expires_at > now()
      returning workspace_id, member_id, provider, purpose, detail`,
  );
  return rows[0] ?? null;
}
