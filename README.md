# Armada

Run hundreds of Shopify stores and eBay accounts from one screen: an AI shop builder, a product
catalog with 1–100 scores, listing across stores with preview and undo, one orders inbox, and a
practice fleet that behaves like real stores without real money.

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

## Everyday commands

```
npm run dev                                   # local copy (needs .env.local)
node scripts/preflight.mjs                    # build checks; --live adds database checks; --selftest proves each check fires
node --env-file=.env.local scripts/e2e.mjs https://armada-pi.vercel.app   # full browser run with a virtual passkey
node --env-file=.env.local scripts/e2e-ab.mjs https://armada-pi.vercel.app   # headline test end to end (builds a practice shop; delete "AB test fleet" after)
node --env-file=.env.local scripts/make-invite.mjs https://armada-pi.vercel.app   # a first-owner setup link
vercel deploy --prod --yes --scope spacemutters-projects                   # deploy (run preflight first)
```

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

Real Shopify and eBay connections (they need Davis's partner and developer accounts), automatic CJ
ordering from real sales (the calls exist in `connectors/cj/api.ts`; they need a real store's orders),
ads, the plain-language command box, and the practice fleet's live clock. The CJ connection has been
tested end to end against the stand-in only, until Davis adds his key.
