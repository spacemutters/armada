-- One-press store opening for eBay and Facebook/Instagram shops.
--
-- A live eBay store is one row per workspace per eBay account (eBay's permanent user id), and a
-- live Facebook shop is one row per workspace per Meta setup (the id Armada gave Meta's setup
-- window). Coming back from eBay or Meta twice, or from two tabs at once, updates that row instead
-- of adding a copy. Setup progress lives in stores.meta.setup; no new tables, so row-level
-- security is unchanged (stores and credentials are already scoped to their workspace).

create unique index if not exists stores_ebay_live_account
  on armada.stores (workspace_id, (meta ->> 'ebayUserId'))
  where platform = 'ebay' and mode = 'live';

create unique index if not exists stores_facebook_live_setup
  on armada.stores (workspace_id, (meta ->> 'fbeExternalId'))
  where platform = 'facebook' and mode = 'live';
