// Loads the shared practice catalog: sample products with real photos from DummyJSON, a free
// test-data service. Costs, shipping and stock are simulated, and every item is marked "practice".
// Food and vehicles are left out; items that carry a brand are kept but flagged, so the brand
// rule has something to catch.
import postgres from "postgres";

const SKIP = new Set(["groceries", "vehicle", "motorcycle"]);

function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const humanize = (s) => s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const res = await fetch("https://dummyjson.com/products?limit=0");
if (!res.ok) throw new Error(`DummyJSON answered ${res.status}`);
const { products } = await res.json();

const rows = products
  .filter((p) => !SKIP.has(p.category))
  .map((p) => {
    const r = hash(p.id);
    const shipMin = 5 + Math.floor(r * 4);
    const shipMax = shipMin + 4 + Math.floor(hash(p.id + 7) * 6);
    return {
      source: "practice",
      source_id: `dummyjson-${p.id}`,
      title: p.title,
      description: p.description,
      category: humanize(p.category),
      tags: p.tags ?? [],
      images: (p.images ?? []).slice(0, 4).map((url) => ({ url, alt: p.title })),
      cost_cents: Math.max(100, Math.round(p.price * 0.38 * 100)),
      ship_cents: 299 + Math.round(hash(p.id + 3) * 600),
      ship_days_min: shipMin,
      ship_days_max: shipMax,
      stock: p.stock ?? null,
      rating: p.rating ?? null,
      branded: Boolean(p.brand),
      attributes: {
        ...(p.brand ? { brand: p.brand } : {}),
        ...(p.dimensions ? { dimensionsCm: p.dimensions } : {}),
        ...(p.weight ? { weight: p.weight } : {}),
        origin: "dummyjson",
      },
    };
  });

const url = process.env.DATABASE_URL;
const { hostname } = new URL(url);
const { SUPABASE_CA } = await import("../lib/db/supabase-ca.ts");
const sql = postgres(url, {
  prepare: false,
  max: 1,
  host: process.env.DATABASE_HOSTADDR || undefined,
  ssl: { ca: SUPABASE_CA, servername: hostname, rejectUnauthorized: true },
});

try {
  const n = await sql.begin(async (tx) => {
    await tx`select set_config('armada.system', 'on', true)`;
    let count = 0;
    for (const row of rows) {
      await tx`
        insert into armada.catalog_items
          (workspace_id, source, source_id, title, description, category, tags, images, cost_cents, ship_cents,
           ship_days_min, ship_days_max, stock, rating, branded, attributes)
        values (null, ${row.source}, ${row.source_id}, ${row.title}, ${row.description}, ${row.category}, ${row.tags},
                ${tx.json(row.images)}, ${row.cost_cents}, ${row.ship_cents}, ${row.ship_days_min}, ${row.ship_days_max},
                ${row.stock}, ${row.rating}, ${row.branded}, ${tx.json(row.attributes)})
        on conflict (workspace_id, source, source_id) do update set
          title = excluded.title, description = excluded.description, category = excluded.category, tags = excluded.tags,
          images = excluded.images, cost_cents = excluded.cost_cents, ship_cents = excluded.ship_cents,
          ship_days_min = excluded.ship_days_min, ship_days_max = excluded.ship_days_max, stock = excluded.stock,
          rating = excluded.rating, branded = excluded.branded, attributes = excluded.attributes, updated_at = now()`;
      count++;
    }
    return count;
  });
  const [{ unbranded }] = await sql.begin(async (tx) => {
    await tx`select set_config('armada.system', 'on', true)`;
    return tx`select count(*) filter (where not branded)::int as unbranded from armada.catalog_items where workspace_id is null`;
  });
  console.log(`practice catalog: ${n} items loaded, ${unbranded} without a brand`);
} finally {
  await sql.end();
}
