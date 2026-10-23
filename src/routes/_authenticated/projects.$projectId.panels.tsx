import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers, Loader2, Plus, Save, Wand2 } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { useAccess } from "@/lib/access";
import { PanelExcelImport } from "@/components/PanelExcelImport";
import { STAGES, formatSet } from "@/lib/domain";
import type { ImportedPanel } from "@/lib/panel-import";
import { usePanelStages, usePanels, useProject, useSets } from "@/lib/queries";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/_authenticated/projects/$projectId/panels")({
  head: () => ({
    meta: [
      { title: pageTitle("Panel Configuration") },
      {
        name: "description",
        content: "Define panels, part details and the production stages that apply to each panel.",
      },
      { property: "og:title", content: "Panel Configuration — Production Tracker" },
      {
        property: "og:description",
        content: "Define panels, part details and the production stages that apply to each panel.",
      },
    ],
  }),
  component: PanelConfig,
});

function PanelConfig() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: project } = useProject(projectId);
  const { data: panels } = usePanels(projectId);
  const { data: stages } = usePanelStages(projectId);
  const { data: sets } = useSets(projectId);

  const { ready, isAdmin } = useAccess();
  const navigate = useNavigate();
  useEffect(() => {
    if (ready && !isAdmin) {
      toast.error("Only Admin can configure panels.");
      navigate({ to: "/projects/$projectId", params: { projectId }, replace: true });
    }
  }, [ready, isAdmin, navigate, projectId]);

  const [busy, setBusy] = useState<string | null>(null);
  const [masterStages, setMasterStages] = useState<string[] | null>(null);
  const [useForNew, setUseForNew] = useState(true);
  const [toleranceInput, setToleranceInput] = useState<string | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [newSetInput, setNewSetInput] = useState("");
  const [newPanel, setNewPanel] = useState({
    set_number: "",
    name: "",
    part_number: "",
    id_number: "",
    part_area: "",
    part_weight: "",
  });

  const archived = project?.status === "archived";
  const canEdit = !archived && isAdmin;

  function stageOf(panelId: string, stage: string) {
    return (stages ?? []).find((s) => s.panel_id === panelId && s.stage === stage);
  }

  type PanelPatch = {
    name?: string;
    part_number?: string;
    id_number?: string | null;
    weight_tolerance_pct?: number | null;
    part_area?: number;
    part_weight?: number;
    sequence?: number;
    is_active?: boolean;
  };

  async function savePanel(panelId: string, patch: PanelPatch, description: string) {
    setBusy(panelId);
    const { error } = await supabase.from("panels").update(patch).eq("id", panelId);
    setBusy(null);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "That ID Number is already used by another panel in this project."
          : "We couldn't save this change. Please try again.",
      );
      await queryClient.invalidateQueries({ queryKey: ["panels", projectId] });
      return;
    }
    await logAudit("Update Panel", description, projectId);
    await queryClient.invalidateQueries();
    toast.success("Panel updated.");
  }

  async function toggleStage(panelId: string, stage: string) {
    const existing = stageOf(panelId, stage);
    setBusy(`${panelId}-${stage}`);
    const seq = STAGES.findIndex((s) => s.value === stage) + 1;
    const { error } = existing
      ? await supabase
          .from("panel_stages")
          .update({ is_applicable: !existing.is_applicable })
          .eq("id", existing.id)
      : await supabase.from("panel_stages").insert({
          panel_id: panelId,
          project_id: projectId,
          stage: stage as never,
          is_applicable: true,
          sequence: seq,
        });
    setBusy(null);
    if (error) {
      toast.error("You do not have permission to change stage configuration.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["panel-stages", projectId] });
    toast.success("Stage configuration saved.");
  }

  const activeSets = sets ?? [];
  const existingIds = (panels ?? []).filter((p) => p.is_active).map((p) => p.id_number ?? "");
  const master = masterStages ?? project?.default_stages ?? STAGES.map((st) => st.value as string);
  const chosenSet =
    newPanel.set_number || (activeSets.length === 1 ? String(activeSets[0]!.set_number) : "");

  async function addPanel() {
    const name = newPanel.name.trim();
    const part = newPanel.part_number.trim();
    if (!name) {
      toast.error("Please enter a panel name.");
      return;
    }
    if (!chosenSet) {
      toast.error("Please choose the set this panel belongs to.");
      return;
    }
    if (!part) {
      toast.error("Please enter a part number.");
      return;
    }
    const idn = newPanel.id_number.trim();
    if (idn && existingIds.some((x) => x.trim().toLowerCase() === idn.toLowerCase())) {
      toast.error(`ID Number ${idn} already exists in this project.`);
      return;
    }
    setBusy("new");
    const { data, error } = await supabase.rpc("add_panels", {
      p_project_id: projectId,
      p_create_missing_sets: false,
      p_panels: [
        {
          name,
          set_number: Number(chosenSet),
          part_number: part,
          id_number: idn || null,
          part_area: newPanel.part_area === "" ? 0 : Number(newPanel.part_area),
          part_weight: newPanel.part_weight === "" ? 0 : Number(newPanel.part_weight),
        },
      ],
    });
    setBusy(null);
    if (error) {
      toast.error(
        error.code === "P0001" && error.message
          ? error.message
          : "We couldn't add the panel. Please try again.",
      );
      return;
    }
    const result = data as { records: number };
    await logAudit(
      "Add Panel",
      `Added panel ${name} (${part}) to ${formatSet(Number(chosenSet))}`,
      projectId,
    );
    setNewPanel({
      set_number: chosenSet,
      name: "",
      part_number: "",
      id_number: "",
      part_area: "",
      part_weight: "",
    });
    await queryClient.invalidateQueries();
    toast.success(`Panel added with ${result.records} production records.`);
  }

  async function importPanels(rows: ImportedPanel[]) {
    const { data, error } = await supabase.rpc("add_panels", {
      p_project_id: projectId,
      p_create_missing_sets: true,
      p_panels: rows.map((r) => ({
        name: r.name,
        set_number: r.set_number,
        part_number: r.part_number,
        id_number: r.id_number || null,
        part_area: r.part_area,
        part_weight: r.part_weight,
      })),
    });
    if (error) {
      // The whole import is one transaction, so nothing was saved.
      throw new Error(
        error.code === "P0001" && error.message
          ? `${error.message} Nothing was imported.`
          : "The import failed, so nothing was added. Please try again.",
      );
    }
    const result = data as { added: number; new_sets: number; records: number };
    await logAudit(
      "Import Panels",
      `Imported ${result.added} panels from Excel (${result.new_sets} new sets, ${result.records} production records)`,
      projectId,
    );
    await queryClient.invalidateQueries();
    toast.success(`${result.added} panels imported. ${result.records} production records created.`);
  }

  async function addSet() {
    const n = Number(newSetInput);
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      toast.error("Set numbers must be whole numbers from 1 to 9999.");
      return;
    }
    if (activeSets.some((x) => x.set_number === n)) {
      toast.error(`${formatSet(n)} already exists.`);
      return;
    }
    setBusy("set");
    const { error } = await supabase
      .from("production_sets")
      .insert({ project_id: projectId, set_number: n });
    if (!error) {
      await supabase
        .from("projects")
        .update({ set_count: activeSets.length + 1 })
        .eq("id", projectId);
      await supabase.rpc("generate_workflows", { p_project_id: projectId });
    }
    setBusy(null);
    if (error) {
      toast.error("We couldn't add that set. Please try again.");
      return;
    }
    await logAudit("Add Set", `Added ${formatSet(n)}`, projectId);
    setNewSetInput("");
    await queryClient.invalidateQueries();
    toast.success(`${formatSet(n)} added.`);
  }

  async function applyStages(panelIds: string[] | null) {
    if (master.length === 0) {
      toast.error("Select at least one stage first.");
      return;
    }
    setBusy(panelIds ? `apply-${panelIds[0]}` : "apply-all");
    const { data, error } = await supabase.rpc("apply_stages_to_panels", {
      p_project_id: projectId,
      p_stages: master,
      p_panel_ids: panelIds,
      p_save_default: panelIds ? false : useForNew,
    });
    setBusy(null);
    if (error) {
      toast.error(
        error.code === "P0001" && error.message
          ? error.message
          : "We couldn't apply the stages. Nothing was changed.",
      );
      return;
    }
    const r = data as { panels: number; records_created: number; kept_with_work: number };
    await logAudit(
      "Apply Stages",
      `Applied ${master.length} stages to ${panelIds ? "1 panel" : `${r.panels} panels`}`,
      projectId,
    );
    await queryClient.invalidateQueries();
    toast.success(
      `Stages applied to ${r.panels} panel${r.panels === 1 ? "" : "s"}. ${r.records_created} new production records.` +
        (r.kept_with_work > 0
          ? ` ${r.kept_with_work} records with recorded work were kept as they were.`
          : ""),
    );
  }

  async function saveTolerance() {
    const tol = Number(toleranceInput);
    if ((toleranceInput ?? "").trim() === "" || !Number.isFinite(tol) || tol < 0 || tol > 100) {
      toast.error("Weight tolerance must be a number from 0 to 100.");
      return;
    }
    setBusy("tolerance");
    const { error } = await supabase
      .from("projects")
      .update({ weight_tolerance_pct: tol })
      .eq("id", projectId);
    setBusy(null);
    if (error) {
      toast.error("We couldn't save the tolerance. Please try again.");
      return;
    }
    await logAudit("Update Tolerance", `Weight tolerance set to ±${tol}%`, projectId);
    setToleranceInput(null);
    await queryClient.invalidateQueries();
    toast.success(`Weight tolerance set to ±${tol}%.`);
  }

  async function generate() {
    setBusy("generate");
    const { data, error } = await supabase.rpc("generate_workflows", { p_project_id: projectId });
    setBusy(null);
    setConfirmGenerate(false);
    if (error) {
      toast.error("You do not have permission to generate workflows for this project.");
      return;
    }
    await logAudit("Generate Workflows", `Generated ${data} new production records`, projectId);
    await queryClient.invalidateQueries();
    toast.success(
      data === 0
        ? "Everything is already up to date — no new records needed."
        : `${data} new production records created.`,
    );
  }

  const groups = [
    ...((panels ?? []).some((p) => !p.set_id)
      ? [
          {
            key: "legacy",
            label: "All sets",
            legacy: true,
            panels: (panels ?? []).filter((p) => !p.set_id),
          },
        ]
      : []),
    ...activeSets
      .map((x) => ({
        key: x.id,
        label: formatSet(x.set_number),
        legacy: false,
        panels: (panels ?? []).filter((p) => p.set_id === x.id),
      }))
      .filter((g) => g.panels.length > 0),
  ];

  return (
    <AppShell
      title="Panel & Stage Configuration"
      breadcrumb={`Production Tracker · ${project?.code ?? "Project"} · Configuration`}
      actions={
        <div className="flex gap-2">
          <Button asChild size="sm" variant="secondary" className="rounded-full">
            <Link to="/projects/$projectId" params={{ projectId }}>
              Overview
            </Link>
          </Button>
          {canEdit && (
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => setConfirmGenerate(true)}
              disabled={busy === "generate"}
            >
              {busy === "generate" ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Wand2 className="mr-1 size-4" />
              )}
              Generate Workflows
            </Button>
          )}
        </div>
      }
    >
      {archived && (
        <GlassPanel className="mb-4 p-4">
          <p className="text-sm text-muted-foreground">
            This project is archived, so configuration is read-only.
          </p>
        </GlassPanel>
      )}

      {canEdit && (
        <GlassPanel className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight">Add panels</h2>
              <p className="text-xs text-muted-foreground">
                Add one panel with the form, or upload an Excel file to add many at once.
              </p>
            </div>
            <PanelExcelImport
              existingIds={existingIds}
              knownSets={activeSets.map((x) => x.set_number)}
              onImport={importPanels}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            <div className="space-y-1.5">
              <Label>Set</Label>
              <Select
                value={chosenSet}
                onValueChange={(v) => setNewPanel({ ...newPanel, set_number: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose set" />
                </SelectTrigger>
                <SelectContent>
                  {activeSets.map((x) => (
                    <SelectItem key={x.id} value={String(x.set_number)}>
                      {formatSet(x.set_number)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Panel name</Label>
              <Input
                value={newPanel.name}
                onChange={(e) => setNewPanel({ ...newPanel, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Part number</Label>
              <Input
                value={newPanel.part_number}
                onChange={(e) => setNewPanel({ ...newPanel, part_number: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>ID Number</Label>
              <Input
                value={newPanel.id_number}
                placeholder="optional"
                onChange={(e) => setNewPanel({ ...newPanel, id_number: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Area (m²)</Label>
              <Input
                type="number"
                step="0.01"
                value={newPanel.part_area}
                onChange={(e) => setNewPanel({ ...newPanel, part_area: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Weight (kg)</Label>
              <Input
                type="number"
                step="0.01"
                value={newPanel.part_weight}
                onChange={(e) => setNewPanel({ ...newPanel, part_weight: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={addPanel} disabled={busy === "new"}>
                {busy === "new" ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Plus className="mr-1 size-4" />
                )}
                Add panel
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-set">Add a set</Label>
              <Input
                id="new-set"
                type="number"
                min={1}
                inputMode="numeric"
                className="w-32"
                placeholder="e.g. 7"
                value={newSetInput}
                onChange={(e) => setNewSetInput(e.target.value)}
              />
            </div>
            <Button variant="secondary" onClick={addSet} disabled={busy === "set"}>
              {busy === "set" ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Layers className="mr-1 size-4" />
              )}
              Add set
            </Button>
            <p className="text-xs text-muted-foreground">
              {(panels ?? []).filter((p) => p.is_active).length} active panels · {activeSets.length}{" "}
              sets. Panels with history are deactivated rather than deleted, so production records
              are never lost.
            </p>
          </div>
        </GlassPanel>
      )}

      {canEdit && (
        <GlassPanel className="mt-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight">Apply to All Panels</h2>
              <p className="text-xs text-muted-foreground">
                Pick the stages once and apply them to every panel in every set. You can still
                change any single panel below; that never affects the others.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMasterStages(STAGES.map((st) => st.value as string))}
              >
                Select all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMasterStages([])}>
                Clear
              </Button>
              <Button size="sm" disabled={busy === "apply-all"} onClick={() => applyStages(null)}>
                {busy === "apply-all" ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                Apply to all {(panels ?? []).filter((p) => p.is_active).length} panels
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {STAGES.map((stage) => {
              const on = master.includes(stage.value);
              return (
                <button
                  key={stage.value}
                  type="button"
                  onClick={() =>
                    setMasterStages(
                      on ? master.filter((x) => x !== stage.value) : [...master, stage.value],
                    )
                  }
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    on
                      ? "prism text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {stage.label}
                </button>
              );
            })}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useForNew}
              onChange={(e) => setUseForNew(e.target.checked)}
            />
            Save this selection and use it for panels added later
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Records that already have work (status, QC status or remarks) are never changed or
            removed. Untouched records of removed stages are marked Not Applicable.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="proj-tol">Weight tolerance (± %) for this project</Label>
              <Input
                id="proj-tol"
                type="number"
                min={0}
                max={100}
                step="0.1"
                className="w-40"
                value={toleranceInput ?? String(Number(project?.weight_tolerance_pct ?? 5))}
                onChange={(e) => setToleranceInput(e.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              disabled={toleranceInput === null || busy === "tolerance"}
              onClick={saveTolerance}
            >
              Save tolerance
            </Button>
            <p className="text-xs text-muted-foreground">
              A panel can override this with its own tolerance below.
            </p>
          </div>
        </GlassPanel>
      )}

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.key} className="space-y-3">
            <div className="flex items-center gap-2 pt-2">
              <Layers className="size-4 text-primary" />
              <h3 className="text-sm font-bold">{group.label}</h3>
              <span className="text-xs text-muted-foreground">
                {group.panels.length} panel{group.panels.length === 1 ? "" : "s"}
              </span>
              {group.legacy && (
                <span className="text-xs text-muted-foreground">
                  · created before sets were assigned; tracked in every set
                </span>
              )}
            </div>
            {group.panels.map((panel) => (
              <GlassPanel key={panel.id} className="p-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
                  <div className="space-y-1.5">
                    <Label>Panel name</Label>
                    <Input
                      defaultValue={panel.name}
                      disabled={!canEdit}
                      onBlur={(e) =>
                        e.target.value !== panel.name &&
                        savePanel(
                          panel.id,
                          { name: e.target.value },
                          `Renamed panel to ${e.target.value}`,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Part number</Label>
                    <Input
                      defaultValue={panel.part_number}
                      disabled={!canEdit}
                      onBlur={(e) =>
                        e.target.value !== panel.part_number &&
                        savePanel(
                          panel.id,
                          { part_number: e.target.value },
                          `Updated part number for ${panel.name}`,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>ID Number</Label>
                    <Input
                      defaultValue={panel.id_number ?? ""}
                      placeholder="optional"
                      disabled={!canEdit}
                      onBlur={(e) =>
                        e.target.value.trim() !== (panel.id_number ?? "") &&
                        savePanel(
                          panel.id,
                          { id_number: e.target.value.trim() || null },
                          `Updated ID Number for ${panel.name}`,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Area (m²)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      defaultValue={Number(panel.part_area)}
                      disabled={!canEdit}
                      onBlur={(e) =>
                        Number(e.target.value) !== Number(panel.part_area) &&
                        savePanel(
                          panel.id,
                          { part_area: Number(e.target.value) || 0 },
                          `Updated area for ${panel.name}`,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Weight (kg)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      defaultValue={Number(panel.part_weight)}
                      disabled={!canEdit}
                      onBlur={(e) =>
                        Number(e.target.value) !== Number(panel.part_weight) &&
                        savePanel(
                          panel.id,
                          { part_weight: Number(e.target.value) || 0 },
                          `Updated weight for ${panel.name}`,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tolerance (±%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      defaultValue={panel.weight_tolerance_pct ?? ""}
                      placeholder={`${Number(project?.weight_tolerance_pct ?? 5)} (project)`}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === "" ? null : Number(raw);
                        if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) {
                          toast.error("Tolerance must be a number from 0 to 100.");
                          return;
                        }
                        if (next !== (panel.weight_tolerance_pct ?? null))
                          savePanel(
                            panel.id,
                            { weight_tolerance_pct: next },
                            `Updated weight tolerance for ${panel.name}`,
                          );
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Sequence</Label>
                    <Input
                      type="number"
                      min={1}
                      defaultValue={panel.sequence}
                      disabled={!canEdit}
                      onBlur={(e) =>
                        Number(e.target.value) !== panel.sequence &&
                        savePanel(
                          panel.id,
                          { sequence: Number(e.target.value) || 1 },
                          `Reordered ${panel.name}`,
                        )
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`active-${panel.id}`}
                      checked={panel.is_active}
                      disabled={!canEdit || busy === panel.id}
                      onCheckedChange={(checked) =>
                        savePanel(
                          panel.id,
                          { is_active: checked },
                          `${checked ? "Activated" : "Deactivated"} panel ${panel.name}`,
                        )
                      }
                    />
                    <Label htmlFor={`active-${panel.id}`} className="text-sm">
                      {panel.is_active ? "Active" : "Inactive (history preserved)"}
                    </Label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === `apply-${panel.id}`}
                        onClick={() => applyStages([panel.id])}
                      >
                        Use the stage selection above for this panel
                      </Button>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Save className="size-3.5" /> Changes save when you leave a field
                    </span>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Applicable stages
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {STAGES.map((stage) => {
                      const record = stageOf(panel.id, stage.value);
                      const on = record?.is_applicable ?? false;
                      return (
                        <button
                          key={stage.value}
                          type="button"
                          disabled={!canEdit || busy === `${panel.id}-${stage.value}`}
                          onClick={() => toggleStage(panel.id, stage.value)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                            on
                              ? "prism text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {stage.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </GlassPanel>
            ))}
          </div>
        ))}
        {(panels ?? []).length === 0 && (
          <GlassPanel className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No panels configured yet.</p>
          </GlassPanel>
        )}
      </div>

      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate production workflows?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates any missing production records for every active panel, applicable stage
              and set. Existing records, statuses and history are never changed or removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={generate}>Generate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
