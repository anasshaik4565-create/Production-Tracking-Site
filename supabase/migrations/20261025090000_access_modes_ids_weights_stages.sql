-- =====================================================================
-- Migration C: Reader / Admin access, ID Number, duplicate part numbers,
--              apply-stages-to-all-panels, panel weights + tolerance.
--
-- Run AFTER migrations A and B. Safe to run more than once.
-- Existing projects, sets, panels, stages, QC statuses, remarks and
-- history are kept. Nothing is dropped except the old rule that made
-- Part Number unique (it is now allowed to repeat).
--
-- IMPORTANT: this closes public (no-login) access. Create the two login
-- users first (see ACCESS-SETUP.sql), then run this file.
-- =====================================================================

-- ---------- 1. Role helpers (role comes from the signed login token) ----
-- app_metadata can only be changed from the Supabase dashboard / SQL,
-- never by the browser, so it cannot be spoofed by a user.
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
              THEN coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', '')
              ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_role()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.app_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_reader_or_admin()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.app_role() IN ('reader', 'admin');
$$;

-- Older helper functions now follow the same rules.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_reader_or_admin(); $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_admin_role(); $$;

CREATE OR REPLACE FUNCTION public.has_project_access(_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_reader_or_admin(); $$;

CREATE OR REPLACE FUNCTION public.can_configure(_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_admin_role()
          AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived'); $$;

CREATE OR REPLACE FUNCTION public.can_update_production(_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_admin_role()
          AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived'); $$;

GRANT EXECUTE ON FUNCTION public.app_role(), public.is_admin_role(), public.is_reader_or_admin(),
  public.is_active_user(), public.is_admin(), public.has_project_access(uuid),
  public.can_configure(uuid), public.can_update_production(uuid) TO authenticated;

-- ---------- 2. ID Number, tolerance, default stages ---------------------
-- Part Number may now repeat. Every panel keeps its own internal id (uuid).
DROP INDEX IF EXISTS public.uq_panels_project_part;

ALTER TABLE public.panels
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS weight_tolerance_pct numeric;
ALTER TABLE public.panels DROP CONSTRAINT IF EXISTS panels_weight_tolerance_chk;
ALTER TABLE public.panels ADD CONSTRAINT panels_weight_tolerance_chk
  CHECK (weight_tolerance_pct IS NULL OR (weight_tolerance_pct >= 0 AND weight_tolerance_pct <= 100));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS weight_tolerance_pct numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS default_stages text[];
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_weight_tolerance_chk;
ALTER TABLE public.projects ADD CONSTRAINT projects_weight_tolerance_chk
  CHECK (weight_tolerance_pct >= 0 AND weight_tolerance_pct <= 100);

-- ID Number (when entered) must be unique inside a project.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.panels
    WHERE btrim(coalesce(id_number, '')) <> '' AND is_active
    GROUP BY project_id, lower(btrim(id_number)) HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'Duplicate ID Numbers exist, so the unique ID Number index was NOT created.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_panels_project_id_number
      ON public.panels (project_id, lower(btrim(id_number)))
      WHERE btrim(coalesce(id_number, '')) <> '' AND is_active;
  END IF;
END $$;

-- ---------- 3. Panel weights (untrimmed / final), per panel and set -----
CREATE TABLE IF NOT EXISTS public.panel_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  panel_id uuid NOT NULL REFERENCES public.panels(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES public.production_sets(id) ON DELETE CASCADE,
  untrimmed_weight numeric CHECK (untrimmed_weight IS NULL OR (untrimmed_weight >= 0 AND untrimmed_weight <= 10000000)),
  final_weight numeric CHECK (final_weight IS NULL OR (final_weight >= 0 AND final_weight <= 10000000)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (panel_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_panel_weights_project ON public.panel_weights(project_id);
ALTER TABLE public.panel_weights ENABLE ROW LEVEL SECURITY;

-- ---------- 4. Row Level Security: Reader = read, Admin = read + write ---
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN
             ('projects','production_sets','panels','panel_stages','production_status',
              'production_history','audit_logs','panel_weights')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- projects
CREATE POLICY projects_read   ON public.projects FOR SELECT TO authenticated USING (public.is_reader_or_admin());
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated WITH CHECK (public.is_admin_role());
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated
  USING (public.is_admin_role()) WITH CHECK (public.is_admin_role());
-- sets / panels / stages (admin only, and not on archived projects)
CREATE POLICY sets_read   ON public.production_sets FOR SELECT TO authenticated USING (public.is_reader_or_admin());
CREATE POLICY sets_insert ON public.production_sets FOR INSERT TO authenticated WITH CHECK (public.can_configure(project_id));
CREATE POLICY sets_update ON public.production_sets FOR UPDATE TO authenticated
  USING (public.can_configure(project_id)) WITH CHECK (public.can_configure(project_id));
CREATE POLICY panels_read   ON public.panels FOR SELECT TO authenticated USING (public.is_reader_or_admin());
CREATE POLICY panels_insert ON public.panels FOR INSERT TO authenticated WITH CHECK (public.can_configure(project_id));
CREATE POLICY panels_update ON public.panels FOR UPDATE TO authenticated
  USING (public.can_configure(project_id)) WITH CHECK (public.can_configure(project_id));
CREATE POLICY panel_stages_read   ON public.panel_stages FOR SELECT TO authenticated USING (public.is_reader_or_admin());
CREATE POLICY panel_stages_insert ON public.panel_stages FOR INSERT TO authenticated WITH CHECK (public.can_configure(project_id));
CREATE POLICY panel_stages_update ON public.panel_stages FOR UPDATE TO authenticated
  USING (public.can_configure(project_id)) WITH CHECK (public.can_configure(project_id));
-- production records: read by both, updated by admin only (inserts go through functions)
CREATE POLICY prod_read   ON public.production_status FOR SELECT TO authenticated USING (public.is_reader_or_admin());
CREATE POLICY prod_update ON public.production_status FOR UPDATE TO authenticated
  USING (public.can_update_production(project_id)) WITH CHECK (public.can_update_production(project_id));
-- history and weights: read only (written by trusted functions / triggers)
CREATE POLICY history_read ON public.production_history FOR SELECT TO authenticated USING (public.is_reader_or_admin());
CREATE POLICY weights_read ON public.panel_weights FOR SELECT TO authenticated USING (public.is_reader_or_admin());
-- audit log: admin only
CREATE POLICY audit_read   ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin_role());
CREATE POLICY audit_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_admin_role());

-- Account tables: only Reader/Admin sessions may even see profile names.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (public.is_reader_or_admin());

-- ---------- 5. Privileges: close public access, no direct deletes -------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

REVOKE DELETE, TRUNCATE ON public.projects, public.production_sets, public.panels, public.panel_stages,
  public.production_status, public.production_history, public.audit_logs, public.panel_weights FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.projects, public.production_sets, public.panels, public.panel_stages TO authenticated;
GRANT SELECT, UPDATE ON public.production_status TO authenticated;
GRANT SELECT ON public.production_history, public.panel_weights TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
REVOKE INSERT, UPDATE ON public.production_history, public.panel_weights FROM authenticated;

-- ---------- 6. History trigger: allow silent system normalisation ------
CREATE OR REPLACE FUNCTION public.log_production_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_set integer; v_panel text; v_name text; v_remark text;
BEGIN
  IF coalesce(current_setting('app.skip_history', true), '') = 'on' THEN
    RETURN NEW;  -- used only by apply_stages_to_panels for untouched records
  END IF;
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

-- ---------- 7. Status update (admin only) + optional weights ------------
CREATE OR REPLACE FUNCTION public.update_production_status(
  p_id uuid, p_status text, p_qc_status text, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project uuid; v_qc public.qc_status;
BEGIN
  IF NOT public.is_admin_role() THEN
    RAISE EXCEPTION 'Admin access is required for this action.' USING ERRCODE = '42501';
  END IF;
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

CREATE OR REPLACE FUNCTION public.set_panel_weights(
  p_panel_id uuid, p_set_id uuid, p_untrimmed numeric, p_final numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project uuid; v_panel_set uuid; v_set_project uuid;
BEGIN
  IF NOT public.is_admin_role() THEN
    RAISE EXCEPTION 'Admin access is required for this action.' USING ERRCODE = '42501';
  END IF;
  SELECT project_id, set_id INTO v_project, v_panel_set FROM public.panels WHERE id = p_panel_id;
  IF v_project IS NULL THEN RAISE EXCEPTION 'Panel not found.'; END IF;
  SELECT project_id INTO v_set_project FROM public.production_sets WHERE id = p_set_id;
  IF v_set_project IS DISTINCT FROM v_project THEN RAISE EXCEPTION 'That set does not belong to this panel''s project.'; END IF;
  IF v_panel_set IS NOT NULL AND v_panel_set <> p_set_id THEN
    RAISE EXCEPTION 'This panel belongs to a different set.';
  END IF;
  IF NOT public.can_update_production(v_project) THEN
    RAISE EXCEPTION 'This project is archived, so weights cannot be changed.';
  END IF;
  IF (p_untrimmed IS NOT NULL AND (p_untrimmed < 0 OR p_untrimmed > 10000000))
     OR (p_final IS NOT NULL AND (p_final < 0 OR p_final > 10000000)) THEN
    RAISE EXCEPTION 'Weights must be zero or a positive number.';
  END IF;
  INSERT INTO public.panel_weights (project_id, panel_id, set_id, untrimmed_weight, final_weight, updated_by)
  VALUES (v_project, p_panel_id, p_set_id, p_untrimmed, p_final, auth.uid())
  ON CONFLICT (panel_id, set_id) DO UPDATE
    SET untrimmed_weight = EXCLUDED.untrimmed_weight,
        final_weight = EXCLUDED.final_weight,
        updated_at = now(), updated_by = auth.uid();
END; $$;

-- One transaction: status + QC + remarks, and (optionally) the weights.
CREATE OR REPLACE FUNCTION public.save_stage_update(
  p_id uuid, p_status text, p_qc_status text, p_remarks text,
  p_apply_weights boolean DEFAULT false, p_untrimmed numeric DEFAULT NULL, p_final numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_panel uuid; v_set uuid;
BEGIN
  IF NOT public.is_admin_role() THEN
    RAISE EXCEPTION 'Admin access is required for this action.' USING ERRCODE = '42501';
  END IF;
  SELECT panel_id, set_id INTO v_panel, v_set FROM public.production_status WHERE id = p_id;
  IF v_panel IS NULL THEN RAISE EXCEPTION 'Production record not found.'; END IF;
  IF p_apply_weights THEN
    PERFORM public.set_panel_weights(v_panel, v_set, p_untrimmed, p_final);
  END IF;
  PERFORM public.update_production_status(p_id, p_status, p_qc_status, p_remarks);
END; $$;

-- ---------- 8. Apply stages to all (or selected) panels ----------------
CREATE OR REPLACE FUNCTION public.apply_stages_to_panels(
  p_project_id uuid, p_stages text[], p_panel_ids uuid[] DEFAULT NULL, p_save_default boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_all text[] := ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.prod_stage)) e);
  v_stages text[]; v_panels integer; v_off integer := 0; v_on integer := 0;
  v_records integer; v_kept integer;
BEGIN
  IF NOT public.can_configure(p_project_id) THEN
    RAISE EXCEPTION 'Admin access is required, and the project must not be archived.' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT s) INTO v_stages FROM unnest(coalesce(p_stages, '{}')) s;
  IF coalesce(array_length(v_stages, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one stage.'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_stages) s WHERE NOT (s = ANY (v_all))) THEN
    RAISE EXCEPTION 'Unknown production stage.';
  END IF;

  SELECT count(*) INTO v_panels FROM public.panels
   WHERE project_id = p_project_id AND is_active AND (p_panel_ids IS NULL OR id = ANY (p_panel_ids));

  -- One row per panel and stage (never duplicated): insert missing, update the flag.
  INSERT INTO public.panel_stages (panel_id, project_id, stage, is_applicable, sequence)
  SELECT pa.id, p_project_id, a.s::public.prod_stage, a.s = ANY (v_stages), a.ord
  FROM public.panels pa CROSS JOIN unnest(v_all) WITH ORDINALITY AS a(s, ord)
  WHERE pa.project_id = p_project_id AND pa.is_active AND (p_panel_ids IS NULL OR pa.id = ANY (p_panel_ids))
  ON CONFLICT (panel_id, stage) DO UPDATE SET is_applicable = EXCLUDED.is_applicable;

  -- Records nobody has touched are switched quietly; records with work are never changed.
  PERFORM set_config('app.skip_history', 'on', true);
  UPDATE public.production_status ps SET status = 'not_applicable'
  FROM public.production_sets s, public.panels pa
  WHERE ps.set_id = s.id AND ps.panel_id = pa.id AND pa.project_id = p_project_id AND pa.is_active
    AND (p_panel_ids IS NULL OR pa.id = ANY (p_panel_ids))
    AND NOT (ps.stage::text = ANY (v_stages))
    AND ps.status = 'pending' AND ps.qc_status IS NULL AND ps.remarks IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.production_history h
                    WHERE h.panel_id = ps.panel_id AND h.stage = ps.stage AND h.set_number = s.set_number);
  GET DIAGNOSTICS v_off = ROW_COUNT;
  UPDATE public.production_status ps SET status = 'pending'
  FROM public.production_sets s, public.panels pa
  WHERE ps.set_id = s.id AND ps.panel_id = pa.id AND pa.project_id = p_project_id AND pa.is_active
    AND (p_panel_ids IS NULL OR pa.id = ANY (p_panel_ids))
    AND ps.stage::text = ANY (v_stages)
    AND ps.status = 'not_applicable' AND ps.qc_status IS NULL AND ps.remarks IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.production_history h
                    WHERE h.panel_id = ps.panel_id AND h.stage = ps.stage AND h.set_number = s.set_number);
  GET DIAGNOSTICS v_on = ROW_COUNT;
  PERFORM set_config('app.skip_history', '', true);

  SELECT count(*) INTO v_kept
  FROM public.production_status ps JOIN public.panels pa ON pa.id = ps.panel_id
  WHERE pa.project_id = p_project_id AND pa.is_active
    AND (p_panel_ids IS NULL OR pa.id = ANY (p_panel_ids))
    AND NOT (ps.stage::text = ANY (v_stages))
    AND ps.status NOT IN ('not_applicable');

  v_records := public.generate_workflows(p_project_id);
  IF p_save_default THEN
    UPDATE public.projects SET default_stages = v_stages WHERE id = p_project_id;
  END IF;
  RETURN jsonb_build_object('panels', v_panels, 'records_created', v_records,
                            'switched_off', v_off, 'switched_on', v_on, 'kept_with_work', v_kept);
END; $$;

-- ---------- 9. Create project / add panels (ID Number, duplicates ok) ---
CREATE OR REPLACE FUNCTION public.create_project_full(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := btrim(coalesce(p_payload->>'name', ''));
  v_code text := upper(btrim(coalesce(p_payload->>'code', '')));
  v_country text := coalesce(nullif(btrim(p_payload->>'country'), ''), 'India');
  v_tol numeric := coalesce(nullif(btrim(p_payload->>'weight_tolerance_pct'), '')::numeric, 5);
  v_sets integer[]; v_project_id uuid; v_set integer; v_set_id uuid;
  v_panel jsonb; v_panel_id uuid; v_idx integer := 0; v_pset integer;
  v_part text; v_idn text; v_pname text; v_stages text[]; v_default text[];
  v_all text[] := ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.prod_stage)) e);
  v_records integer; v_ids text[] := '{}'; v_area numeric; v_weight numeric; v_ptol numeric;
BEGIN
  IF NOT public.is_admin_role() THEN
    RAISE EXCEPTION 'Admin access is required for this action.' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' OR v_code = '' THEN RAISE EXCEPTION 'Project name and code are required.'; END IF;
  IF v_tol < 0 OR v_tol > 100 THEN RAISE EXCEPTION 'Weight tolerance must be between 0 and 100 percent.'; END IF;
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
  IF jsonb_typeof(p_payload->'default_stages') = 'array' THEN
    SELECT array_agg(DISTINCT x) INTO v_default FROM jsonb_array_elements_text(p_payload->'default_stages') x;
    IF EXISTS (SELECT 1 FROM unnest(v_default) s WHERE NOT (s = ANY (v_all))) THEN
      RAISE EXCEPTION 'Unknown production stage.';
    END IF;
  END IF;

  INSERT INTO public.projects (name, code, country, country_other, process, set_count, weight_tolerance_pct, default_stages)
  VALUES (v_name, v_code, v_country,
          CASE WHEN v_country = 'Other' THEN nullif(btrim(p_payload->>'country_other'), '') END,
          btrim(coalesce(p_payload->>'process', '')), array_length(v_sets, 1), v_tol, v_default)
  RETURNING id INTO v_project_id;

  FOREACH v_set IN ARRAY v_sets LOOP
    INSERT INTO public.production_sets (project_id, set_number) VALUES (v_project_id, v_set);
  END LOOP;

  FOR v_panel IN SELECT * FROM jsonb_array_elements(p_payload->'panels') LOOP
    v_idx := v_idx + 1;
    v_pname := btrim(coalesce(v_panel->>'name', ''));
    IF v_pname = '' THEN RAISE EXCEPTION 'Panel % needs a name.', v_idx; END IF;
    v_part := btrim(coalesce(v_panel->>'part_number', ''));   -- may repeat
    v_idn := nullif(btrim(coalesce(v_panel->>'id_number', '')), '');
    IF v_idn IS NOT NULL THEN
      IF lower(v_idn) = ANY (v_ids) THEN RAISE EXCEPTION 'ID Number % is used by more than one panel.', v_idn; END IF;
      v_ids := v_ids || lower(v_idn);
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
    v_ptol := nullif(btrim(coalesce(v_panel->>'weight_tolerance_pct', '')), '')::numeric;

    INSERT INTO public.panels (project_id, set_id, name, part_number, id_number, part_area, part_weight, weight_tolerance_pct, sequence)
    VALUES (v_project_id, v_set_id, v_pname, v_part, v_idn, v_area, v_weight, v_ptol, v_idx)
    RETURNING id INTO v_panel_id;

    IF jsonb_typeof(v_panel->'stages') = 'array' THEN
      SELECT array_agg(x) INTO v_stages FROM jsonb_array_elements_text(v_panel->'stages') x;
    ELSE
      v_stages := coalesce(v_default, v_all);
    END IF;
    INSERT INTO public.panel_stages (panel_id, project_id, stage, is_applicable, sequence)
    SELECT v_panel_id, v_project_id, s::public.prod_stage, s = ANY (coalesce(v_stages, '{}')), ord
    FROM unnest(v_all) WITH ORDINALITY AS t(s, ord);
  END LOOP;

  v_records := public.generate_workflows(v_project_id);
  RETURN jsonb_build_object('project_id', v_project_id, 'code', v_code,
                            'sets', array_length(v_sets, 1), 'panels', v_idx, 'records', v_records);
END; $$;

CREATE OR REPLACE FUNCTION public.add_panels(
  p_project_id uuid, p_panels jsonb, p_create_missing_sets boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_panel jsonb; v_panel_id uuid; v_pset integer; v_set_id uuid; v_pname text; v_part text; v_idn text;
  v_seq integer; v_added integer := 0; v_new_sets integer := 0; v_records integer;
  v_all text[] := ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.prod_stage)) e);
  v_stages text[]; v_default text[]; v_ids text[] := '{}'; v_area numeric; v_weight numeric;
  v_nsets integer; v_ptol numeric;
