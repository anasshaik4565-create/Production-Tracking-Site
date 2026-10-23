import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, History as HistoryIcon, Loader2, MessageSquare } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { ProgressBar, QcBadge, StatusBadge, WeightBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { useAccess } from "@/lib/access";
import { PanelWeightsCard } from "@/components/PanelWeightsCard";
import { compareWeight, effectiveTolerance, WEIGHT_STAGE } from "@/lib/weights";
import {
  QC_STATUSES,
  QC_STATUS_LABEL,
  STAGES,
  STAGE_LABEL,
  STAGE_SHORT,
  STATUSES,
  STATUS_LABEL,
  formatDateTime,
  formatSet,
} from "@/lib/domain";
import { exportProjectWorkbook } from "@/lib/excel";
import {
  usePanelStages,
  usePanelWeights,
  usePanels,
  useProductionStatus,
  useProject,
  useProjectProgress,
  useSets,
  useStageHistory,
} from "@/lib/queries";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/_authenticated/projects/$projectId/production")({
  head: () => ({
    meta: [
      { title: pageTitle("Production Dashboard") },
      {
        name: "description",
        content:
          "Update every panel and stage status per set, with automatic user and time stamps.",
      },
      { property: "og:title", content: "Production Dashboard — Production Tracker" },
      {
        property: "og:description",
        content:
          "Update every panel and stage status per set, with automatic user and time stamps.",
      },
    ],
  }),
  component: ProductionDashboard,
});

type Cell = {
  id: string;
  panelId: string;
  panelName: string;
  stage: string;
  status: string;
  qc_status: string | null;
  remarks: string | null;
  updated_at: string;
  updated_by: string | null;
};

