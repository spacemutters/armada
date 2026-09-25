import { ExternalLink, Sparkles } from "lucide-react";
import { Expand } from "@/components/fx/expand";
import { PendingButton } from "@/components/fx/pending-button";
import { ShimmerText } from "@/components/fx/shimmer-text";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { buttonClass, ButtonLink, cx, inputClass, StatusPill, type Tone } from "@/components/ui";
import { afterPublishNote } from "@/lib/social/accounts";
import { slideUrl, slideVersion, type SlideLook } from "@/lib/social/posts/design";
import { isDue } from "@/lib/social/posts/due";
import type { PhotoChoice } from "@/lib/social/posts/queries";
import { HEADLINE_MAX, LINE_MAX } from "@/lib/social/posts/schema";
import { platformLabel } from "@/lib/social/posts/schedule";
import type { PostWithSlides } from "@/lib/social/posts/types";
import { CarouselPreview } from "./carousel-preview";
import { LocalTime } from "./local-time";
import { SchedulePanel, type TargetAccount } from "./schedule-panel";

export interface PostActions {
  schedule: (formData: FormData) => Promise<void>;
  postNow: (formData: FormData) => Promise<void>;
  caption: (formData: FormData) => Promise<void>;
  slides: (formData: FormData) => Promise<void>;
  rewrite: () => Promise<void>;
  remove: () => Promise<void>;
  unschedule: () => Promise<void>;
}

const quiet = buttonClass("quiet", "min-h-11 md:min-h-9");
const secondary = buttonClass("secondary", "min-h-11 md:min-h-9");

function statusOf(post: PostWithSlides, now: number): { tone: Tone; word: string } {
  if (post.rewriting) return { tone: "working", word: "Writing a new version" };
  if (post.status === "draft") return { tone: "attention", word: "Ready for you to review" };
  if (post.status === "scheduled") {
    return isDue(post, now) ? { tone: "working", word: "Sending" } : { tone: "ok", word: "Scheduled" };
  }
  if (post.status === "posting") return { tone: "working", word: "Sending" };
  if (post.status === "posted") return { tone: "ok", word: "Posted" };
  return { tone: "error", word: "Didn't go out" };
}

/**
 * One carousel post: the preview on the left, and on the right what it is, where it stands, and
 * everything that can be done with it. The AI's words are labelled as the AI's.
 */
