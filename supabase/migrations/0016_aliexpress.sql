-- AliExpress joins CJ as a supplier: its connection is a credential, its products catalog items.
alter table armada.credentials drop constraint credentials_provider_check;
alter table armada.credentials add constraint credentials_provider_check check (provider in ('cj', 'shopify', 'ebay', 'meta', 'google', 'tiktok', 'aliexpress'));
alter table armada.catalog_items drop constraint catalog_items_source_check;
alter table armada.catalog_items add constraint catalog_items_source_check check (source in ('practice', 'cj', 'aliexpress'));
