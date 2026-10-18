-- STEP 2 of 2 (NEW DATABASE): run AFTER step 1 has finished. Adds no-login access, sets, QC status, remarks and project deletion.

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


-- ---- 20261020090100_b_sets_qc_remarks_delete.sql
-- =====================================================================
-- Migration B (run AFTER migration A has finished)
--   1. Panels belong to a set (Project -> Set -> Panel -> Stages)
--   2. Unique part number per project
--   3. QC status (separate from the production-stage status)
--   4. Remarks on every status update + history
--   5. Atomic functions: create project, add/import panels,
--      update status, delete project
-- Existing data is kept. Safe to run more than once.
-- =====================================================================

-- ---------- 1 + 2. Panels -> set, unique part number ----------------
ALTER TABLE public.panels
  ADD COLUMN IF NOT EXISTS set_id uuid REFERENCES public.production_sets(id) ON DELETE CASCADE;
-- NULL set_id = legacy panel that belongs to every set (old behaviour, unchanged)
CREATE INDEX IF NOT EXISTS idx_panels_set ON public.panels(set_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.panels
    WHERE btrim(part_number) <> '' AND is_active
    GROUP BY project_id, lower(btrim(part_number))
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'Duplicate part numbers already exist, so the unique part-number index was NOT created. The app still checks for duplicates.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_panels_project_part
      ON public.panels (project_id, lower(btrim(part_number)))
      WHERE btrim(part_number) <> '' AND is_active;
  END IF;
END $$;

-- ---------- 3 + 4. QC status and remarks ----------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'qc_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.qc_status AS ENUM ('qc_pending', 'qc_approved', 'not_ok');
  END IF;
END $$;

ALTER TABLE public.production_status
  ADD COLUMN IF NOT EXISTS qc_status public.qc_status,
  ADD COLUMN IF NOT EXISTS remarks text;

ALTER TABLE public.production_history
  ADD COLUMN IF NOT EXISTS old_qc_status public.qc_status,
  ADD COLUMN IF NOT EXISTS new_qc_status public.qc_status,
  ADD COLUMN IF NOT EXISTS remarks text;

CREATE INDEX IF NOT EXISTS idx_ps_qc ON public.production_status(project_id, qc_status);
CREATE INDEX IF NOT EXISTS idx_ph_panel ON public.production_history(panel_id, stage, changed_at DESC);

-- History trigger: now also records QC changes and the remark of each update.
CREATE OR REPLACE FUNCTION public.log_production_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_set integer; v_panel text; v_name text; v_remark text;
BEGIN
  v_remark := nullif(btrim(coalesce(current_setting('app.status_remark', true), '')), '');
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.qc_status IS DISTINCT FROM OLD.qc_status
     OR v_remark IS NOT NULL THEN
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    IF v_remark IS NOT NULL THEN NEW.remarks := v_remark; END IF;
    SELECT set_number INTO v_set FROM public.production_sets WHERE id = NEW.set_id;
    SELECT name INTO v_panel FROM public.panels WHERE id = NEW.panel_id;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.production_history
      (project_id, set_number, panel_name, panel_id, stage, old_status, new_status,
       old_qc_status, new_qc_status, remarks, changed_by, changed_by_name)
    VALUES
      (NEW.project_id, COALESCE(v_set, 0), COALESCE(v_panel, ''), NEW.panel_id, NEW.stage,
       OLD.status, NEW.status, OLD.qc_status, NEW.qc_status, v_remark,
       auth.uid(), COALESCE(v_name, ''));
  END IF;
  RETURN NEW;
END; $$;

-- ---------- Workflows: a panel only gets records for its own set ----
CREATE OR REPLACE FUNCTION public.generate_workflows(p_project_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted integer;
BEGIN
  IF NOT public.can_configure(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.';
  END IF;
  INSERT INTO public.production_status (project_id, set_id, panel_id, stage, status)
  SELECT p_project_id, s.id, pa.id, st.stage, 'pending'::public.prod_status
  FROM public.production_sets s
  JOIN public.panels pa
    ON pa.project_id = p_project_id AND pa.is_active
   AND (pa.set_id IS NULL OR pa.set_id = s.id)
  JOIN public.panel_stages st ON st.panel_id = pa.id AND st.is_applicable
  WHERE s.project_id = p_project_id AND s.is_active
  ON CONFLICT (set_id, panel_id, stage) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END; $$;

-- ---------- Progress: per-panel entries + QC counts ------------------
CREATE OR REPLACE FUNCTION public.get_project_progress(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_project_access(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to view this project.';
  END IF;
  SELECT jsonb_build_object(
    'overall', COALESCE((
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / GREATEST(COUNT(*), 1))
      FROM public.production_status WHERE project_id = p_project_id AND status <> 'not_applicable'
    ), 0),
    'counts', COALESCE((
      SELECT jsonb_object_agg(status, c) FROM (
        SELECT status::text AS status, COUNT(*) c FROM public.production_status
        WHERE project_id = p_project_id GROUP BY status
      ) q
    ), '{}'::jsonb),
    'qc', COALESCE((
      SELECT jsonb_object_agg(qc_status, c) FROM (
        SELECT qc_status::text AS qc_status, COUNT(*) c FROM public.production_status
        WHERE project_id = p_project_id AND qc_status IS NOT NULL GROUP BY qc_status
      ) q
    ), '{}'::jsonb),
    'sets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('set_number', set_number, 'progress', progress) ORDER BY set_number)
      FROM (
        SELECT s.set_number,
          ROUND(100.0 * COUNT(ps.id) FILTER (WHERE ps.status = 'completed') / GREATEST(COUNT(ps.id), 1)) progress
        FROM public.production_sets s
        LEFT JOIN public.production_status ps ON ps.set_id = s.id AND ps.status <> 'not_applicable'
        WHERE s.project_id = p_project_id GROUP BY s.set_number
      ) q
    ), '[]'::jsonb),
    'panels', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', id, 'panel', name, 'part_number', part_number,
               'set_number', set_number, 'progress', progress)
             ORDER BY set_number NULLS FIRST, sequence, name)
      FROM (
        SELECT pa.id, pa.name, pa.part_number, pa.sequence, s.set_number,
          ROUND(100.0 * COUNT(ps.id) FILTER (WHERE ps.status = 'completed') / GREATEST(COUNT(ps.id), 1)) progress
        FROM public.panels pa
        LEFT JOIN public.production_sets s ON s.id = pa.set_id
        LEFT JOIN public.production_status ps ON ps.panel_id = pa.id AND ps.status <> 'not_applicable'
        WHERE pa.project_id = p_project_id AND pa.is_active
        GROUP BY pa.id, pa.name, pa.part_number, pa.sequence, s.set_number
      ) q
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', stage::text, 'progress', progress) ORDER BY stage)
      FROM (
        SELECT ps.stage,
          ROUND(100.0 * COUNT(*) FILTER (WHERE ps.status = 'completed') / GREATEST(COUNT(*), 1)) progress
        FROM public.production_status ps
        WHERE ps.project_id = p_project_id AND ps.status <> 'not_applicable'
        GROUP BY ps.stage
      ) q
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

-- ---------- Atomic status update (stage status + QC status + remarks) -
CREATE OR REPLACE FUNCTION public.update_production_status(
  p_id uuid, p_status text, p_qc_status text, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project uuid; v_qc public.qc_status;
BEGIN
  SELECT project_id INTO v_project FROM public.production_status WHERE id = p_id;
  IF v_project IS NULL THEN RAISE EXCEPTION 'Production record not found.'; END IF;
  IF NOT public.can_update_production(v_project) THEN
    RAISE EXCEPTION 'This project is archived, so production cannot be updated.';
  END IF;
  v_qc := CASE WHEN p_qc_status IS NULL OR btrim(p_qc_status) IN ('', 'none')
               THEN NULL ELSE p_qc_status::public.qc_status END;
  PERFORM set_config('app.status_remark', coalesce(p_remarks, ''), true);
  UPDATE public.production_status
     SET status = p_status::public.prod_status, qc_status = v_qc
   WHERE id = p_id;
  PERFORM set_config('app.status_remark', '', true);
END; $$;

-- ---------- Atomic project creation ----------------------------------
CREATE OR REPLACE FUNCTION public.create_project_full(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := btrim(coalesce(p_payload->>'name', ''));
  v_code text := upper(btrim(coalesce(p_payload->>'code', '')));
  v_country text := coalesce(nullif(btrim(p_payload->>'country'), ''), 'India');
  v_sets integer[];
  v_project_id uuid;
  v_set integer;
  v_set_id uuid;
  v_panel jsonb;
  v_panel_id uuid;
  v_idx integer := 0;
  v_pset integer;
  v_part text;
  v_pname text;
  v_stages text[];
  v_all text[] := ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.prod_stage)) e);
  v_records integer;
  v_parts text[] := '{}';
  v_area numeric; v_weight numeric;
