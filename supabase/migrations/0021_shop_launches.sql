-- Launch: one press on a finished shop sets up everything around it (its eBay listings, its
-- Facebook Page and Instagram, the first week of posts, and its ads, ready and switched off).
-- One row per shop holds where each step got to, so the progress view survives reloads and a
-- second press picks up where the first left off. `lease_until` lets only one request work on a
-- shop's launch at a time (the page's refresh, a second tab, and the helper's once-a-minute sweep).

create table armada.shop_launches (
  shop_id uuid primary key references armada.shops (id) on delete cascade,
  workspace_id uuid not null references armada.workspaces (id) on delete cascade,
  started_by uuid references armada.members (id) on delete set null,
  status text not null default 'working' check (status in ('working', 'needs_you', 'waiting', 'done')),
  -- The steps as the progress view shows them: key, label, state, note, the one press, when finished.
  steps jsonb not null default '[]',
  -- What the steps made, so a later pass finds it again: the eBay change, the posts run, the ad set.
  state jsonb not null default '{}',
  lease_until timestamptz,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index shop_launches_workspace on armada.shop_launches (workspace_id);
-- The helper's sweep looks for launches still under way.
create index shop_launches_open on armada.shop_launches (updated_at) where status <> 'done';

alter table armada.shop_launches enable row level security;
create policy workspace_scope on armada.shop_launches
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.shop_launches to armada_app;
