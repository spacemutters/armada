import "server-only";
import { composioOn } from "@/connectors/composio/client";
import { stripeConnection } from "@/lib/billing/settings";
import { withWorkspace } from "@/lib/db";
import { CREDENTIAL_PROVIDER } from "./status";
import type { Provider } from "./types";

// Home's "Needs you" list also carries the setup that's still waiting on a person, each as one line
// with its one press: payments and Instagram (for the Armada owner), and any connection someone
// started in the last three days but didn't finish (they closed the platform's page, or weren't
// signed in there).

export interface SetupNeed {
  title: string;
  body: string;
  href: string;
}

/** Connections finished on the service's page, and what they're called. */
const SERVICE: Partial<Record<Provider, string>> = { printful: "Printful", printify: "Printify", tiktok_ads: "TikTok Ads", google_ads: "Google Ads" };

export async function setupNeeds(workspaceId: string, opts: { admin: boolean; canConnect: boolean }): Promise<SetupNeed[]> {
  const out: SetupNeed[] = [];
  if (opts.admin && !(await stripeConnection())) out.push({ title: "Connect payments", body: "Paste your Stripe key once.", href: "/billing" });
  if (opts.admin && !composioOn()) out.push({ title: "Switch on Instagram", body: "Paste the Composio key once.", href: "/connections" });
  if (!opts.canConnect) return out;

  const rows = await withWorkspace(
    workspaceId,
    (tx) => tx<{ provider: string; connected: boolean }[]>`
      select p.provider,
             exists (select 1 from armada.credentials c
                     where c.provider = (case p.provider when 'google_ads' then 'google' when 'tiktok_ads' then 'tiktok' else p.provider end)
                       and c.status = 'connected') as connected
      from (select distinct split_part(action, '.', 1) as provider from armada.audit_log
            where action like '%.connect_started' and created_at > now() - interval '3 days') p`,
  );
  for (const r of rows) {
    const name = SERVICE[r.provider as Provider];
    if (!name || r.connected) continue;
    // Keep the mapping honest: the credential the check looked for is the one Connections keeps.
    if (CREDENTIAL_PROVIDER[r.provider as Provider] === undefined) continue;
    const body = r.provider === "google_ads" ? "Needs a Google Ads account first." : "Sign in on their page and approve.";
    out.push({ title: `Finish connecting ${name}`, body, href: `/api/connect/service/${r.provider}/start` });
  }
  return out;
}
