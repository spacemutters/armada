-- Carousel posts for each shop's social accounts.
--
-- The AI writes a week of posts from the shop's real products and brand (job kind social.carousel).
-- Each post is a set of slides that Armada renders itself (app/api/social/slide/...), plus a caption,
-- hashtags and a suggested posting time. Nothing goes out until someone schedules it or presses
-- Post now; a due post is published by a once-a-minute sweep (lib/social/posts/schedule.ts).

-- One request to the AI: a week of posts for a shop, or a new version of one post.
create table armada.social_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  kind text not null check (kind in ('week', 'rewrite')),
  -- The post being written again (kind = 'rewrite'). The foreign key is added below.
  post_id uuid,
  status text not null default 'writing' check (status in ('writing', 'done', 'failed', 'cancelled')),
  -- The product photos the AI was offered, by the short name it saw:
  -- {"P1-1": {"productId": "...", "url": "https://...", "title": "..."}}. Anything else it names is ignored.
  refs jsonb not null default '{}',
  -- How many posts came back.
  count int not null default 0,
  error text,
  created_by uuid references armada.members(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- One week being written per shop at a time, so a double press asks the AI once.
create unique index social_runs_one_week_per_shop on armada.social_runs (shop_id) where status = 'writing' and kind = 'week';
create index social_runs_shop on armada.social_runs (shop_id, created_at desc);

create table armada.social_posts (
  -- Also the unguessable part of each slide's public image address.
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  shop_id uuid not null references armada.shops(id) on delete cascade,
  run_id uuid references armada.social_runs(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'posting', 'posted', 'failed')),
  -- What the post is about, in plain words ("How to layer bedding for warm nights").
  angle text not null default '',
  caption text not null default '',
  -- Without the # sign: ["sleepbetter", "bedroomideas"].
  hashtags jsonb not null default '[]',
  -- When the AI suggests it goes out (its best time for the shop's shoppers).
  suggested_at timestamptz,
  -- When it goes out. Set only while scheduled (and kept as a record once posted).
  scheduled_at timestamptz,
  -- The shop's social accounts it goes to (ids from lib/social/accounts).
  account_ids jsonb not null default '[]',
  -- Per account: {"<accountId>": {"ok": true, "url": "...", "externalId": "...", "problem": null, "at": "...", "platform": "instagram", "name": "..."}}.
  -- An account already marked ok is never posted to again, so a retry only tries the others.
  results jsonb not null default '{}',
  -- A plain sentence when it didn't go out, or the AI couldn't write a new version.
  problem text,
  -- The public web address the slide images are served from, remembered when it was scheduled.
  slide_base text,
  -- Someone changed the AI's words.
  edited boolean not null default false,
  -- A new version is being written.
  rewriting boolean not null default false,
  posting_started_at timestamptz,
  posted_at timestamptz,
  created_by uuid references armada.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index social_posts_shop on armada.social_posts (shop_id, created_at desc);
create index social_posts_due on armada.social_posts (scheduled_at) where status = 'scheduled';
create index social_posts_posting on armada.social_posts (posting_started_at) where status = 'posting';

alter table armada.social_runs
  add constraint social_runs_post_fk foreign key (post_id) references armada.social_posts(id) on delete cascade;

-- A slide: its words and the product photo on it. The image itself is drawn on request from these,
-- in the shop's palette and fonts, so an edit shows everywhere at once.
create table armada.social_slides (
  post_id uuid not null references armada.social_posts(id) on delete cascade,
  workspace_id uuid not null references armada.workspaces(id) on delete cascade,
  n int not null check (n between 1 and 8),
  headline text not null,
  line text not null default '',
  product_id uuid references armada.products(id) on delete set null,
  image_url text,
  -- What a screen reader says for the slide on the platform.
  alt text not null default '',
  updated_at timestamptz not null default now(),
  primary key (post_id, n)
);

alter table armada.social_runs enable row level security;
create policy workspace_scope on armada.social_runs
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

alter table armada.social_posts enable row level security;
create policy workspace_scope on armada.social_posts
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

alter table armada.social_slides enable row level security;
create policy workspace_scope on armada.social_slides
  using (workspace_id = armada.current_workspace() or armada.is_system())
  with check (workspace_id = armada.current_workspace() or armada.is_system());

grant select, insert, update, delete on armada.social_runs, armada.social_posts, armada.social_slides to armada_app;
