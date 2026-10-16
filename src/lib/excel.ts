import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import {
  PROJECT_STATUS_LABEL,
  STAGE_LABEL,
  STATUS_LABEL,
  countryLabel,
  formatDate,
  formatTime,
} from "@/lib/domain";
import { logAudit } from "@/lib/audit";

export type SheetSpec = { name: string; rows: Record<string, unknown>[] };

export function downloadWorkbook(sheets: SheetSpec[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const rows = sheet.rows.length ? sheet.rows : [{ Info: "No data" }];
    const ws = XLSX.utils.json_to_sheet(rows);
    const widths = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.min(
        40,
        Math.max(key.length + 2, ...rows.map((r) => String(r[key] ?? "").length + 2)),
      ),
    }));
    ws["!cols"] = widths;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export type ExportFilters = {
  setId?: string | null;
  stage?: string | null;
  status?: string | null;
  panelId?: string | null;
};

/** Full project workbook: summary, sets, panels, production status, history. */
export async function exportProjectWorkbook(projectId: string, filters: ExportFilters = {}) {
  const [{ data: project }, { data: sets }, { data: panels }, { data: stages }] = await Promise.all(
    [
      supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
      supabase.from("production_sets").select("*").eq("project_id", projectId).order("set_number"),
      supabase.from("panels").select("*").eq("project_id", projectId).order("sequence"),
      supabase.from("panel_stages").select("*").eq("project_id", projectId),
    ],
  );

  if (!project) throw new Error("Unable to load project. Please try again.");

  let statusQuery = supabase.from("production_status").select("*").eq("project_id", projectId);
  if (filters.setId) statusQuery = statusQuery.eq("set_id", filters.setId);
  if (filters.panelId) statusQuery = statusQuery.eq("panel_id", filters.panelId);
  if (filters.stage) statusQuery = statusQuery.eq("stage", filters.stage as never);
  if (filters.status) statusQuery = statusQuery.eq("status", filters.status as never);
  const { data: statuses } = await statusQuery;

  let historyQuery = supabase
    .from("production_history")
    .select("*")
    .eq("project_id", projectId)
    .order("changed_at", { ascending: false });
  if (filters.stage) historyQuery = historyQuery.eq("stage", filters.stage as never);
  const { data: history } = await historyQuery;

  const { data: progress } = await supabase.rpc("get_project_progress", {
    p_project_id: projectId,
  });
  const overall = (progress as { overall?: number } | null)?.overall ?? 0;

  const setById = new Map((sets ?? []).map((s) => [s.id, s.set_number]));
  const panelById = new Map((panels ?? []).map((p) => [p.id, p]));
  // Latest recorded name per panel / set / stage, taken from the permanent history log.
  const lastBy = new Map<string, string>();
  for (const h of history ?? []) {
    const key = `${h.panel_id}|${h.set_number}|${h.stage}`;
    if (!lastBy.has(key)) lastBy.set(key, h.changed_by_name ?? "");
  }

  const sheets: SheetSpec[] = [
    {
      name: "Project Summary",
      rows: [
        { Field: "Project Name", Value: project.name },
        { Field: "Project Code", Value: project.code },
        { Field: "Country", Value: countryLabel(project.country, project.country_other) },
        { Field: "Process", Value: project.process },
        { Field: "Number of Sets", Value: (sets ?? []).length },
        { Field: "Number of Panels", Value: (panels ?? []).filter((p) => p.is_active).length },
        { Field: "Overall Progress", Value: `${overall}%` },
        { Field: "Project Status", Value: PROJECT_STATUS_LABEL[project.status] },
        { Field: "Created Date", Value: formatDate(project.created_at) },
        { Field: "Last Updated", Value: formatDate(project.updated_at) },
      ],
    },
    {
      name: "Sets",
      rows: (sets ?? []).map((s) => ({
        Set: `Set ${s.set_number}`,
        Active: s.is_active ? "Yes" : "No",
        "Created Date": formatDate(s.created_at),
      })),
    },
    {
      name: "Panels",
      rows: (panels ?? []).map((p) => ({
        Sequence: p.sequence,
        "Panel Name": p.name,
        "Part Number": p.part_number,
        "Part Area (m2)": Number(p.part_area),
        "Part Weight (kg)": Number(p.part_weight),
        Active: p.is_active ? "Yes" : "No",
        "Applicable Stages": (stages ?? [])
          .filter((s) => s.panel_id === p.id && s.is_applicable)
          .map((s) => STAGE_LABEL[s.stage])
          .join(", "),
      })),
    },
    {
      name: "Production Status",
      rows: (statuses ?? []).map((s) => {
        const panel = panelById.get(s.panel_id);
        return {
          Project: project.code,
          Set: `Set ${setById.get(s.set_id) ?? ""}`,
          Panel: panel?.name ?? "",
          "Part Number": panel?.part_number ?? "",
          Stage: STAGE_LABEL[s.stage],
          Status: STATUS_LABEL[s.status],
          "Updated By": lastBy.get(`${s.panel_id}|${setById.get(s.set_id)}|${s.stage}`) ?? "",
          Date: formatDate(s.updated_at),
          Time: formatTime(s.updated_at),
        };
      }),
    },
    {
      name: "Production History",
      rows: (history ?? []).map((h) => ({
        Date: formatDate(h.changed_at),
        Time: formatTime(h.changed_at),
        User: h.changed_by_name ?? "",
        Project: project.code,
        Set: `Set ${h.set_number}`,
        Panel: h.panel_name,
        Stage: STAGE_LABEL[h.stage],
        "Old Status": h.old_status ? STATUS_LABEL[h.old_status] : "",
        "New Status": STATUS_LABEL[h.new_status],
      })),
    },
  ];

  downloadWorkbook(
    sheets,
    `${project.code}-production-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
  await logAudit("Excel Export", `Exported project ${project.code}`, projectId);
}

/** Export whatever rows a table view is currently showing. */
export async function exportCurrentView(
  name: string,
  rows: Record<string, unknown>[],
  auditDescription: string,
) {
  downloadWorkbook([{ name, rows }], `${name.toLowerCase().replace(/\s+/g, "-")}.xlsx`);
  await logAudit("Excel Export", auditDescription);
}
