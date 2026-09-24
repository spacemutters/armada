import { createShops } from "../actions";
import { Button, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "New shop" };

const IDEAS = ["Dog walking gear for city apartments", "Minimalist desk setup for gamers", "Home workout gear for small spaces", "Calm bedroom and sleep goods"];

export default async function NewShopPage({ searchParams }: PageProps<"/builder/new">) {
  await requireSession();
  const { error, niche } = await searchParams;
  return (
    <>
      <PageHeader
        title="Build a shop"
        subtitle="Describe the idea. The AI names the brand, picks the look, chooses and writes the products, and writes every page. Prices come from your pricing rules, not the AI."
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
          <Field label="Look and feel" hint="Optional, a few words.">
            <input name="look" maxLength={160} className={inputClass} placeholder="Calm, natural materials, lots of white space" />
          </Field>
          {error ? (
            <p role="alert" className="text-[13px] text-negative">
              {String(error)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Build it</Button>
            <span className="text-[13px] text-muted">Takes about two to four minutes per shop. You can leave this page.</span>
          </div>
        </form>
      </Card>
    </>
  );
}
