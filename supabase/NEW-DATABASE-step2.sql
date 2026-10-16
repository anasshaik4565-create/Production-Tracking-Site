-- STEP 2 of 2: run AFTER step 1 has finished. Adds the no-login access rules.

-- ---- 20261001060414_dd105b4a-95eb-4bb3-9203-ae34924127f3.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name',''), NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.email,''))
  ON CONFLICT (id) DO NOTHING;
  SELECT COUNT(*) INTO v_count FROM public.profiles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN v_count <= 1 THEN 'admin'::public.app_role ELSE 'pending'::public.app_role END)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.has_project_access(_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_active_user()
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role <> 'pending')
    AND (
      public.has_role(auth.uid(),'admin')
      OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = _project_id AND m.user_id = auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION public.can_configure(_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_project_access(_project_id) AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'project_manager')
    OR public.has_role(auth.uid(),'engineer') OR public.has_role(auth.uid(),'estimator')
  ) AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived');
$$;

CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role app_role)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role.';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role);
END; $$;

-- Users may only edit their own name; account status / email are admin-only
CREATE OR REPLACE FUNCTION public.guard_profile_update()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.is_active := OLD.is_active;
    NEW.email := OLD.email;
  END IF;
  IF auth.uid() IS NOT NULL AND NEW.id = auth.uid() AND OLD.is_active AND NOT NEW.is_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.guard_profile_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_profile_update ON public.profiles;
CREATE TRIGGER guard_profile_update BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();
-- ---- 20261003033955_5d361539-ceef-4a87-87a5-cc6a19e763f1.sql
CREATE OR REPLACE FUNCTION public.has_project_access(_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.is_active_user(); $$;

CREATE OR REPLACE FUNCTION public.can_configure(_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_active_user()
    AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived');
$$;

CREATE OR REPLACE FUNCTION public.can_update_production(_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_active_user()
    AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.is_active_user(); $$;

DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.is_active_user());

DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated
USING (public.is_active_user()) WITH CHECK (public.is_active_user());
-- ---- 20261005030803_f2987326-437e-45a1-b770-2b2531089e83.sql
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_configure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_update_production(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
-- ---- 20261014090000_open_access_no_login.sql
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

