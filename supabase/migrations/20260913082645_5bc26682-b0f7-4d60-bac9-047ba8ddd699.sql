-- Revoke public/anon execute on all helper + RPC functions
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_active_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_project_access(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_configure(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_update_production(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_production_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.my_roles() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_workflows(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_project_progress(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_projects_progress() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_login() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_workflows(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_progress(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_projects_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_login() TO authenticated;