import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { roleFromSession, startAuth } from "@/lib/access";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    startAuth();
    const { data } = await supabase.auth.getSession();
    if (!roleFromSession(data.session)) throw redirect({ to: "/login" });
  },
  component: () => <Outlet />,
});
