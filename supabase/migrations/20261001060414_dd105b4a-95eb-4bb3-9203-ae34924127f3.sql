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