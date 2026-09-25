# Armada

Run hundreds of Shopify stores and eBay accounts from one screen: an AI shop builder, a product
catalog with 1–100 scores, listing across stores with preview and undo, one orders inbox, AI ads and
social posts, and a practice fleet that behaves like real stores without real money.

- Live: https://armada-pi.vercel.app (the bare project alias; the per-deployment URLs sit behind Vercel login)
- Plan: https://claude.ai/code/artifact/663c5d19-8ce7-4979-818a-b1be82742e01 (plain-language plan plus a "For the build" tab)

## How it fits together

- **Web app**: Next.js 16 on Vercel (`spacemutters-projects/armada`), region iad1.
- **Database**: the `armada` schema inside the Supabase project `alpr-network` (`ltrzsicklomwnqpedpxr`).
  The app logs in as `armada_app`, which is not the table owner, so row-level security scopes every
  query to one workspace (`lib/db`: `withWorkspace`, `asSystem`). The TLS certificate is pinned
  (`lib/db/supabase-ca.ts`). Migrations are in `supabase/migrations/`.
- **AI**: jobs queue in `armada.ai_jobs`. The helper on Davis's computer (`helper/armada-helper.mjs`)
  claims them and runs the local Claude command-line tool on his own login, with every tool switched off,
  so the AI can only return text. Prompts and schemas live server-side (`lib/shops/prompts.ts`);
  models are chosen in `lib/ai/config.ts`. Each finished step starts the next (`lib/shops/pipeline.ts`).
- **Sign-in**: passkeys only. One-time setup links (`scripts/make-invite.mjs`) create the first owner;
  Settings makes links for more devices and teammates.
- **CJ Dropshipping**: connected in Settings with the account's API key, which is exchanged for tokens
  and stored sealed with AES-256-GCM (`lib/crypto.ts`, key in `ENCRYPTION_KEY`). Every request goes
  through `connectors/cj/client.ts`, which waits for the account's slot in a database-backed speed
  lane (`lib/lanes.ts`, 1.25 s apart because CJ allows about one call a second), renews tokens, and
  retries only CJ's busy answers. Search is live; "checking" an item (`lib/catalog/cj.ts`) fetches full
  photos, variants and the real shipping price and days. Unchecked items are costed with a cautious
  shipping stand-in (`UNCONFIRMED_SHIP_CENTS`) and their score says the margin is estimated.
  CJ shop builds search CJ after the concept step and check every chosen product before pricing; that
  work runs after the response (`defer` → `after()`), and the helper's poll restarts any CJ build
  that has sat still for six minutes (`resumeStalledCjBuilds`).
  Checked against CJ's docs on 2026-09-24 (copies in the session scratchpad `cjdocs/`): `qpsLimit` is
  only believed up to CJ's top tier of 6/s; running out of API points (HTTP 429, code 429 or
  16900500) is reported, not retried; searches ask for `enable_category`; shipping takes the higher of
  price + taxes + clearance and the stated total. **Open risk:** CJ allows 3 accounts per outgoing IP,
  and Vercel's outgoing IPs are shared. Fine for one account; before many customers connect CJ,
  route CJ calls through a fixed IP.
