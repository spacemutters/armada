import Link from "next/link";
import { ShimmerText } from "@/components/fx/shimmer-text";
import { ThinkingOrb } from "@/components/fx/thinking-orb";
import { ProductArt } from "@/components/product-art";
import { ButtonLink, EmptyState, PageHeader, StatusPill, type Tone } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { getShopProducts, listShops } from "@/lib/shops/queries";
import { chooseCount, type ShopRow } from "@/lib/shops/types";
import { timeAgo } from "@/lib/text";

export const metadata = { title: "Shop builder" };

const STATUS: Record<ShopRow["status"], { tone: Tone; label: string }> = {
  draft: { tone: "off", label: "Draft" },
  building: { tone: "working", label: "Building" },
  choosing: { tone: "attention", label: "Waiting for you" },
  ready: { tone: "ok", label: "Ready" },
  publishing: { tone: "working", label: "Publishing" },
  published: { tone: "ok", label: "Live in a store" },
  failed: { tone: "error", label: "Stopped" },
};

export default async function BuilderPage() {
  const session = await requireSession();
  const shops = await listShops(session.workspaceId);
  const thumbIds = shops.flatMap((s) => (s.blueprint.products ?? []).slice(0, 3).map((p) => p.productId));
  const products = new Map((await getShopProducts(session.workspaceId, thumbIds)).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader
        title="Shop builder"
        subtitle="Whole shops from one idea: brand, look, products, prices and pages. Build one, or ten at once, each with its own name and angle."
        actions={<ButtonLink href="/builder/new">Build a shop</ButtonLink>}
      />
      {shops.length === 0 ? (
        <EmptyState
          mark={<ThinkingOrb state="idle" size={32} decorative />}
          title="No shops yet"
          body="Type an idea like “calm bedroom and sleep goods”. The first shop takes about three minutes, and you can watch it being built."
          action={<ButtonLink href="/builder/new">Build your first shop</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shops.map((s) => {
            const bp = s.blueprint;
            const palette = bp.theme?.palette;
            const status = STATUS[s.status] ?? STATUS.draft;
            // While the owner chooses, the cards show the first of the AI's proposals.
            const proposals = s.status === "choosing" ? (bp.proposals ?? []) : [];
            const need = chooseCount(s.brief.productCount, proposals.length);
            return (
              <li key={s.id}>
                <Link href={`/builder/${s.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-raised transition-colors hover:border-line-strong">
                  <div className="grid aspect-[3/1] grid-cols-3 gap-px bg-line">
                    {[0, 1, 2].map((i) => {
                      const ref = bp.products?.[i];
                      const p = ref ? products.get(ref.productId) : undefined;
                      const proposed = p ? undefined : proposals[i];
                      return (
                        <div key={i} className="overflow-hidden bg-sunken" style={palette ? ({ "--art-bg": palette.surface, "--art-fg": palette.accent } as React.CSSProperties) : undefined}>
                          {p ? (
                            <ProductArt images={p.images} icon={p.art?.icon} title={p.title} />
                          ) : proposed ? (
                            <ProductArt images={proposed.image ? [proposed.image] : []} icon={proposed.icon ?? undefined} title={proposed.title} />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[16px] font-semibold">
                          {bp.brand?.name ?? (s.status === "building" ? <ShimmerText>Naming the brand…</ShimmerText> : "No name yet")}
                        </div>
                        <div className="truncate text-[13px] text-muted">{bp.brand?.tagline ?? s.niche}</div>
                      </div>
                      <StatusPill tone={status.tone}>{status.label}</StatusPill>
                    </div>
                    {s.status === "choosing" ? (
                      <p className="text-[13px] font-medium text-attention">
                        Choose {need} of the {proposals.length} products the AI found
                      </p>
                    ) : null}
                    <div className="flex items-center justify-between text-[13px] text-muted">
                      <span className="truncate">{s.niche}</span>
                      <span className="shrink-0">{timeAgo(s.createdAt)}</span>
                    </div>
                    {palette ? (
                      <div className="flex gap-1" aria-hidden>
                        {[palette.background, palette.surface, palette.ink, palette.muted, palette.accent].map((c, i) => (
                          <span key={i} className="h-2 flex-1 rounded-full border border-line" style={{ background: c }} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
