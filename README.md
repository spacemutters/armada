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

## Everyday commands

```
npm run dev                                   # local copy (needs .env.local)
node scripts/preflight.mjs                    # build checks; --live adds database checks; --selftest proves each check fires
node --env-file=.env.local scripts/e2e.mjs https://armada-pi.vercel.app   # full browser run with a virtual passkey
node --env-file=.env.local scripts/make-invite.mjs https://armada-pi.vercel.app   # a first-owner setup link
vercel deploy --prod --yes --scope spacemutters-projects                   # deploy (run preflight first)
```

AI helper: `helper/start-helper.cmd` starts it in a small minimized window; `helper/stop-helper.cmd` stops it.
Start it through Explorer (`Start-Process explorer.exe -ArgumentList ...start-helper.cmd`) so it runs outside
the Claude app's container and survives the session. Its settings are in `helper/.env` (not committed).

## Local-only notes

- This PC's DNS stalls on `aws-0-us-east-1.pooler.supabase.com`; `.env.local` sets `DATABASE_HOSTADDR`
  to one of its addresses so local runs dial it directly. Vercel resolves it normally.
- `vercel link` overwrites `.env.local`. Back it up first (`.env.local.backup`).
- `scripts/push-env.mjs NAME...` copies server settings into Vercel without printing them.

## Not built yet

Real Shopify, eBay and CJ connections (they need Davis's partner, developer and supplier accounts),
ads, the plain-language command box, and the practice fleet's live clock. See the plan's build stages.
