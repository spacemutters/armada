import { ImageIcon } from "lucide-react";
import { makeImageAgain, makeImages } from "@/app/(app)/shop-images/actions";
import { PendingButton } from "@/components/fx/pending-button";
import { RefreshEvery } from "@/components/refresh-every";
import { buttonClass, Section } from "@/components/ui";
import { helperStatus } from "@/lib/ai/jobs";
import { shopImagesView } from "@/lib/shops/images";

/**
 * "Brand images" for one AI-built shop: the home page picture and the collection covers, each with a
 * one-press "Make again", and "Make images" when some are missing. Self-contained: give it the
 * workspace and the shop, and it loads what it needs and refreshes itself while pictures are made.
 *
 * These are mood pictures only. They never show the shop's products: product pages keep the
 * supplier's real photos, so shoppers get what the pictures show.
 */
export async function ShopImages({ workspaceId, shopId, canEdit = true }: { workspaceId: string; shopId: string; canEdit?: boolean }) {
  const view = await shopImagesView(workspaceId, shopId);
  if (!view || !view.hasPlan) return null;
  const making = view.slots.some((s) => s.making);
  const missing = view.slots.filter((s) => !s.image && !s.making);
  const helper = making ? await helperStatus() : null;

  return (
    <Section
      title="Brand images"
      action={
        canEdit && missing.length ? (
          <form action={makeImages.bind(null, shopId)}>
            <PendingButton pendingLabel="Asking…" className={buttonClass(view.slots.some((s) => s.image) ? "secondary" : "primary", "min-h-11 sm:min-h-9")}>
              {view.slots.some((s) => s.image) ? `Make the missing ${missing.length === 1 ? "one" : missing.length}` : "Make images"}
            </PendingButton>
          </form>
        ) : null
      }
    >
      <p className="mb-4 max-w-2xl text-[14px] text-muted">
        Pictures that set the shop&apos;s mood on its home page and collection pages, made with ChatGPT. They never show the products themselves:
        product pages keep the supplier&apos;s real photos.
      </p>
      {making ? (
        <p role="status" className="mb-4 text-[14px]">
          {helper && !helper.online
            ? "Waiting for the AI helper on your computer to come online. The pictures start as soon as it does."
            : "Making pictures now. Each takes about half a minute."}
        </p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {view.slots.map((s) => (
          <li key={s.key} className="flex flex-col gap-2">
            <div
              className="relative overflow-hidden rounded-xl border border-line bg-sunken"
              style={{ aspectRatio: s.kind === "collection" ? "1 / 1" : "16 / 9" }}
            >
              {s.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/img/${s.image.id}`} alt={s.image.alt || `${s.label} picture`} loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">
                  <ImageIcon aria-hidden className="size-6" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3 sm:min-h-9">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{s.label}</div>
                <div className="text-[13px] text-muted">
                  {s.making ? "Being made" : s.failed ? "The last try didn't work" : s.image ? (s.kind === "hero" ? "Home page and link previews" : "Collection cover") : "Not made yet"}
                </div>
              </div>
              {canEdit && s.image && !s.making ? (
                <form action={makeImageAgain.bind(null, shopId, s.image.id)}>
                  <PendingButton pendingLabel="Asking…" variant="secondary" className={buttonClass("secondary", "min-h-11 shrink-0 sm:min-h-9")}>
                    Make again
                  </PendingButton>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {making ? <RefreshEvery seconds={6} /> : null}
    </Section>
  );
}
