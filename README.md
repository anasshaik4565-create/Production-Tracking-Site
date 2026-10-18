# Production Tracker (no sign-in, no AI)

Projects → Sets → Panels → 17 production stages, with production status, QC status,
remarks, permanent history, progress, analytics and Excel import/export.

## Features added in the latest update
- Industrial SaaS look (navy sidebar, KPI cards, consistent badges and tables)
- Delete project (confirmation by typing the project code, warning when work is recorded)
- Sets: define set numbers (Set 05, Set 06 …) and assign every panel to a set
- Excel upload for bulk panels (template, preview, row-level validation, one-transaction import)
- New stages: Foam Placement (before Packing) and Palletization (after Packing)
- QC statuses (QC Pending, QC Approved, Not OK) kept separate from the production status
- Remarks on every status update, latest remark on the grid, full timeline per stage

## Database
New database: run `supabase/NEW-DATABASE-step1.sql`, wait for "Success", then `supabase/NEW-DATABASE-step2.sql`.
Existing database from the previous version: run, in this order and one at a time,
`supabase/migrations/20261020090000_a_new_stage_values.sql` then
`supabase/migrations/20261020090100_b_sets_qc_remarks_delete.sql`.

## Environment variables (unchanged)
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).

## Run / build
```
npm install --include=dev
npm run dev          # local
npm run build        # Cloudflare output; for Node hosts build with NITRO_PRESET=node-server
node .output/server/index.mjs
```

## Access
There is no login: anyone with the site address can view and edit data.
Protect the site at your host if it must stay private.
