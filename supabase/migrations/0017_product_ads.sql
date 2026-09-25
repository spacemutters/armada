-- "Make an ad with AI" on a product: the AI writes a few carousel posts about that one product, in
-- the look of a shop it's in (job kind social.carousel, run kind 'product').

alter table armada.social_runs drop constraint social_runs_kind_check;
alter table armada.social_runs add constraint social_runs_kind_check check (kind in ('week', 'rewrite', 'product'));

-- The product a 'product' run is about.
alter table armada.social_runs add column product_id uuid references armada.products(id) on delete set null;

-- One product run being written per shop and product at a time; a second press finds the first.
create unique index social_runs_one_product_run on armada.social_runs (shop_id, product_id) where status = 'writing' and kind = 'product';
