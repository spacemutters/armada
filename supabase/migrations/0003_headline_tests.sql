-- Headline tests (A/B tests) on a shop's storefront.
--
-- A test compares the shop's current home-page headline (A) with one other version (B), usually
-- written by the AI. Visitors are split by a signed visitor cookie, so the same person always sees
-- the same version. What counts is whether a visitor who saw the headline adds something to the bag.

create table armada.ab_tests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  -- What is being tested. Only the home-page headline block for now.
  element text not null default 'hero' check (element in ('hero')),
  status text not null default 'writing'
    check (status in ('writing', 'choosing', 'running', 'finished', 'failed', 'cancelled')),
  -- A: the headline block as it was when the test was made.
  original jsonb not null,
  -- The AI's versions to choose from: [{headline, subhead, cta, idea}].
  candidates jsonb not null default '[]',
  -- B: the version being tested, after any edits.
  variant jsonb,
  -- Share of visitors who see B, in percent.
  split int not null default 50 check (split between 5 and 95),
  winner text check (winner in ('a', 'b', 'none')),
  -- The headline block just before B was made the winner, so it can be put back.
  replaced jsonb,
  -- When the original was put back after B won.
  undone_at timestamptz,
  -- Made-up conversion rates for practice visitors; never shown as fact.
  practice_rates jsonb,
  error text,
  created_by uuid references armada.members(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open test per shop at a time, so a visitor is never in two tests of the same headline.
create unique index ab_tests_one_open_per_shop on armada.ab_tests (shop_id) where status in ('writing', 'choosing', 'running');
create index ab_tests_shop on armada.ab_tests (shop_id, created_at desc);

-- One row per visitor per kind of event per test, so reloading a page never counts twice.
create table armada.ab_events (
  test_id uuid not null references armada.ab_tests(id) on delete cascade,
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  visitor text not null,
  kind text not null check (kind in ('view', 'add')),
  variant text not null check (variant in ('a', 'b')),
  practice boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (test_id, visitor, kind)
);
create index ab_events_counts on armada.ab_events (test_id, variant, kind);

-- Added after review (applied as armada_headline_tests_ip_cap): a keyed hash of the visitor's
-- internet address, so one address can't count more than a handful of "visitors" in a test.
alter table armada.ab_events add column ip_hash text;
create index ab_events_ip on armada.ab_events (test_id, ip_hash) where ip_hash is not null;

alter table armada.ab_tests enable row level security;
create policy workspace_scope on armada.ab_tests
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

alter table armada.ab_events enable row level security;
create policy workspace_scope on armada.ab_events
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.ab_tests, armada.ab_events to armada_app;
