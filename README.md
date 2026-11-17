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
| `GEMINI_API_KEY` | Render environment only (secret) | for Trio AI Assistant |
| `GEMINI_MODEL` | Render environment | optional, default `gemini-3.8-flash` |
| `GEMINI_THINKING_LEVEL` | Render environment | optional (`low`, `medium`, `high`, `default`) |

`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are no longer used and can be deleted from Render.

## Trio AI Assistant
Page `/assistant`, available to Reader and Admin, read-only for both.
* The browser sends its signed-in token to `POST /api/assistant`. The server verifies the token and
  role with Supabase, then lets the Gemini model choose from 8 fixed read-only lookups
  (`src/lib/assistant/tools.ts`). Every lookup runs with the signed-in user's own permissions (Row Level
  Security applies). There is no SQL access, no write access and no service-role key.
* Provider code: `src/lib/assistant/provider.server.ts` (Gemini `generateContent` REST API with function calling).
* Chats live only in the browser tab (`sessionStorage`), per user. Logging out asks for confirmation,
  erases them, verifies the erase, and only then signs out.

## Production stages
* Every panel has its own saved stage order (`panel_stages.sequence`); the project's default order is
  `projects.default_stages`. Reordering changes only the order, never a status, QC result, remark, weight or history.
* "Apply Status to All Panels" (Production page, per stage) updates one stage across every set (Admin only).
* Part Numbers and ID Numbers may repeat; panels are identified by an internal id.

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
