-- Ads: AI-written ads for each shop, created switched off, switched on by a person.
--
-- An ad set is one shop's ads on one platform: a few ad variations (single photo or carousel), one
-- budget, one audience. The AI writes the variations; people edit, rewrite or remove them; pressing
-- "Create these ads — paused" builds them on the platform (or in practice) switched off; only a
-- person's "Switch on" starts spending. Every switch-on, pause, stop and budget change is written to
-- armada.audit_log by the app.
--
-- Practice ad sets (practice shops, or no ad account connected) never leave Armada: their results are
-- made up by lib/ads/simulator.ts, stored with practice = true and labelled on every screen.

create table armada.ad_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  -- writing: the AI is writing; draft: written, nothing created yet; paused: created and switched off;
  -- on: spending; stopped: finished for good (ran its days, hit its cap, or ended by a person);
  -- failed: the AI couldn't write them.
  status text not null default 'writing'
    check (status in ('writing', 'draft', 'paused', 'on', 'stopped', 'failed')),
  platform text not null default 'practice' check (platform in ('practice', 'meta', 'google', 'tiktok')),
  -- Why these are practice ads, in plain words. Null for a real platform.
  practice_reason text,
  currency text not null default 'USD',
  daily_budget_cents int not null default 1000 check (daily_budget_cents between 100 and 1000000),
  days int not null default 7 check (days between 1 and 60),
  -- The most these ads can ever spend. Real platforms get it as a hard lifetime budget.
  spend_cap_cents int generated always as (daily_budget_cents * days) stored,
  -- The AI's reasoning for the budget, and its one-sentence plan.
  budget_reason text,
  plan text,
  -- {description, countries, ageMin, ageMax, interests}: who the ads are shown to, in plain words.
  audience jsonb not null default '{}',
  -- The shop's product ids in the order the AI saw them (p1, p2, ...), so its answer can be mapped back.
  product_refs jsonb not null default '[]',
  -- The platform's ids once created: {accountId, campaignId, adSetId, pageId}.
  external jsonb not null default '{}',
  error text,
  -- Why it stopped or paused, in plain words.
  stop_reason text,
  created_by uuid references armada.members(id) on delete set null,
  -- Set while "Create these ads" is talking to the platform, so a double press can't create twice.
  launching_at timestamptz,
  launched_at timestamptz,
  switched_on_at timestamptz,
  switched_on_by uuid references armada.members(id) on delete set null,
  -- Practice only: when the practice clock last started (one practice day per minute while on).
  clock_started_at timestamptz,
  results_synced_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One unfinished ad set per shop, so a double press on "Make ads" never writes two.
create unique index ad_sets_one_open_per_shop on armada.ad_sets (shop_id)
  where status in ('writing', 'draft', 'paused', 'on', 'failed');
create index ad_sets_workspace on armada.ad_sets (workspace_id, created_at desc);
create index ad_sets_on on armada.ad_sets (workspace_id) where status = 'on';

create table armada.ad_variations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  ad_set_id uuid not null references armada.ad_sets(id) on delete cascade,
  position int not null default 0,
  -- draft: can be edited; rewriting: the AI is writing it again; removed: taken out (can be put back);
  -- created: built on the platform (it is on or off with its ad set).
  status text not null default 'draft' check (status in ('draft', 'rewriting', 'removed', 'created', 'failed')),
  format text not null check (format in ('single', 'carousel')),
  -- What this version tries, in plain words.
  idea text not null default '',
  primary_text text not null default '',
  headline text not null default '',
  description text not null default '',
  call_to_action text not null default 'SHOP_NOW'
    check (call_to_action in ('SHOP_NOW', 'LEARN_MORE', 'ORDER_NOW', 'BUY_NOW')),
  -- The products shown: one for a single-photo ad, one per card for a carousel.
  product_ids jsonb not null default '[]',
  -- Carousel cards: [{productId, headline, description}].
  cards jsonb not null default '[]',
  -- 'ai', or 'ai_edited' once a person has changed the words.
  written_by text not null default 'ai' check (written_by in ('ai', 'ai_edited')),
  -- Practice only: this ad's made-up pull (0.7 to 1.3), so one practice ad can pull ahead.
  practice_strength real,
  -- The platform's ids once created: {creativeId, adId}.
  external jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ad_variations_set on armada.ad_variations (ad_set_id, position);

-- One row per ad per day: made-up practice delivery, or the platform's own numbers.
create table armada.ad_results_daily (
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  ad_set_id uuid not null references armada.ad_sets(id) on delete cascade,
  variation_id uuid not null references armada.ad_variations(id) on delete cascade,
  day date not null,
  practice boolean not null,
  impressions int not null default 0 check (impressions >= 0),
  reach int not null default 0 check (reach >= 0),
  clicks int not null default 0 check (clicks >= 0),
  add_to_carts int not null default 0 check (add_to_carts >= 0),
  purchases int not null default 0 check (purchases >= 0),
  spend_cents int not null default 0 check (spend_cents >= 0),
  sales_cents int not null default 0 check (sales_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (variation_id, day)
);
create index ad_results_set on armada.ad_results_daily (ad_set_id, day);

alter table armada.ad_sets enable row level security;
create policy workspace_scope on armada.ad_sets
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

alter table armada.ad_variations enable row level security;
create policy workspace_scope on armada.ad_variations
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

alter table armada.ad_results_daily enable row level security;
create policy workspace_scope on armada.ad_results_daily
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.ad_sets, armada.ad_variations, armada.ad_results_daily to armada_app;
