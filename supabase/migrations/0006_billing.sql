-- Subscription billing on Stripe.
--
-- Davis connects his own Stripe account once, on /billing, by pasting a key. Armada keeps that key and
-- the signing secret of the notification address it registers with Stripe, both sealed by the app
-- (AES-256-GCM, lib/crypto.ts; the encryption key lives in Vercel's settings, never here).
-- Each workspace then picks a plan and pays through Stripe's own checkout page. Stripe tells Armada what
-- happened through app/api/stripe/webhook, which writes armada.subscriptions.

-- One row per workspace: what it pays for right now. No row means the free Practice plan.
create table armada.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references armada.workspaces(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan_key text not null,
  interval text check (interval in ('month', 'year')),
  -- Stripe's own words: trialing, active, past_due, canceled, unpaid, incomplete, incomplete_expired, paused.
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  -- Set when a renewal payment fails, cleared when an invoice is paid.
  payment_failed_at timestamptz,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_customer on armada.subscriptions (stripe_customer_id);

-- The one Stripe connection for all of Armada (a singleton: the id can only be true).
create table armada.billing_settings (
  id boolean primary key default true check (id),
  secret_key bytea not null,
  webhook_secret bytea not null,
  webhook_endpoint_id text not null,
  portal_configuration_id text,
  account_id text,
  account_name text,
  livemode boolean not null,
  -- {"starter": {"month": "price_...", "year": "price_..."}, ...} for the plans in lib/billing/plans.ts.
  price_ids jsonb not null default '{}',
  product_ids jsonb not null default '{}',
  -- The plans' price lookup keys when Stripe was last set up; differs from lib/billing/plans.ts after a price change.
  plans_version text,
  connected_by uuid references armada.members (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The last thing Stripe refused (a revoked key, a missing permission), in plain words.
  last_error text,
  last_error_at timestamptz
);

-- Every notification from Stripe that was handled, so a repeat delivery is recognised and skipped.
create table armada.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
create index stripe_events_received on armada.stripe_events (received_at);

alter table armada.subscriptions enable row level security;
create policy workspace_scope on armada.subscriptions
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

alter table armada.billing_settings enable row level security;
create policy system_only on armada.billing_settings using (armada.is_system()) with check (armada.is_system());

alter table armada.stripe_events enable row level security;
create policy system_only on armada.stripe_events using (armada.is_system()) with check (armada.is_system());

grant select, insert, update, delete on armada.subscriptions, armada.billing_settings, armada.stripe_events to armada_app;
