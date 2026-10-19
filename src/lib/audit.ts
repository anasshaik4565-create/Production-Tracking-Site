import { supabase } from "@/integrations/supabase/client";
import { currentRole } from "@/lib/access";

/** Record an entry in the audit log. Only Admin sessions write to it. */
export async function logAudit(action: string, description: string, projectId?: string) {
  if (currentRole() !== "admin") return;
  const { data } = await supabase.auth.getSession();
  await supabase.from("audit_logs").insert({
    user_id: data.session?.user.id ?? null,
    user_name: "Admin",
    action,
    description,
    project_id: projectId ?? null,
  });
}