BEGIN
  IF v_name = '' OR v_code = '' THEN RAISE EXCEPTION 'Project name and code are required.'; END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE upper(btrim(code)) = v_code) THEN
    RAISE EXCEPTION 'duplicate project code %', v_code;
  END IF;
  SELECT array_agg(DISTINCT x::integer ORDER BY x::integer)
    INTO v_sets FROM jsonb_array_elements_text(coalesce(p_payload->'sets', '[]'::jsonb)) x;
  IF coalesce(array_length(v_sets, 1), 0) = 0 THEN RAISE EXCEPTION 'Add at least one set.'; END IF;
  IF v_sets[1] < 1 THEN RAISE EXCEPTION 'Set numbers must be 1 or higher.'; END IF;
  IF jsonb_typeof(p_payload->'panels') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'panels') = 0 THEN
    RAISE EXCEPTION 'Add at least one panel.';
  END IF;

  INSERT INTO public.projects (name, code, country, country_other, process, set_count)
  VALUES (v_name, v_code, v_country,
          CASE WHEN v_country = 'Other' THEN nullif(btrim(p_payload->>'country_other'), '') END,
          btrim(coalesce(p_payload->>'process', '')), array_length(v_sets, 1))
  RETURNING id INTO v_project_id;

  FOREACH v_set IN ARRAY v_sets LOOP
    INSERT INTO public.production_sets (project_id, set_number) VALUES (v_project_id, v_set);
  END LOOP;

  FOR v_panel IN SELECT * FROM jsonb_array_elements(p_payload->'panels') LOOP
    v_idx := v_idx + 1;
    v_pname := btrim(coalesce(v_panel->>'name', ''));
    IF v_pname = '' THEN RAISE EXCEPTION 'Panel % needs a name.', v_idx; END IF;
    v_part := btrim(coalesce(v_panel->>'part_number', ''));
    IF v_part <> '' THEN
      IF lower(v_part) = ANY (v_parts) THEN RAISE EXCEPTION 'Part number % is used by more than one panel.', v_part; END IF;
      v_parts := v_parts || lower(v_part);
    END IF;
    v_pset := nullif(btrim(coalesce(v_panel->>'set_number', '')), '')::integer;
    IF v_pset IS NULL AND array_length(v_sets, 1) = 1 THEN v_pset := v_sets[1]; END IF;
    IF v_pset IS NULL OR NOT (v_pset = ANY (v_sets)) THEN
      RAISE EXCEPTION 'Panel "%" must be assigned to one of the project sets.', v_pname;
    END IF;
    SELECT id INTO v_set_id FROM public.production_sets WHERE project_id = v_project_id AND set_number = v_pset;
    v_area := coalesce(nullif(btrim(v_panel->>'part_area'), '')::numeric, 0);
    v_weight := coalesce(nullif(btrim(v_panel->>'part_weight'), '')::numeric, 0);
    IF v_area < 0 OR v_weight < 0 THEN RAISE EXCEPTION 'Panel "%": area and weight cannot be negative.', v_pname; END IF;

    INSERT INTO public.panels (project_id, set_id, name, part_number, part_area, part_weight, sequence)
    VALUES (v_project_id, v_set_id, v_pname, v_part, v_area, v_weight, v_idx)
    RETURNING id INTO v_panel_id;

    IF jsonb_typeof(v_panel->'stages') = 'array' THEN
      SELECT array_agg(x) INTO v_stages FROM jsonb_array_elements_text(v_panel->'stages') x;
    ELSE
      v_stages := v_all;
    END IF;
    INSERT INTO public.panel_stages (panel_id, project_id, stage, is_applicable, sequence)
    SELECT v_panel_id, v_project_id, s::public.prod_stage, s = ANY (coalesce(v_stages, '{}')), ord
    FROM unnest(v_all) WITH ORDINALITY AS t(s, ord);
  END LOOP;

  v_records := public.generate_workflows(v_project_id);
  RETURN jsonb_build_object('project_id', v_project_id, 'code', v_code,
                            'sets', array_length(v_sets, 1), 'panels', v_idx, 'records', v_records);
