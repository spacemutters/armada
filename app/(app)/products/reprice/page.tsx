import { previewReprice } from "../actions";
import { Button, Card, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { withWorkspace } from "@/lib/db";

export const metadata = { title: "Change prices" };

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export default async function RepricePage({ searchParams }: PageProps<"/products/reprice">) {
  const session = await requireSession();
  const sp = await searchParams;
  const ids = ([] as unknown[]).concat(sp.ids ?? []).filter(uuid).slice(0, 200);
  if (!ids.length) {
    return (
      <>
        <PageHeader title="Change prices" />
        <EmptyState title="No products chosen" body="Go back to Products, tick the products you want, then press Change prices." />
      </>
    );
  }
  const [{ n, stores }] = await withWorkspace(
    session.workspaceId,
    (tx) => tx<{ n: number; stores: number }[]>`
      select count(*)::int as n, count(distinct store_id)::int as stores from armada.listings where product_id in ${tx(ids)} and status = 'active'`,
  );
  return (
    <>
      <PageHeader title="Change prices" subtitle={`${ids.length} products, live in ${stores} stores (${n} listings).`} />
      <Card className="max-w-lg p-6">
        <form action={previewReprice} className="flex flex-col gap-5">
          {ids.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          <Field label="Change every price by" hint="A percentage. Use a minus sign to lower prices. Prices keep their .99 endings.">
            <div className="flex items-center gap-2">
              <input name="percent" type="number" min={-50} max={100} step={1} defaultValue={5} className={`${inputClass} max-w-32`} />
              <span className="text-muted">%</span>
            </div>
          </Field>
          <Button type="submit" className="self-start">
            See the preview
          </Button>
        </form>
      </Card>
    </>
  );
}
