import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { ConnectButton } from "./connect-button";
import { PlatformMark } from "./marks";
import { Expand, HoldButton, PendingButton } from "@/components/fx";
import { buttonClass, Card, StatusPill, type Tone } from "@/components/ui";
import type { AccountRow, PracticePost } from "@/lib/social/accounts/store";
import type { SocialPlatform } from "@/lib/social/types";

// One platform on the social media page: its status, its one primary press, the practice account,
// and the profile kit. Server-rendered; the press, copy buttons and the kit's opening are the only
// client parts.
//
// The primary press is the real connection when it can be used (switched on, the person may connect,
// and the shop sells real products). Otherwise it's "Use a practice account", which always works.

export interface CardProps {
  platform: SocialPlatform;
  title: string;
  /** The platform connection is switched on in Armada (its settings exist). */
  ready: boolean;
  real: AccountRow | null;
  practice: AccountRow | null;
  practiceCount: number;
  practicePosts: PracticePost[];
  /** Where the one press goes (the platform's own sign-in, through Armada's start address). */
  startHref: string;
  /** The owner or a manager: connects and disconnects real accounts. */
  canConnect: boolean;
  /** Anyone but a viewer: makes and removes practice accounts. */
  canPractice: boolean;
  /** A practice shop: Armada's posts for it only go to practice accounts. */
  practiceShop: boolean;
  /** Instagram only: the shop's Facebook Page is connected but has no Instagram account linked. */
  needsLink?: { pageName: string } | null;
  /** Words under the title when nothing is connected: what the press does. */
  intro: ReactNode;
  /** "Don't have an account yet?" help, shown next to the press before connecting. */
  firstTime?: ReactNode;
  /** A second press beside "Set up" before connecting (Facebook: make a new Page). */
  firstTimeAction?: ReactNode;
  /** Extra actions for a connected account (Facebook: put the kit on the Page). */
  connectedExtra?: ReactNode;
  /** The profile kit, for platforms that have one. */
  kit?: ReactNode;
  kitOpen?: boolean;
  isAdmin: boolean;
  makePractice: () => Promise<void>;
  remove: (accountId: string) => Promise<void>;
  highlight?: boolean;
}

function statusOf(p: CardProps): { tone: Tone; label: string } {
  if (p.real?.status === "connected") return { tone: "ok", label: "Connected" };
  if (p.real?.status === "needs_attention" || p.needsLink) return { tone: "attention", label: "Needs you" };
  if (p.practiceShop) return p.practice ? { tone: "ok", label: "Practice" } : { tone: "off", label: "Not set up" };
  if (!p.ready) return { tone: "off", label: "Coming soon" };
  return { tone: "off", label: "Not set up" };
}

const at = (h: string | null) => (h ? `@${h.replace(/^@/, "")}` : null);