END; $$;

-- ---------- Atomic add / import of panels into an existing project ---
CREATE OR REPLACE FUNCTION public.add_panels(
  p_project_id uuid, p_panels jsonb, p_create_missing_sets boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_panel jsonb; v_panel_id uuid; v_pset integer; v_set_id uuid; v_pname text; v_part text;
  v_seq integer; v_added integer := 0; v_new_sets integer := 0; v_records integer;
  v_all text[] := ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.prod_stage)) e);
  v_stages text[]; v_parts text[] := '{}'; v_area numeric; v_weight numeric; v_nsets integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;
  IF NOT public.can_configure(p_project_id) THEN
    RAISE EXCEPTION 'This project is archived, so it cannot be changed.';
  END IF;
  IF jsonb_typeof(p_panels) IS DISTINCT FROM 'array' OR jsonb_array_length(p_panels) = 0 THEN
    RAISE EXCEPTION 'There are no panels to add.';
  END IF;
  SELECT coalesce(max(sequence), 0) INTO v_seq FROM public.panels WHERE project_id = p_project_id;
  SELECT count(*) INTO v_nsets FROM public.production_sets WHERE project_id = p_project_id AND is_active;

  FOR v_panel IN SELECT * FROM jsonb_array_elements(p_panels) LOOP
    v_pname := btrim(coalesce(v_panel->>'name', ''));
    IF v_pname = '' THEN RAISE EXCEPTION 'Every panel needs a name.'; END IF;
    v_part := btrim(coalesce(v_panel->>'part_number', ''));
    IF v_part <> '' THEN
      IF lower(v_part) = ANY (v_parts) THEN RAISE EXCEPTION 'Part number % appears more than once.', v_part; END IF;
      IF EXISTS (SELECT 1 FROM public.panels WHERE project_id = p_project_id AND is_active
                 AND lower(btrim(part_number)) = lower(v_part)) THEN
        RAISE EXCEPTION 'Part number % already exists in this project.', v_part;
      END IF;
      v_parts := v_parts || lower(v_part);
    END IF;
    v_pset := nullif(btrim(coalesce(v_panel->>'set_number', '')), '')::integer;
    IF v_pset IS NULL THEN
      IF v_nsets = 1 THEN
        SELECT set_number INTO v_pset FROM public.production_sets WHERE project_id = p_project_id AND is_active;
      ELSE
        RAISE EXCEPTION 'Panel "%" needs a set number.', v_pname;
      END IF;
    END IF;
    SELECT id INTO v_set_id FROM public.production_sets WHERE project_id = p_project_id AND set_number = v_pset;
    IF v_set_id IS NULL THEN
      IF p_create_missing_sets AND v_pset >= 1 THEN
        INSERT INTO public.production_sets (project_id, set_number) VALUES (p_project_id, v_pset)
        RETURNING id INTO v_set_id;
        v_new_sets := v_new_sets + 1;
      ELSE
        RAISE EXCEPTION 'Set % does not exist in this project.', v_pset;
      END IF;
    END IF;
    v_area := coalesce(nullif(btrim(v_panel->>'part_area'), '')::numeric, 0);
    v_weight := coalesce(nullif(btrim(v_panel->>'part_weight'), '')::numeric, 0);
    IF v_area < 0 OR v_weight < 0 THEN RAISE EXCEPTION 'Panel "%": area and weight cannot be negative.', v_pname; END IF;

    v_seq := v_seq + 1;
    INSERT INTO public.panels (project_id, set_id, name, part_number, part_area, part_weight, sequence)
    VALUES (p_project_id, v_set_id, v_pname, v_part, v_area, v_weight, v_seq)
    RETURNING id INTO v_panel_id;

    IF jsonb_typeof(v_panel->'stages') = 'array' THEN
      SELECT array_agg(x) INTO v_stages FROM jsonb_array_elements_text(v_panel->'stages') x;
    ELSE
      v_stages := v_all;
    END IF;
    INSERT INTO public.panel_stages (panel_id, project_id, stage, is_applicable, sequence)
    SELECT v_panel_id, p_project_id, s::public.prod_stage, s = ANY (coalesce(v_stages, '{}')), ord
    FROM unnest(v_all) WITH ORDINALITY AS t(s, ord);
    v_added := v_added + 1;
  END LOOP;

  UPDATE public.projects SET set_count = (SELECT count(*) FROM public.production_sets WHERE project_id = p_project_id)
   WHERE id = p_project_id;
  v_records := public.generate_workflows(p_project_id);
  RETURN jsonb_build_object('added', v_added, 'new_sets', v_new_sets, 'records', v_records);
