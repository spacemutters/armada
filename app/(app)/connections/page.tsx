import { isPlatformAdmin } from "../admin/access";
import { clearServiceHere, connectCjHere, disconnectHere, saveServiceHere } from "./actions";
import { ConnectBanner, ConnectorGroup } from "@/components/connect/connector-card";
import { ServiceSetup } from "@/components/connect/service-setup";
import { pdStatus } from "@/connectors/pipedream/client";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { CONNECTOR_GROUPS, connector } from "@/lib/connections/registry";
import { canManageConnections, connectionStatus, problemMessage } from "@/lib/connections/status";
import { appOrigin, type Provider } from "@/lib/connections/types";

// Every connection in one place: stores, the supplier and ads, each with one primary action.
// Coming back from a platform lands here: ?connected=<provider>[&store=<id>] or
// ?problem=<code>&provider=<provider> (codes in lib/connections/status.ts).

export const metadata = { title: "Connections" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ConnectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [statuses, admin] = await Promise.all([connectionStatus(session.workspaceId), isPlatformAdmin(session.memberId)]);
  const service = admin ? await pdStatus() : null;
  const canManage = canManageConnections(session.role);
  const origin = appOrigin();

  const connected = statuses.find((s) => s.provider === one(sp.connected));
  const storeParam = one(sp.store);
  const connectedAccount = connected
    ? storeParam
      ? connected.accounts.find((a) => a.storeId === storeParam)
      : connected.accounts.find((a) => a.status === "connected")
    : undefined;
  const problemFor = connector(one(sp.provider) as Provider);
  const problem = problemMessage(one(sp.problem), problemFor?.name ?? "The platform");
  const typedShop = problemFor?.provider === "shopify" ? (one(sp.shop) ?? "").slice(0, 120) : "";
  const anyConnected = statuses.some((s) => s.connectedCount > 0);

  return (
    <>
      <PageHeader
        title="Connections"
        subtitle="Connect your stores, your supplier and your ads. Each one is a single approval on the platform's own site, and you can disconnect any time."
      />

      {connected ? (
        <ConnectBanner
          tone="done"
          title={connectedAccount ? `Connected as ${connectedAccount.name}.` : `${connected.connector.name} is connected.`}
          body={
            connected.connector.kind === "store"
              ? "It's in Stores now, ready for products."
              : connected.provider === "cj"
                ? "The shop builder and product search now use CJ's real catalog."
                : undefined
          }
          action={
            connectedAccount?.storeId ? (
              <ButtonLink href={`/stores/${connectedAccount.storeId}`} variant="quiet" className="min-h-11 md:min-h-9">
                Open the store
              </ButtonLink>
            ) : null
          }
        />
      ) : problem ? (
        <ConnectBanner tone="problem" title={problem} />
      ) : null}

      {service ? (
        <ServiceSetup
          view={{ on: service.on, from: service.from, projectId: service.projectId, environment: service.environment }}
          save={saveServiceHere}
          clear={clearServiceHere}
        />
      ) : null}

      {!canManage ? (
        <p className="mb-6 max-w-2xl text-[14px] text-muted">You can see what&apos;s connected here. The owner or a manager connects and disconnects accounts.</p>
      ) : null}

      <div className="flex flex-col gap-10">
        {CONNECTOR_GROUPS.map((g) => {
          const items = statuses.filter((s) => s.connector.kind === g.kind);
          return items.length ? (
            <ConnectorGroup
              key={g.kind}
              kind={g.kind}
              title={g.title}
              about={g.about}
              items={items}
              canManage={canManage}
              admin={admin}
              origin={origin}
              typedShop={typedShop}
              actions={{ connectCj: connectCjHere, disconnect: disconnectHere }}
              rollIn={anyConnected}
            />
          ) : null;
        })}
      </div>
    </>
  );
}
