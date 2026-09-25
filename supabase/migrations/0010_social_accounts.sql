-- Social media accounts for each shop: its Instagram, Facebook Page and TikTok.
--
-- A real account is connected through the platform's own sign-in. Its access is in `secret`, which is
-- AES-256-GCM ciphertext made by the app (lib/crypto.ts; the encryption key lives in Vercel's
-- settings, never here). A practice account is simulated: it has no secret, never leaves Armada, and
-- lets the whole flow (and the posts Armada makes) be used before the platforms approve Armada's apps.
-- `meta` holds only non-secret facts: the linked Page, what Armada filled in, the last problem.

create table armada.social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'tiktok')),
  kind text not null default 'real' check (kind in ('real', 'practice')),
  -- The page or profile name as people see it, and the @handle when there is one.
  name text not null default '',
  handle text,
  -- The platform's own id: the Instagram account id, the Facebook Page id, the TikTok open_id.
  external_id text,
  status text not null check (status in ('connected', 'needs_attention', 'practice')),
  secret bytea,
  -- When the stored access stops working unless renewed (null: no set end, as with a Page's access).
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  meta jsonb not null default '{}',
  connected_by uuid references armada.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One real and one practice account per shop per platform; connecting again updates the row.
  unique (shop_id, platform, kind),
  check ((kind = 'practice') = (status = 'practice')),
  check (kind = 'practice' or secret is not null)
);
create index social_accounts_workspace on armada.social_accounts (workspace_id, shop_id);

-- Posts "published" to practice accounts, so the flow can be seen end to end.
create table armada.practice_social_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  account_id uuid not null references armada.social_accounts(id) on delete cascade,
  caption text not null,
  slides jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index practice_social_posts_account on armada.practice_social_posts (account_id, created_at desc);

-- When Meta shares several Pages, the person picks the shop's Page in Armada. Until then the Pages'
-- access waits here, sealed, for 30 minutes; picking one uses the row up.
create table armada.social_page_choices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  member_id uuid references armada.members(id) on delete cascade,
  -- Which card started it: the Facebook Page card, or the Instagram card (then only Pages with a linked Instagram account are offered).
  wanted text not null check (wanted in ('facebook', 'instagram')),
  secret bytea not null,
  -- [{id, name, instagram}] only: names to show, no access.
  choices jsonb not null default '[]',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create index social_page_choices_shop on armada.social_page_choices (workspace_id, shop_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['social_accounts', 'practice_social_posts', 'social_page_choices'] loop
    execute format('alter table armada.%I enable row level security', t);
    execute format(
      'create policy workspace_scope on armada.%I using (workspace_id = armada.current_workspace() or armada.is_system()) with check (workspace_id = armada.current_workspace() or armada.is_system())',
      t
    );
  end loop;
end $$;

grant select, insert, update, delete on armada.social_accounts, armada.practice_social_posts, armada.social_page_choices to armada_app;
