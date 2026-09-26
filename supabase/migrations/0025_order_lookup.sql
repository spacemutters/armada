-- A shopper follows their own order at /s/<slug>/order/<token>. The token is random, made when the
-- checkout starts, and rides on Stripe's receipt, so only the buyer has it.
alter table armada.orders add column if not exists lookup_token text;
create unique index if not exists orders_lookup_token on armada.orders (lookup_token) where lookup_token is not null;
