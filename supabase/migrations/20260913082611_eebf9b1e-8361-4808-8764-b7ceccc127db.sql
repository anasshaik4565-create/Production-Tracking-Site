-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin','project_manager','engineer','production','qc','viewer');
CREATE TYPE public.project_status AS ENUM ('active','on_hold','completed','archived');
CREATE TYPE public.prod_status AS ENUM ('pending','wip','completed','hold','rework','not_applicable');
CREATE TYPE public.prod_stage AS ENUM (
  'lamination','demould','trimming','detailing','assembly','bracket_bonding',
  'panel_to_panel_bonding','gelcoat_sanding','primer_spray','primer_sanding',
  'painting','clear_coat','post_operations','post_operations_qc','packing'
);

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- HELPERS
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'admin') AND public.is_active_user();
$$;

CREATE OR REPLACE FUNCTION public.my_roles()
RETURNS public.app_role[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ARRAY_AGG(role), '{}'::public.app_role[]) FROM public.user_roles WHERE user_id = auth.uid();
$$;

-- PROJECTS
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'India',
  country_other TEXT,
  process TEXT NOT NULL DEFAULT '',
  set_count INTEGER NOT NULL DEFAULT 1,
  status public.project_status NOT NULL DEFAULT 'active',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_project_access(_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = _project_id AND m.user_id = auth.uid())
  );
$$;

-- can configure project structure (project/panels/stages/sets)
CREATE OR REPLACE FUNCTION public.can_configure(_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_project_access(_project_id) AND (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'project_manager')
    OR public.has_role(auth.uid(),'engineer')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived'
  );
$$;

-- can update production status
CREATE OR REPLACE FUNCTION public.can_update_production(_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_project_access(_project_id) AND (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'project_manager')
    OR public.has_role(auth.uid(),'engineer')
    OR public.has_role(auth.uid(),'production')
    OR public.has_role(auth.uid(),'qc')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.status = 'archived'
  );
$$;

-- SETS
CREATE TABLE public.production_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, set_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_sets TO authenticated;
GRANT ALL ON public.production_sets TO service_role;
ALTER TABLE public.production_sets ENABLE ROW LEVEL SECURITY;

-- PANELS
CREATE TABLE public.panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  part_number TEXT NOT NULL DEFAULT '',
  part_area NUMERIC(10,2) NOT NULL DEFAULT 0,
  part_weight NUMERIC(10,2) NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.panels TO authenticated;
GRANT ALL ON public.panels TO service_role;
ALTER TABLE public.panels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.panel_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id UUID NOT NULL REFERENCES public.panels(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage public.prod_stage NOT NULL,
  is_applicable BOOLEAN NOT NULL DEFAULT true,
  sequence INTEGER NOT NULL DEFAULT 1,
  UNIQUE (panel_id, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.panel_stages TO authenticated;
GRANT ALL ON public.panel_stages TO service_role;
ALTER TABLE public.panel_stages ENABLE ROW LEVEL SECURITY;

-- PRODUCTION STATUS
CREATE TABLE public.production_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  set_id UUID NOT NULL REFERENCES public.production_sets(id) ON DELETE CASCADE,
  panel_id UUID NOT NULL REFERENCES public.panels(id) ON DELETE CASCADE,
  stage public.prod_stage NOT NULL,
  status public.prod_status NOT NULL DEFAULT 'pending',
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (set_id, panel_id, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_status TO authenticated;
GRANT ALL ON public.production_status TO service_role;
ALTER TABLE public.production_status ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ps_project ON public.production_status(project_id);
CREATE INDEX idx_ps_set ON public.production_status(set_id);
CREATE INDEX idx_ps_panel ON public.production_status(panel_id);
CREATE INDEX idx_ps_status ON public.production_status(project_id, status);

-- PRODUCTION HISTORY
CREATE TABLE public.production_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  set_number INTEGER NOT NULL,
  panel_name TEXT NOT NULL,
  panel_id UUID,
  stage public.prod_stage NOT NULL,
  old_status public.prod_status,
  new_status public.prod_status NOT NULL,
  changed_by UUID,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.production_history TO authenticated;
GRANT ALL ON public.production_history TO service_role;
ALTER TABLE public.production_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ph_project ON public.production_history(project_id, changed_at DESC);

-- AUDIT LOGS
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_name TEXT,
  action TEXT NOT NULL,
  project_id UUID,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);

-- POLICIES: profiles
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- POLICIES: user_roles
CREATE POLICY "roles_select_own" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "roles_admin_write" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- POLICIES: projects
CREATE POLICY "projects_select" ON public.projects FOR SELECT TO authenticated
  USING (public.has_project_access(id));
CREATE POLICY "projects_insert" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND public.is_active_user() AND (
      public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'project_manager')
    )
  );