- **Headline tests (A/B)**: `/builder/<shop>/test`. The AI writes three versions of the home-page
  headline (`lib/abtest/prompt.ts`, job `ab.variants`), the owner picks and edits one, and the
  storefront splits visitors by a signed cookie minted in `proxy.ts` (`lib/abtest/visitor.ts`;
  bots and the shop's own team are never counted). Views and adds to the bag go to `/api/ab`; the
  version is always worked out on the server. `lib/abtest/stats.ts` reads the result (exact chance B
  is better, sample size for a 20% difference, a winner only at 95%). Making B the winner writes it
  into the shop and can be undone. "Practice visitors" are made-up shoppers stored as practice and
  labelled everywhere. Checks: `ab-fair-count` and `ab-math` in preflight
  (`scripts/check-abtest-math.mjs` compares the math with a simulation and textbook figures).

- **Connections** (`/connections`, `lib/connections/*`, one connector per folder in `connectors/`):
  stores (Shopify, eBay, Facebook), suppliers (CJ, AliExpress) and ad accounts. Only files in
  `connectors/` may call a platform (preflight `one-door`); keys are sealed (`sealed-keys`).
- **One-click connections through Pipedream Connect** (`connectors/pipedream/`, `lib/connections/service.ts`):
  a platform only shows its "Allow access?" page for an approved app. Pipedream holds approved apps
  with Shopify and eBay, so when Armada has no app of its own there, Connect goes to Pipedream's page,
  the seller approves on the platform's page, and `/api/connect/service/<platform>/done` finishes it.
  Armada keeps only which account it is; every Shopify/eBay call for that store goes through
  Pipedream's relay (Shopify as a relative path, since each store has its own address). Switched on by
  the platform admin on Connections (Project ID, Client ID, Client secret; sealed in
  `armada.connection_service`), or by `PIPEDREAM_*` settings. Testing mode is free for up to 10 users
  who are signed in to pipedream.com; live mode is Pipedream's paid Connect plan. Not covered by any
  service: Instagram posting, Facebook shops, Meta ads, TikTok posting, AliExpress. Tested against
  `scripts/mock-pipedream.mjs` only (`e2e-service.mjs`, `e2e-service-admin.mjs`).
- **AliExpress** (`connectors/aliexpress/`): the official Open Platform, signed requests, a speed lane
  (preflight `aliexpress-lane`). Find products can search it; added items are checked for photos,
  stock and a real shipping quote (`lib/catalog/aliexpress.ts`). Not yet a shop-builder source.
  Switched on by `ALIEXPRESS_APP_KEY`/`ALIEXPRESS_APP_SECRET` from an approved Dropshipping app.
- **Shop builder** (`lib/shops/pipeline.ts`): concept → products (the AI proposes twice the count) →
  the owner chooses on cards → (CJ: shipping check) → pages, sets and "goes well with" pairs →
  brand pictures. Prices always come from `lib/pricing.ts`, never the AI; "Premium brand" (`luxury`)
  prices at about 7× landed cost in round numbers and gives 60-day returns the shop pays for. Sets
  cost a little less than their items at the shop's own prices (`lib/shops/sets.ts`). The craft
  guides in `lib/shops/craft.ts` ride along with the prompts.
- **Brand pictures** (`lib/shops/images.ts`): made by the helper with ChatGPT's image maker (model
  in `lib/ai/config.ts`; only `gpt-5.5` reaches it under the helper's lockdown), cut for desktop,
  phone and link previews, served from `/api/img/<id>`. They never show a product the shop sells.
- **Ads and social** (`lib/ads`, `lib/social`): AI-written ad sets and carousel posts (ChatGPT,
  `social.` and `ads.` jobs), practice results and practice accounts; scheduled posts go out from the
  helper's once-a-minute sweep. Each product page has "Make an ad with AI" (three carousel ads for it).
  Carousel ads have 4 to 6 cards and carousel posts 4 to 8 slides.
- **Ad and post pictures** (`lib/creative`, `lib/ads/pictures.ts`, `lib/social/posts/pictures.ts`,
  table `creative_pictures`): made by the helper with ChatGPT's image maker (`images.scene`,
  `images.item`, same road as brand pictures) right after the words are written, once per slot;
  "Make again" per picture. Honest by construction: a product is only ever its real photo, composed
  by Armada (`lib/creative/compose.ts`: on the shop's ground, or on a panel in front of a ChatGPT
  setting); ChatGPT makes scenes that never show a product, and pictures of practice items in
  practice shops only (checked in code, by a database trigger and by preflight `honest-pictures`).
  Ads go to the platform with the same composed pictures (`/api/ads/picture/...`). About 45 s per
  picture, two at a time; an ad set usually needs 4 to 8, a post at most 2 plus any practice items.
