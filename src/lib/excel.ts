import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { compareWeight, effectiveTolerance, formatDeviation, verdictLabel } from "@/lib/weights";
import {
  PROJECT_STATUS_LABEL,
  STAGE_LABEL,
  QC_STATUS_LABEL,
  STATUS_LABEL,
  countryLabel,
  formatDate,
  formatSet,
  formatTime,
} from "@/lib/domain";
import { logAudit } from "@/lib/audit";
import { buildStandardRows } from "@/lib/export-format";

export type SheetSpec = {
  name: string;
  rows: Record<string, unknown>[];
  /** Column order to use even when there are no rows. */
  columns?: string[];
  /** Excel number format per column (for example "0.00"). */
  numberFormats?: Record<string, string>;
};

/** Read every row of a query, page by page (the API returns at most 1000 rows per request). */
async function fetchAllRows<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = 50000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error("Unable to read production data. Please try again.");
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function downloadWorkbook(sheets: SheetSpec[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const rows = sheet.rows.length ? sheet.rows : [{ Info: "No data" }];
    const ws = XLSX.utils.json_to_sheet(
      rows,
      sheet.columns ? { header: sheet.columns } : undefined,
    );
    for (const [col, fmt] of Object.entries(sheet.numberFormats ?? {})) {
      const c = (sheet.columns ?? Object.keys(rows[0] ?? {})).indexOf(col);
      if (c < 0) continue;
      for (let r = 1; r <= sheet.rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === "n") cell.z = fmt;
      }
    }
    const widths = (sheet.columns ?? Object.keys(rows[0] ?? {})).map((key) => ({
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
  qcStatus?: string | null;
  panelId?: string | null;
};

/** Full project workbook: summary, sets, panels, production status, history. */
export async function exportProjectWorkbook(projectId: string, filters: ExportFilters = {}) {
  const [{ data: project }, { data: sets }, { data: panels }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    supabase.from("production_sets").select("*").eq("project_id", projectId).order("set_number"),
    supabase.from("panels").select("*").eq("project_id", projectId).order("sequence"),
  ]);
  if (!project) throw new Error("Unable to load project. Please try again.");

  // These tables can hold thousands of rows, so they are read page by page.
  const [stages, weightRows, allStatuses, history] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("panel_stages")
        .select("*")
        .eq("project_id", projectId)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("panel_weights")
        .select("*")
        .eq("project_id", projectId)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("production_status")
        .select("*")
        .eq("project_id", projectId)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("production_history")
          .select("*")
          .eq("project_id", projectId)
          .order("changed_at", { ascending: false })
          .order("id")
          .range(from, to),
      20000,
    ),
  ]);

  // Filters for the long-format sheets (the standard sheet applies the same filters itself).
  const statuses = allStatuses
    .filter((x) => !filters.setId || x.set_id === filters.setId)
    .filter((x) => !filters.panelId || x.panel_id === filters.panelId)
    .filter((x) => !filters.stage || x.stage === filters.stage)
    .filter((x) => !filters.status || x.status === filters.status)
    .filter((x) =>
      !filters.qcStatus
        ? true
        : filters.qcStatus === "none"
          ? !x.qc_status
          : x.qc_status === filters.qcStatus,
    );
  const historyRows = history.filter((h) => !filters.stage || h.stage === filters.stage);

  const { data: progress } = await supabase.rpc("get_project_progress", {
    p_project_id: projectId,
  });
  const overall = (progress as { overall?: number } | null)?.overall ?? 0;

  const setById = new Map((sets ?? []).map((s) => [s.id, s.set_number]));
  const panelById = new Map((panels ?? []).map((p) => [p.id, p]));
  // Latest recorded name per panel / set / stage, taken from the permanent history log.
  const lastBy = new Map<string, string>();
  for (const h of historyRows) {
    const key = `${h.panel_id}|${h.set_number}|${h.stage}`;
    if (!lastBy.has(key)) lastBy.set(key, h.changed_by_name ?? "");
  }

  const standard = buildStandardRows(
    {
      projectCode: project.code,
      projectTolerance: project.weight_tolerance_pct,
      sets: sets ?? [],
      panels: panels ?? [],
      panelStages: stages,
      statuses: allStatuses,
      weights: weightRows,
    },
    filters,
  );

  const sheets: SheetSpec[] = [
    {
      // One row per panel, one column per production stage: the standard layout for every export.
      name: "Production Tracking",
      rows: standard.rows,
      columns: standard.columns,
      numberFormats: {
        "Part Area": "0.00",
        "Expected Part Weight": "0.00",
        "Untrimmed Weight": "0.00",
        "Final Weight": "0.00",
        "Weight Difference": "0.00",
      },
    },
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
        Set: formatSet(s.set_number),
        Active: s.is_active ? "Yes" : "No",
        "Created Date": formatDate(s.created_at),
      })),
    },
    {
      name: "Panels",
      rows: (panels ?? []).map((p) => ({
        Sequence: p.sequence,
        Set: p.set_id ? formatSet(setById.get(p.set_id)) : "All sets",
        "Panel Name": p.name,
        "Part Number": p.part_number,
        "ID Number": p.id_number ?? "",
        "Part Area (m2)": Number(p.part_area),
        "Part Weight (kg)": Number(p.part_weight),
        "Weight Tolerance (±%)": effectiveTolerance(
          p.weight_tolerance_pct,
          project.weight_tolerance_pct,
        ),
        Active: p.is_active ? "Yes" : "No",
        "Applicable Stages": stages
          .filter((s) => s.panel_id === p.id && s.is_applicable)
          .sort((a, b) => a.sequence - b.sequence)
          .map((s) => STAGE_LABEL[s.stage])
          .join(", "),
      })),
    },
    {
      name: "Weights",
      rows: weightRows
        .filter((w) => !filters.setId || w.set_id === filters.setId)
        .filter((w) => !filters.panelId || w.panel_id === filters.panelId)
        .flatMap((w) => {
          const panel = panelById.get(w.panel_id);
          if (!panel) return [];
          const tol = effectiveTolerance(panel.weight_tolerance_pct, project.weight_tolerance_pct);
          return (
            [
              ["Untrimmed Weight", w.untrimmed_weight],
              ["Final Weight", w.final_weight],
            ] as const
          ).map(([type, actual]) => {
            const c = compareWeight(panel.part_weight, actual, tol);
            return {
              Project: project.code,
              Set: formatSet(setById.get(w.set_id)),
              Panel: panel.name,
              "Part Number": panel.part_number,
              "ID Number": panel.id_number ?? "",
              "Weight Type": type,
              "Expected Weight (kg)": c.expected ?? "",
              "Actual Weight (kg)": c.actual ?? "",
              "Deviation (%)": c.deviationPct === null ? "" : formatDeviation(c.deviationPct),
              "Tolerance (±%)": tol,
              Result: verdictLabel(c),
            };
          });
        }),
    },
    {
      name: "Production Status",
      rows: statuses.map((s) => {
        const panel = panelById.get(s.panel_id);
        return {
          Project: project.code,
          Set: formatSet(setById.get(s.set_id)),
          Panel: panel?.name ?? "",
          "Part Number": panel?.part_number ?? "",
          "ID Number": panel?.id_number ?? "",
          Stage: STAGE_LABEL[s.stage],
          Status: STATUS_LABEL[s.status],
          "QC Status": s.qc_status ? QC_STATUS_LABEL[s.qc_status] : "",
          "Latest Remark": s.remarks ?? "",
          "Updated By": lastBy.get(`${s.panel_id}|${setById.get(s.set_id)}|${s.stage}`) ?? "",
          Date: formatDate(s.updated_at),
          Time: formatTime(s.updated_at),
        };
      }),
    },
    {
      name: "Production History",
      rows: historyRows.map((h) => ({
        Date: formatDate(h.changed_at),
        Time: formatTime(h.changed_at),
        User: h.changed_by_name ?? "",
        Project: project.code,
        Set: formatSet(h.set_number),
        Panel: h.panel_name,
        Stage: STAGE_LABEL[h.stage],
        "Old Status": h.old_status ? STATUS_LABEL[h.old_status] : "",
        "New Status": STATUS_LABEL[h.new_status],
        "Old QC Status": h.old_qc_status ? QC_STATUS_LABEL[h.old_qc_status] : "",
        "New QC Status": h.new_qc_status ? QC_STATUS_LABEL[h.new_qc_status] : "",
        Remarks: h.remarks ?? "",
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
