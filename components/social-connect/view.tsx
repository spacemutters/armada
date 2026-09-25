import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { KitPanel } from "./kit-panel";
import { PlatformCard } from "./platform-card";
import { PendingButton } from "@/components/fx";
import { buttonClass, Card, PageHeader, Section } from "@/components/ui";
import { META_CREATE_PAGE_URL } from "@/connectors/social-accounts/meta";
import type { ProfileKit } from "@/lib/social/accounts/kit";
import type { AccountRow, PageChoice, PracticePost } from "@/lib/social/accounts/store";
import type { SocialPlatform } from "@/lib/social/types";

// The social media page for one shop, drawn from data the page loads (app/(app)/social/connect/page.tsx).
// Kept free of database and settings reads so it can be drawn with sample data to review the design.

export interface Note {
  tone: "ok" | "problem";
  text: string;
}

export interface OwnerInfo {
  meta: { settings: { name: string; set: boolean }[]; callbacks: string[]; permissions: { name: string; why: string }[] };
  tiktok: { settings: { name: string; set: boolean }[]; callback: string; prefix: string; scopes: string[] };
  open: boolean;
}

export interface ViewActions {
  makePractice: (shopId: string, platform: SocialPlatform) => Promise<void>;
  remove: (shopId: string, accountId: string) => Promise<void>;
  pick: (shopId: string, choiceId: string, pageId: string) => Promise<void>;
  skip: (shopId: string) => Promise<void>;
  applyKit: (shopId: string) => Promise<void>;
}

export interface ViewProps {
  shopId: string;
  brandName: string;
  link: string;
  avatarUrl: string;
  coverUrl: string;
  kit: ProfileKit;
  note: Note | null;
  choice: { id: string; wanted: "facebook" | "instagram"; choices: PageChoice[] } | null;
  rows: AccountRow[];
  practice: { posts: PracticePost[]; counts: Record<string, number> };
  ready: Record<SocialPlatform, boolean>;
  canConnect: boolean;
  canPractice: boolean;
  /** A practice shop: its posts only go to practice accounts. */
  practiceShop: boolean;
  isAdmin: boolean;
  highlight?: string;
  actions: ViewActions;
  owner: OwnerInfo | null;
}

const TITLES: Record<SocialPlatform, string> = { instagram: "Instagram", facebook: "Facebook Page", tiktok: "TikTok" };

/** The page's one sentence about the limit, said once, at the top. */
export const LIMIT_SENTENCE =
  "No app can make an Instagram, Facebook or TikTok account for you, so each button opens that platform's own sign-in or sign-up, and Armada does everything the platform allows once you're back.";

export function Flash({ note }: { note: Note }) {
  return (
    <p
      role={note.tone === "ok" ? "status" : "alert"}
      className={`mb-4 max-w-3xl rounded-xl px-4 py-3 text-[14px] ${note.tone === "ok" ? "bg-accent-soft text-ink" : "bg-attention-soft text-attention"}`}
    >
      {note.text}
    </p>
  );
}

