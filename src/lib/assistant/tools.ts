/**
 * Read-only data tools for the Trio AI Assistant.
 *
 * Every tool is a fixed, parameterised query. The model can only choose a tool and fill in
 * validated parameters: it cannot run SQL, cannot write, and cannot reach any other table.
 * All queries run with the signed-in user's own session, so database Row Level Security applies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  PENDING_WORK,
  countByStatus,
  fmtIST,
  perSet,
  periodRange,
  qcCounts,
  stageBacklog,
  weightRows,
  weightSummary,
  type PanelLite,
  type Period,
  type SetLite,
  type StatusLite,
  type WeightRec,
} from "@/lib/assistant/analytics";

export type Db = SupabaseClient<Database>;
export type ToolContext = { db: Db; now: Date };
export type ToolOutcome = { data: unknown; label: string };

export class ToolInputError extends Error {}

const STAGES = [
  "lamination",
  "demould",
  "trimming",
  "detailing",
  "assembly",
  "bracket_bonding",
  "panel_to_panel_bonding",
  "gelcoat_sanding",
  "primer_spray",
  "primer_sanding",
  "painting",
  "clear_coat",
  "post_operations",
  "post_operations_qc",
  "foam_placement",
  "packing",
  "palletization",
] as const;
const STATUSES = ["pending", "wip", "completed", "hold", "rework", "not_applicable"] as const;
const QC = ["qc_pending", "qc_approved", "not_ok"] as const;
const VERDICTS = ["ok", "over", "under", "not_recorded", "invalid_reference"] as const;
const PERIODS = ["today", "yesterday", "last_7_days", "last_30_days"] as const;

const PAGE = 1000;
const MAX_ROWS = 20000;

// ---------- input validation ----------
function optString(x: unknown, name: string, max = 80): string | undefined {
  if (x === undefined || x === null || x === "") return undefined;
  if (typeof x !== "string") throw new ToolInputError(`${name} must be text.`);
  const t = x.trim();
  if (t.length > max) throw new ToolInputError(`${name} is too long.`);
  return t || undefined;
}
function optInt(x: unknown, name: string, min: number, max: number): number | undefined {
  if (x === undefined || x === null || x === "") return undefined;
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ToolInputError(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}
function optEnum<T extends string>(x: unknown, name: string, allowed: readonly T[]): T | undefined {
  if (x === undefined || x === null || x === "") return undefined;
  if (typeof x !== "string" || !(allowed as readonly string[]).includes(x))
    throw new ToolInputError(`${name} must be one of: ${allowed.join(", ")}.`);
  return x as T;
}
function optBool(x: unknown, name: string): boolean | undefined {
  if (x === undefined || x === null) return undefined;
  if (typeof x !== "boolean") throw new ToolInputError(`${name} must be true or false.`);
  return x;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------- database helpers ----------
async function fetchAll<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  country: string;
  process: string;
  weight_tolerance_pct: number;
  set_count: number;
  updated_at: string;
};
const PROJECT_COLS =
  "id,code,name,status,country,process,weight_tolerance_pct,set_count,updated_at";

async function allProjects(db: Db): Promise<ProjectRow[]> {
  const { data, error } = await db.from("projects").select(PROJECT_COLS).order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectRow[];
}

async function resolveProject(
  db: Db,
  ref: string | undefined,
): Promise<{ project?: ProjectRow | undefined; error?: string | undefined }> {
  const projects = await allProjects(db);
  if (!ref) return { error: "A project code or name is required." };
  const q = norm(ref);
  const exact = projects.filter((p) => norm(p.code) === q);
  if (exact.length === 1) return { project: exact[0] };
  const partial = projects.filter((p) => norm(p.code).includes(q) || norm(p.name).includes(q));
  if (partial.length === 1) return { project: partial[0] };
  const list = (partial.length ? partial : projects)
    .slice(0, 15)
    .map((p) => `${p.code} (${p.name})`);
  return {
    error: partial.length
      ? `More than one project matches "${ref}": ${list.join("; ")}. Ask which one is meant.`
      : `No project matches "${ref}". Known projects: ${list.join("; ") || "none"}.`,
  };
}

async function loadProjectData(db: Db, projectId: string) {
  const [sets, panels, status, weights] = await Promise.all([
    db.from("production_sets").select("id,set_number,is_active").eq("project_id", projectId),
    db
      .from("panels")
      .select(
        "id,name,part_number,id_number,part_weight,weight_tolerance_pct,set_id,is_active,sequence",
      )
      .eq("project_id", projectId),
    fetchAll<StatusLite & { id: string; updated_at: string; remarks: string | null }>(
      (from, to) =>
        db
          .from("production_status")
          .select("id,set_id,panel_id,stage,status,qc_status,remarks,updated_at")
          .eq("project_id", projectId)
          .order("id")
          .range(from, to) as never,
    ),
    db
      .from("panel_weights")
      .select("panel_id,set_id,untrimmed_weight,final_weight")
      .eq("project_id", projectId),
  ]);
  for (const r of [sets, panels, weights]) if (r.error) throw new Error(r.error.message);
  const panelList = (panels.data ?? []) as PanelLite[];
  const activePanelIds = new Set(panelList.filter((p) => p.is_active).map((p) => p.id));
  return {
    sets: (sets.data ?? []) as SetLite[],
    panels: panelList,
    // Production records of deactivated panels are not part of live production figures.
    status: status.rows.filter((r) => activePanelIds.has(r.panel_id)),
    weights: (weights.data ?? []) as WeightRec[],
    truncated: status.truncated,
  };
}

const setLabel = (n: number | null | undefined) =>
  n === null || n === undefined ? "All sets" : `Set ${String(n).padStart(2, "0")}`;

// ---------- tools ----------
type Tool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
};

const projectProp = {
  type: "string",
  description: "Project code (for example RFQ-464) or part of the project name.",
};

export const TOOLS: Tool[] = [
  {
    name: "list_projects",
    description:
      "List projects with their status, number of sets and active panels, and overall completion %. Use for overviews and for comparing progress across projects.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "on_hold", "completed", "archived"],
          description: "Optional project status filter.",
        },
      },
    },
    run: async (input, { db, now }) => {
      const status = optEnum(input["status"], "status", [
        "active",
        "on_hold",
        "completed",
        "archived",
      ] as const);
      let projects = await allProjects(db);
      if (status) projects = projects.filter((p) => p.status === status);
      projects = projects.slice(0, 50);
      const out = [];
      for (const p of projects) {
        const d = await loadProjectData(db, p.id);
        const s = countByStatus(d.status);
        out.push({
          code: p.code,
          name: p.name,
          status: p.status,
          sets: d.sets.filter((x) => x.is_active).length,
          active_panels: d.panels.filter((x) => x.is_active).length,
          completed_records: s.counts.completed,
          applicable_records: s.applicable_records,
          completion_pct: s.completion_pct,
          pending_work_records: s.pending_work,
        });
      }
      return { label: "Project list", data: { as_of: fmtIST(now), projects: out } };
    },
  },
  {
    name: "project_summary",
    description:
      "Full production summary of ONE project: totals, completion %, status counts, QC counts, per-set progress, stage backlog, weight check counts, latest remarks and last update time.",
    input_schema: { type: "object", properties: { project: projectProp }, required: ["project"] },
    run: async (input, { db, now }) => {
      const r = await resolveProject(db, optString(input["project"], "project"));
      if (!r.project) return { label: "Project summary", data: { error: r.error } };
      const p = r.project;
      const d = await loadProjectData(db, p.id);
      const overall = countByStatus(d.status);
      const wr = weightRows(d.panels, d.sets, d.weights, p.weight_tolerance_pct);
      const { data: hist } = await db
        .from("production_history")
        .select("panel_name,set_number,stage,new_status,new_qc_status,remarks,changed_at")
        .eq("project_id", p.id)
        .not("remarks", "is", null)
        .order("changed_at", { ascending: false })
        .limit(5);
      const lastUpdate =
        d.status
          .map((x) => x.updated_at)
          .sort()
          .at(-1) ?? null;
      return {
        label: `Project summary (${p.code})`,
        data: {
          as_of: fmtIST(now),
          project: {
            code: p.code,
            name: p.name,
            status: p.status,
            country: p.country,
            process: p.process,
          },
          active_sets: d.sets.filter((s) => s.is_active).length,
          active_panels: d.panels.filter((x) => x.is_active).length,
          overall,
          qc: qcCounts(d.status),
          by_set: perSet(d.status, d.sets, d.panels),
          stage_backlog: stageBacklog(d.status.filter((x) => x.status !== "not_applicable")).slice(
            0,
            8,
          ),
          weight_checks: weightSummary(wr),
          weight_tolerance_pct: p.weight_tolerance_pct,
          latest_remarks: (hist ?? []).map((h) => ({
            panel: h.panel_name,
            set: setLabel(h.set_number),
            stage: h.stage,
            status: h.new_status,
            qc_status: h.new_qc_status,
            remark: h.remarks,
            at: fmtIST(h.changed_at),
          })),
          last_production_update: lastUpdate ? fmtIST(lastUpdate) : null,
          data_truncated: d.truncated,
        },
      };
    },
  },
  {
    name: "query_production_records",
    description:
      "List individual production records (one per panel, set and stage) with filters, plus the total match count. Use for questions like 'which panels are pending for painting', 'panels on hold', 'QC Pending', 'Not OK', 'rework'. Set pending_work=true for all unfinished work (Pending, WIP, Hold, Rework).",
    input_schema: {
      type: "object",
      properties: {
        project: projectProp,
        set_number: { type: "integer", description: "Set number, e.g. 5 for Set 05." },
        stage: { type: "string", enum: [...STAGES] },
        status: { type: "string", enum: [...STATUSES] },
        qc_status: { type: "string", enum: [...QC] },
        pending_work: {
          type: "boolean",
          description: "true = status is Pending, WIP, Hold or Rework.",
        },
        has_remarks: { type: "boolean" },
        limit: { type: "integer", description: "Rows to return, 1-50 (default 30)." },
      },
      required: ["project"],
    },
    run: async (input, { db, now }) => {
      const r = await resolveProject(db, optString(input["project"], "project"));
      if (!r.project) return { label: "Production records", data: { error: r.error } };
      const setNumber = optInt(input["set_number"], "set_number", 1, 9999);
      const stage = optEnum(input["stage"], "stage", STAGES);
      const status = optEnum(input["status"], "status", STATUSES);
      const qc = optEnum(input["qc_status"], "qc_status", QC);
      const pendingWork = optBool(input["pending_work"], "pending_work");
      const hasRemarks = optBool(input["has_remarks"], "has_remarks");
      const limit = optInt(input["limit"], "limit", 1, 50) ?? 30;

      let q = db
        .from("production_status")
        .select(
          "stage,status,qc_status,remarks,updated_at,panels!inner(name,part_number,id_number,is_active),production_sets!inner(set_number)",
          { count: "exact" },
        )
        .eq("project_id", r.project.id)
        .eq("panels.is_active", true);
      if (setNumber !== undefined) q = q.eq("production_sets.set_number", setNumber);
      if (stage) q = q.eq("stage", stage);
      if (status) q = q.eq("status", status);
      else if (pendingWork) q = q.in("status", [...PENDING_WORK]);
      else q = q.neq("status", "not_applicable");
      if (qc) q = q.eq("qc_status", qc);
      if (hasRemarks) q = q.not("remarks", "is", null);
      const { data, count, error } = await q.order("updated_at", { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);
      type Row = {
        stage: string;
        status: string;
        qc_status: string | null;
        remarks: string | null;
        updated_at: string;
        panels: { name: string; part_number: string; id_number: string | null };
        production_sets: { set_number: number };
      };
      const rows = ((data ?? []) as unknown as Row[])
        .map((x) => ({
          set: setLabel(x.production_sets.set_number),
          panel: x.panels.name,
          part_number: x.panels.part_number,
          id_number: x.panels.id_number,
          stage: x.stage,
          status: x.status,
          qc_status: x.qc_status,
          latest_remark: x.remarks,
          updated_at: fmtIST(x.updated_at),
        }))
        .sort((a, b) => a.set.localeCompare(b.set) || a.panel.localeCompare(b.panel));
      return {
        label: `Production records (${r.project.code})`,
        data: {
          as_of: fmtIST(now),
          project: r.project.code,
          filters: {
            set_number: setNumber ?? null,
            stage: stage ?? null,
            status: status ?? null,
            qc_status: qc ?? null,
            pending_work: pendingWork ?? false,
            has_remarks: hasRemarks ?? false,
          },
          total_matching: count ?? rows.length,
          returned: rows.length,
          note:
            (count ?? 0) > rows.length
              ? "Showing the most recently updated records only."
              : undefined,
          records: rows,
        },
      };
    },
  },
  {
    name: "stage_backlog",
    description:
      "Counts of Pending, WIP, Hold, Rework and Completed records for each production stage, ranked by backlog (unfinished records). For one project or across all projects.",
    input_schema: {
      type: "object",
      properties: { project: { ...projectProp, description: "Optional. Omit for all projects." } },
    },
    run: async (input, { db, now }) => {
      const ref = optString(input["project"], "project");
      let projectFilter: ProjectRow | undefined;
      if (ref) {
        const r = await resolveProject(db, ref);
        if (!r.project) return { label: "Stage backlog", data: { error: r.error } };
        projectFilter = r.project;
      }
      const { rows, truncated } = await fetchAll<{
        stage: string;
        status: string;
        panels: { is_active: boolean };
      }>((from, to) => {
        let q = db
          .from("production_status")
          .select("stage,status,panels!inner(is_active)")
          .eq("panels.is_active", true)
          .neq("status", "not_applicable");
        if (projectFilter) q = q.eq("project_id", projectFilter.id);
        return q.order("id").range(from, to) as never;
      });
      return {
        label: projectFilter
          ? `Stage backlog (${projectFilter.code})`
          : "Stage backlog (all projects)",
        data: {
          as_of: fmtIST(now),
          scope: projectFilter?.code ?? "all projects",
          records_counted: rows.length,
          data_truncated: truncated,
          stages: stageBacklog(rows),
        },
      };
    },
  },
  {
    name: "weight_analysis",
    description:
      "Untrimmed and final weight checks against the expected Part Weight and the tolerance. Returns counts (within tolerance / overweight / underweight / not recorded) and a list of panels, optionally filtered by verdict or set.",
    input_schema: {
      type: "object",
      properties: {
        project: projectProp,
        set_number: { type: "integer" },
        verdict: { type: "string", enum: [...VERDICTS], description: "ok = within tolerance." },
        limit: { type: "integer", description: "Rows to return, 1-50 (default 30)." },
      },
      required: ["project"],
    },
    run: async (input, { db, now }) => {
      const r = await resolveProject(db, optString(input["project"], "project"));
      if (!r.project) return { label: "Weight analysis", data: { error: r.error } };
      const setNumber = optInt(input["set_number"], "set_number", 1, 9999);
      const verdict = optEnum(input["verdict"], "verdict", VERDICTS);
      const limit = optInt(input["limit"], "limit", 1, 50) ?? 30;
      const d = await loadProjectData(db, r.project.id);
      let rows = weightRows(d.panels, d.sets, d.weights, r.project.weight_tolerance_pct);
      if (setNumber !== undefined) rows = rows.filter((x) => x.set_number === setNumber);
      const summary = weightSummary(rows);
      let list = verdict
        ? rows.filter((x) => x.verdict === verdict)
        : rows.filter((x) => x.verdict === "over" || x.verdict === "under");
      list = [...list].sort(
        (a, b) => Math.abs(b.deviation_pct ?? 0) - Math.abs(a.deviation_pct ?? 0),
      );
      return {
        label: `Weight analysis (${r.project.code})`,
        data: {
          as_of: fmtIST(now),
          project: r.project.code,
          project_tolerance_pct: r.project.weight_tolerance_pct,
          set: setNumber ? setLabel(setNumber) : "all sets",
          summary,
          listed: verdict ?? "over and under (outside tolerance)",
          total_listed: list.length,
          rows: list.slice(0, limit).map((x) => ({
            ...x,
            set: setLabel(x.set_number),
            panel_id: undefined,
            set_number: undefined,
          })),
        },
      };
    },
  },
  {
    name: "recent_activity",
    description:
      "Recorded production updates (status, QC and remarks) from the history log for a period, newest first, with counts. Use for 'today's updates' and 'latest remarks'. Times are India Standard Time.",
    input_schema: {
      type: "object",
      properties: {
        project: { ...projectProp, description: "Optional. Omit for all projects." },
        period: { type: "string", enum: [...PERIODS], description: "Default today." },
        with_remarks_only: { type: "boolean" },
        limit: { type: "integer", description: "Rows to return, 1-40 (default 20)." },
      },
    },
    run: async (input, { db, now }) => {
      const ref = optString(input["project"], "project");
      let project: ProjectRow | undefined;
      if (ref) {
        const r = await resolveProject(db, ref);
        if (!r.project) return { label: "Recent activity", data: { error: r.error } };
        project = r.project;
      }
      const period = (optEnum(input["period"], "period", PERIODS) ?? "today") as Period;
      const withRemarks = optBool(input["with_remarks_only"], "with_remarks_only") ?? false;
      const limit = optInt(input["limit"], "limit", 1, 40) ?? 20;
      const { from, to } = periodRange(period, now);
      let q = db
        .from("production_history")
        .select(
          "project_id,set_number,panel_name,stage,old_status,new_status,old_qc_status,new_qc_status,remarks,changed_by_name,changed_at",
          { count: "exact" },
        )
        .gte("changed_at", from.toISOString())
        .lte("changed_at", to.toISOString());
      if (project) q = q.eq("project_id", project.id);
      if (withRemarks) q = q.not("remarks", "is", null);
      const { data, count, error } = await q.order("changed_at", { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);
      const codes = new Map((await allProjects(db)).map((p) => [p.id, p.code]));
      const rows = data ?? [];
      const byStatus: Record<string, number> = {};
      for (const h of rows) byStatus[h.new_status] = (byStatus[h.new_status] ?? 0) + 1;
      return {
        label: `Recent activity (${period.replace(/_/g, " ")})`,
        data: {
          as_of: fmtIST(now),
          period,
          from: fmtIST(from),
          to: fmtIST(to),
          scope: project?.code ?? "all projects",
          total_updates_in_period: count ?? rows.length,
          returned: rows.length,
          counts_by_new_status_in_returned_rows: byStatus,
          updates: rows.map((h) => ({
            project: codes.get(h.project_id) ?? null,
            set: setLabel(h.set_number),
            panel: h.panel_name,
            stage: h.stage,
            status_change:
              h.old_status && h.old_status !== h.new_status
                ? `${h.old_status} → ${h.new_status}`
                : h.new_status,
            qc_status: h.new_qc_status,
            remark: h.remarks,
            by: h.changed_by_name || null,
            at: fmtIST(h.changed_at),
          })),
        },
      };
    },
  },
  {
    name: "find_panel",
    description:
      "Look up panels by name, part number or ID Number within a project and show their stage statuses, QC status, remarks and weights per set.",
    input_schema: {
      type: "object",
      properties: {
        project: projectProp,
        query: {
          type: "string",
          description: "Panel name, part number or ID Number (partial match).",
        },
      },
      required: ["project", "query"],
    },
    run: async (input, { db, now }) => {
      const r = await resolveProject(db, optString(input["project"], "project"));
      if (!r.project) return { label: "Panel lookup", data: { error: r.error } };
      const query = optString(input["query"], "query", 60);
      if (!query) throw new ToolInputError("query is required.");
      const d = await loadProjectData(db, r.project.id);
      const nq = norm(query);
      const matches = d.panels
        .filter(
          (p) =>
            p.is_active &&
            (norm(p.name).includes(nq) ||
              norm(p.part_number).includes(nq) ||
              norm(p.id_number ?? "").includes(nq)),
        )
        .slice(0, 5);
      const wr = weightRows(matches, d.sets, d.weights, r.project.weight_tolerance_pct);
      return {
        label: `Panel lookup (${r.project.code})`,
        data: {
          as_of: fmtIST(now),
          project: r.project.code,
          matches: matches.map((p) => ({
            panel: p.name,
            part_number: p.part_number,
            id_number: p.id_number,
            expected_weight_kg: Number(p.part_weight),
            sets: d.sets
              .filter(
                (s) =>
                  s.is_active && d.status.some((x) => x.panel_id === p.id && x.set_id === s.id),
              )
              .sort((a, b) => a.set_number - b.set_number)
              .map((s) => ({
                set: setLabel(s.set_number),
                stages: d.status
                  .filter((x) => x.panel_id === p.id && x.set_id === s.id)
                  .map((x) => ({
                    stage: x.stage,
                    status: x.status,
                    qc_status: x.qc_status,
                    latest_remark: x.remarks,
                    updated_at: fmtIST(x.updated_at),
                  })),
                weights: wr
                  .filter((w) => w.panel_id === p.id && w.set_number === s.set_number)
                  .map((w) => ({
                    type: w.weight_type,
                    actual_kg: w.actual_kg,
                    deviation_pct: w.deviation_pct,
                    verdict: w.verdict,
                  })),
              })),
          })),
          note: matches.length === 0 ? "No panel matched." : undefined,
        },
      };
    },
  },
  {
    name: "compare_projects",
    description:
      "Side-by-side progress of several projects: completion %, record counts by status and QC counts. Provide project codes, or omit for the most recently updated projects (max 10).",
    input_schema: {
      type: "object",
      properties: {
        projects: {
          type: "array",
          items: { type: "string" },
          description: "Project codes or names (max 10).",
        },
      },
    },
    run: async (input, { db, now }) => {
      const refs = Array.isArray(input["projects"])
        ? (input["projects"]
            .slice(0, 10)
            .map((x) => optString(x, "projects", 80))
            .filter(Boolean) as string[])
        : [];
      let selected: ProjectRow[] = [];
      if (refs.length) {
        for (const ref of refs) {
          const r = await resolveProject(db, ref);
          if (r.project) selected.push(r.project);
          else return { label: "Project comparison", data: { error: r.error } };
        }
      } else {
        selected = (await allProjects(db))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, 10);
      }
      const rows = [];
      for (const p of selected) {
        const d = await loadProjectData(db, p.id);
        const s = countByStatus(d.status);
        rows.push({
          code: p.code,
          name: p.name,
          status: p.status,
          active_panels: d.panels.filter((x) => x.is_active).length,
          completion_pct: s.completion_pct,
          ...s.counts,
          qc: qcCounts(d.status),
        });
      }
      return { label: "Project comparison", data: { as_of: fmtIST(now), projects: rows } };
    },
  },
];

export const TOOL_DEFINITIONS = TOOLS.map(({ name, description, input_schema }) => ({
  name,
  description,
  input_schema,
}));

const MAX_RESULT_CHARS = 14000;

/** Run one tool by name. Never throws: problems come back as a result the model can explain. */
export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<{ content: string; isError: boolean; label: string }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool)
    return { content: JSON.stringify({ error: "Unknown tool." }), isError: true, label: name };
  try {
    const obj =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const out = await tool.run(obj, ctx);
    let text = JSON.stringify(out.data);
    if (text.length > MAX_RESULT_CHARS) {
      text = JSON.stringify({
        warning: "Result was too large and was cut. Ask a narrower question or use filters.",
        partial: text.slice(0, MAX_RESULT_CHARS),
      });
    }
    return { content: text, isError: false, label: out.label };
  } catch (e) {
    if (e instanceof ToolInputError) {
      return { content: JSON.stringify({ error: e.message }), isError: true, label: tool.name };
    }
    console.error(`[assistant] tool ${name} failed:`, (e as Error).message);
    return {
      content: JSON.stringify({ error: "The production data could not be read right now." }),
      isError: true,
      label: tool.name,
    };
  }
}
