import { PendingButton } from "@/components/fx/pending-button";
import { buttonClass, Card, StatusPill, type Tone } from "@/components/ui";
import type { LaunchStatus, LaunchView } from "@/lib/launch/core";
import { LaunchProgress } from "./launch-progress";

// The Launch card on a ready shop's page: before the press, what one press will do; after it,
// the launch as it happens (launch-progress.tsx).

const STATUS: Record<LaunchStatus, { tone: Tone; label: string }> = {
  working: { tone: "working", label: "Launching" },
  needs_you: { tone: "attention", label: "Needs you" },
  waiting: { tone: "off", label: "Waiting" },
  done: { tone: "ok", label: "Launched" },
};

export function LaunchSection({
  brand,
  practice,
  view,
  launch,
  canLaunch,
  problem,
}: {
  brand: string;
  /** A practice shop: practice accounts, practice ads, and nothing on real eBay. */
  practice: boolean;
  view: LaunchView | null;
  launch: () => Promise<void>;
  canLaunch: boolean;
  problem: string | null;
}) {
  return (
    <Card id="launch" className="mb-6 scroll-mt-20 p-5 md:scroll-mt-6 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">{view ? `Launch of ${brand}` : `Launch ${brand}`}</h2>
        {view ? <StatusPill tone={STATUS[view.status].tone}>{STATUS[view.status].label}</StatusPill> : null}
      </div>
      {problem ? (
        <p role="alert" className="mt-3 max-w-3xl rounded-xl bg-attention-soft px-4 py-3 text-[13px] text-attention">
          {problem}
        </p>
      ) : null}
      {view ? (
        <div className="mt-2">
          <LaunchProgress initial={view} relaunch={launch} canLaunch={canLaunch} />
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-4">
          <p className="max-w-2xl text-[14px] text-muted">
            {practice
              ? "One press sets up everything around this shop: practice Facebook and Instagram accounts, the first week of posts, scheduled, and its ads, ready and switched off. It's a practice shop, so nothing reaches the real platforms, and its practice items never go on real eBay."
              : "One press sets up everything around this shop: its products listed on your eBay account, its Facebook Page and Instagram, the first week of posts, scheduled, and its ads, ready and switched off. Platforms only let people make accounts, so those steps become one press for you, with everything filled in and ready to copy."}
          </p>
          {canLaunch ? (
            <form action={launch}>
              <PendingButton pendingLabel="Launching…" beam className={buttonClass("primary", "min-h-11 px-6 text-[15px]")}>
                Launch
              </PendingButton>
            </form>
          ) : (
            <p className="text-[13px] text-muted">Ask the owner or a manager to launch it.</p>
          )}
        </div>
      )}
    </Card>
  );
}
