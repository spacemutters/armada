-- Brand images for AI-built shops, made with ChatGPT's image maker on the owner's PC (job kinds
-- images.hero, images.lifestyle, images.collection; lib/shops/images.ts, helper/engines.mjs).
--
-- These are mood pictures only: the shop's world, light and materials, for the home page hero,
-- collection covers, a lifestyle band and the link preview (og). They never show a product the shop
-- sells; product photos stay the supplier's real photos, so shoppers get what the photos show.
--
-- One picture from the AI becomes one or more rows: the hero comes as 'wide' (16:9) and 'tall' (4:5)
-- plus an 'og' row (1200x630) cut from the same picture. Rows arrive with live = false and go live
-- together when the job finishes; the slot's older rows are deleted then.

create table armada.shop_images (
  -- Also the unguessable part of the image's public address (/api/img/<id>). A new picture always
  -- gets a new id, so the address can be cached forever.
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  job_id uuid references armada.ai_jobs(id) on delete set null,
  kind text not null check (kind in ('hero', 'lifestyle', 'collection', 'og')),
  variant text not null default 'main' check (variant in ('main', 'wide', 'tall')),
  -- The collection's handle in the shop's blueprint, for kind = 'collection'.
  collection_handle text,
  -- What the image maker was asked for, and one plain sentence for screen readers.
  prompt text not null default '',
  alt text not null default '',
  mime text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  bytes bytea not null check (octet_length(bytes) between 100 and 800000),
  width int not null check (width between 16 and 4000),
  height int not null check (height between 16 and 4000),
  live boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'collection') = (collection_handle is not null))
);
create index shop_images_shop on armada.shop_images (shop_id, kind) where live;
create index shop_images_job on armada.shop_images (job_id);

alter table armada.shop_images enable row level security;
create policy workspace_scope on armada.shop_images
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.shop_images to armada_app;
