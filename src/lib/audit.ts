import { supabase } from "@/integrations/supabase/client";

/** Record an entry in the audit log (no sign-in, so no user is attached). */
export async function logAudit(action: string, description: string, projectId?: string) {
  await supabase.from("audit_logs").insert({
    user_id: null,
    user_name: "",
    action,
    description,
    project_id: projectId ?? null,
  });
}