export function SocialConnectView(v: ViewProps) {
  const find = (platform: SocialPlatform, kind: AccountRow["kind"]) => v.rows.find((r) => r.platform === platform && r.kind === kind) ?? null;
  const fb = find("facebook", "real");
  const ig = find("instagram", "real");

  const common = (platform: SocialPlatform) => {
    const prac = find(platform, "practice");
    return {
      platform,
      title: TITLES[platform],
      ready: v.ready[platform],
      real: find(platform, "real"),
      practice: prac,
      practiceCount: prac ? (v.practice.counts[prac.id] ?? 0) : 0,
      practicePosts: prac ? v.practice.posts.filter((x) => x.accountId === prac.id) : [],
      startHref: `/api/connect/${platform === "facebook" ? "facebook_page" : platform}/start?shop=${v.shopId}`,
      canConnect: v.canConnect,
      canPractice: v.canPractice,
      practiceShop: v.practiceShop,
      isAdmin: v.isAdmin,
      makePractice: v.actions.makePractice.bind(null, v.shopId, platform),
      remove: v.actions.remove.bind(null, v.shopId),
      highlight: v.highlight === platform,
    };
  };
  const kitProps = { kit: v.kit, avatarUrl: v.avatarUrl, coverUrl: v.coverUrl, brandName: v.brandName };

  return (
    <>
      <PageHeader title={`Social media for ${v.brandName}`} subtitle={LIMIT_SENTENCE} />
      {v.note ? <Flash note={v.note} /> : null}

      <div className="flex max-w-3xl flex-col gap-4">
        <Card className="flex flex-wrap items-center gap-4 p-5">
          {/* The kit's own profile picture, so the brand's mark is the first thing on the page. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.avatarUrl} alt={`${v.brandName} profile picture`} className="size-14 rounded-full border border-line" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold">{v.brandName}</div>
            <a href={v.link} target="_blank" rel="noreferrer" className="-my-3 block truncate py-3 text-[13px] leading-5 text-accent hover:underline md:my-0 md:py-0">
              {v.link.replace(/^https?:\/\//, "")}
            </a>
          </div>
          <Link href={`/social?shop=${v.shopId}`} className={buttonClass("quiet", "min-h-11")}>
            Make posts
          </Link>
        </Card>

        {v.choice ? (
          <Section title={`Which Page is ${v.brandName}'s?`}>
            <p className="-mt-2 mb-3 text-[14px] text-muted">
              You shared {v.choice.choices.length} Pages with Armada. Pick the one for this shop
              {v.choice.wanted === "instagram" ? "; each has an Instagram account linked" : ""}.
            </p>
            <ul className="flex flex-col gap-2">
              {v.choice.choices.map((c) => (
                <li key={c.id}>
                  <form action={v.actions.pick.bind(null, v.shopId, v.choice!.id, c.id)}>
                    <PendingButton pendingLabel="Connecting…" orb="connecting" variant="secondary" className={buttonClass("secondary", "min-h-11 w-full justify-between px-4")}>
                      <span className="truncate">{c.name}</span>
                      {c.instagram ? <span className="shrink-0 text-[13px] text-muted">@{c.instagram}</span> : null}
                    </PendingButton>
                  </form>
                </li>
              ))}
            </ul>
            <form action={v.actions.skip.bind(null, v.shopId)} className="mt-2">
              <button type="submit" className={buttonClass("quiet", "min-h-11")}>
                None of these
              </button>
            </form>
          </Section>
        ) : null}

        <PlatformCard
          {...common("instagram")}
          needsLink={!ig && fb?.status === "connected" && v.ready.instagram ? { pageName: fb.name } : null}
          intro="Opens Facebook's sign-in: Instagram posting runs through the Facebook Page your Instagram account is linked to. Choose that Page, and Armada connects both."
          firstTime={
            <>
              New to Instagram? Make the account in the Instagram app, switch it to a professional account (Settings, then Account type and tools), then tap Edit
              profile, Page, and Create a new Facebook Page. Then come back and press Set up Instagram.
            </>
          }
          kitOpen={false}
          kit={<KitPanel platform="instagram" {...kitProps} />}
        />

        <PlatformCard
          {...common("facebook")}
          intro="Opens Facebook's sign-in, where you choose the shop's Page. Armada then fills in its description, website, profile picture and cover wherever they're empty."
          firstTime="No Page yet? Make one on Facebook first (or let Instagram make it for you), then press Set up Facebook Page."
          firstTimeAction={
            <a href={META_CREATE_PAGE_URL} target="_blank" rel="noreferrer" className={buttonClass("quiet", "min-h-11 px-4")}>
              Make a new Page <ExternalLink aria-hidden className="size-4" />
            </a>
          }
          connectedExtra={
            fb?.status === "connected" && v.canConnect ? (
              <form action={v.actions.applyKit.bind(null, v.shopId)}>
                <PendingButton pendingLabel="Putting it on the Page…" variant="secondary" className={buttonClass("secondary", "min-h-11 px-5")}>
                  Replace with the kit
                </PendingButton>
              </form>
            ) : null
          }
          kitOpen={false}
          kit={<KitPanel platform="facebook" {...kitProps} pageKit={fb?.meta.kit} pageConnected={fb?.status === "connected"} />}
        />

        <PlatformCard
          {...common("tiktok")}
          intro="Opens TikTok's sign-in, where you can also sign up. Once connected, the posts Armada makes arrive in your TikTok inbox, ready to post with one tap."
          kitOpen={false}
          kit={<KitPanel platform="tiktok" {...kitProps} />}
        />

        {v.owner ? <OwnerChecklist o={v.owner} /> : null}
      </div>
    </>
  );
}

function Setting({ name, set }: { name: string; set: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={set ? "size-2 rounded-full bg-positive" : "size-2 rounded-full border border-muted"} />
      <code className="text-[13px]">{name}</code>
      <span className="text-[13px] text-muted">{set ? "set" : "missing"}</span>
    </li>
  );
}

function Address({ value }: { value: string }) {
  return <span className="mt-1 block rounded-lg bg-sunken px-3 py-2 font-mono text-[13px] text-ink break-all select-all">{value}</span>;
}

/** Only platform admins see this: exactly what switches each platform on. */
function OwnerChecklist({ o }: { o: OwnerInfo }) {
  return (
    <details className="rounded-2xl border border-line bg-raised p-5" open={o.open}>
      <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold">For the Armada owner: switching these on</summary>
      <div className="mt-3 flex flex-col gap-6 text-[14px]">
        <section>
          <h3 className="font-semibold">Facebook Page and Instagram (Meta)</h3>
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-muted">
            <li>
              In Meta for Developers, use a Business-type app with the products Facebook Login for Business and Instagram (the setup that signs in with
              Facebook).
            </li>
            <li>
              In Facebook Login for Business, open Settings and add both return addresses to the list of valid redirect addresses:
              {o.meta.callbacks.map((c) => (
                <Address key={c} value={c} />
              ))}
            </li>
            <li>
              Make a Facebook Login for Business configuration (for people, not a system user) that asks for:
              <ul className="mt-1 flex flex-col gap-0.5">
                {o.meta.permissions.map((perm) => (
                  <li key={perm.name}>
                    <code className="text-ink">{perm.name}</code>: {perm.why}
                  </li>
                ))}
              </ul>
              <span className="mt-1 block">If people run their Page through a business portfolio, Meta also wants ads_management and ads_read for Instagram posting.</span>
            </li>
            <li>Finish Business Verification, then App Review for Advanced Access to each permission above, and switch the app to Live.</li>
            <li>Put the app&apos;s settings into Vercel (the last one is the configuration&apos;s id from step 3):</li>
          </ol>
          <ul className="mt-2 flex flex-col gap-1 pl-5">
            {o.meta.settings.map((s) => (
              <Setting key={s.name} {...s} />
            ))}
          </ul>
        </section>

        <section>
          <h3 className="font-semibold">TikTok</h3>
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-muted">
            <li>In TikTok for Developers, make an app with Login Kit (web) and Content Posting (the upload option).</li>
            <li>
              Add this Redirect URI under Login Kit:
              <Address value={o.tiktok.callback} />
            </li>
            <li>
              Ask for{" "}
              {o.tiktok.scopes.map((s, i) => (
                <span key={s}>
                  {i ? ", " : ""}
                  <code className="text-ink">{s}</code>
                </span>
              ))}
              , and submit the app for review.
            </li>
            <li>
              Under URL properties, verify this URL prefix. TikTok gives you a file: put its name and the text inside it in the last two settings, and
              Armada serves it there.
              <Address value={o.tiktok.prefix} />
            </li>
            <li>Put the app&apos;s settings into Vercel:</li>
          </ol>
          <ul className="mt-2 flex flex-col gap-1 pl-5">
            {o.tiktok.settings.map((s) => (
              <Setting key={s.name} {...s} />
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