CREATE POLICY "projects_update" ON public.projects FOR UPDATE TO authenticated
  USING (public.can_configure(id)) WITH CHECK (public.has_project_access(id));
CREATE POLICY "projects_delete_admin" ON public.projects FOR DELETE TO authenticated
  USING (public.is_admin());

-- POLICIES: project_members
CREATE POLICY "members_select" ON public.project_members FOR SELECT TO authenticated
  USING (public.has_project_access(project_id));
CREATE POLICY "members_write" ON public.project_members FOR ALL TO authenticated
  USING (public.is_admin() OR public.has_role(auth.uid(),'project_manager') AND public.has_project_access(project_id))
  WITH CHECK (public.is_admin() OR public.has_role(auth.uid(),'project_manager') AND public.has_project_access(project_id));

-- POLICIES: sets / panels / panel_stages
CREATE POLICY "sets_select" ON public.production_sets FOR SELECT TO authenticated
  USING (public.has_project_access(project_id));
CREATE POLICY "sets_write" ON public.production_sets FOR ALL TO authenticated
  USING (public.can_configure(project_id)) WITH CHECK (public.can_configure(project_id));

CREATE POLICY "panels_select" ON public.panels FOR SELECT TO authenticated
  USING (public.has_project_access(project_id));
CREATE POLICY "panels_write" ON public.panels FOR ALL TO authenticated
  USING (public.can_configure(project_id)) WITH CHECK (public.can_configure(project_id));

CREATE POLICY "panel_stages_select" ON public.panel_stages FOR SELECT TO authenticated
  USING (public.has_project_access(project_id));
CREATE POLICY "panel_stages_write" ON public.panel_stages FOR ALL TO authenticated
  USING (public.can_configure(project_id)) WITH CHECK (public.can_configure(project_id));

-- POLICIES: production status
CREATE POLICY "prod_select" ON public.production_status FOR SELECT TO authenticated
  USING (public.has_project_access(project_id));
CREATE POLICY "prod_insert" ON public.production_status FOR INSERT TO authenticated
  WITH CHECK (public.can_configure(project_id));
CREATE POLICY "prod_update" ON public.production_status FOR UPDATE TO authenticated
  USING (public.can_update_production(project_id)) WITH CHECK (public.can_update_production(project_id));

-- POLICIES: history (read only)
CREATE POLICY "history_select" ON public.production_history FOR SELECT TO authenticated
  USING (public.has_project_access(project_id));

-- POLICIES: audit
CREATE POLICY "audit_select_admin" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_admin() OR user_id = auth.uid());
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- TRIGGERS
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_panels_touch BEFORE UPDATE ON public.panels
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- status change -> history (append only, server timestamp)
CREATE OR REPLACE FUNCTION public.log_production_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_set INTEGER; v_panel TEXT; v_name TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    SELECT set_number INTO v_set FROM public.production_sets WHERE id = NEW.set_id;
    SELECT name INTO v_panel FROM public.panels WHERE id = NEW.panel_id;
    SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.production_history
      (project_id,set_number,panel_name,panel_id,stage,old_status,new_status,changed_by,changed_by_name)
    VALUES (NEW.project_id, COALESCE(v_set,0), COALESCE(v_panel,''), NEW.panel_id, NEW.stage,
            OLD.status, NEW.status, auth.uid(), COALESCE(v_name,''));
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_prod_history BEFORE UPDATE ON public.production_status
  FOR EACH ROW EXECUTE FUNCTION public.log_production_change();

