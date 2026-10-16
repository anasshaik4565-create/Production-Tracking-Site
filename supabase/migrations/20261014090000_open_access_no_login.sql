-- =====================================================================
-- Production Tracker: open access (no sign-in)
-- Run this ONCE in the Supabase SQL Editor before using the new build.
-- Safe to run more than once.
--
-- What it does
--   1. Lets the app work without a signed-in user (the site now talks to
--      the database as the public "anon" role).
--   2. Keeps the same rules the app already had: nothing can be deleted,
--      history is append-only, and archived projects are read-only for
--      sets, panels, stages and production status.
--   3. Does NOT open up profiles, user roles or old chat tables.
-- =====================================================================

-- 1. Projects no longer need a creator.
ALTER TABLE public.projects ALTER COLUMN created_by DROP NOT NULL;

-- 2. Permission helpers no longer look for a signed-in user.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT true; $$;

CREATE OR REPLACE FUNCTION public.has_project_access(_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT true; $$;

CREATE OR REPLACE FUNCTION public.can_configure(_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived'); $$;

CREATE OR REPLACE FUNCTION public.can_update_production(_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived'); $$;

-- 3. Table privileges for the public role (no DELETE anywhere).
GRANT SELECT, INSERT, UPDATE ON public.projects          TO anon;
GRANT SELECT, INSERT, UPDATE ON public.production_sets   TO anon;
GRANT SELECT, INSERT, UPDATE ON public.panels            TO anon;
GRANT SELECT, INSERT, UPDATE ON public.panel_stages      TO anon;
GRANT SELECT, UPDATE         ON public.production_status TO anon;
GRANT SELECT                 ON public.production_history TO anon;
GRANT INSERT                 ON public.audit_logs         TO anon;

-- 4. Row-level policies for the public role.
DROP POLICY IF EXISTS open_projects_select ON public.projects;
CREATE POLICY open_projects_select ON public.projects FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS open_projects_insert ON public.projects;
CREATE POLICY open_projects_insert ON public.projects FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS open_projects_update ON public.projects;
CREATE POLICY open_projects_update ON public.projects FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS open_sets_select ON public.production_sets;
CREATE POLICY open_sets_select ON public.production_sets FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS open_sets_insert ON public.production_sets;
CREATE POLICY open_sets_insert ON public.production_sets FOR INSERT TO anon
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'));
DROP POLICY IF EXISTS open_sets_update ON public.production_sets;
CREATE POLICY open_sets_update ON public.production_sets FOR UPDATE TO anon
  USING (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'));

DROP POLICY IF EXISTS open_panels_select ON public.panels;
CREATE POLICY open_panels_select ON public.panels FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS open_panels_insert ON public.panels;
CREATE POLICY open_panels_insert ON public.panels FOR INSERT TO anon
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'));
DROP POLICY IF EXISTS open_panels_update ON public.panels;
CREATE POLICY open_panels_update ON public.panels FOR UPDATE TO anon
  USING (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'));

DROP POLICY IF EXISTS open_panel_stages_select ON public.panel_stages;
CREATE POLICY open_panel_stages_select ON public.panel_stages FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS open_panel_stages_insert ON public.panel_stages;
CREATE POLICY open_panel_stages_insert ON public.panel_stages FOR INSERT TO anon
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'));
DROP POLICY IF EXISTS open_panel_stages_update ON public.panel_stages;
CREATE POLICY open_panel_stages_update ON public.panel_stages FOR UPDATE TO anon
  USING (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'));

DROP POLICY IF EXISTS open_prod_select ON public.production_status;
CREATE POLICY open_prod_select ON public.production_status FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS open_prod_update ON public.production_status;
CREATE POLICY open_prod_update ON public.production_status FOR UPDATE TO anon
  USING (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'archived'));

DROP POLICY IF EXISTS open_history_select ON public.production_history;
CREATE POLICY open_history_select ON public.production_history FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS open_audit_insert ON public.audit_logs;
CREATE POLICY open_audit_insert ON public.audit_logs FOR INSERT TO anon WITH CHECK (true);

-- 5. Functions the app calls.
GRANT EXECUTE ON FUNCTION public.generate_workflows(uuid)    TO anon;
GRANT EXECUTE ON FUNCTION public.get_project_progress(uuid)  TO anon;
GRANT EXECUTE ON FUNCTION public.get_projects_progress()     TO anon;
