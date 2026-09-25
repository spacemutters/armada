import { createShops } from "../actions";
import { PendingButton } from "@/components/fx/pending-button";
import { buttonClass, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { cjStatus } from "@/connectors/cj/client";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "New shop" };

const IDEAS = ["Dog walking gear for city apartments", "Minimalist desk setup for gamers", "Home workout gear for small spaces", "Calm bedroom and sleep goods"];

export default async function NewShopPage({ searchParams }: PageProps<"/builder/new">) {
  const session = await requireSession();
  const { error, niche } = await searchParams;
  const cj = await cjStatus(session.workspaceId);
  return (
    <>
      <PageHeader
        title="Build a shop"
        subtitle="Describe the idea. The AI names the brand, picks the look, finds and writes twice the products you ask for so you can choose the ones that go in, and writes every page. Prices come from your pricing rules, not the AI."
      />
      <Card className="max-w-2xl p-6">
        <form action={createShops} className="flex flex-col gap-6">
          <Field label="What should the shop sell?" hint="Plain words work best.">
            <input
              name="niche"
              required
              minLength={3}
              maxLength={200}
              defaultValue={typeof niche === "string" ? niche : ""}
              className={inputClass}
              placeholder={IDEAS[0]}
              list="shop-ideas"
            />
            <datalist id="shop-ideas">
              {IDEAS.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </Field>
          <Field label="Who is it for?" hint="Optional. Leave it blank and the AI picks the most promising buyers.">
            <input name="audience" maxLength={200} className={inputClass} placeholder="People in small apartments who walk their dog twice a day" />
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Prices">
              <select name="priceFeel" defaultValue="mid" className={inputClass}>
                <option value="budget">Everyday</option>
                <option value="mid">Mid-range</option>
                <option value="premium">Premium</option>
              </select>
            </Field>
            <Field label="Products at launch">
              <select name="productCount" defaultValue="12" className={inputClass}>
                <option value="8">8</option>
                <option value="12">12</option>
                <option value="16">16</option>
              </select>
            </Field>
            <Field label="Sells to">
              <input name="country" defaultValue="United States" maxLength={40} className={inputClass} />
            </Field>
            <Field label="How many shops?" hint="More than one gives each its own name, look and angle.">
              <select name="count" defaultValue="1" className={inputClass}>
                {[1, 2, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Products from"
            hint={cj.connected ? "CJ gives real products, photos, costs and shipping times." : "Connect CJ in Settings to build shops from real supplier products."}
          >
            <select name="source" defaultValue={cj.connected ? "cj" : "practice"} className={inputClass}>
              {cj.connected ? <option value="cj">CJ Dropshipping (real products)</option> : null}
              <option value="practice">Practice catalog</option>
            </select>
          </Field>
          <Field label="Look and feel" hint="Optional, a few words.">
            <input name="look" maxLength={160} className={inputClass} placeholder="Calm, natural materials, lots of white space" />
          </Field>
          {error ? (
            <p role="alert" className="text-[13px] text-negative">
              {String(error)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <PendingButton pendingLabel="Starting the build…" beam className={buttonClass("primary")}>
              Build it
            </PendingButton>
            <span className="text-[13px] text-muted">Takes a few minutes per shop, with one stop where you choose the products. You can leave this page.</span>
          </div>
        </form>
      </Card>
    </>
  );
}
