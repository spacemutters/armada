import { notFound, redirect } from "next/navigation";
import { SetupView } from "./setup-view";
import { PageHeader } from "@/components/ui";
import { ebaySetupView } from "@/connectors/ebay/setup";
import { metaSetupView } from "@/connectors/meta/setup";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";

export const metadata = { title: "Setting up" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROBLEMS: Record<string, string> = {
  role: "Only the owner or a manager can do this.",
  ebay_off: "eBay isn't switched on in Armada right now.",
  ebay_declined: "eBay didn't give Armada access. Press Sign in to eBay and choose Agree on eBay's page.",
  ebay_failed: "eBay didn't finish signing you in. Try again.",
  ebay_busy: "eBay is busy right now. Try again in a minute.",
};

export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { problem } = await searchParams;
  if (!UUID.test(id)) notFound();

  const [store] = await withWorkspace(
    session.workspaceId,
    (tx) => tx<{ platform: string }[]>`select platform from armada.stores where id = ${id} and mode = 'live'`,
  );
  const view =
    store?.platform === "ebay" ? await ebaySetupView(session.workspaceId, id) : store?.platform === "facebook" ? await metaSetupView(session.workspaceId, id) : null;
  if (!view) notFound();
  if (view.finished && view.status === "connected") redirect(`/stores/${id}`);

  const where = view.platform === "ebay" ? "eBay" : "Facebook and Instagram";
  const message = typeof problem === "string" ? PROBLEMS[problem] : undefined;
  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title={`Setting up ${view.name}`} subtitle={`Armada is getting your ${where} store ready to sell. You can leave this page; it carries on from here when you come back.`} />
      {message ? (
        <p role="alert" className="mb-5 rounded-xl border border-line bg-raised px-4 py-3 text-[14px] text-negative">
          {message}
        </p>
      ) : null}
      <SetupView initial={view} canAct={session.role === "owner" || session.role === "manager"} />
    </div>
  );
}
