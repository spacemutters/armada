"use client";

import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/social-connect/copy-button";
import { buttonClass } from "@/components/ui";
import type { LaunchKit } from "@/lib/launch/core";

// Beside the one press that opens Facebook's or Instagram's own sign-up page: everything the
// person will be asked for there, each one tap to copy or download.

function Row({ label, value, hint, action, picture }: { label: string; value?: string; hint?: string; action: ReactNode; picture?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {picture}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-muted">{label}</div>
        {value ? <div className="text-[14px] break-words whitespace-pre-line">{value}</div> : null}
        {hint ? <div className="tabular text-[12px] text-muted">{hint}</div> : null}
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

function DownloadButton({ href, what }: { href: string; what: string }) {
  return (
    <a href={`${href}?download=1`} download className={buttonClass("secondary", "min-h-11 md:min-h-9")} aria-label={`Download ${what}`}>
      <Download aria-hidden className="size-4" />
      Download
    </a>
  );
}

function Thumb({ src, alt, round }: { src: string; alt: string; round?: boolean }) {
  return (
    // The kit's own pictures, served by Armada exactly as they'll be uploaded.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className={round ? "size-11 shrink-0 rounded-full border border-line object-cover" : "h-11 w-16 shrink-0 rounded-lg border border-line object-cover sm:w-20"} />
  );
}

export function LaunchKitRows({ platform, kit }: { platform: "facebook" | "instagram"; kit: LaunchKit }) {
  const picture = (
    <Row
      label="Profile picture"
      hint="1080 × 1080"
      picture={<Thumb src={kit.avatarUrl} alt={`${kit.name} profile picture`} round />}
      action={<DownloadButton href={kit.avatarUrl} what="the profile picture" />}
    />
  );
  return (
    <div className="mt-3 rounded-xl border border-line px-4 py-1">
      <ul className="flex flex-col divide-y divide-line">
        {platform === "facebook" ? (
          <>
            <Row label="Page name" value={kit.name} action={<CopyButton text={kit.name} what="the Page name" />} />
            <Row label="Description" value={kit.pageAbout} hint={`${kit.pageAbout.length} of 100 characters`} action={<CopyButton text={kit.pageAbout} what="the description" />} />
            <Row label="Website" value={kit.website} action={<CopyButton text={kit.website} what="the website" />} />
            {picture}
            <Row
              label="Cover photo"
              hint="1640 × 924"
              picture={<Thumb src={kit.coverUrl} alt={`${kit.name} cover photo`} />}
              action={<DownloadButton href={kit.coverUrl} what="the cover photo" />}
            />
          </>
        ) : (
          <>
            {kit.username ? (
              <Row label="Username" value={kit.username} hint="Instagram says if it's taken" action={<CopyButton text={kit.username} what="the username" />} />
            ) : null}
            <Row label="Name" value={kit.name} action={<CopyButton text={kit.name} what="the name" />} />
            <Row label="Bio" value={kit.instagramBio} hint={`${kit.instagramBio.length} of 150 characters`} action={<CopyButton text={kit.instagramBio} what="the bio" />} />
            <Row label="Link" value={kit.link} action={<CopyButton text={kit.link} what="the link" />} />
            {picture}
          </>
        )}
      </ul>
    </div>
  );
}
