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