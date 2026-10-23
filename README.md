# Production Tracker — TrioVision Composite Technologies Pvt. Ltd.

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
  `projectsreader@triovision.com` and `projectsadmin@triovision.com`, each with its own password.
  Then run `supabase/ACCESS-SETUP.sql` once. Turn **off** "Allow new users to sign up".
* **Forgot a password:** use `supabase/RESET-PASSWORD.sql`.

## Environment variables
| Name | Where | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | build + server | yes (unchanged) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | build + server | yes (unchanged) |
| `ANTHROPIC_API_KEY` | Render environment only (secret) | for Trio AI Assistant |
| `ANTHROPIC_MODEL` | Render environment | optional, default `claude-sonnet-5-5` |

## Trio AI Assistant
Page `/assistant`, available to Reader and Admin, read-only for both.
* The browser sends its signed-in token to `POST /api/assistant`. The server verifies the token and
  role with Supabase, then lets the model choose from 8 fixed read-only lookups (`src/lib/assistant/tools.ts`).
  Every lookup runs with the signed-in user's own permissions (Row Level Security applies). There is no
  SQL access, no write access and no service-role key.
* Chats live only in the browser tab (`sessionStorage`), per user. Logging out asks for confirmation,
  erases them, verifies the erase, and only then signs out.
* No database changes are needed for the assistant.

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
