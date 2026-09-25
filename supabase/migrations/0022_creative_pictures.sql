-- Pictures for ads and social posts, made with ChatGPT's image maker on the owner's PC (job kinds
-- images.scene and images.item; lib/creative/pictures.ts, lib/creative/brief.ts, helper/engines.mjs).
--
-- THE HONESTY RULE: an ad or post never shows a product the shopper won't receive. A product is
-- always shown by its real photo, placed by Armada. ChatGPT makes only:
--   scene  the shop's world around the products (a place, light, the moment of use), never a product;
--          one per carousel card, single-photo ad setting or post slide that asks for one.
--   item   a picture of a practice item: an imagined product in a practice shop, which only has an
--          illustration. Practice shops never sell and their ads never run. One per shop and item,
--          used wherever that item appears. The trigger below refuses an item picture for anything
--          that isn't a practice shop's imagined item.
-- Brand pictures (armada.shop_images) are separate and never reach a product card, page or the bag.
--
-- One picture from the AI becomes one row per cut (square, portrait 4:5, story 9:16). Rows arrive
-- with live = false and go live together when the job finishes; the slot's older rows are deleted then.

create table armada.creative_pictures (
  -- Also the unguessable part of the picture's public address (/api/img/<id>). A new picture always
  -- gets a new id, so the address can be cached forever.
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  -- Whose picture it is: an ad (a card or its setting), a post (a slide), or a practice item.
  ad_variation_id uuid references armada.ad_variations(id) on delete cascade,
  post_id uuid references armada.social_posts(id) on delete cascade,
  product_id uuid references armada.products(id) on delete cascade,
  -- "main" (a single-photo ad's setting), "card:<key>", "slide:<n>", or "item".
  slot text not null check (slot ~ '^(main|item|card:[a-z0-9]{1,8}|slide:[1-8])$'),
  kind text not null check (kind in ('scene', 'item')),
  variant text not null check (variant in ('square', 'portrait', 'story')),
  job_id uuid references armada.ai_jobs(id) on delete set null,
  -- What the image maker was asked for, and one plain sentence for screen readers.
  prompt text not null default '',
  alt text not null default '',
  mime text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  bytes bytea not null check (octet_length(bytes) between 100 and 800000),
  width int not null check (width between 16 and 4000),
  height int not null check (height between 16 and 4000),
  live boolean not null default false,
  created_at timestamptz not null default now(),
  -- An item picture belongs to a practice item and nothing else; a scene belongs to exactly one ad or post.
  check (
    (kind = 'item' and slot = 'item' and product_id is not null and ad_variation_id is null and post_id is null)
    or (kind = 'scene' and product_id is null and ((ad_variation_id is null) <> (post_id is null)))
  )
);
create index creative_pictures_ad on armada.creative_pictures (ad_variation_id, slot) where live;
create index creative_pictures_post on armada.creative_pictures (post_id, slot) where live;
create index creative_pictures_item on armada.creative_pictures (shop_id, product_id) where live and kind = 'item';
create index creative_pictures_job on armada.creative_pictures (job_id);

-- The honesty rule for item pictures, held by the database too: only a practice shop's imagined item.
create function armada.creative_item_is_practice() returns trigger language plpgsql as $$
begin
  if new.kind = 'item' and not exists (
    select 1 from armada.shops s, jsonb_array_elements(coalesce(s.blueprint -> 'products', '[]'::jsonb)) p
    where s.id = new.shop_id
      and s.brief ->> 'source' = 'practice'
      and p ->> 'productId' = new.product_id::text
      and coalesce((p ->> 'imagined')::boolean, false)
  ) then
    raise exception 'An item picture is only for a practice shop''s imagined item';
  end if;
  return new;
end $$;
create trigger creative_item_is_practice before insert or update of kind, product_id, shop_id on armada.creative_pictures
  for each row execute function armada.creative_item_is_practice();

alter table armada.creative_pictures enable row level security;
create policy workspace_scope on armada.creative_pictures
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.creative_pictures to armada_app;

-- A single-photo ad's setting: what the ChatGPT picture behind its real product photo shows. Carousel
-- cards carry their own (ad_variations.cards: [{key, kind: product|scene, productId, photo, headline,
-- description, scene}]).
alter table armada.ad_variations add column scene text not null default '';

-- A slide can show a ChatGPT picture: a scene (its own, described in `scene`) or the practice item on
-- it (product_id). A product's real photo stays in image_url, as before.
alter table armada.social_slides add column picture text check (picture in ('scene', 'item'));
alter table armada.social_slides add column scene text not null default '';
