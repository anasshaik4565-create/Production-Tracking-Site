import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Save, Wand2 } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { STAGES } from "@/lib/domain";
import { usePanelStages, usePanels, useProject, useSets } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/projects/$projectId/panels")({
  head: () => ({
    meta: [
      { title: "Panel Configuration — Production Tracker" },
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

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [newPanel, setNewPanel] = useState({
    name: "",
    part_number: "",
    part_area: "",
    part_weight: "",
  });

  const archived = project?.status === "archived";
  const canEdit = !archived;

  function stageOf(panelId: string, stage: string) {
    return (stages ?? []).find((s) => s.panel_id === panelId && s.stage === stage);
  }

  type PanelPatch = {
    name?: string;
    part_number?: string;
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
      toast.error("You do not have permission to change this panel.");
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

  async function addPanel() {
    if (!newPanel.name.trim()) {
      toast.error("Please enter a panel name.");
      return;
    }
    setBusy("new");
    const nextSeq = (panels ?? []).length + 1;
    const { data: created, error } = await supabase
      .from("panels")
      .insert({
        project_id: projectId,
        name: newPanel.name.trim(),
        part_number: newPanel.part_number.trim(),
        part_area: Number(newPanel.part_area) || 0,
        part_weight: Number(newPanel.part_weight) || 0,
        sequence: nextSeq,
      })
      .select()
      .single();
    if (error || !created) {
      setBusy(null);
      toast.error("We couldn't add the panel. Please try again.");
      return;
    }
    await supabase.from("panel_stages").insert(
      STAGES.map((s, i) => ({
        panel_id: created.id,
        project_id: projectId,
        stage: s.value as never,
        is_applicable: true,
        sequence: i + 1,
      })),
    );
    await logAudit("Add Panel", `Added panel ${created.name}`, projectId);
    setNewPanel({ name: "", part_number: "", part_area: "", part_weight: "" });
    setBusy(null);
    await queryClient.invalidateQueries();
    toast.success("Panel added. Generate workflows to create its production records.");
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
          <h2 className="font-display text-lg font-bold tracking-tight">Add a panel</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              <Button className="w-full rounded-full" onClick={addPanel} disabled={busy === "new"}>
                {busy === "new" ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Plus className="mr-1 size-4" />
                )}
                Add panel
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {(panels ?? []).filter((p) => p.is_active).length} active panels × {(sets ?? []).length}{" "}
            sets. Panels with history are deactivated rather than deleted, so production records are
            never lost.
          </p>
        </GlassPanel>
      )}

      <div className="mt-4 space-y-4">
        {(panels ?? []).map((panel) => (
          <GlassPanel key={panel.id} className="p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Save className="size-3.5" /> Changes save when you leave a field
              </span>
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
