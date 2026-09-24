-- Armada core schema.
-- Everything lives in the `armada` schema, walled off from the host project's own tables.
-- The app connects as `armada_app` (created separately, never committed), which is not the
-- table owner, so row-level security applies to every query it makes.

create schema if not exists armada;
grant usage on schema armada to armada_app;
alter role armada_app set search_path = armada, public;

-- The workspace a request acts for is set per transaction with set_config('armada.workspace_id', ...).
-- Background work that spans workspaces sets armada.system = 'on' instead.
create or replace function armada.current_workspace() returns uuid
language sql stable as $$
  select nullif(current_setting('armada.workspace_id', true), '')::uuid
$$;

create or replace function armada.is_system() returns boolean
language sql stable as $$
  select coalesce(current_setting('armada.system', true), '') = 'on'
$$;

-- People and sign-in -------------------------------------------------------

create table armada.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table armada.members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner', 'manager', 'assistant', 'viewer')),
  session_version int not null default 1,
  created_at timestamptz not null default now()
);
create index members_workspace on armada.members (workspace_id);

create table armada.passkeys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  member_id uuid not null references armada.members(id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_member on armada.passkeys (member_id);

-- One-time links: first-owner setup (workspace_id null), a new teammate, or another device.
create table armada.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references armada.workspaces(id) on delete cascade,
  member_id uuid references armada.members(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'manager', 'assistant', 'viewer')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Stores ---------------------------------------------------------------------

create table armada.store_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table armada.stores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  platform text not null check (platform in ('shopify', 'ebay')),
  mode text not null default 'practice' check (mode in ('practice', 'live')),
  name text not null,
  domain text,
  currency text not null default 'USD',
  country text not null default 'US',
  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'needs_attention', 'setting_up')),
  group_id uuid references armada.store_groups (id) on delete set null,
  -- eBay: the real-world seller behind the account, so the one-listing rule spans all their accounts.
  seller_key text,
  health jsonb not null default '{}',
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index stores_workspace on armada.stores (workspace_id);

-- Supplier catalog -------------------------------------------------------------

create table armada.catalog_items (
  id uuid primary key default gen_random_uuid(),
  -- null workspace = the shared practice catalog
  workspace_id uuid references armada.workspaces(id) on delete cascade,
  source text not null check (source in ('practice', 'cj')),
  source_id text not null,
  title text not null,
  description text not null default '',
  category text not null default '',
  tags text[] not null default '{}',
  images jsonb not null default '[]',
  cost_cents int not null check (cost_cents >= 0),
  ship_cents int not null default 0,
  ship_days_min int,
  ship_days_max int,
  stock int,
  rating numeric(3, 2),
  branded boolean not null default false,
  -- true for retail sources (Amazon, Walmart and the like), which eBay's dropshipping policy forbids
  retail_source boolean not null default false,
  attributes jsonb not null default '{}',
  search tsvector generated always as (to_tsvector('english', title || ' ' || category)) stored,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (workspace_id, source, source_id)
);
create index catalog_items_workspace on armada.catalog_items (workspace_id);
create index catalog_items_search on armada.catalog_items using gin (search);

-- Master catalog and listings -----------------------------------------------------

create table armada.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  catalog_item_id uuid references armada.catalog_items (id) on delete set null,
  title text not null,
  description text not null default '',
  bullets jsonb not null default '[]',
  images jsonb not null default '[]',
  category text not null default '',
  cost_cents int not null default 0,
  ship_cents int not null default 0,
  seo_title text,
  seo_description text,
  score int check (score between 1 and 100),
  score_parts jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_workspace on armada.products (workspace_id);

create table armada.listings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  product_id uuid not null references armada.products (id) on delete cascade,
  store_id uuid not null references armada.stores (id) on delete cascade,
  external_id text,
  handle text,
  title text,
  price_cents int not null check (price_cents >= 0),
  compare_at_cents int,
  status text not null default 'active' check (status in ('active', 'hidden', 'draft', 'error')),
  last_synced_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (store_id, product_id)
);
create index listings_workspace on armada.listings (workspace_id);
create index listings_product on armada.listings (product_id);

-- AI-built shops ---------------------------------------------------------------------

create table armada.shops (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  slug text not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'building', 'ready', 'publishing', 'published', 'failed')),
  niche text not null,
  brief jsonb not null default '{}',
  blueprint jsonb not null default '{}',
  store_id uuid references armada.stores (id) on delete set null,
  progress jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shops_workspace on armada.shops (workspace_id);

-- AI jobs, run by the helper on Davis's computer -------------------------------------

create table armada.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  kind text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  input jsonb not null,
  output jsonb,
  error text,
  attempts int not null default 0,
  parent_type text,
  parent_id uuid,
  claimed_by text,
  usage jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index ai_jobs_queue on armada.ai_jobs (status, created_at) where status in ('queued', 'running');
