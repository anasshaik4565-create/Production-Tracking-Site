import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Layers, Loader2, Plus, Trash2, X } from "lucide-react";

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
import { PanelExcelImport } from "@/components/PanelExcelImport";
import { COUNTRIES, STAGES, formatSet } from "@/lib/domain";
import type { ImportedPanel } from "@/lib/panel-import";

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
  set_number: string;
  name: string;
  part_number: string;
  part_area: string;
  part_weight: string;
  stages: string[];
};

const ALL_STAGES = STAGES.map((s) => s.value as string);

function emptyPanel(setNumber = ""): PanelDraft {
  return {
    set_number: setNumber,
    name: "",
    part_number: "",
    part_area: "",
    part_weight: "",
    stages: [...ALL_STAGES],
  };
}

function isBlankPanel(p: PanelDraft) {
  return !p.name.trim() && !p.part_number.trim() && !p.part_area && !p.part_weight;
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
  const [sets, setSets] = useState<number[]>([1]);
  const [setInput, setSetInput] = useState("");
  const [panels, setPanels] = useState<PanelDraft[]>([emptyPanel("1")]);

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

  function addSet(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      toast.error("Set numbers must be whole numbers from 1 to 9999.");
      return false;
    }
    if (sets.includes(n)) {
      toast.error(`${formatSet(n)} is already in the list.`);
      return false;
    }
    setSets((prev) => [...prev, n].sort((a, b) => a - b));
    return true;
  }

  function removeSet(n: number) {
    if (sets.length === 1) {
      toast.error("A project needs at least one set.");
      return;
    }
    const used = panels.filter((p) => Number(p.set_number) === n && !isBlankPanel(p)).length;
    if (used > 0) {
      toast.error(`${formatSet(n)} still has ${used} panel(s). Move or remove them first.`);
      return;
    }
    setSets((prev) => prev.filter((x) => x !== n));
    setPanels((prev) => prev.filter((p) => !(Number(p.set_number) === n && isBlankPanel(p))));
  }

  /** Merge rows read from Excel into the draft: add unknown sets, replace the untouched blank panel. */
  function importPanels(rows: ImportedPanel[]) {
    const newSets = Array.from(new Set(rows.map((r) => r.set_number))).filter(
      (n) => !sets.includes(n),
    );
    if (sets.length + newSets.length > 200) {
      throw new Error("That would create more than 200 sets. Please check the Set Number column.");
    }
    if (newSets.length) setSets((prev) => [...prev, ...newSets].sort((a, b) => a - b));
    setPanels((prev) => [
      ...prev.filter((p) => !isBlankPanel(p)),
      ...rows.map<PanelDraft>((r) => ({
        set_number: String(r.set_number),
        name: r.name,
        part_number: r.part_number,
        part_area: String(r.part_area),
        part_weight: String(r.part_weight),
        stages: [...ALL_STAGES],
      })),
    ]);
    toast.success(`${rows.length} panels added from Excel.`);
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
      if (sets.length === 0) {
        toast.error("Add at least one set.");
        return;
      }
    }
    if (step === 2) {
      const message = validatePanels();
      if (message) {
        toast.error(message);
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function validatePanels(): string | null {
    if (panels.length === 0) return "Add at least one panel.";
    const seen = new Set<string>();
    for (const [i, p] of panels.entries()) {
      const label = p.name.trim() || `Panel ${i + 1}`;
      if (!p.name.trim()) return `Panel ${i + 1} needs a name.`;
      if (!sets.includes(Number(p.set_number))) return `${label}: choose a set.`;
      if (!p.part_number.trim()) return `${label}: enter a part number.`;
      const key = p.part_number.trim().toLowerCase();
      if (seen.has(key))
        return `Part number ${p.part_number.trim()} is used by more than one panel.`;
      seen.add(key);
      if (p.part_area && (!Number.isFinite(Number(p.part_area)) || Number(p.part_area) < 0))
        return `${label}: part area must be a positive number.`;
      if (p.part_weight && (!Number.isFinite(Number(p.part_weight)) || Number(p.part_weight) < 0))
        return `${label}: part weight must be a positive number.`;
    }
    return null;
  }

  async function create() {
    if (busy) return;
    if (panels.some((p) => p.stages.length === 0)) {
      toast.error("Each panel must have at least one applicable stage.");
      return;
    }
    const problem = validatePanels();
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy("Creating project and generating workflows...");
    try {
      const { data, error } = await supabase.rpc("create_project_full", {
        p_payload: {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          country,
          country_other: country === "Other" ? countryOther.trim() : null,
          process: process.trim(),
          sets,
          panels: panels.map((p) => ({
            name: p.name.trim(),
            set_number: Number(p.set_number),
            part_number: p.part_number.trim(),
            part_area: p.part_area === "" ? 0 : Number(p.part_area),
            part_weight: p.part_weight === "" ? 0 : Number(p.part_weight),
            stages: p.stages,
          })),
        },
      });
      if (error) throw error;
      const result = data as { project_id: string; code: string; records: number };

      await logAudit(
        "Create Project",
        `Created project ${result.code} with ${panels.length} panels across ${sets.length} sets (${result.records} production records)`,
        result.project_id,
      );
      await queryClient.invalidateQueries();
      toast.success(`Project created. ${result.records} production records generated.`);
      navigate({ to: "/projects/$projectId", params: { projectId: result.project_id } });
    } catch (error) {
      const e = error as { message?: string; code?: string };
      const message = e.message ?? "";
      toast.error(
        message.includes("duplicate")
          ? "That project code is already in use. Please choose another."
          : e.code === "P0001" && message
            ? message
            : "We couldn't create the project. Nothing was saved — please check your details and try again.",
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
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold">Production sets</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Define the sets this project will produce, for example Set 05 and Set 06. Each panel
                is assigned to exactly one set in the next step. Set numbers can be any whole
                number.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="set-input">Set number</Label>
                <Input
                  id="set-input"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="w-36"
                  placeholder="e.g. 5"
                  value={setInput}
                  onChange={(e) => setSetInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (addSet(Number(setInput))) setSetInput("");
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                onClick={() => {
                  if (addSet(Number(setInput))) setSetInput("");
                }}
              >
                <Plus className="mr-1 size-4" /> Add set
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => addSet((sets.length ? Math.max(...sets) : 0) + 1)}
              >
                Add next set ({formatSet((sets.length ? Math.max(...sets) : 0) + 1)})
              </Button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {sets.map((n) => (
                <li
                  key={n}
                  className="flex items-center gap-1.5 rounded-lg border bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground"
                >
                  <Layers className="size-3.5" />
                  {formatSet(n)}
                  <button
                    type="button"
                    aria-label={`Remove ${formatSet(n)}`}
                    className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-card hover:text-foreground"
                    onClick={() => removeSet(n)}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {sets.length} set{sets.length === 1 ? "" : "s"} · you can add more sets later from the
              Configure page.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Panels</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add panels one by one, or upload an Excel file to add many at once. You can mix
                  both methods.
                </p>
              </div>
              <PanelExcelImport
                existingParts={panels.map((p) => p.part_number)}
                knownSets={sets}
                onImport={importPanels}
              />
            </div>

            {[...sets, null as number | null].map((setNumber) => {
              const group = panels
                .map((panel, index) => ({ panel, index }))
                .filter(({ panel }) =>
                  setNumber === null
                    ? !sets.includes(Number(panel.set_number))
                    : Number(panel.set_number) === setNumber,
                );
              if (setNumber === null && group.length === 0) return null;
              return (
                <div key={setNumber ?? "unassigned"} className="rounded-xl border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2.5">
                    <p className="text-sm font-bold">
                      {setNumber === null ? "Unassigned panels" : formatSet(setNumber)}
                      <span className="ml-2 text-xs font-medium text-muted-foreground">
                        {group.length} panel{group.length === 1 ? "" : "s"}
                      </span>
                    </p>
                    {setNumber !== null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setPanels((prev) => [...prev, emptyPanel(String(setNumber))])
                        }
                      >
                        <Plus className="mr-1 size-4" /> Add panel to {formatSet(setNumber)}
                      </Button>
                    )}
                  </div>
                  <div className="space-y-3 p-3">
                    {group.length === 0 && (
                      <p className="px-1 py-2 text-sm text-muted-foreground">
                        No panels in this set yet.
                      </p>
                    )}
                    {group.map(({ panel, index: i }) => (
                      <div key={i} className="rounded-lg border bg-card p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                            Panel {i + 1}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove panel"
                            onClick={() => setPanels((prev) => prev.filter((_, x) => x !== i))}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          <div className="space-y-1.5">
                            <Label>Set</Label>
                            <Select
                              value={panel.set_number}
                              onValueChange={(v) => updatePanel(i, { set_number: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Choose set" />
                              </SelectTrigger>
                              <SelectContent>
                                {sets.map((n) => (
                                  <SelectItem key={n} value={String(n)}>
                                    {formatSet(n)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
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
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              {panels.length} panel{panels.length === 1 ? "" : "s"} across {sets.length} set
              {sets.length === 1 ? "" : "s"}. Each part number must be unique within the project.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose the stages that apply to each panel. Unselected stages are recorded as Not
              Applicable and never count towards progress.
            </p>
            {panels.map((panel, i) => (
              <div key={i} className="rounded-lg border bg-card/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {panel.name || `Panel ${i + 1}`}
                    <span className="ml-2 text-xs font-medium text-muted-foreground">
                      {panel.part_number}
                    </span>
                  </p>
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
                  {formatSet(Number(panel.set_number))} · {panel.stages.length} of{" "}
                  {ALL_STAGES.length} stages applicable · {panel.stages.length} production records
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
