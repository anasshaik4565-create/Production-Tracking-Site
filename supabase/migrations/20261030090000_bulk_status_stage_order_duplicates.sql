-- =====================================================================
-- Migration D: bulk status per stage, saved stage sequence (reordering),
--              duplicate ID Numbers allowed.
--
-- Run AFTER migrations A, B and C. Safe to run more than once.
-- Existing data, statuses, QC records, remarks, weights and history are
-- not changed. The only restriction removed is the old rule that an
-- ID Number had to be unique inside a project.
-- =====================================================================

-- ---------- 1. Duplicate ID Numbers (and Part Numbers) are allowed ------
-- Every panel keeps its own internal id (uuid); ID Number / Part Number are plain text.
DROP INDEX IF EXISTS public.uq_panels_project_id_number;
DROP INDEX IF EXISTS public.uq_panels_project_part;

-- ---------- 2. Stage sequence helpers -----------------------------------
-- Cleans a list of stage names: unknown names are refused, repeats removed,
-- first-seen order kept (the order IS the execution order).
CREATE OR REPLACE FUNCTION public.clean_stage_list(p_stages text[])
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_all text[] := ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.prod_stage)) e);
  v_out text[];
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_stages, '{}')) s WHERE NOT (s = ANY (v_all))) THEN
    RAISE EXCEPTION 'Unknown production stage.';
  END IF;
  SELECT coalesce(array_agg(s ORDER BY first_ord), '{}') INTO v_out
  FROM (SELECT s, min(ord) AS first_ord
          FROM unnest(coalesce(p_stages, '{}')) WITH ORDINALITY AS u(s, ord) GROUP BY s) q;
  RETURN v_out;
END; $$;