END; $$;

-- ---------- Delete project (everything that belongs to it) -----------
CREATE OR REPLACE FUNCTION public.delete_project(p_project_id uuid, p_confirm_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text; v_name text; v_sets integer; v_panels integer; v_records integer; v_hist integer;
BEGIN
  SELECT code, name INTO v_code, v_name FROM public.projects WHERE id = p_project_id;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF upper(btrim(coalesce(p_confirm_code, ''))) <> upper(btrim(v_code)) THEN
    RAISE EXCEPTION 'The confirmation code does not match this project.';
  END IF;
  SELECT count(*) INTO v_sets FROM public.production_sets WHERE project_id = p_project_id;
  SELECT count(*) INTO v_panels FROM public.panels WHERE project_id = p_project_id;
  SELECT count(*) INTO v_records FROM public.production_status WHERE project_id = p_project_id;
  SELECT count(*) INTO v_hist FROM public.production_history WHERE project_id = p_project_id;

  -- History has no foreign key, so remove it explicitly (no orphans left behind).
  DELETE FROM public.production_history WHERE project_id = p_project_id;
  -- Keep the audit trail, but detach it from the deleted project.
  UPDATE public.audit_logs SET project_id = NULL WHERE project_id = p_project_id;
  INSERT INTO public.audit_logs (user_id, user_name, action, description, project_id)
  VALUES (NULL, '', 'Delete Project',
          format('Deleted project %s (%s): %s sets, %s panels, %s production records, %s history entries',
                 v_code, v_name, v_sets, v_panels, v_records, v_hist), NULL);
  -- Sets, panels, stages, production records and members are removed by ON DELETE CASCADE.
  DELETE FROM public.projects WHERE id = p_project_id;
  RETURN jsonb_build_object('code', v_code, 'sets', v_sets, 'panels', v_panels,
                            'records', v_records, 'history', v_hist);
END; $$;

-- ---------- Permissions for the new functions -------------------------
REVOKE EXECUTE ON FUNCTION public.update_production_status(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_project_full(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_panels(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_project(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_production_status(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_full(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_panels(uuid, jsonb, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project(uuid, text) TO anon, authenticated;
