import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { ProgressBar, StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  STAGES,
  STAGE_LABEL,
  STAGE_SHORT,
  STATUSES,
  STATUS_LABEL,
  formatDateTime,
} from "@/lib/domain";
import { exportProjectWorkbook } from "@/lib/excel";
import {
  usePanelStages,
  usePanels,
  useProductionStatus,
  useProject,
  useProjectProgress,
  useSets,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/projects/$projectId/production")({
  head: () => ({
    meta: [
      { title: "Production Dashboard — Production Tracker" },
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

  const [setId, setSetId] = useState<string | null>(null);
  const activeSetId = setId ?? sets?.[0]?.id ?? null;
  const { data: rows, isLoading } = useProductionStatus(projectId, activeSetId);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Cell | null>(null);
  const [nextStatus, setNextStatus] = useState("pending");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const archived = project?.status === "archived";
  const canUpdate = !archived;

  const activePanels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (panels ?? [])
      .filter((p) => p.is_active)
      .filter(
        (p) => !q || p.name.toLowerCase().includes(q) || p.part_number.toLowerCase().includes(q),
      );
  }, [panels, search]);

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
    if (!canUpdate) {
      toast.error("You do not have permission to update production status.");
      return;
    }
    setSelected(cell);
    setNextStatus(cell.status);
  }

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("production_status")
      .update({ status: nextStatus as never })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      toast.error("You do not have permission to update this stage.");
      return;
    }
    await logAudit(
      "Update Production Status",
      `${selected.panelName} · ${STAGE_LABEL[selected.stage]} → ${STATUS_LABEL[nextStatus]}`,
      projectId,
    );
    await queryClient.invalidateQueries();
    toast.success("Status saved.");
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
                  Set {s.set_number}
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
        <Skeleton className="mt-4 h-80 rounded-3xl" />
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
                        const dim = statusFilter !== "all" && cell && cell.status !== statusFilter;
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
                              className={`w-full rounded-lg px-1 py-1 transition hover:brightness-105 ${
                                dim ? "opacity-25" : ""
                              }`}
                            >
                              <StatusBadge status={cell.status} compact />
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
                        <StatusBadge status={cell.status} compact />
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

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update stage status</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.panelName} · ${STAGE_LABEL[selected.stage]}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={nextStatus} onValueChange={setNextStatus}>
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
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              Your name and the current date and time are recorded automatically. Last update:{" "}
              {selected ? formatDateTime(selected.updated_at) : "—"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" className="rounded-full" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button className="rounded-full" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Save Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
