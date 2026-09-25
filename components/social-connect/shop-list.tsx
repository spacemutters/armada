import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Flash, type Note } from "./view";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";

// The social media page with no shop chosen: pick one. Kept free of database reads so the design
// harness can draw it with sample shops.

export interface ShopChoice {
  id: string;
  name: string;
  tagline: string;
  /** The shop's profile picture from its kit. */
  avatarUrl: string;
  /** "3 set up", "Practice", or nothing yet. */
  summary: string | null;
}

export function ShopChooser({ shops, note, building }: { shops: ShopChoice[]; note: Note | null; building: number }) {
  return (
    <>
      <PageHeader title="Social media" subtitle="Pick a shop." />
      {note ? <Flash note={note} /> : null}
      {shops.length ? (
        <Card className="max-w-3xl overflow-hidden">
          <ul className="flex flex-col divide-y divide-line">
            {shops.map((s) => (
              <li key={s.id}>
                <Link href={`/social/connect?shop=${s.id}`} className="flex min-h-16 items-center gap-4 px-5 py-3 hover:bg-sunken focus-visible:bg-sunken">
                  {/* The shop's own profile picture, so each row is recognisable at a glance. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.avatarUrl} alt="" className="size-10 shrink-0 rounded-full border border-line" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{s.name}</span>
                    <span className="block truncate text-[13px] text-muted">{s.summary ?? s.tagline}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[14px] font-medium text-accent">
                    Set up
                    <ChevronRight aria-hidden className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState
          title={building ? "Your shops are still being built" : "No shops yet"}
          body={
            building
              ? "Each shop shows up here when it's ready."
              : "Build a shop first."
          }
          action={
            building ? null : (
              <Link href="/builder/new" className={buttonClass("primary", "min-h-11")}>
                Build a shop
              </Link>
            )
          }
        />
      )}
      {shops.length && building ? (
        <p className="mt-3 max-w-3xl text-[13px] text-muted">
          {building === 1 ? "One more shop is still being built." : `${building} more shops are still being built.`}
        </p>
      ) : null}
    </>
  );
}