function ProductionDashboard() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: project } = useProject(projectId);
  const { data: sets } = useSets(projectId);
  const { data: panels } = usePanels(projectId);
  const { data: stages } = usePanelStages(projectId);
  const { data: progress } = useProjectProgress(projectId);
  const { data: weights } = usePanelWeights(projectId);
  const { isAdmin } = useAccess();

  const [setId, setSetId] = useState<string | null>(null);
  const activeSetId = setId ?? sets?.[0]?.id ?? null;
  const { data: rows, isLoading } = useProductionStatus(projectId, activeSetId);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [qcFilter, setQcFilter] = useState("all");
  const [selected, setSelected] = useState<Cell | null>(null);
  const [nextStatus, setNextStatus] = useState("pending");
  const [nextQc, setNextQc] = useState("none");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [untrimmedInput, setUntrimmedInput] = useState("");
  const [finalInput, setFinalInput] = useState("");

  const archived = project?.status === "archived";
  const canUpdate = !archived && isAdmin;

  const activePanels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (panels ?? [])
      .filter((p) => p.is_active)
      .filter((p) => !p.set_id || p.set_id === activeSetId)
      .filter(
        (p) => !q || p.name.toLowerCase().includes(q) || p.part_number.toLowerCase().includes(q),
      );
  }, [panels, search, activeSetId]);

  const cellMap = useMemo(() => {
    const map = new Map<string, Cell>();
    for (const r of rows ?? []) {
      const panel = (panels ?? []).find((p) => p.id === r.panel_id);
      map.set(`${r.panel_id}-${r.stage}`, {
        id: r.id,
        panelId: r.panel_id,
        panelName: panel?.name ?? "",
        stage: r.stage,
        status: r.status,
        qc_status: r.qc_status,
        remarks: r.remarks,
        updated_at: r.updated_at,
        updated_by: r.updated_by,
      });
    }
    return map;
  }, [rows, panels]);

  const applicable = (panelId: string, stage: string) =>
    (stages ?? []).some((s) => s.panel_id === panelId && s.stage === stage && s.is_applicable);

  function openCell(cell: Cell | undefined) {
    if (!cell) return;
    const w = (weights ?? []).find((x) => x.panel_id === cell.panelId && x.set_id === activeSetId);
    setUntrimmedInput(w?.untrimmed_weight != null ? String(w.untrimmed_weight) : "");
    setFinalInput(w?.final_weight != null ? String(w.final_weight) : "");
    setSelected(cell);
    setNextStatus(cell.status);
    setNextQc(cell.qc_status ?? "none");
    setRemarks("");
  }

  const activeSetNumber = sets?.find((x) => x.id === activeSetId)?.set_number ?? null;
  const { data: stageHistory, isLoading: historyLoading } = useStageHistory(
    selected?.panelId ?? null,
    activeSetNumber,
    selected?.stage ?? null,
  );

  const selectedPanel = (panels ?? []).find((p) => p.id === selected?.panelId);
  const weightKind: "untrimmed" | "final" | null =
    selected?.stage === WEIGHT_STAGE.untrimmed
      ? "untrimmed"
      : selected?.stage === WEIGHT_STAGE.final
        ? "final"
        : null;
  const savedWeights = (weights ?? []).find(
    (x) => x.panel_id === selected?.panelId && x.set_id === activeSetId,
  );
  const weightInput = weightKind === "untrimmed" ? untrimmedInput : finalInput;
  const weightPreview = compareWeight(
    selectedPanel?.part_weight,
    weightInput.trim() === "" || !Number.isFinite(Number(weightInput)) ? null : Number(weightInput),
    effectiveTolerance(selectedPanel?.weight_tolerance_pct, project?.weight_tolerance_pct),
  );

  async function save() {
    if (!selected || saving || !canUpdate) return;
    // Weights are optional; only the weight that belongs to this stage is edited here.
    const typed = weightInput.trim();
    if (weightKind && typed !== "" && (!Number.isFinite(Number(typed)) || Number(typed) < 0)) {
      toast.error("Weight must be zero or a positive number.");
      return;
    }
    const prevU = savedWeights?.untrimmed_weight ?? null;
    const prevF = savedWeights?.final_weight ?? null;
    const nextU = weightKind === "untrimmed" ? (typed === "" ? null : Number(typed)) : prevU;
    const nextF = weightKind === "final" ? (typed === "" ? null : Number(typed)) : prevF;
    const weightsChanged = weightKind !== null && (nextU !== prevU || nextF !== prevF);
    const unchanged =
      nextStatus === selected.status &&
      (nextQc === "none" ? null : nextQc) === selected.qc_status &&
      !remarks.trim() &&
      !weightsChanged;
    if (unchanged) {
      toast.message("Nothing to save — change the status, QC status, weight or add a remark.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("save_stage_update", {
      p_id: selected.id,
      p_status: nextStatus,
      p_qc_status: nextQc === "none" ? null : nextQc,
      p_remarks: remarks.trim() || null,
      p_apply_weights: weightsChanged,
      p_untrimmed: nextU,
      p_final: nextF,
    });
    setSaving(false);
    if (error) {
      toast.error(
        error.message?.includes("archived")
          ? "This project is archived, so production can't be updated."
          : error.code === "42501"
            ? "Only Admin can update production."
            : "We couldn't save this update. Please try again.",
      );
      return;
    }
    const qcText = nextQc !== "none" ? ` · ${QC_STATUS_LABEL[nextQc]}` : "";
    const weightText = weightsChanged
      ? ` · ${weightKind === "untrimmed" ? "untrimmed" : "final"} weight ${typed === "" ? "cleared" : `${typed} kg`}`
      : "";
    await logAudit(
      "Update Production Status",
      `${selected.panelName} · ${STAGE_LABEL[selected.stage]} → ${STATUS_LABEL[nextStatus]}${qcText}${weightText}${
        remarks.trim() ? ` — ${remarks.trim()}` : ""
      }`,
      projectId,
    );
    await queryClient.invalidateQueries();
    toast.success("Update saved.");
    setSelected(null);
  }

  async function exportSet() {
    if (exporting) return;
    setExporting(true);
    const id = toast.loading("Preparing Excel workbook...");
    try {
      await exportProjectWorkbook(projectId, {
        setId: activeSetId,
        status: statusFilter === "all" ? null : statusFilter,
      });
      toast.success("Excel file downloaded.", { id });
    } catch {
      toast.error("We couldn't build the Excel file. Please try again.", { id });
    } finally {
      setExporting(false);
    }
  }

  const setProgress = progress?.sets?.find(
    (s) => s.set_number === sets?.find((x) => x.id === activeSetId)?.set_number,
  );

  return (
    <AppShell
      title="Production Dashboard"
      breadcrumb={`Production Tracker · ${project?.code ?? "Project"} · Production`}
      actions={
        <div className="flex gap-2">
          <Button asChild size="sm" variant="secondary" className="rounded-full">
            <Link to="/projects/$projectId" params={{ projectId }}>
              Overview
            </Link>
          </Button>
          {
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={exportSet}
              disabled={exporting}
            >
              <FileSpreadsheet className="mr-1 size-4" /> Export view
            </Button>
          }
        </div>
      }
    >
      <GlassPanel className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Select value={activeSetId ?? ""} onValueChange={setSetId}>
            <SelectTrigger className="lg:w-40">
              <SelectValue placeholder="Select set" />
            </SelectTrigger>
            <SelectContent>
              {(sets ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {formatSet(s.set_number)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search panel or part number"
            className="lg:max-w-xs"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="lg:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={qcFilter} onValueChange={setQcFilter}>
            <SelectTrigger className="lg:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All QC statuses</SelectItem>
              <SelectItem value="none">No QC status</SelectItem>
              {QC_STATUSES.map((q) => (
                <SelectItem key={q.value} value={q.value}>
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1 lg:max-w-xs">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Set progress</span>
              <span className="font-semibold">{setProgress?.progress ?? 0}%</span>
            </div>
            <ProgressBar value={setProgress?.progress ?? 0} className="mt-1 h-1.5" />
          </div>
        </div>
        {archived && (
          <p className="mt-3 text-xs text-muted-foreground">
            This project is archived — production updates are disabled.
          </p>
        )}
      </GlassPanel>

      {isLoading ? (
        <Skeleton className="mt-4 h-80 rounded-xl" />
      ) : (
        <>
          {/* Wide grid: desktop / tablet */}
          <GlassPanel className="mt-4 hidden md:block">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className="sticky left-0 z-30 min-w-52 border-b bg-card px-4 py-3 text-left font-semibold">
                      Panel
                    </th>
                    {STAGES.map((s) => (
                      <th
                        key={s.value}
                        title={s.label}
                        className="border-b bg-card px-2 py-3 text-center text-[11px] font-semibold whitespace-nowrap"
                      >
                        {STAGE_SHORT[s.value]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePanels.map((panel) => (
                    <tr key={panel.id} className="hover:bg-muted/40">
                      <th className="sticky left-0 z-10 border-b bg-card px-4 py-2 text-left align-middle font-medium">
                        <span className="block truncate">{panel.name}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {panel.part_number || "—"}
                        </span>
                      </th>
                      {STAGES.map((stage) => {
                        const cell = cellMap.get(`${panel.id}-${stage.value}`);
                        const isApplicable = applicable(panel.id, stage.value);
                        const dim =
                          !!cell &&
                          ((statusFilter !== "all" && cell.status !== statusFilter) ||
                            (qcFilter !== "all" &&
                              (qcFilter === "none"
                                ? !!cell.qc_status
                                : cell.qc_status !== qcFilter)));
                        if (!isApplicable || !cell) {
                          return (
                            <td key={stage.value} className="border-b px-1 py-2 text-center">
                              <span className="text-[10px] text-muted-foreground">N/A</span>
                            </td>
                          );
                        }
                        return (
                          <td key={stage.value} className="border-b px-1 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => openCell(cell)}
                              title={cell.remarks ? `Latest remark: ${cell.remarks}` : undefined}
                              className={`flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-1 transition hover:bg-accent ${
                                dim ? "opacity-25" : ""
                              }`}
                            >
                              <StatusBadge status={cell.status} compact />
                              {cell.qc_status && <QcBadge status={cell.qc_status} compact />}
                              {cell.remarks && (
                                <MessageSquare className="size-3 text-muted-foreground" />
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {activePanels.length === 0 && (
                    <tr>
                      <td
                        colSpan={STAGES.length + 1}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        No panels match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassPanel>

          {/* Panel cards: mobile */}
          <div className="mt-4 space-y-3 md:hidden">
            {activePanels.map((panel) => (
              <GlassPanel key={panel.id} className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-semibold">{panel.name}</p>
                  <span className="text-xs text-muted-foreground">{panel.part_number || "—"}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {STAGES.filter((s) => applicable(panel.id, s.value)).map((stage) => {
                    const cell = cellMap.get(`${panel.id}-${stage.value}`);
                    if (!cell) return null;
                    return (
                      <button
                        key={stage.value}
                        type="button"
                        onClick={() => openCell(cell)}
                        className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-left"
                      >
                        <span className="truncate text-xs">{stage.label}</span>
                        <span className="flex flex-col items-end gap-0.5">
                          <StatusBadge status={cell.status} compact />
                          {cell.qc_status && <QcBadge status={cell.qc_status} compact />}
                          {cell.remarks && (
                            <MessageSquare className="size-3 text-muted-foreground" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </GlassPanel>
            ))}
            {activePanels.length === 0 && (
              <GlassPanel className="p-8 text-center">
                <p className="text-sm text-muted-foreground">No panels match your search.</p>
              </GlassPanel>
            )}
          </div>
        </>
      )}

      {!isLoading && (
        <PanelWeightsCard
          projectId={projectId}
          setId={activeSetId}
          setNumber={activeSetNumber}
          panels={activePanels}
          projectTolerance={project?.weight_tolerance_pct}
          canEdit={canUpdate}
        />
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{canUpdate ? "Update panel status" : "Panel status"}</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.panelName} · ${formatSet(activeSetNumber)} · ${STAGE_LABEL[selected.stage]}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Production status</Label>
                <Select value={nextStatus} onValueChange={setNextStatus} disabled={!canUpdate}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>QC status</Label>
                <Select value={nextQc} onValueChange={setNextQc} disabled={!canUpdate}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No QC status</SelectItem>
                    {QC_STATUSES.map((q) => (
                      <SelectItem key={q.value} value={q.value}>
                        {q.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {weightKind && (
              <div className="space-y-1.5">
                <Label htmlFor="stage-weight">
                  {weightKind === "untrimmed" ? "Untrimmed weight (kg)" : "Final weight (kg)"}{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="stage-weight"
                    type="number"
                    min={0}
                    step="0.001"
                    inputMode="decimal"
                    className="w-40"
                    disabled={!canUpdate}
                    value={weightKind === "untrimmed" ? untrimmedInput : finalInput}
                    onChange={(e) =>
                      weightKind === "untrimmed"
                        ? setUntrimmedInput(e.target.value)
                        : setFinalInput(e.target.value)
                    }
                  />
                  <WeightBadge comparison={weightPreview} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Compared with the expected Part Weight (
                  {selectedPanel ? `${Number(selectedPanel.part_weight)} kg` : "—"}). You can save
                  without a weight.
                </p>
              </div>
            )}

            {canUpdate && (
              <div className="space-y-2">
                <Label htmlFor="remarks">
                  Remarks <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="e.g. Surface pinholes observed; rework required."
                />
              </div>
            )}

            {selected?.remarks && (
              <div className="rounded-lg border bg-muted/50 px-3 py-2.5">
                <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Latest remark
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{selected.remarks}</p>
              </div>
            )}

            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                <HistoryIcon className="size-3.5" /> Activity timeline
              </p>
              <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                {historyLoading && <li className="text-sm text-muted-foreground">Loading…</li>}
                {!historyLoading && (stageHistory ?? []).length === 0 && (
                  <li className="text-sm text-muted-foreground">No updates recorded yet.</li>
                )}
                {(stageHistory ?? []).map((h) => (
                  <li key={h.id} className="rounded-lg border px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {h.old_status && h.old_status !== h.new_status ? (
                        <>
                          <StatusBadge status={h.old_status} compact />
                          <span className="text-muted-foreground">→</span>
                        </>
                      ) : null}
                      <StatusBadge status={h.new_status} compact />
                      {h.new_qc_status !== h.old_qc_status &&
                        (h.new_qc_status ? (
                          <QcBadge status={h.new_qc_status} compact />
                        ) : h.old_qc_status ? (
                          <span className="text-xs text-muted-foreground">
                            {QC_STATUS_LABEL[h.old_qc_status]} cleared
                          </span>
                        ) : null)}
                    </div>
                    {h.remarks && <p className="mt-1 whitespace-pre-wrap">{h.remarks}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {h.changed_by_name || "System"} · {formatDateTime(h.changed_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              The date and time are recorded automatically. Last update:{" "}
              {selected ? formatDateTime(selected.updated_at) : "—"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              {canUpdate ? "Cancel" : "Close"}
            </Button>
            {canUpdate && (
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Save update
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
