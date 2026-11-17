/**
 * Standard "Production Tracking" export: ONE ROW PER PANEL (per set it is made in), with one
 * column per production stage. Pure functions (no network) so the format can be tested exactly.
 */
import { QC_STATUS_LABEL, STAGE_LABEL, STATUS_LABEL } from "@/lib/domain";
import { deriveColumnOrder, type PanelStageRow } from "@/lib/stages";
import {
  compareWeight,
  effectiveTolerance,
  formatDeviation,
  weightDifference,
} from "@/lib/weights";

export type ExPanel = {
  id: string;
  name: string;
  part_number: string;
  id_number: string | null;
  part_area: number | string;
  part_weight: number | string;
  weight_tolerance_pct: number | null;
  set_id: string | null;
  is_active: boolean;
  sequence: number;
};
export type ExSet = { id: string; set_number: number; is_active: boolean };
export type ExStatus = {
  panel_id: string;
  set_id: string;
  stage: string;
  status: string;
  qc_status: string | null;
  remarks: string | null;
  updated_at: string;
};
export type ExWeight = {
  panel_id: string;
  set_id: string;
  untrimmed_weight: number | string | null;
  final_weight: number | string | null;
};
export type ExStageRow = PanelStageRow;

export type StandardFilters = {
  setId?: string | null;
  panelId?: string | null;
  stage?: string | null;
  status?: string | null;
  qcStatus?: string | null;
};

export const FIXED_COLUMNS_BEFORE = [
  "Project",
  "Set",
  "Panel Name",
  "ID No",
  "Part Number",
  "Part Area",
  "Expected Part Weight",
] as const;
export const FIXED_COLUMNS_AFTER = [
  "QC Status",
  "Untrimmed Weight",
  "Final Weight",
  "Weight Difference",
  "Weight Deviation (%)",
  "Remarks",
] as const;

const NOT_ASSIGNED = "Not Applicable";
const QC_ORDER = ["not_ok", "qc_pending", "qc_approved"] as const; // worst first

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build the sheet. `columns` is the exact column order, `rows` has one entry per panel and set. */
export function buildStandardRows(
  input: {
    projectCode: string;
    projectTolerance: number | string | null | undefined;
    sets: ExSet[];
    panels: ExPanel[];
    panelStages: ExStageRow[];
    statuses: ExStatus[];
    weights: ExWeight[];
  },
  filters: StandardFilters = {},
): { columns: string[]; rows: Record<string, string | number>[] } {
  const activeSets = input.sets
    .filter((s) => s.is_active)
    .sort((a, b) => a.set_number - b.set_number);

  type Entry = { panel: ExPanel; set: ExSet };
  let entries: Entry[] = [];
  for (const set of activeSets) {
    for (const panel of input.panels) {
      if (!panel.is_active) continue;
      if (panel.set_id ? panel.set_id !== set.id : false) continue; // a panel made in one set only appears there
      entries.push({ panel, set });
    }
  }
  if (filters.setId) entries = entries.filter((e) => e.set.id === filters.setId);
  if (filters.panelId) entries = entries.filter((e) => e.panel.id === filters.panelId);

  const assigned = (panelId: string, stage: string) =>
    input.panelStages.some((r) => r.panel_id === panelId && r.stage === stage && r.is_applicable);
  if (filters.stage) entries = entries.filter((e) => assigned(e.panel.id, filters.stage as string));

  // Stage columns: every stage assigned to at least one exported panel, in the saved execution order.
  const idsShown = new Set(entries.map((e) => e.panel.id));
  const shownRows = input.panelStages.filter((r) => idsShown.has(r.panel_id));
  const used = new Set(shownRows.filter((r) => r.is_applicable).map((r) => r.stage));
  let stageColumns = deriveColumnOrder(shownRows).filter((s) => used.has(s));
  if (filters.stage) stageColumns = stageColumns.filter((s) => s === filters.stage);

  const recordsOf = (e: Entry) =>
    input.statuses.filter((x) => x.panel_id === e.panel.id && x.set_id === e.set.id);
  const stageCell = (e: Entry, stage: string): string => {
    if (!assigned(e.panel.id, stage)) return NOT_ASSIGNED; // not assigned (different from an assigned Pending)
    const rec = recordsOf(e).find((x) => x.stage === stage);
    return rec ? (STATUS_LABEL[rec.status] ?? rec.status) : STATUS_LABEL["pending"]!;
  };
  const qcSummary = (e: Entry): string | null => {
    const qcs = recordsOf(e)
      .map((x) => x.qc_status)
      .filter(Boolean) as string[];
    return QC_ORDER.find((q) => qcs.includes(q)) ?? null;
  };

  const columns = [
    ...FIXED_COLUMNS_BEFORE,
    ...stageColumns.map((s) => STAGE_LABEL[s] ?? s),
    ...FIXED_COLUMNS_AFTER,
  ] as string[];

  let out = entries.map((e) => {
    const weightRec = input.weights.find((w) => w.panel_id === e.panel.id && w.set_id === e.set.id);
    const tol = effectiveTolerance(e.panel.weight_tolerance_pct, input.projectTolerance);
    const finalW = weightRec?.final_weight ?? null;
    const cmp = compareWeight(e.panel.part_weight, finalW, tol);
    const diff = weightDifference(e.panel.part_weight, finalW);
    const qc = qcSummary(e);
    const withRemark = recordsOf(e)
      .filter((x) => x.remarks && x.remarks.trim())
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const row: Record<string, string | number> = {
      Project: input.projectCode,
      Set: String(e.set.set_number).padStart(2, "0"),
      "Panel Name": e.panel.name,
      "ID No": e.panel.id_number ?? "",
      "Part Number": e.panel.part_number,
      "Part Area": num(e.panel.part_area) ?? "",
      "Expected Part Weight": num(e.panel.part_weight) ?? "",
    };
    for (const s of stageColumns) row[STAGE_LABEL[s] ?? s] = stageCell(e, s);
    row["QC Status"] = qc ? QC_STATUS_LABEL[qc]! : "";
    row["Untrimmed Weight"] = num(weightRec?.untrimmed_weight) ?? "";
    row["Final Weight"] = num(finalW) ?? "";
    row["Weight Difference"] = diff === null ? "" : round2(diff);
    row["Weight Deviation (%)"] =
      cmp.verdict === "not_recorded"
        ? "Not Recorded"
        : cmp.verdict === "invalid_reference"
          ? "Unavailable"
          : formatDeviation(cmp.deviationPct);
    row["Remarks"] = withRemark
      ? `${STAGE_LABEL[withRemark.stage] ?? withRemark.stage}: ${withRemark.remarks!.trim()}`
      : "";
    return { e, row };
  });

  if (filters.status) {
    out = out.filter(({ e }) =>
      recordsOf(e).some(
        (x) => x.status === filters.status && (!filters.stage || x.stage === filters.stage),
      ),
    );
  }
  if (filters.qcStatus) {
    out = out.filter(({ e }) => {
      const recs = recordsOf(e).filter((x) => !filters.stage || x.stage === filters.stage);
      return filters.qcStatus === "none"
        ? recs.every((x) => !x.qc_status)
        : recs.some((x) => x.qc_status === filters.qcStatus);
    });
  }

  out.sort(
    (a, b) =>
      a.e.set.set_number - b.e.set.set_number ||
      a.e.panel.sequence - b.e.panel.sequence ||
      a.e.panel.name.localeCompare(b.e.panel.name) ||
      a.e.panel.id.localeCompare(b.e.panel.id),
  );
  return { columns, rows: out.map((x) => x.row) };
}