BEGIN
  IF NOT public.is_admin_role() THEN
    RAISE EXCEPTION 'Admin access is required for this action.' USING ERRCODE = '42501';
  END IF;
  SELECT default_stages INTO v_default FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.'; END IF;
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
    v_part := btrim(coalesce(v_panel->>'part_number', ''));   -- may repeat
    v_idn := nullif(btrim(coalesce(v_panel->>'id_number', '')), '');
    IF v_idn IS NOT NULL THEN
      IF lower(v_idn) = ANY (v_ids) THEN RAISE EXCEPTION 'ID Number % appears more than once.', v_idn; END IF;
      IF EXISTS (SELECT 1 FROM public.panels WHERE project_id = p_project_id AND is_active
                 AND lower(btrim(coalesce(id_number, ''))) = lower(v_idn)) THEN
        RAISE EXCEPTION 'ID Number % already exists in this project.', v_idn;
      END IF;
      v_ids := v_ids || lower(v_idn);
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
    v_ptol := nullif(btrim(coalesce(v_panel->>'weight_tolerance_pct', '')), '')::numeric;

    v_seq := v_seq + 1;
    INSERT INTO public.panels (project_id, set_id, name, part_number, id_number, part_area, part_weight, weight_tolerance_pct, sequence)
    VALUES (p_project_id, v_set_id, v_pname, v_part, v_idn, v_area, v_weight, v_ptol, v_seq)
    RETURNING id INTO v_panel_id;

    IF jsonb_typeof(v_panel->'stages') = 'array' THEN
      SELECT array_agg(x) INTO v_stages FROM jsonb_array_elements_text(v_panel->'stages') x;
    ELSE
      v_stages := coalesce(v_default, v_all);   -- the project's saved stage selection
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

