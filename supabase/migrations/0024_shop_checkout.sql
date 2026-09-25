-- Checkout on Armada's own storefronts (/s/<slug>): shoppers pay through the platform's Stripe
-- connection (billing_settings), and each paid checkout becomes an order on the shop's own store.
--
-- A shop's storefront is a store like any other (platform 'armada'), so its orders use the same
-- orders, order_lines and supplier_orders tables, with the same no-double-orders guarantee.
alter table armada.stores drop constraint if exists stores_platform_check;
alter table armada.stores add constraint stores_platform_check check (platform in ('shopify', 'ebay', 'facebook', 'armada'));
alter table armada.stores add column if not exists shop_id uuid references armada.shops (id) on delete cascade;
-- One store per shop and payment mode: test payments land on a practice store, so a test purchase
-- can never become a real supplier order.
create unique index if not exists stores_one_per_shop on armada.stores (shop_id, mode) where platform = 'armada';

-- Launch switches a real shop's checkout on (practice shops never take payments).
alter table armada.shops add column if not exists checkout_open boolean not null default false;