- **Launch** (`lib/launch`, the card on a ready shop's page, `armada.shop_launches`): one press sets up
  everything around a shop. Real supplier products (CJ, AliExpress; never practice items) are listed on
  the connected eBay account for real (`connectors/ebay/listing.ts`: eBay's suggested category, required
  item details filled from the product's own facts only, item, offer with the account's policies and
  ship-from place, publish), as one approved change in the changes engine (one-listing rule, selling
  limit, undo ends each listing on eBay). Facebook Page and Instagram: practice accounts for practice
  shops; otherwise one press to the platform's own sign-up page with the profile kit beside it, then
  Connect it. Then the first week of posts, scheduled, and the ads, created switched off. The progress
  view runs the passes itself; the helper's sweep carries on unwatched launches. Checks:
  `check-launch.mjs`, preflight `real-items-only`, `no-auto-signup`. Tested against the eBay stand-in
  (`e2e-launch-ebay.mjs`); `scripts/live-ebay-listing.mjs` is the live check (reads only unless `--publish`).
- **Look**: the app's own tokens in `app/globals.css`, following the system light/dark setting.
  Glass (Apple's Liquid Glass rules) only on what floats above content: the sidebar, the phone's
  bars, sticky action bars and menus; solid when the system asks for less transparency or more
  contrast (preflight `contrast`, `glass-layer`).

## Everyday commands

```
npm run dev                                   # local copy (needs .env.local)
node scripts/preflight.mjs                    # build checks; --live adds database checks; --selftest proves each check fires
node --env-file=.env.local scripts/e2e.mjs https://armada-pi.vercel.app   # full browser run with a virtual passkey
node --env-file=.env.local scripts/e2e-ab.mjs https://armada-pi.vercel.app   # headline test end to end (builds a practice shop; delete "AB test fleet" after)
node --env-file=.env.local scripts/make-invite.mjs https://armada-pi.vercel.app   # a first-owner setup link
vercel deploy --prod --yes --scope spacemutters-projects                   # deploy (run preflight first)
node --env-file=.env.local scripts/check-live-pages.mjs https://armada-pi.vercel.app   # the signed-in pages, live (delete "Pages check" after)
node --env-file=.env.local scripts/e2e.mjs https://armada-pi.vercel.app --price luxury   # a premium brand shop, chooser included
node scripts/shoot-glass.mjs <url>             # screenshots of the glass layer, light and dark, desktop and phone
node --env-file=.env.local scripts/e2e-launch.mjs https://armada-pi.vercel.app   # Launch on a practice shop, live (delete "Launch check" after)
node --env-file=.env.local scripts/live-ebay-listing.mjs --store <id>   # a real eBay account: can it sell, and what a listing would say (--publish lists one)
```

Deploy from the `projects/armada-verify` worktree so only committed work ships: commit (this repo
has no git identity; pass `-c user.name=Davis -c user.email=davis@insight-underground.com`), then in
the worktree `git checkout --detach <sha>`, `npm run build`, `node scripts/preflight.mjs`, deploy.
Preflight's `suites` check runs every offline `scripts/check-*.mjs`.

Testing CJ without a real key: `node scripts/mock-cj.mjs` runs a stand-in CJ (DummyJSON products,
CJ's answer shapes, a per-account one-call-a-second limit, and switches for expired access and busy
answers). Run a production build with `CJ_BASE_URL=http://127.0.0.1:4599/api2.0/v1 npx next start`,
point a helper at it (`ARMADA_URL=http://localhost:3000`, after stopping the live helper so it
doesn't take the test jobs), then `node --env-file=.env.local scripts/e2e-cj.mjs http://localhost:3000 --count 2`.
Delete the "CJ test fleet" workspaces afterwards. (`npm run dev` answers 404 on some routes on this
machine; test against `next start`.)

AI helper: `helper/start-helper.cmd` starts it in a small minimized window; `helper/stop-helper.cmd` stops it.
Start it through Explorer (`Start-Process explorer.exe -ArgumentList ...start-helper.cmd`) so it runs outside
the Claude app's container and survives the session. Its settings are in `helper/.env` (not committed).

## Local-only notes

- This PC's DNS stalls on `aws-0-us-east-1.pooler.supabase.com`; `.env.local` sets `DATABASE_HOSTADDR`
  to one of its addresses so local runs dial it directly. Vercel resolves it normally.
- `vercel link` overwrites `.env.local`. Back it up first (`.env.local.backup`).
- `scripts/push-env.mjs NAME...` copies server settings into Vercel without printing them.

## Not built yet

AliExpress as a shop-builder source (it's in Find products), automatic supplier ordering from real
sales (the calls exist in `connectors/cj/api.ts`; they need a real store's orders), the plain-language
command box, and the practice fleet's live clock. CJ, AliExpress and the Pipedream connections have
been tested against stand-ins only, until Davis adds his keys; real Shopify/eBay/Meta connections of
Armada's own need his developer accounts.
