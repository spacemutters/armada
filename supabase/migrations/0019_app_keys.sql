-- Armada's own app keys on each platform (Shopify, eBay, Meta, TikTok, Google Ads, AliExpress),
-- pasted by the platform admin on Connections instead of set in Vercel. One row per setting; the
-- value is sealed. Settings set in Vercel win over these.

create table armada.app_keys (
  name text primary key check (name ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  value bytea not null,
  updated_by uuid references armada.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table armada.app_keys enable row level security;
create policy system_only on armada.app_keys using (armada.is_system()) with check (armada.is_system());
grant select, insert, update, delete on armada.app_keys to armada_app;
