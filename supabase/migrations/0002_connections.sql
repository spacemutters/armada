-- Connections to outside services, and the speed lanes that keep Armada inside their limits.

-- Keys and tokens for a workspace's connections. `secret` is AES-256-GCM ciphertext made by the app
-- (the encryption key lives in Vercel's settings, never in the database). `meta` holds only
-- non-secret facts: account name, when tokens expire, last error.
create table armada.credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  provider text not null check (provider in ('cj', 'shopify', 'ebay', 'meta', 'google', 'tiktok')),
  label text not null default '',
  secret bytea not null,
  key_version int not null default 1,
  status text not null default 'connected' check (status in ('connected', 'needs_attention', 'disconnected')),
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, label)
);

-- One row per speed lane (a CJ account, later each Shopify store). Callers reserve the next free
-- time slot with a single atomic update, so many servers at once still stay under the limit.
create table armada.provider_lanes (
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  lane text not null,
  next_at timestamptz not null default now(),
  primary key (workspace_id, lane)
);

alter table armada.credentials enable row level security;
create policy workspace_scope on armada.credentials
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

alter table armada.provider_lanes enable row level security;
create policy workspace_scope on armada.provider_lanes
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.credentials, armada.provider_lanes to armada_app;