-- new user -> profile + role (first user becomes admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), COALESCE(NEW.email,''));
  SELECT COUNT(*) INTO v_count FROM public.profiles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN v_count <= 1 THEN 'admin'::public.app_role ELSE 'viewer'::public.app_role END);
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- WORKFLOW GENERATION
CREATE OR REPLACE FUNCTION public.generate_workflows(p_project_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted INTEGER;
BEGIN
  IF NOT public.can_configure(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.';
  END IF;
  INSERT INTO public.production_status (project_id, set_id, panel_id, stage, status)
  SELECT p_project_id, s.id, pa.id, st.stage, 'pending'::public.prod_status
  FROM public.production_sets s
  JOIN public.panels pa ON pa.project_id = p_project_id AND pa.is_active
  JOIN public.panel_stages st ON st.panel_id = pa.id AND st.is_applicable
  WHERE s.project_id = p_project_id AND s.is_active
  ON CONFLICT (set_id, panel_id, stage) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END; $$;
GRANT EXECUTE ON FUNCTION public.generate_workflows(UUID) TO authenticated;

-- PROGRESS
CREATE OR REPLACE FUNCTION public.get_project_progress(p_project_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.has_project_access(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to view this project.';
  END IF;
  SELECT jsonb_build_object(
    'overall', COALESCE((
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status='completed') / GREATEST(COUNT(*),1))
      FROM public.production_status WHERE project_id = p_project_id AND status <> 'not_applicable'
    ),0),
    'counts', COALESCE((
      SELECT jsonb_object_agg(status, c) FROM (
        SELECT status::text AS status, COUNT(*) c FROM public.production_status
        WHERE project_id = p_project_id GROUP BY status
      ) q
    ), '{}'::jsonb),
    'sets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('set_number', set_number, 'progress', progress) ORDER BY set_number)
      FROM (
        SELECT s.set_number,
          ROUND(100.0 * COUNT(ps.id) FILTER (WHERE ps.status='completed') / GREATEST(COUNT(ps.id),1)) progress
        FROM public.production_sets s
        LEFT JOIN public.production_status ps ON ps.set_id = s.id AND ps.status <> 'not_applicable'
        WHERE s.project_id = p_project_id GROUP BY s.set_number
      ) q
    ), '[]'::jsonb),
    'panels', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('panel', name, 'progress', progress) ORDER BY name)
      FROM (
        SELECT pa.name,
          ROUND(100.0 * COUNT(ps.id) FILTER (WHERE ps.status='completed') / GREATEST(COUNT(ps.id),1)) progress
        FROM public.panels pa
        LEFT JOIN public.production_status ps ON ps.panel_id = pa.id AND ps.status <> 'not_applicable'
        WHERE pa.project_id = p_project_id AND pa.is_active GROUP BY pa.name
      ) q
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', stage, 'progress', progress))
      FROM (
        SELECT ps.stage::text stage,
          ROUND(100.0 * COUNT(*) FILTER (WHERE ps.status='completed') / GREATEST(COUNT(*),1)) progress
        FROM public.production_status ps
        WHERE ps.project_id = p_project_id AND ps.status <> 'not_applicable'
        GROUP BY ps.stage
      ) q
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_project_progress(UUID) TO authenticated;

-- Progress for many projects at once (list views)
CREATE OR REPLACE FUNCTION public.get_projects_progress()
RETURNS TABLE(project_id UUID, progress INTEGER, panel_count INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
    COALESCE(ROUND(100.0 * COUNT(ps.id) FILTER (WHERE ps.status='completed')
      / GREATEST(COUNT(ps.id) FILTER (WHERE ps.status <> 'not_applicable'),1))::int, 0),
    (SELECT COUNT(*)::int FROM public.panels pa WHERE pa.project_id = p.id AND pa.is_active)
  FROM public.projects p
  LEFT JOIN public.production_status ps ON ps.project_id = p.id AND ps.status <> 'not_applicable'
  WHERE public.has_project_access(p.id)
  GROUP BY p.id;
$$;
GRANT EXECUTE ON FUNCTION public.get_projects_progress() TO authenticated;

-- Admin system stats
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.';
  END IF;
  SELECT jsonb_build_object(
    'users_total', (SELECT COUNT(*) FROM public.profiles),
    'users_active', (SELECT COUNT(*) FROM public.profiles WHERE is_active),
    'users_inactive', (SELECT COUNT(*) FROM public.profiles WHERE NOT is_active),
    'projects_total', (SELECT COUNT(*) FROM public.projects),
    'projects_active', (SELECT COUNT(*) FROM public.projects WHERE status='active'),
    'projects_completed', (SELECT COUNT(*) FROM public.projects WHERE status='completed'),
    'projects_hold', (SELECT COUNT(*) FROM public.projects WHERE status='on_hold'),
    'projects_archived', (SELECT COUNT(*) FROM public.projects WHERE status='archived'),
    'panels_total', (SELECT COUNT(*) FROM public.panels WHERE is_active),
    'records_total', (SELECT COUNT(*) FROM public.production_status),
    'records_completed', (SELECT COUNT(*) FROM public.production_status WHERE status='completed'),
    'records_wip', (SELECT COUNT(*) FROM public.production_status WHERE status='wip'),
    'records_hold', (SELECT COUNT(*) FROM public.production_status WHERE status='hold'),
    'records_rework', (SELECT COUNT(*) FROM public.production_status WHERE status='rework')
  ) INTO r;
  RETURN r;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;

-- Admin: set a user's single role
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id UUID, p_role public.app_role)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'You do not have permission to perform this action.';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_set_role(UUID, public.app_role) TO authenticated;

-- record last login
CREATE OR REPLACE FUNCTION public.record_login()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET last_login_at = now() WHERE id = auth.uid();
END; $$;
GRANT EXECUTE ON FUNCTION public.record_login() TO authenticated;