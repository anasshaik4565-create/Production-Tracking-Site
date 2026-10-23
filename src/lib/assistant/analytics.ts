/**
 * Pure production-data calculations used by the Trio AI Assistant tools.
 * No network, no database: rows in, numbers out. The same business rules as the app:
 *  - completion % = Completed records / records that are not "Not Applicable"
 *  - pending work = Pending + WIP + Hold + Rework
 *  - weight deviation % = (actual − expected) / expected × 100, judged against the tolerance
 */
import { compareWeight, effectiveTolerance, type WeightVerdict } from "@/lib/weights";

export type PanelLite = {
  id: string;
  name: string;
  part_number: string;
  id_number: string | null;
  part_weight: number | string;
  weight_tolerance_pct: number | null;
  set_id: string | null;
  is_active: boolean;
  sequence: number;
};
export type SetLite = { id: string; set_number: number; is_active: boolean };
export type WeightRec = {
  panel_id: string;
  set_id: string;
  untrimmed_weight: number | string | null;
  final_weight: number | string | null;
};
export type StatusLite = {
  set_id: string;
  panel_id: string;
  stage: string;
  status: string;
  qc_status: string | null;
};

export const STATUS_KEYS = [
  "pending",
  "wip",
  "completed",
  "hold",
  "rework",
  "not_applicable",
] as const;
export const PENDING_WORK = ["pending", "wip", "hold", "rework"] as const;
export const QC_KEYS = ["qc_pending", "qc_approved", "not_ok"] as const;

export type StatusCounts = Record<(typeof STATUS_KEYS)[number], number>;

export function emptyCounts(): StatusCounts {
  return { pending: 0, wip: 0, completed: 0, hold: 0, rework: 0, not_applicable: 0 };
}

export function countByStatus(rows: Pick<StatusLite, "status">[]) {
  const counts = emptyCounts();
  for (const r of rows) {
    if (r.status in counts) counts[r.status as keyof StatusCounts] += 1;
  }
  const applicable = rows.length - counts.not_applicable;
  return {
    counts,
    total_records: rows.length,
    applicable_records: applicable,
    pending_work: PENDING_WORK.reduce((n, k) => n + counts[k], 0),
    /** null when there is nothing to measure (never shown as 0%). */
    completion_pct: applicable > 0 ? Math.round((100 * counts.completed) / applicable) : null,
  };
}

export function qcCounts(rows: Pick<StatusLite, "qc_status">[]) {
  const out = { qc_pending: 0, qc_approved: 0, not_ok: 0, no_qc_status: 0 };
  for (const r of rows) {
    if (r.qc_status && r.qc_status in out) out[r.qc_status as keyof typeof out] += 1;
    else out.no_qc_status += 1;
  }
  return out;
}

export function stageBacklog(rows: Pick<StatusLite, "stage" | "status">[]) {
  const map = new Map<string, StatusCounts>();
  for (const r of rows) {
    const c = map.get(r.stage) ?? emptyCounts();
    if (r.status in c) c[r.status as keyof StatusCounts] += 1;
    map.set(r.stage, c);
  }
  return Array.from(map, ([stage, c]) => ({
    stage,
    pending: c.pending,
    wip: c.wip,
    hold: c.hold,
    rework: c.rework,
    completed: c.completed,
    backlog: PENDING_WORK.reduce((n, k) => n + c[k], 0),
    applicable: c.pending + c.wip + c.hold + c.rework + c.completed,
  })).sort((a, b) => b.backlog - a.backlog || a.stage.localeCompare(b.stage));
}

export function perSet(rows: StatusLite[], sets: SetLite[], panels: PanelLite[]) {
  return sets
    .filter((s) => s.is_active)
    .sort((a, b) => a.set_number - b.set_number)
    .map((s) => {
      const inSet = rows.filter((r) => r.set_id === s.id);
      const summary = countByStatus(inSet);
      const panelIds = new Set(inSet.map((r) => r.panel_id));
      return {
        set_number: s.set_number,
        panels: panels.filter((p) => p.is_active && panelIds.has(p.id)).length,
        ...summary,
        qc: qcCounts(inSet),
      };
    });
}

export type WeightRow = {
  set_number: number;
  panel_id: string;
  panel: string;
  part_number: string;
  id_number: string | null;
  weight_type: "Untrimmed Weight" | "Final Weight";
  expected_kg: number | null;
  actual_kg: number | null;
  deviation_pct: number | null;
  tolerance_pct: number;
  verdict: WeightVerdict;
};

/** One row per active panel × set it is produced in × weight type. */
export function weightRows(
  panels: PanelLite[],
  sets: SetLite[],
  weights: WeightRec[],
  projectTolerance: number | string | null | undefined,
): WeightRow[] {
  const activeSets = sets.filter((s) => s.is_active);
  const setById = new Map(sets.map((s) => [s.id, s]));
  const out: WeightRow[] = [];
  for (const p of panels.filter((x) => x.is_active)) {
    const targets = p.set_id ? ([setById.get(p.set_id)].filter(Boolean) as SetLite[]) : activeSets;
    for (const s of targets) {
      const rec = weights.find((w) => w.panel_id === p.id && w.set_id === s.id);
      const tol = effectiveTolerance(p.weight_tolerance_pct, projectTolerance);
      for (const [type, actual] of [
        ["Untrimmed Weight", rec?.untrimmed_weight ?? null],
        ["Final Weight", rec?.final_weight ?? null],
      ] as const) {
        const c = compareWeight(p.part_weight, actual, tol);
        out.push({
          set_number: s.set_number,
          panel_id: p.id,
          panel: p.name,
          part_number: p.part_number,
          id_number: p.id_number,
          weight_type: type,
          expected_kg: c.expected,
          actual_kg: c.actual,
          deviation_pct: c.deviationPct,
          tolerance_pct: tol,
          verdict: c.verdict,
        });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.set_number - b.set_number ||
      a.panel.localeCompare(b.panel) ||
      a.weight_type.localeCompare(b.weight_type),
  );
}

export function weightSummary(rows: WeightRow[]) {
  const make = () => ({ ok: 0, over: 0, under: 0, not_recorded: 0, invalid_reference: 0 });
  const out = { untrimmed: make(), final: make() };
  for (const r of rows) {
    const bucket = r.weight_type === "Untrimmed Weight" ? out.untrimmed : out.final;
    bucket[r.verdict] += 1;
  }
  return out;
}

/** Company time zone (India Standard Time, no daylight saving). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function fmtIST(input: Date | string | number): string {
  const d = new Date(input);
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)} IST`;
}

export function startOfDayIST(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

export type Period = "today" | "yesterday" | "last_7_days" | "last_30_days";
export function periodRange(period: Period, now: Date): { from: Date; to: Date } {
  const sod = startOfDayIST(now);
  switch (period) {
    case "today":
      return { from: sod, to: now };
    case "yesterday":
      return { from: new Date(sod.getTime() - 86400000), to: sod };
    case "last_7_days":
      return { from: new Date(now.getTime() - 7 * 86400000), to: now };
    default:
      return { from: new Date(now.getTime() - 30 * 86400000), to: now };
  }
}
