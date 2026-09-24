import { previewListing } from "../actions";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";

export const metadata = { title: "List in stores" };

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export default async function ListInStoresPage({ searchParams }: PageProps<"/products/list">) {
  const session = await requireSession();
  const sp = await searchParams;
  const ids = ([] as unknown[]).concat(sp.ids ?? []).filter(uuid).slice(0, 200);
  if (!ids.length) {
    return (
      <>
        <PageHeader title="List in stores" />
        <EmptyState title="No products chosen" body="Go back to Products, tick the products you want, then press List in stores." />
      </>
    );
  }
  const { products, groups } = await withWorkspace(session.workspaceId, async (tx) => {
    const products = await tx<{ id: string; title: string }[]>`select id, title from armada.products where id in ${tx(ids)} order by title`;
    const stores = await tx<{ id: string; name: string; platform: string; mode: string; group: string | null }[]>`
      select s.id, s.name, s.platform, s.mode, g.name as "group"
      from armada.stores s left join armada.store_groups g on g.id = s.group_id
      where s.status <> 'disconnected' order by g.name nulls last, s.name`;
    const groups = new Map<string, (typeof stores)[number][]>();
    for (const s of stores) {
      const key = s.group ?? "Not in a group";
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return { products, groups: [...groups.entries()] };
  });

  return (
    <>
      <PageHeader
        title="List in stores"
        subtitle={`${products.length} ${products.length === 1 ? "product" : "products"}: ${products
          .slice(0, 3)
          .map((p) => p.title)
          .join(", ")}${products.length > 3 ? ` and ${products.length - 3} more` : ""}`}
      />
      <form action={previewListing} className="flex flex-col gap-4">
        {products.map((p) => (
          <input key={p.id} type="hidden" name="ids" value={p.id} />
        ))}
        {sp.error === "stores" ? <p className="text-negative">Choose at least one store.</p> : null}
        {groups.map(([group, stores]) => (
          <Card key={group} className="p-5">
            <fieldset>
              <legend className="mb-3 text-[15px] font-semibold">
                {group} <span className="font-normal text-muted">· {stores.length} stores</span>
              </legend>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {stores.map((s) => (
                  <label key={s.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-sunken md:min-h-9">
                    <input type="checkbox" name="stores" value={s.id} className="size-5 accent-[var(--accent)]" />
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="ml-auto shrink-0 text-[12px] text-muted">{s.platform === "ebay" ? "eBay" : "Shopify"}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit">See the preview</Button>
          <span className="text-[13px] text-muted">Nothing changes until you approve the preview. eBay rules are checked for you.</span>
        </div>
      </form>
    </>
  );
}