export function PostCard({
  post,
  look,
  handle,
  accounts,
  canEdit,
  choices,
  saved,
  problem,
  actions,
  now,
}: {
  post: PostWithSlides;
  look: SlideLook;
  handle: string | null;
  accounts: TargetAccount[];
  canEdit: boolean;
  choices: PhotoChoice[];
  saved: boolean;
  problem: string | null;
  actions: PostActions;
  now: number;
}) {
  const total = post.slides.length;
  const slides = post.slides.map((s) => ({ ...s, src: slideUrl("", post.id, s.n, slideVersion(s, total, look)) }));
  const status = statusOf(post, now);
  const results = Object.entries(post.results ?? {});
  const wentOutSomewhere = results.some(([, r]) => r.ok);
  const sending = status.word === "Sending";
  const editable = canEdit && !post.rewriting && !sending && (post.status === "draft" || post.status === "scheduled" || post.status === "failed");
  const canRewrite = canEdit && !post.rewriting && (post.status === "draft" || post.status === "failed") && !wentOutSomewhere;
  const scheduledIso = post.scheduledAt ? new Date(post.scheduledAt).toISOString() : null;
  const suggestedIso = post.suggestedAt ? new Date(post.suggestedAt).toISOString() : null;
  const chosenNames = (post.accountIds ?? [])
    .map((id) => accounts.find((a) => a.id === id) ?? (post.results?.[id] ? { platform: platformLabel(post.results[id].platform) } : null))
    .filter(Boolean)
    .map((a) => a!.platform);

  return (
    <article id={`post-${post.id}`} className="grid scroll-mt-6 items-start gap-6 rounded-3xl border border-line bg-raised p-4 sm:p-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-8">
      <div className="relative">
        <CarouselPreview
          slides={slides.map((s) => ({ src: s.src, alt: s.alt }))}
          name={look.brand}
          handle={handle}
          monogram={{ background: look.palette.accent, ink: look.palette.accentInk }}
          caption={post.caption}
          hashtags={post.hashtags ?? []}
        />
        {post.rewriting ? (
          <div role="status" className="absolute inset-0 flex max-w-[400px] flex-col items-center justify-center gap-3 rounded-[22px] bg-raised/90 text-center">
            <ThinkingOrb state="composing" size={40} decorative />
            <ShimmerText className="text-[14px] font-medium">Writing a new version</ShimmerText>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusPill tone={status.tone}>{status.word}</StatusPill>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <Sparkles aria-hidden className="size-3.5" strokeWidth={1.8} />
              {post.edited ? "Written by AI, edited by you" : "Written by AI"}
            </span>
          </div>
          <h3 className="text-[18px] leading-snug font-semibold tracking-tight text-balance">{post.angle || post.slides[0]?.headline}</h3>
          <p className="text-[13px] text-muted">
            {total} slides
            {post.status === "draft" && suggestedIso ? (
              <>
                {" "}
                · suggested for <LocalTime iso={suggestedIso} />
              </>
            ) : null}
            {post.status === "scheduled" && scheduledIso && !sending ? (
              <>
                {" "}
                · goes out <LocalTime iso={scheduledIso} className="font-medium text-ink" />
                {chosenNames.length ? ` to ${chosenNames.join(" and ")}` : ""}
              </>
            ) : null}
          </p>
          {saved ? (
            <p role="status" className="text-[13px] text-positive">
              Saved. The slides and caption above show your changes.
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="rounded-xl bg-sunken px-3 py-2 text-[13px] text-negative">
              {problem}
            </p>
          ) : null}
          {post.problem && !post.rewriting ? (
            <p className={cx("rounded-xl px-3 py-2 text-[13px]", post.status === "failed" ? "bg-sunken text-negative" : "bg-attention-soft text-attention")}>{post.problem}</p>
          ) : null}
        </header>

        {results.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {results.map(([id, r]) => {
              const note = r.ok ? afterPublishNote(r.platform, r.practice ? "practice" : "connected") : null;
              return (
                <li key={id} className="flex flex-col gap-0.5 px-4 py-3 text-[14px]">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <StatusPill tone={r.ok ? "ok" : "error"}>{r.ok ? "Posted" : "Not posted"}</StatusPill>
                    <span className="font-medium">{platformLabel(r.platform)}</span>
                    <span className="text-muted">{r.handle ?? r.name}</span>
                    {r.ok && r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-accent hover:underline md:min-h-6">
                        See the post <ExternalLink aria-hidden className="size-3.5" />
                      </a>
                    ) : null}
                  </span>
                  {!r.ok && r.problem ? <span className="text-[13px] text-muted">{r.problem}</span> : null}
                  {note ? <span className="text-[13px] text-muted">{note}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {sending ? (
          <div role="status" className="flex items-center gap-3 rounded-2xl bg-sunken px-4 py-3">
            <ThinkingOrb state="connecting" size={24} decorative />
            <ShimmerText className="text-[14px]">Sending{chosenNames.length ? ` to ${chosenNames.join(" and ")}` : ""}</ShimmerText>
          </div>
        ) : null}

        {editable && accounts.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-line-strong p-4">
            <p className="text-[14px]">This shop has no accounts that can take posts yet.</p>
            <ButtonLink href={`/social/connect?shop=${post.shopId}`} className="min-h-11 md:min-h-9">
              Set up this shop&apos;s social media
            </ButtonLink>
          </div>
        ) : null}

        {editable && accounts.length > 0 && post.status !== "scheduled" ? (
          <section aria-label="Schedule or post" className="rounded-2xl border border-line p-4">
            {post.status === "failed" ? <p className="mb-3 text-[14px] font-medium">Send it again</p> : null}
            <SchedulePanel
              accounts={accounts}
              chosen={post.status === "failed" ? (post.accountIds ?? []) : []}
              suggestedIso={suggestedIso}
              currentIso={null}
              schedule={actions.schedule}
              postNow={actions.postNow}
            />
          </section>
        ) : null}

        {editable && post.status === "scheduled" ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-2">
              <form action={actions.unschedule}>
                <PendingButton pendingLabel="Moving" variant="secondary" className={secondary}>
                  Move back to drafts
                </PendingButton>
              </form>
            </div>
            {accounts.length ? (
              <Expand summary="Change the time or accounts" buttonClassName="min-h-11 text-[14px] md:min-h-10" className="mt-1 border-t border-line">
                <div className="pt-3 pb-1">
                  <SchedulePanel
                    accounts={accounts}
                    chosen={post.accountIds ?? []}
                    suggestedIso={suggestedIso}
                    currentIso={scheduledIso}
                    schedule={actions.schedule}
                    postNow={actions.postNow}
                    scheduleLabel="Save new time"
                  />
                </div>
              </Expand>
            ) : null}
          </div>
        ) : null}

        {editable ? (
          <div className="flex flex-col border-t border-line">
            <Expand summary="Edit caption" buttonClassName="min-h-11 text-[14px] md:min-h-10" className="border-b border-line">
              <form action={actions.caption} className="flex flex-col gap-3 pt-1 pb-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-muted">Caption</span>
                  <textarea name="caption" defaultValue={post.caption} rows={6} maxLength={1500} className={cx(inputClass, "leading-relaxed")} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-muted">Hashtags, separated by spaces</span>
                  <input name="hashtags" defaultValue={(post.hashtags ?? []).map((h) => `#${h}`).join(" ")} className={cx(inputClass, "min-h-11 md:min-h-10")} />
                </label>
                <div>
                  <PendingButton pendingLabel="Saving" className={buttonClass("primary", "min-h-11 md:min-h-9")}>
                    Save caption
                  </PendingButton>
                </div>
              </form>
            </Expand>

            <Expand summary="Edit slide text" buttonClassName="min-h-11 text-[14px] md:min-h-10" className="border-b border-line">
              <form action={actions.slides} className="flex flex-col gap-4 pt-1 pb-4">
                {slides.map((s) => (
                  <fieldset key={s.n} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
                    <legend className="sr-only">Slide {s.n}</legend>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.src} alt="" width={72} height={90} loading="lazy" className="aspect-[4/5] w-full rounded-lg border border-line bg-sunken object-cover" />
                    <div className="flex min-w-0 flex-col gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[12px] font-medium text-muted">Slide {s.n} headline</span>
                        <input name={`headline-${s.n}`} defaultValue={s.headline} required maxLength={HEADLINE_MAX} className={cx(inputClass, "min-h-11 md:min-h-10")} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[12px] font-medium text-muted">Line under it</span>
                        <textarea name={`line-${s.n}`} defaultValue={s.line} rows={2} maxLength={LINE_MAX} className={inputClass} />
                      </label>
                      {choices.length ? (
                        <label className="flex flex-col gap-1">
                          <span className="text-[12px] font-medium text-muted">Photo</span>
                          <select name={`photo-${s.n}`} defaultValue="keep" className={cx(inputClass, "min-h-11 md:min-h-10")}>
                            <option value="keep">{s.imageUrl ? `Keep this photo${photoName(choices, s.imageUrl)}` : "Keep it without a photo"}</option>
                            {s.imageUrl ? <option value="none">No photo, words only</option> : null}
                            {choices
                              .filter((c) => c.url !== s.imageUrl)
                              .map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </fieldset>
                ))}
                <div>
                  <PendingButton pendingLabel="Saving" className={buttonClass("primary", "min-h-11 md:min-h-9")}>
                    Save slides
                  </PendingButton>
                </div>
              </form>
            </Expand>

            <div className="flex flex-wrap items-center gap-1 pt-3">
              {canRewrite ? (
                <form action={actions.rewrite}>
                  <PendingButton pendingLabel="Asking the AI" variant="secondary" orb="composing" className={quiet}>
                    Write again
                  </PendingButton>
                </form>
              ) : null}
              {!wentOutSomewhere ? (
                <Expand summary="Remove" buttonClassName="min-h-11 px-4 text-[14px] text-negative md:min-h-9" className="w-full">
                  <form action={actions.remove} className="flex flex-wrap items-center gap-3 pb-2">
                    <p className="text-[13px] text-muted">It hasn&apos;t gone out anywhere. Removing it can&apos;t be undone.</p>
                    <PendingButton pendingLabel="Removing" variant="secondary" className={cx(secondary, "text-negative")}>
                      Remove this post
                    </PendingButton>
                  </form>
                </Expand>
              ) : null}
            </div>
          </div>
        ) : null}

        {!canEdit && post.status === "draft" ? <p className="text-[13px] text-muted">Someone who can make changes can schedule this post.</p> : null}
      </div>
    </article>
  );
}

function photoName(choices: PhotoChoice[], url: string): string {
  const c = choices.find((x) => x.url === url);
  return c ? ` (${c.label})` : "";
}
