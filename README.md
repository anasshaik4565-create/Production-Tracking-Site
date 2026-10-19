# Production Tracker

Projects → Sets → Panels → 17 production stages, with production status, QC status, remarks,
permanent history, progress, analytics, panel weights and Excel import/export.

## Access
Two logins on the sign-in page: **Login Reader** (view only) and **Login Admin** (full access).
Both are Supabase Auth accounts with separate passwords. The role is stored in `app_metadata`
(never editable from the browser) and enforced by database Row Level Security and function checks.

## Database
* **New database:** `supabase/NEW-DATABASE-step1.sql`, then `supabase/NEW-DATABASE-step2.sql`.
* **Existing database:** run migrations in order, one at a time, from `supabase/migrations/`
  (the newest is `20261025090000_access_modes_ids_weights_stages.sql`).
* **Logins:** create the two users in Supabase (Authentication → Users → Add user, "Auto Confirm"):
  `tracker-reader@example.com` and `tracker-admin@example.com`, each with its own password.
  Then run `supabase/ACCESS-SETUP.sql` once. Turn **off** "Allow new users to sign up".
* **Forgot a password:** use `supabase/RESET-PASSWORD.sql`.

## Environment variables (unchanged)
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).

## Weights
Expected weight = Part Weight. Untrimmed weight is entered at the Lamination stage and final weight
at Demould (or any time from the Panel weights table). Deviation % = (Actual − Expected) / Expected × 100.
Green within tolerance, red beyond it, grey when not recorded. Tolerance defaults to ±5% per project
and can be overridden per panel (Admin, on the Configure page).

## Run / build
```
npm install --include=dev
npm run dev
npm run build        # for Node hosts build with NITRO_PRESET=node-server
node .output/server/index.mjs
```
