"use server";

import { redirect } from "next/navigation";
import { advanceEbaySetup } from "@/connectors/ebay/setup";
import type { SetupStep } from "@/connectors/ebay/core";
import { advanceMetaSetup } from "@/connectors/meta/setup";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";
import { openPracticeStore, type PracticePlatform } from "./practice";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Practice store, one press: made on the spot, then straight to its page. */
export async function openPractice(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "owner" && session.role !== "manager") redirect("/stores/new?problem=role");
  const raw = String(formData.get("platform") ?? "shopify");
  const platform: PracticePlatform = raw === "ebay" || raw === "facebook" ? raw : "shopify";
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const opened = await withWorkspace(session.workspaceId, (tx) => openPracticeStore(tx, session.workspaceId, session.memberId, { platform, name }));
  redirect(`/stores/${opened.storeId}`);
}

export interface SetupState {
  storeId: string;
  name: string;
  platform: "ebay" | "facebook";
  status: string;
  steps: SetupStep[];
  finished: boolean;
}

/**
 * Runs the next setup step of a live eBay account or Facebook shop and returns where it got to.
 * `retry` runs a step that last needed the person or failed; `confirm` says the person finished the
 * step that's theirs; `postalCode` answers the ship-from question.
 */
export async function advanceSetup(storeId: string, input: { retry?: boolean; confirm?: boolean; postalCode?: string } = {}): Promise<SetupState | null> {
  const session = await requireSession();
  if (!UUID.test(storeId)) return null;
  if (session.role !== "owner" && session.role !== "manager") return null;
  const [store] = await withWorkspace(
    session.workspaceId,
    (tx) => tx<{ platform: string }[]>`select platform from armada.stores where id = ${storeId} and mode = 'live'`,
  );
  const opts = {
    retry: input.retry === true,
    confirm: input.confirm === true,
    postalCode: typeof input.postalCode === "string" ? input.postalCode.slice(0, 16) : undefined,
  };
  if (store?.platform === "ebay") return advanceEbaySetup(session.workspaceId, storeId, { retry: opts.retry, postalCode: opts.postalCode });
  if (store?.platform === "facebook") return advanceMetaSetup(session.workspaceId, storeId, { retry: opts.retry, confirm: opts.confirm });
  return null;
}
