import { AppNav } from "@/components/app-nav";
import { helperStatus } from "@/lib/ai/jobs";
import { requireSession } from "@/lib/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const helper = await helperStatus();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppNav workspaceName={session.workspaceName} memberName={session.name} helperOnline={helper.online} helperBusy={helper.busy} />
      <main className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:pt-10 md:pb-16">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}
