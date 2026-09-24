-- Shopify connections.
--
-- A Shopify store is one live row per workspace, keyed by its permanent address
-- (yourstore.myshopify.com), so connecting the same store again updates that row instead of adding
-- a copy. Its access is in armada.credentials (provider 'shopify', label = the same address).
-- Practice stores and the other platforms are untouched by this rule.
create unique index if not exists stores_shopify_live_domain
  on armada.stores (workspace_id, domain)
  where platform = 'shopify' and mode = 'live';

-- Shopify's notices (the app was removed from a store, privacy requests) name the store by its
-- address only, so they are matched across workspaces by platform and address.
create index if not exists stores_live_platform_domain
  on armada.stores (platform, domain)
  where mode = 'live';

create index if not exists credentials_provider_label
  on armada.credentials (provider, label);
