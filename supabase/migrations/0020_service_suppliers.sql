-- Print-on-demand suppliers connected in one press through the connection service (Pipedream's own
-- approved apps): Printful and Printify. Their credentials hold only which account it is at the service.
alter table armada.credentials drop constraint credentials_provider_check;
alter table armada.credentials add constraint credentials_provider_check
  check (provider in ('cj', 'shopify', 'ebay', 'meta', 'google', 'tiktok', 'aliexpress', 'printful', 'printify'));
