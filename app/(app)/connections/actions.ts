"use server";

import { refresh } from "next/cache";
import type { FormResult } from "@/components/connect/cj-connect";
import type { ServiceResult } from "@/components/connect/service-setup";
import { connectCj, describeCjError, disconnectCj } from "@/connectors/cj/client";
import { clearPdSettings, savePdSettings } from "@/connectors/pipedream/client";
import { disconnectShopify } from "@/connectors/shopify/client";
import { isPlatformAdmin } from "../admin/access";
import { forgetViaService } from "@/lib/connections/service";
import { isAppKey, saveAppKeys } from "@/lib/app-keys";
import { requireSession } from "@/lib/auth/session";
import { connector } from "@/lib/connections/registry";
import { canManageConnections, CREDENTIAL_PROVIDER, credentialLabelFor } from "@/lib/connections/status";
import type { Provider } from "@/lib/connections/types";
import { withWorkspace } from "@/lib/db";

const NOT_ALLOWED: FormResult = { ok: false, message: "Only the owner or a manager can change connections." };
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Checks a pasted CJ key with CJ and keeps it sealed. CJ's refusals come back as plain words. */
export async function connectCjHere(_prev: FormResult | null, formData: FormData): Promise<FormResult> {
  const session = await requireSession();
  if (!canManageConnections(session.role)) return NOT_ALLOWED;
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (apiKey.length < 10 || apiKey.length > 300) return { ok: false, message: "Paste the whole key from CJ. It's a long line of letters and numbers." };
  try {
    const meta = await connectCj(session.workspaceId, apiKey);
    await withWorkspace(
      session.workspaceId,
      (tx) => tx`
        insert into armada.audit_log (workspace_id, member_id, action, detail)
        values (${session.workspaceId}, ${session.memberId}, 'cj.connected', ${tx.json({ account: meta.account ?? null } as never)})`,
    );
  } catch (e) {
    return { ok: false, message: describeCjError(e) };
  }
  refresh();
  return { ok: true, message: "CJ is connected." };
}

/**
 * Disconnects one account. `key` is a store's id for store platforms and the credential's label
 * for the others. Shopify also removes Armada from the store in Shopify; the other store platforms
 * are let go here (their own connectors can add a platform-side step later).
 */
export async function disconnectHere(_prev: FormResult | null, formData: FormData): Promise<FormResult> {
  const session = await requireSession();
  if (!canManageConnections(session.role)) return NOT_ALLOWED;
  const provider = String(formData.get("provider") ?? "") as Provider;
  const key = String(formData.get("key") ?? "");
  const c = connector(provider);
  if (!c) return { ok: false, message: "That connection wasn't found. Reload the page and try again." };

  if (provider === "cj") {
    await disconnectCj(session.workspaceId);
    await audit(session.workspaceId, session.memberId, "cj.disconnected", {});
  } else if (c.kind === "store") {
    if (!isUuid(key)) return { ok: false, message: "That store wasn't found. Reload the page and try again." };
    const platform = provider === "facebook" ? "facebook" : provider;
    const [store] = await withWorkspace(
      session.workspaceId,
      (tx) => tx<{ id: string; domain: string | null; meta: Record<string, unknown> }[]>`
        select id, domain, meta from armada.stores where id = ${key} and platform = ${platform} and mode = 'live'`,
    );
    if (!store) return { ok: false, message: "That store wasn't found. Reload the page and try again." };
    if (provider === "shopify" && store.domain) {
      await disconnectShopify(session.workspaceId, session.memberId, store.domain);
    } else {
      const label = credentialLabelFor(store);
      // Connected through the connection service: let go of the account there too.
      if (label) await forgetViaService(session.workspaceId, CREDENTIAL_PROVIDER[provider], label);
      await withWorkspace(session.workspaceId, async (tx) => {
        if (label) await tx`delete from armada.credentials where provider = ${CREDENTIAL_PROVIDER[provider]} and label = ${label}`;
        await tx`
          update armada.stores
          set status = 'disconnected', meta = meta || ${tx.json({ disconnectedAt: new Date().toISOString(), disconnectedBy: session.memberId } as never)}
          where id = ${store.id}`;
      });
      await audit(session.workspaceId, session.memberId, "connection.disconnected", { provider, storeId: store.id });
    }
  } else {
    if (provider === "meta_ads") {
      // Meta ads keep their access under label "ads" (connectors/meta-ads); a Facebook shop's credential stays.
      await withWorkspace(session.workspaceId, (tx) => tx`delete from armada.credentials where provider = 'meta' and label = 'ads'`);
    } else {
      await forgetViaService(session.workspaceId, CREDENTIAL_PROVIDER[provider], key);
      await withWorkspace(
        session.workspaceId,
        (tx) => tx`delete from armada.credentials where provider = ${CREDENTIAL_PROVIDER[provider]} and label = ${key}`,
      );
    }
    await audit(session.workspaceId, session.memberId, "connection.disconnected", { provider, label: key });
  }
  refresh();
  return { ok: true, message: `${c.name} is disconnected.` };
}