export function PlatformCard(p: CardProps) {
  const status = statusOf(p);
  const verb = p.platform === "facebook" ? "Set up Facebook Page" : `Set up ${p.title}`;
  const going = p.platform === "tiktok" ? "Opening TikTok…" : p.platform === "pinterest" ? "Opening Pinterest…" : "Opening Facebook…";
  const realUsable = p.ready && p.canConnect;

  let line: ReactNode;
  let primary: ReactNode = null;
  let secondary: ReactNode = null;
  if (p.real?.status === "connected") {
    const handle = at(p.real.handle);
    line = (
      <>
        Connected as <span className="font-medium text-ink">{p.platform === "facebook" ? p.real.name : (handle ?? p.real.name)}</span>
        {p.platform === "facebook" && handle ? <span> ({handle})</span> : null}
        {p.real.meta.lastProblem ? <span className="mt-1 block text-attention">{p.real.meta.lastProblem}</span> : null}
      </>
    );
    secondary = (
      <>
        {p.real.meta.link ? (
          <a href={p.real.meta.link} target="_blank" rel="noreferrer" className={buttonClass("secondary", "min-h-11 px-5")}>
            Open profile <ExternalLink aria-hidden className="size-4" />
          </a>
        ) : null}
        {p.connectedExtra}
      </>
    );
  } else if (p.real?.status === "needs_attention") {
    line = <span className="text-attention">{p.real.meta.lastProblem ?? `${p.title} stopped accepting Armada's access.`}</span>;
    primary = realUsable ? (
      <ConnectButton href={p.startHref} pendingLabel={going}>
        Connect again
      </ConnectButton>
    ) : null;
  } else if (p.needsLink) {
    line = (
      <>
        Link your Instagram to <span className="font-medium text-ink">{p.needsLink.pageName}</span> (in Instagram: Edit profile, then Page), then press Check again.
      </>
    );
    primary = p.canConnect ? (
      <ConnectButton href={p.startHref} pendingLabel="Checking…">
        Check again
      </ConnectButton>
    ) : null;
  } else if (p.practiceShop) {
    line = "Practice shop: posts stay in Armada.";
    // A real account can still be connected (to try the sign-in), but it isn't the main press here.
    secondary = realUsable ? (
      <ConnectButton href={p.startHref} pendingLabel={going} variant="secondary">
        {verb}
      </ConnectButton>
    ) : null;
  } else if (p.ready) {
    line = p.canConnect ? p.intro : <>{p.intro} The owner or a manager connects it.</>;
    primary = realUsable ? (
      <ConnectButton href={p.startHref} pendingLabel={going}>
        {verb}
      </ConnectButton>
    ) : null;
    secondary = realUsable ? p.firstTimeAction : null;
  } else {
    line = p.isAdmin
      ? p.platform === "pinterest"
        ? "Off until the connection service is on (Connections)."
        : `Off until Armada's ${p.platform === "tiktok" ? "TikTok" : "Meta"} app is set up (steps at the bottom).`
      : "A practice account works meanwhile.";
  }

  // With no real press to make, the practice account is the one primary press.
  const practiceIsPrimary = !primary && !p.real && !p.practice && p.canPractice;
  const makePracticeButton = (variant: "primary" | "secondary") => (
    <form action={p.makePractice}>
      <PendingButton pendingLabel="Making it…" variant={variant} className={buttonClass(variant, variant === "primary" ? "min-h-11 px-5 text-[15px]" : "min-h-11 md:min-h-9")}>
        Use a practice account
      </PendingButton>
    </form>
  );
  if (practiceIsPrimary) primary = makePracticeButton("primary");

  return (
    <Card id={p.platform} className={`scroll-mt-6 p-5 md:p-6 ${p.highlight ? "ring-2 ring-accent/40" : ""}`}>
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink">
          <PlatformMark platform={p.platform} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-[17px] font-semibold tracking-tight">{p.title}</h2>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          <div className="mt-1 max-w-2xl text-[14px] text-muted">{line}</div>
        </div>
      </div>

      {primary || secondary ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 md:pl-15">
          {primary}
          {secondary}
        </div>
      ) : null}
      {!p.real && !p.needsLink && p.firstTime && realUsable && !p.practiceShop ? <div className="mt-3 max-w-2xl text-[13px] text-muted md:pl-15">{p.firstTime}</div> : null}

      {p.real && p.canConnect ? (
        <div className="mt-3 md:pl-15">
          <form action={p.remove.bind(null, p.real.id)} className="inline-flex flex-col items-start gap-1">
            <HoldButton className={buttonClass("quiet", "min-h-11 md:min-h-9")} doneLabel="Disconnecting…" hint={`Press and hold to disconnect ${p.title} from this shop`}>
              Hold to disconnect
            </HoldButton>
          </form>
        </div>
      ) : null}

      {p.practice ? (
        <div className="mt-4 rounded-xl border border-line px-4 py-3 md:ml-15">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[14px] font-medium">
                  Practice account <span className="font-normal text-muted">{at(p.practice.handle)}</span>
                </div>
                <div className="text-[13px] text-muted">
                  {p.practiceCount ? `${p.practiceCount} practice ${p.practiceCount === 1 ? "post" : "posts"}, kept in Armada.` : "Posts stay in Armada."}
                </div>
              </div>
              {p.canPractice ? (
                <form action={p.remove.bind(null, p.practice.id)}>
                  <PendingButton pendingLabel="Removing…" variant="secondary" className={buttonClass("quiet", "min-h-11 md:min-h-9")}>
                    Remove
                  </PendingButton>
                </form>
              ) : null}
            </div>
            {p.practicePosts.length ? (
              <ul className="flex flex-col gap-2">
                {p.practicePosts.map((post) => (
                  <li key={post.id} className="flex items-center gap-3">
                    {post.slides[0]?.imageUrl ? (
                      // Practice posts show their first picture as a small preview.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.slides[0].imageUrl} alt={post.slides[0].alt || ""} className="size-11 shrink-0 rounded-lg border border-line object-cover" loading="lazy" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {post.caption || "No caption"}
                      <span className="text-muted"> · {post.slides.length} {post.slides.length === 1 ? "picture" : "pictures"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : !practiceIsPrimary && !p.real && p.canPractice ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 md:ml-15">
          <p className="min-w-[14rem] flex-1 text-[13px] text-muted">Or try it first.</p>
          {makePracticeButton("secondary")}
        </div>
      ) : null}

      {p.kit ? (
      <div className="mt-4 md:ml-15">
        <Expand
          defaultOpen={p.kitOpen ?? false}
          summary={
            <span className="text-[14px] font-medium">Profile kit</span>
          }
          buttonClassName="min-h-11 rounded-xl px-1 text-left"
        >
          {p.kit}
        </Expand>
      </div>
      ) : null}
    </Card>
  );
}