-- ---------- 10. Delete project: admin only -----------------------------
CREATE OR REPLACE FUNCTION public.delete_project(p_project_id uuid, p_confirm_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text; v_name text; v_sets integer; v_panels integer; v_records integer; v_hist integer;
BEGIN
  IF NOT public.is_admin_role() THEN
    RAISE EXCEPTION 'Admin access is required for this action.' USING ERRCODE = '42501';
  END IF;
  SELECT code, name INTO v_code, v_name FROM public.projects WHERE id = p_project_id;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF upper(btrim(coalesce(p_confirm_code, ''))) <> upper(btrim(v_code)) THEN
    RAISE EXCEPTION 'The confirmation code does not match this project.';
  END IF;
  SELECT count(*) INTO v_sets FROM public.production_sets WHERE project_id = p_project_id;
  SELECT count(*) INTO v_panels FROM public.panels WHERE project_id = p_project_id;
  SELECT count(*) INTO v_records FROM public.production_status WHERE project_id = p_project_id;
  SELECT count(*) INTO v_hist FROM public.production_history WHERE project_id = p_project_id;
  DELETE FROM public.production_history WHERE project_id = p_project_id;
  UPDATE public.audit_logs SET project_id = NULL WHERE project_id = p_project_id;
  INSERT INTO public.audit_logs (user_id, user_name, action, description, project_id)
  VALUES (auth.uid(), '', 'Delete Project',
          format('Deleted project %s (%s): %s sets, %s panels, %s production records, %s history entries',
                 v_code, v_name, v_sets, v_panels, v_records, v_hist), NULL);
  DELETE FROM public.projects WHERE id = p_project_id;  -- cascades to sets, panels, stages, records, weights
  RETURN jsonb_build_object('code', v_code, 'sets', v_sets, 'panels', v_panels,
                            'records', v_records, 'history', v_hist);
END; $$;

-- ---------- 11. Function privileges (signed-in users only) --------------
REVOKE EXECUTE ON FUNCTION public.set_panel_weights(uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_stage_update(uuid, text, text, text, boolean, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_stages_to_panels(uuid, text[], uuid[], boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_production_status(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_project_full(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_panels(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_project(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_workflows(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_project_progress(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_projects_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_panel_weights(uuid, uuid, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_stage_update(uuid, text, text, text, boolean, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stages_to_panels(uuid, text[], uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_production_status(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_full(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_panels(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_workflows(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_progress(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_projects_progress() TO authenticated;