async function audit(workspaceId: string, memberId: string, action: string, detail: Record<string, unknown>) {
  await withWorkspace(
    workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${workspaceId}, ${memberId}, ${action}, ${tx.json(detail as never)})`,
  );
}

/** Platform admins only: switches on one-click connections by saving the connection service's settings. */
export async function saveServiceHere(_prev: ServiceResult | null, formData: FormData): Promise<ServiceResult> {
  const session = await requireSession();
  if (!(await isPlatformAdmin(session.memberId))) return { ok: false, message: "Only Armada's admin can change this." };
  const environment = formData.get("environment") === "production" ? "production" : "development";
  const typed = { projectId: String(formData.get("projectId") ?? "").slice(0, 80), clientId: String(formData.get("clientId") ?? "").slice(0, 200), environment } as const;
  const problem = await savePdSettings(
    {
      clientId: String(formData.get("clientId") ?? ""),
      clientSecret: String(formData.get("clientSecret") ?? ""),
      projectId: String(formData.get("projectId") ?? ""),
      environment,
    },
    session.memberId,
  );
  if (problem) return { ok: false, message: problem, typed };
  await withWorkspace(
    session.workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'connection_service.saved', ${tx.json({ environment } as never)})`,
  );
  refresh();
  return { ok: true, message: "Switched on. Shopify and eBay now connect in one press." };
}

export async function clearServiceHere(): Promise<ServiceResult> {
  const session = await requireSession();
  if (!(await isPlatformAdmin(session.memberId))) return { ok: false, message: "Only Armada's admin can change this." };
  await clearPdSettings();
  await withWorkspace(
    session.workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'connection_service.cleared', '{}'::jsonb)`,
  );
  refresh();
  return { ok: true, message: "Switched off. Accounts already connected stop working until it's on again." };
}

/** Platform admins only: saves Armada's own app keys for one platform, pasted on its card. */
export async function saveAppKeysHere(_prev: FormResult | null, formData: FormData): Promise<FormResult> {
  const session = await requireSession();
  if (!(await isPlatformAdmin(session.memberId))) return { ok: false, message: "Only Armada's admin can change this." };
  const c = connector(String(formData.get("provider") ?? "") as Provider);
  if (!c) return { ok: false, message: "That connection wasn't found. Reload the page and try again." };
  const values: Record<string, string> = {};
  for (const name of c.requiredEnv.filter(isAppKey)) {
    const v = formData.get(name);
    if (typeof v === "string" && v.trim()) {
      if (v.trim().length > 500 || /\s/.test(v.trim())) return { ok: false, message: "One of those has a space in it or is far too long. Copy it again." };
      values[name] = v;
    }
  }
  if (!Object.keys(values).length) return { ok: false, message: "Paste at least one key first." };
  const saved = await saveAppKeys(values, session.memberId);
  await withWorkspace(
    session.workspaceId,
    (tx) => tx`
      insert into armada.audit_log (workspace_id, member_id, action, detail)
      values (${session.workspaceId}, ${session.memberId}, 'app_keys.saved', ${tx.json({ provider: c.provider, names: saved } as never)})`,
  );
  refresh();
  return { ok: true, message: c.available() ? `Saved. ${c.name} is switched on.` : `Saved. ${c.name} switches on once every setting above is in.` };
}
