import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { COUNTRIES, STAGES } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/projects/new")({
  head: () => ({
    meta: [
      { title: "Create Project — Production Tracker" },
      {
        name: "description",
        content: "Set up a project, its sets, panels and applicable production stages.",
      },
      { property: "og:title", content: "Create Project — Production Tracker" },
      {
        property: "og:description",
        content: "Set up a project, its sets, panels and applicable production stages.",
      },
    ],
  }),
  component: NewProject,
});

type PanelDraft = {
  name: string;
  part_number: string;
  part_area: string;
  part_weight: string;
  stages: string[];
};

const ALL_STAGES = STAGES.map((s) => s.value as string);

function emptyPanel(): PanelDraft {
  return { name: "", part_number: "", part_area: "", part_weight: "", stages: [...ALL_STAGES] };
}

const STEPS = ["Project details", "Sets", "Panels", "Stages"] as const;

function NewProject() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [country, setCountry] = useState<string>("India");
  const [countryOther, setCountryOther] = useState("");
  const [process, setProcess] = useState("");
  const [setCount, setSetCount] = useState("1");
  const [panels, setPanels] = useState<PanelDraft[]>([emptyPanel()]);

  function updatePanel(index: number, patch: Partial<PanelDraft>) {
    setPanels((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function toggleStage(index: number, stage: string) {
    setPanels((prev) =>
      prev.map((p, i) =>
        i === index
          ? {
              ...p,
              stages: p.stages.includes(stage)
                ? p.stages.filter((s) => s !== stage)
                : [...p.stages, stage],
            }
          : p,
      ),
    );
  }

  function next() {
    if (step === 0) {
      if (!name.trim() || !code.trim()) {
        toast.error("Please enter a project name and code.");
        return;
      }
      if (country === "Other" && !countryOther.trim()) {
        toast.error("Please specify the country.");
        return;
      }
    }
    if (step === 1) {
      const n = Number(setCount);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        toast.error("Number of sets must be a whole number between 1 and 100.");
        return;
      }
    }
    if (step === 2) {
      if (panels.some((p) => !p.name.trim())) {
        toast.error("Every panel needs a name.");
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function create() {
    if (busy) return;
    if (panels.some((p) => p.stages.length === 0)) {
      toast.error("Each panel must have at least one applicable stage.");
      return;
    }
    setBusy("Creating project...");
    try {
      const total = Number(setCount);

      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          country,
          country_other: country === "Other" ? countryOther.trim() : null,
          process: process.trim(),
          set_count: total,
        })
        .select()
        .single();
      if (projectError) throw projectError;

      const { error: setsError } = await supabase.from("production_sets").insert(
        Array.from({ length: total }, (_, i) => ({
          project_id: project.id,
          set_number: i + 1,
        })),
      );
      if (setsError) throw setsError;

      setBusy("Saving panels...");
      const { data: insertedPanels, error: panelError } = await supabase
        .from("panels")
        .insert(
          panels.map((p, i) => ({
            project_id: project.id,
            name: p.name.trim(),
            part_number: p.part_number.trim(),
            part_area: Number(p.part_area) || 0,
            part_weight: Number(p.part_weight) || 0,
            sequence: i + 1,
          })),
        )
        .select();
      if (panelError) throw panelError;

      const stageRows = (insertedPanels ?? []).flatMap((panel, i) =>
        ALL_STAGES.map((stage, si) => ({
          panel_id: panel.id,
          project_id: project.id,
          stage: stage as never,
          is_applicable: panels[i]!.stages.includes(stage),
          sequence: si + 1,
        })),
      );
      const { error: stageError } = await supabase.from("panel_stages").insert(stageRows);
      if (stageError) throw stageError;

      setBusy("Generating workflows...");
      const { data: generated, error: genError } = await supabase.rpc("generate_workflows", {
        p_project_id: project.id,
      });
      if (genError) throw genError;

      await logAudit(
        "Create Project",
        `Created project ${project.code} with ${panels.length} panels × ${total} sets (${generated} production records)`,
        project.id,
      );
      await queryClient.invalidateQueries();
      toast.success(`Project created. ${generated} production records generated.`);
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    } catch (error) {
      const message = (error as { message?: string }).message ?? "";
      toast.error(
        message.includes("duplicate")
          ? "That project code is already in use. Please choose another."
          : "We couldn't create the project. Please check your details and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell title="Create New Project" breadcrumb="Production Tracker · Projects · New">
      <GlassPanel className="p-5">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                i === step
                  ? "prism text-primary-foreground"
                  : i < step
                    ? "bg-done/15 text-done"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="size-3.5" /> : <span>{i + 1}</span>}
              {label}
            </li>
          ))}
        </ol>
      </GlassPanel>

      <GlassPanel className="mt-4 p-5">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-name">Project name</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-code">Project code</Label>
              <Input
                id="p-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. PRJ-2026-01"
              />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {country === "Other" && (
              <div className="space-y-2">
                <Label htmlFor="p-other">Specify country</Label>
                <Input
                  id="p-other"
                  value={countryOther}
                  onChange={(e) => setCountryOther(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="p-process">Process</Label>
              <Textarea
                id="p-process"
                value={process}
                onChange={(e) => setProcess(e.target.value)}
                placeholder="Describe the production process for this project"
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="max-w-sm space-y-2">
            <Label htmlFor="p-sets">Number of sets</Label>
            <Input
              id="p-sets"
              type="number"
              min={1}
              max={100}
              value={setCount}
              onChange={(e) => setSetCount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Panels are defined once and replicated across every set. You can add more sets later —
              existing sets are never removed.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {panels.map((panel, i) => (
              <div key={i} className="rounded-2xl border bg-card/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Panel {i + 1}
                  </p>
                  {panels.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove panel"
                      onClick={() => setPanels((prev) => prev.filter((_, x) => x !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>Panel name</Label>
                    <Input
                      value={panel.name}
                      onChange={(e) => updatePanel(i, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Part number</Label>
                    <Input
                      value={panel.part_number}
                      onChange={(e) => updatePanel(i, { part_number: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Part area (m²)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={panel.part_area}
                      onChange={(e) => updatePanel(i, { part_area: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Part weight (kg)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={panel.part_weight}
                      onChange={(e) => updatePanel(i, { part_weight: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              className="rounded-full"
              onClick={() => setPanels((prev) => [...prev, emptyPanel()])}
            >
              <Plus className="mr-1 size-4" /> Add panel
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose the stages that apply to each panel. Unselected stages are recorded as Not
              Applicable and never count towards progress.
            </p>
            {panels.map((panel, i) => (
              <div key={i} className="rounded-2xl border bg-card/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{panel.name || `Panel ${i + 1}`}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => updatePanel(i, { stages: [...ALL_STAGES] })}
                    >
                      Select all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => updatePanel(i, { stages: [] })}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {STAGES.map((stage) => {
                    const on = panel.stages.includes(stage.value);
                    return (
                      <button
                        key={stage.value}
                        type="button"
                        onClick={() => toggleStage(i, stage.value)}
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
                <p className="mt-2 text-xs text-muted-foreground">
                  {panel.stages.length} of {ALL_STAGES.length} stages applicable ·{" "}
                  {panel.stages.length * Number(setCount || 1)} production records
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            className="rounded-full"
            disabled={step === 0 || !!busy}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button className="rounded-full" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button className="rounded-full" onClick={create} disabled={!!busy}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {busy ?? "Create project & generate workflows"}
            </Button>
          )}
        </div>
      </GlassPanel>
    </AppShell>
  );
}
