# Production Tracker (no sign-in, no AI)

Projects, sets, panels, 15 production stages, status tracking with permanent
history, progress, analytics and Excel exports.

## Setup order
1. Create a Supabase project (supabase.com, free plan is fine).
2. SQL Editor -> run `supabase/NEW-DATABASE-step1.sql`, wait for "Success",
   then run `supabase/NEW-DATABASE-step2.sql`.
   (Only if you already have a database from the earlier version, run just
   `supabase/migrations/20261014090000_open_access_no_login.sql`.)
3. Edit `.env`: paste your Project URL and Publishable (anon) key.
4. Run locally:   npm install --include=dev   then   npm run dev
5. Deploy: build with `npm install --include=dev && npm run build`.
   Node host (Render, Railway, VPS): set NITRO_PRESET=node-server at build time,
   start with `node .output/server/index.mjs`.
   Cloudflare: default output of `npm run build`.

## Access
There is no login: anyone with the site address can view and edit data.
Protect the site at your host if it must stay private.
