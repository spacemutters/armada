-- Store channels and one-press connections.
-- Facebook (and Instagram) shops join Shopify and eBay as a kind of store, and every "connect"
-- or "open a new store" round trip through a platform's own sign-in carries a one-time state
-- token, so a callback can't be forged or replayed.

alter table armada.stores drop constraint if exists stores_platform_check;
alter table armada.stores add constraint stores_platform_check check (platform in ('shopify', 'ebay', 'facebook'));

create table armada.oauth_states (
  -- sha256 of the random state sent to the platform; the raw value is never stored.
  state_hash text primary key,
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  member_id uuid references armada.members(id) on delete cascade,
  provider text not null,
  -- What to do when the platform sends the person back: 'connect' an existing account, or
  -- 'open' a new store and set it up.
  purpose text not null default 'connect' check (purpose in ('connect', 'open')),
  -- Anything the callback needs (shop domain, return path, chosen store name…). No secrets.
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);
create index oauth_states_expiry on armada.oauth_states (expires_at);

alter table armada.oauth_states enable row level security;
create policy workspace_scope on armada.oauth_states
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.oauth_states to armada_app;