-- One row per library stage: the selected stages first, in the given order,
-- then every other stage in library order. seq is 1..N and is stored on panel_stages.sequence.
CREATE OR REPLACE FUNCTION public.ordered_stage_plan(p_selected text[])
RETURNS TABLE (stage text, seq integer, is_applicable boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH lib AS (
    SELECT e::text AS stage, o AS lib_ord
    FROM unnest(enum_range(NULL::public.prod_stage)) WITH ORDINALITY AS t(e, o)
  ), sel AS (
    SELECT s AS stage, min(ord) AS sel_ord
    FROM unnest(coalesce(p_selected, '{}')) WITH ORDINALITY AS u(s, ord) GROUP BY s
  )
  SELECT lib.stage,
         (row_number() OVER (ORDER BY (sel.sel_ord IS NULL), sel.sel_ord, lib.lib_ord))::integer,
         sel.sel_ord IS NOT NULL
  FROM lib LEFT JOIN sel ON sel.stage = lib.stage;
$$;

-- ---------- 3. Reorder ONE panel's stages (order only) ------------------
-- Changes panel_stages.sequence and nothing else: statuses, QC, remarks, weights and
-- history are never touched, and no stage is switched on or off.
CREATE OR REPLACE FUNCTION public.reorder_panel_stages(p_panel_id uuid, p_order text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project uuid; v_order text[];
BEGIN
  SELECT project_id INTO v_project FROM public.panels WHERE id = p_panel_id;
  IF v_project IS NULL THEN RAISE EXCEPTION 'Panel not found.'; END IF;
  IF NOT public.can_configure(v_project) THEN
    RAISE EXCEPTION 'Admin access is required, and the project must not be archived.' USING ERRCODE = '42501';
  END IF;
  v_order := public.clean_stage_list(p_order);
  UPDATE public.panel_stages st
     SET sequence = p.seq
    FROM public.ordered_stage_plan(v_order) p
   WHERE st.panel_id = p_panel_id AND st.stage::text = p.stage;
END; $$;

-- ---------- 4. Apply stages (with order) to all or selected panels ------
CREATE OR REPLACE FUNCTION public.apply_stages_to_panels(
  p_project_id uuid, p_stages text[], p_panel_ids uuid[] DEFAULT NULL, p_save_default boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stages text[]; v_panels integer; v_off integer := 0; v_on integer := 0;
  v_records integer; v_kept integer;
BEGIN
  IF NOT public.can_configure(p_project_id) THEN
    RAISE EXCEPTION 'Admin access is required, and the project must not be archived.' USING ERRCODE = '42501';
  END IF;
  v_stages := public.clean_stage_list(p_stages);   -- ordered, validated
  IF coalesce(array_length(v_stages, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one stage.'; END IF;

  SELECT count(*) INTO v_panels FROM public.panels
   WHERE project_id = p_project_id AND is_active AND (p_panel_ids IS NULL OR id = ANY (p_panel_ids));

  -- One row per panel and stage (never duplicated): insert missing, update flag and order.
  INSERT INTO public.panel_stages (panel_id, project_id, stage, is_applicable, sequence)
  SELECT pa.id, p_project_id, a.stage::public.prod_stage, a.is_applicable, a.seq
  FROM public.panels pa CROSS JOIN LATERAL public.ordered_stage_plan(v_stages) a
  WHERE pa.project_id = p_project_id AND pa.is_active AND (p_panel_ids IS NULL OR pa.id = ANY (p_panel_ids))
  ON CONFLICT (panel_id, stage) DO UPDATE
    SET is_applicable = EXCLUDED.is_applicable, sequence = EXCLUDED.sequence;

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
    UPDATE public.projects SET default_stages = v_stages WHERE id = p_project_id;  -- ordered
  END IF;
  RETURN jsonb_build_object('panels', v_panels, 'records_created', v_records,
                            'switched_off', v_off, 'switched_on', v_on, 'kept_with_work', v_kept);
END; $$;

-- ---------- 5. Create project / add panels: ordered stages, duplicate IDs ok
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
  v_records integer; v_area numeric; v_weight numeric; v_ptol numeric;
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
    SELECT array_agg(x ORDER BY ord) INTO v_default
      FROM jsonb_array_elements_text(p_payload->'default_stages') WITH ORDINALITY AS t(x, ord);
    v_default := public.clean_stage_list(v_default);
    IF coalesce(array_length(v_default, 1), 0) = 0 THEN v_default := NULL; END IF;
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
    v_idn := nullif(btrim(coalesce(v_panel->>'id_number', '')), '');   -- may repeat
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
      SELECT array_agg(x ORDER BY ord) INTO v_stages
        FROM jsonb_array_elements_text(v_panel->'stages') WITH ORDINALITY AS t(x, ord);
      v_stages := public.clean_stage_list(v_stages);
    ELSE
      v_stages := coalesce(v_default, v_all);
    END IF;
    INSERT INTO public.panel_stages (panel_id, project_id, stage, is_applicable, sequence)
    SELECT v_panel_id, v_project_id, p.stage::public.prod_stage, p.is_applicable, p.seq
    FROM public.ordered_stage_plan(v_stages) p;
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
  v_stages text[]; v_default text[]; v_area numeric; v_weight numeric;
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
    v_idn := nullif(btrim(coalesce(v_panel->>'id_number', '')), '');   -- may repeat
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
      SELECT array_agg(x ORDER BY ord) INTO v_stages
        FROM jsonb_array_elements_text(v_panel->'stages') WITH ORDINALITY AS t(x, ord);
      v_stages := public.clean_stage_list(v_stages);
    ELSE
      v_stages := coalesce(v_default, v_all);   -- the project's saved stage selection AND order
    END IF;
    INSERT INTO public.panel_stages (panel_id, project_id, stage, is_applicable, sequence)
    SELECT v_panel_id, p_project_id, p.stage::public.prod_stage, p.is_applicable, p.seq
    FROM public.ordered_stage_plan(v_stages) p;
    v_added := v_added + 1;
  END LOOP;

  UPDATE public.projects SET set_count = (SELECT count(*) FROM public.production_sets WHERE project_id = p_project_id)
   WHERE id = p_project_id;
  v_records := public.generate_workflows(p_project_id);
  RETURN jsonb_build_object('added', v_added, 'new_sets', v_new_sets, 'records', v_records);
END; $$;

-- ---------- 6. Bulk status for ONE stage across every set ---------------
-- Only the status of that stage changes. Remarks, QC status, weights and earlier history are
-- kept; each changed record gets its normal history entry. Stages a panel does not have are
-- never created. One failing record does not stop the others and is reported by name.
CREATE OR REPLACE FUNCTION public.bulk_update_stage_status(
  p_project_id uuid, p_stage text, p_status text, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_stage public.prod_stage; v_new public.prod_status;
  v_total integer; v_change integer; v_same integer; v_missing integer; v_na integer;
  v_by_set jsonb; v_updated integer := 0; v_failed jsonb := '[]'::jsonb; r record; v_name text;
BEGIN
  IF NOT public.is_admin_role() THEN
    RAISE EXCEPTION 'Admin access is required for this action.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF v_project.status = 'archived' THEN
    RAISE EXCEPTION 'This project is archived, so production cannot be updated.';
  END IF;
  IF NOT (p_stage = ANY (ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.prod_stage)) e))) THEN
    RAISE EXCEPTION 'Unknown production stage.';
  END IF;
  IF p_status NOT IN ('pending', 'wip', 'completed', 'hold', 'rework') THEN
    RAISE EXCEPTION 'Choose Pending, WIP, Completed, Hold or Rework.';
  END IF;
  v_stage := p_stage::public.prod_stage;
  v_new := p_status::public.prod_status;

  -- Targets: production records of THIS stage, for active panels that really have the stage assigned.
  SELECT count(*), count(*) FILTER (WHERE ps.status <> v_new), count(*) FILTER (WHERE ps.status = v_new)
    INTO v_total, v_change, v_same
  FROM public.production_status ps
  JOIN public.panels pa ON pa.id = ps.panel_id AND pa.is_active
  JOIN public.panel_stages st ON st.panel_id = ps.panel_id AND st.stage = ps.stage AND st.is_applicable
  WHERE ps.project_id = p_project_id AND ps.stage = v_stage AND ps.status <> 'not_applicable';

  SELECT count(*) INTO v_na
  FROM public.production_status ps
  JOIN public.panels pa ON pa.id = ps.panel_id AND pa.is_active
  JOIN public.panel_stages st ON st.panel_id = ps.panel_id AND st.stage = ps.stage AND st.is_applicable
  WHERE ps.project_id = p_project_id AND ps.stage = v_stage AND ps.status = 'not_applicable';

  SELECT count(*) INTO v_missing
  FROM public.panels pa
  WHERE pa.project_id = p_project_id AND pa.is_active
    AND NOT EXISTS (SELECT 1 FROM public.panel_stages st
                    WHERE st.panel_id = pa.id AND st.stage = v_stage AND st.is_applicable);

  SELECT coalesce(jsonb_agg(jsonb_build_object('set_number', set_number, 'to_change', c, 'already', a)
                            ORDER BY set_number), '[]'::jsonb)
    INTO v_by_set
  FROM (
    SELECT s.set_number,
           count(*) FILTER (WHERE ps.status <> v_new) AS c,
           count(*) FILTER (WHERE ps.status = v_new) AS a
    FROM public.production_status ps
    JOIN public.panels pa ON pa.id = ps.panel_id AND pa.is_active
    JOIN public.panel_stages st ON st.panel_id = ps.panel_id AND st.stage = ps.stage AND st.is_applicable
    JOIN public.production_sets s ON s.id = ps.set_id
    WHERE ps.project_id = p_project_id AND ps.stage = v_stage AND ps.status <> 'not_applicable'
    GROUP BY s.set_number
  ) q;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'project', v_project.code, 'stage', p_stage, 'status', p_status,
      'total', v_total, 'to_change', v_change, 'already', v_same, 'not_applicable_records', v_na,
      'panels_without_stage', v_missing, 'by_set', v_by_set);
  END IF;

  PERFORM set_config('app.status_remark', '', true);   -- never attach an old remark to these updates
  FOR r IN
    SELECT ps.id, pa.name AS panel_name, s.set_number
    FROM public.production_status ps
    JOIN public.panels pa ON pa.id = ps.panel_id AND pa.is_active
    JOIN public.panel_stages st ON st.panel_id = ps.panel_id AND st.stage = ps.stage AND st.is_applicable
    JOIN public.production_sets s ON s.id = ps.set_id
    WHERE ps.project_id = p_project_id AND ps.stage = v_stage
      AND ps.status <> 'not_applicable' AND ps.status <> v_new
    ORDER BY s.set_number, pa.sequence, pa.name, ps.id
  LOOP
    BEGIN
      UPDATE public.production_status SET status = v_new WHERE id = r.id;
      v_updated := v_updated + 1;
    EXCEPTION WHEN others THEN
      v_failed := v_failed || jsonb_build_object('panel', r.panel_name, 'set_number', r.set_number,
                                                 'stage', p_stage, 'error', SQLERRM);
    END;
  END LOOP;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (user_id, user_name, action, description, project_id)
  VALUES (auth.uid(), coalesce(v_name, ''), 'Bulk Status Update',
          format('%s: set stage %s to %s on %s of %s panel records (%s already %s, %s failed)',
                 v_project.code, p_stage, p_status, v_updated, v_change, v_same, p_status,
                 jsonb_array_length(v_failed)),
          p_project_id);

  RETURN jsonb_build_object('dry_run', false, 'project', v_project.code, 'stage', p_stage, 'status', p_status,
    'total', v_total, 'to_change', v_change, 'updated', v_updated, 'already', v_same,
    'not_applicable_records', v_na, 'panels_without_stage', v_missing,
    'failed', v_failed, 'by_set', v_by_set);
END; $$;

-- ---------- 7. Privileges: signed-in users only (role checks are inside) -
REVOKE EXECUTE ON FUNCTION public.reorder_panel_stages(uuid, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_update_stage_status(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_stages_to_panels(uuid, text[], uuid[], boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_project_full(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_panels(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clean_stage_list(text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ordered_stage_plan(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_panel_stages(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_stage_status(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stages_to_panels(uuid, text[], uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_full(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_panels(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clean_stage_list(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ordered_stage_plan(text[]) TO authenticated;
