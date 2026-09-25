import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { buttonClass } from "@/components/ui";
import type { SetupPart, PageSetupResult } from "@/connectors/social-accounts/meta";
import { LIMITS, type ProfileKit } from "@/lib/social/accounts/kit";

// The profile kit on a platform card: what to put on the profile, each piece one press to download
// or copy, and exactly where it goes in the platform's app.

function Row({ label, hint, children, action }: { label: string; hint?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{label}</div>
        {children ? <div className="mt-1.5">{children}</div> : null}
        {hint ? <div className="mt-1 text-[13px] text-muted">{hint}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  );
}

function TextBox({ text }: { text: string }) {
  return <p className="rounded-xl bg-sunken px-3 py-2 text-[14px] leading-relaxed break-words whitespace-pre-line">{text}</p>;
}

function DownloadLink({ href, what }: { href: string; what: string }) {
  return (
    <a href={`${href}?download=1`} download className={buttonClass("secondary", "min-h-11 md:min-h-9")} aria-label={`Download ${what}`}>
      <Download aria-hidden className="size-4" />
      Download
    </a>
  );
}

function Picture({ src, round, alt }: { src: string; round?: boolean; alt: string }) {
  return (
    // The kit's own pictures, served by Armada; a plain img keeps them exactly as they'll be uploaded.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={round ? "size-16 rounded-full border border-line object-cover" : "h-16 w-28 rounded-lg border border-line object-cover"}
    />
  );
}

function Counted({ text, max }: { text: string; max: number }) {
  return (
    <span className="tabular">
      {text.length} of {max} characters
    </span>
  );
}

const PART_NAMES: Record<SetupPart, string> = { about: "Description", website: "Website", picture: "Profile picture", cover: "Cover photo" };

export function KitPanel({
  platform,
  kit,
  avatarUrl,
  coverUrl,
  brandName,
  pageKit,
  pageConnected,
}: {
  platform: "instagram" | "facebook" | "tiktok";
  kit: ProfileKit;
  avatarUrl: string;
  coverUrl: string;
  brandName: string;
  /** Facebook: what Armada filled in on the connected Page. */
  pageKit?: PageSetupResult & { at: string };
  pageConnected?: boolean;
}) {
  const avatar = (
    <Row
      label="Profile picture"
      hint="1080 × 1080, your brand's mark in its colours."
      action={<DownloadLink href={avatarUrl} what="the profile picture" />}
    >
      <Picture src={avatarUrl} round alt={`${brandName} profile picture`} />
    </Row>
  );

  if (platform === "facebook") {
    return (
      <div className="flex flex-col divide-y divide-line">
        {pageConnected && pageKit ? (
          <div className="py-3">
            <div className="text-[14px] font-medium">On your Page</div>
            <ul className="mt-2 grid gap-1.5 text-[14px] sm:grid-cols-2">
              {(["about", "website", "picture", "cover"] as SetupPart[]).map((part) => {
                const failed = pageKit.failed.find((f) => f.part === part);
                const state = pageKit.done.includes(part) ? "Filled in by Armada" : failed ? "Facebook refused it" : "Already had its own, left as it was";
                return (
                  <li key={part} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={
                        pageKit.done.includes(part)
                          ? "mt-1.5 size-2 shrink-0 rounded-full bg-positive"
                          : failed
                            ? "mt-1.5 size-2 shrink-0 rotate-45 bg-attention"
                            : "mt-1.5 size-2 shrink-0 rounded-full border border-muted"
                      }
                    />
                    <span>
                      <span className="font-medium">{PART_NAMES[part]}</span>
                      <span className="text-muted">: {state}</span>
                      {failed ? <span className="block text-[13px] text-attention">{failed.problem}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {avatar}
        <Row label="Cover photo" hint="1640 × 924. Phones show all of it; computers show the middle band, where everything sits." action={<DownloadLink href={coverUrl} what="the cover photo" />}>
          <Picture src={coverUrl} alt={`${brandName} cover photo`} />
        </Row>
        <Row
          label="Description"
          hint={<Counted text={kit.facebook.about} max={LIMITS.facebook.about} />}
          action={<CopyButton text={kit.facebook.about} what="the description" />}
        >
          <TextBox text={kit.facebook.about} />
        </Row>
        <Row label="Website" action={<CopyButton text={kit.facebook.website} what="the website" />}>
          <TextBox text={kit.facebook.website} />
        </Row>
        <p className="py-3 text-[13px] text-muted">
          {pageConnected
            ? "Armada fills these in on your Page when it connects. To change them by hand: on your Page, tap the camera on the profile picture, then Edit cover photo, then Edit details for Bio and Websites."
            : "When your Page is connected, Armada puts these on it for you. By hand: on your Page, tap the camera on the profile picture, then Edit cover photo, then Edit details and paste into Bio and Websites."}
        </p>
      </div>
    );
  }

  const k = platform === "instagram" ? kit.instagram : kit.tiktok;
  const max = platform === "instagram" ? LIMITS.instagram.bio : LIMITS.tiktok.bio;
  const where =
    platform === "instagram"
      ? "In Instagram, open your profile and tap Edit profile. Tap Edit picture and choose the downloaded picture, paste the bio into Bio, then tap Links, Add external link, and paste the link."
      : "In TikTok, open Profile and tap Edit profile. Tap Change photo and choose the downloaded picture, paste the bio into Bio, and paste the link into Website (TikTok shows Website on business accounts).";
  return (
    <div className="flex flex-col divide-y divide-line">
      {avatar}
      <Row label="Bio" hint={<Counted text={k.bio} max={max} />} action={<CopyButton text={k.bio} what="the bio" />}>
        <TextBox text={k.bio} />
      </Row>
      <Row label="Link" hint="Your shop, for the link on your profile." action={<CopyButton text={k.link} what="the link" />}>
        <TextBox text={k.link} />
      </Row>
      {k.usernames.length ? (
        <Row label="Username ideas" hint="For a new account. The platform tells you if one is taken." action={<CopyButton text={k.usernames[0]} what={`the username ${k.usernames[0]}`} label="Copy first" />}>
          <p className="text-[14px]">
            {k.usernames.map((u, i) => (
              <span key={u}>
                {i ? <span className="text-muted"> · </span> : null}
                <span className="font-medium">{u}</span>
              </span>
            ))}
          </p>
        </Row>
      ) : null}
      <p className="py-3 text-[13px] text-muted">{where}</p>
    </div>
  );
}
