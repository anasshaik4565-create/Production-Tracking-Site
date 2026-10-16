import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ProjectRow = {
  id: string;
  name: string;
  code: string;
  country: string;
  country_other: string | null;
  process: string;
  set_count: number;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const [{ data: projects, error }, { data: progress }, { data: sets }] = await Promise.all([
        supabase.from("projects").select("*").order("updated_at", { ascending: false }),
        supabase.rpc("get_projects_progress"),
        supabase.from("production_sets").select("project_id"),
      ]);
      if (error) throw error;
      const progressById = new Map(
        (progress ?? []).map((p) => [
          p.project_id,
          { progress: p.progress, panels: p.panel_count },
        ]),
      );
      const setCount = new Map<string, number>();
      for (const s of sets ?? []) setCount.set(s.project_id, (setCount.get(s.project_id) ?? 0) + 1);
      return (projects ?? []).map((p) => ({
        ...(p as ProjectRow),
        progress: progressById.get(p.id)?.progress ?? 0,
        panelCount: progressById.get(p.id)?.panels ?? 0,
        setsCreated: setCount.get(p.id) ?? 0,
      }));
    },
  });
}

export type ProjectListItem = NonNullable<ReturnType<typeof useProjects>["data"]>[number];

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .maybeSingle();
      if (error) throw error;
      return data as ProjectRow | null;
    },
    enabled: !!projectId,
  });
}

export function useSets(projectId: string) {
  return useQuery({
    queryKey: ["sets", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sets")
        .select("*")
        .eq("project_id", projectId)
        .order("set_number");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });
}

export function usePanels(projectId: string) {
  return useQuery({
    queryKey: ["panels", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("panels")
        .select("*")
        .eq("project_id", projectId)
        .order("sequence");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });
}

export function usePanelStages(projectId: string) {
  return useQuery({
    queryKey: ["panel-stages", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("panel_stages")
        .select("*")
        .eq("project_id", projectId)
        .order("sequence");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });
}

export function useProjectProgress(projectId: string) {
  return useQuery({
    queryKey: ["progress", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_project_progress", {
        p_project_id: projectId,
      });
      if (error) throw error;
      return data as {
        overall: number;
        counts: Record<string, number>;
        sets: { set_number: number; progress: number }[];
        panels: { panel: string; progress: number }[];
        stages: { stage: string; progress: number }[];
      };
    },
    enabled: !!projectId,
  });
}

export function useProductionStatus(projectId: string, setId?: string | null) {
  return useQuery({
    queryKey: ["production", projectId, setId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("production_status").select("*").eq("project_id", projectId);
      if (setId) q = q.eq("set_id", setId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });
}
