-- One-click connections through a connection service (Pipedream Connect). The service holds
-- approved apps with Shopify, eBay and others, so a seller presses Connect, approves on the
-- platform's own page, and comes back connected, without Armada having its own app on that
-- platform. One row for all of Armada, pasted in by the platform admin; the secret is sealed.

create table armada.connection_service (
  id boolean primary key default true check (id),
  service text not null default 'pipedream' check (service = 'pipedream'),
  client_id text not null,
  client_secret bytea not null,
  project_id text not null check (project_id ~ '^proj_[A-Za-z0-9]+$'),
  environment text not null check (environment in ('development', 'production')),
  connected_by uuid references armada.members (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The last thing the service refused, in plain words.
  last_error text,
  last_error_at timestamptz
);

alter table armada.connection_service enable row level security;
create policy system_only on armada.connection_service using (armada.is_system()) with check (armada.is_system());
grant select, insert, update, delete on armada.connection_service to armada_app;