create index ai_jobs_parent on armada.ai_jobs (parent_type, parent_id);

create table armada.helpers (
  id text primary key,
  last_seen_at timestamptz not null default now(),
  info jsonb not null default '{}'
);

-- Changes to many stores, with undo ---------------------------------------------------

create table armada.change_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  kind text not null,
  summary text not null,
  status text not null default 'preview'
    check (status in ('preview', 'running', 'done', 'partial', 'failed', 'undone', 'cancelled')),
  params jsonb not null default '{}',
  counts jsonb not null default '{}',
  created_by uuid references armada.members (id) on delete set null,
  approved_at timestamptz,
  undo_of uuid references armada.change_sets (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index change_sets_workspace on armada.change_sets (workspace_id, created_at desc);

create table armada.change_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  change_set_id uuid not null references armada.change_sets (id) on delete cascade,
  store_id uuid references armada.stores (id) on delete set null,
  target_type text not null,
  target_id uuid,
  before jsonb,
  after jsonb,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'skipped')),
  error text,
  undoable boolean not null default true,
  finished_at timestamptz
);
create index change_items_set on armada.change_items (change_set_id);

-- Orders -------------------------------------------------------------------------------

create table armada.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  store_id uuid not null references armada.stores (id) on delete cascade,
  external_id text not null,
  placed_at timestamptz not null,
  customer_country text,
  total_cents int not null,
  fees_cents int not null default 0,
  refund_cents int not null default 0,
  status text not null default 'new'
    check (status in ('new', 'ordered', 'shipped', 'delivered', 'problem', 'cancelled', 'refunded')),
  problem text,
  created_at timestamptz not null default now(),
  unique (store_id, external_id)
);
create index orders_workspace on armada.orders (workspace_id, placed_at desc);

create table armada.order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  order_id uuid not null references armada.orders (id) on delete cascade,
  listing_id uuid references armada.listings (id) on delete set null,
  product_id uuid references armada.products (id) on delete set null,
  title text not null,
  quantity int not null check (quantity > 0),
  price_cents int not null,
  cost_cents int not null default 0
);
create index order_lines_order on armada.order_lines (order_id);

-- One supplier order per order line: the unique key is what makes double-ordering impossible.
create table armada.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  order_line_id uuid not null unique references armada.order_lines (id) on delete cascade,
  supplier text not null,
  external_id text,
  cost_cents int not null,
  status text not null default 'placed' check (status in ('placed', 'shipped', 'delivered', 'failed', 'cancelled')),
  tracking_number text,
  carrier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit --------------------------------------------------------------------------------

create table armada.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid references armada.workspaces(id) on delete cascade,
  member_id uuid references armada.members (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_workspace on armada.audit_log (workspace_id, created_at desc);

-- Row-level security ----------------------------------------------------------------------

alter table armada.workspaces enable row level security;
create policy workspace_scope on armada.workspaces
  using (id = armada.current_workspace() or armada.is_system())
  with check (id = armada.current_workspace() or armada.is_system());

do $$
declare t text;
begin
  foreach t in array array[
    'members', 'passkeys', 'store_groups', 'stores', 'products', 'listings', 'shops', 'ai_jobs',
    'change_sets', 'change_items', 'orders', 'order_lines', 'supplier_orders', 'audit_log'
  ] loop
    execute format('alter table armada.%I enable row level security', t);
    execute format(
      'create policy workspace_scope on armada.%I using (workspace_id = armada.current_workspace() or armada.is_system()) with check (workspace_id = armada.current_workspace() or armada.is_system())',
      t
    );
  end loop;
end $$;

-- The shared practice catalog (workspace null) is readable by everyone; writes stay scoped.
alter table armada.catalog_items enable row level security;
create policy catalog_read on armada.catalog_items for select
  using (workspace_id is null or workspace_id = armada.current_workspace() or armada.is_system());
create policy catalog_write on armada.catalog_items for all
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

-- Sign-in links and helper heartbeats are only touched by system code.
alter table armada.invites enable row level security;
create policy system_only on armada.invites using (armada.is_system()) with check (armada.is_system());
alter table armada.helpers enable row level security;
create policy system_only on armada.helpers using (armada.is_system()) with check (armada.is_system());

-- Grants -----------------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema armada to armada_app;
grant usage, select on all sequences in schema armada to armada_app;
grant execute on all functions in schema armada to armada_app;
alter default privileges in schema armada grant select, insert, update, delete on tables to armada_app;
alter default privileges in schema armada grant usage, select on sequences to armada_app;
alter default privileges in schema armada grant execute on functions to armada_app;
