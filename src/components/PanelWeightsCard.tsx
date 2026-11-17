import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Scale } from "lucide-react";

import { GlassPanel } from "@/components/AppShell";
import { WeightBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { formatSet } from "@/lib/domain";
import { usePanelWeights } from "@/lib/queries";
import {
  compareWeight,
  effectiveTolerance,
  formatDeviation,
  formatKg,
  formatSignedKg,
  summarizeSetWeights,
  weightDifference,
  type WeightComparison,
} from "@/lib/weights";
import { cn } from "@/lib/utils";

type PanelLite = {
  id: string;
  name: string;
  part_number: string;
  id_number: string | null;
  part_weight: number | string;
  weight_tolerance_pct: number | null;
};

const fmt = (n: number | null) => formatKg(n);

function parseWeight(raw: string): { value: number | null; error?: string } {
  if (raw.trim() === "") return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0)
    return { value: null, error: "Weights must be zero or a positive number." };
  return { value: n };
}

/** Untrimmed / final weight table with automatic deviation against the expected Part Weight. */
export function PanelWeightsCard({
  projectId,
  setId,
  setNumber,
  panels,
  summaryPanels,
  projectTolerance,
  canEdit,
}: {
  projectId: string;
  setId: string | null;
  setNumber: number | null;
  panels: PanelLite[];
  /** Every active panel of the set (not narrowed by search); used for the set totals. */
  summaryPanels?: PanelLite[];
  projectTolerance: number | null | undefined;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: weights } = usePanelWeights(projectId);
  const [editing, setEditing] = useState<PanelLite | null>(null);
  const [untrimmed, setUntrimmed] = useState("");
  const [final, setFinal] = useState("");
  const [saving, setSaving] = useState(false);

  const record = (panelId: string) =>
    (weights ?? []).find((w) => w.panel_id === panelId && w.set_id === setId);

  function open(panel: PanelLite) {
    const r = record(panel.id);
    setEditing(panel);
    setUntrimmed(r?.untrimmed_weight != null ? String(r.untrimmed_weight) : "");
    setFinal(r?.final_weight != null ? String(r.final_weight) : "");
  }

  async function save() {
    if (!editing || !setId || saving) return;
    const u = parseWeight(untrimmed);
    const f = parseWeight(final);
    if (u.error || f.error) {
      toast.error(u.error ?? f.error);
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("set_panel_weights", {
      p_panel_id: editing.id,
      p_set_id: setId,
      p_untrimmed: u.value,
      p_final: f.value,
    });
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "P0001" && error.message
          ? error.message
          : "We couldn't save the weights. Please try again.",
      );
      return;
    }
    await logAudit(
      "Update Weights",
      `${editing.name} · ${formatSet(setNumber)}: untrimmed ${u.value ?? "—"} kg, final ${f.value ?? "—"} kg`,
      projectId,
    );
    await queryClient.invalidateQueries({ queryKey: ["panel-weights", projectId] });
    toast.success("Weights saved.");
    setEditing(null);
  }

  const preview = (raw: string) =>
    compareWeight(
      editing?.part_weight,
      parseWeight(raw).error ? null : parseWeight(raw).value,
      editing ? effectiveTolerance(editing.weight_tolerance_pct, projectTolerance) : 5,
    );

  return (
    <GlassPanel className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 font-bold">
            <Scale className="size-4 text-primary" /> Panel weights · {formatSet(setNumber)}
          </h3>
          <p className="text-xs text-muted-foreground">
            Untrimmed and final weights are compared with each panel&apos;s expected Part Weight.
            Weights are optional.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {[
                "Panel",
                "Expected Part Weight",
                "Final Weight",
                "Weight Difference",
                "Deviation (%)",
                "",
              ].map((h, i) => (
                <th key={i} className="border-b px-4 py-2 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panels.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No panels in this set.
                </td>
              </tr>
            )}
            {panels.map((panel) => {
              const r = record(panel.id);
              const tol = effectiveTolerance(panel.weight_tolerance_pct, projectTolerance);
              const final = compareWeight(panel.part_weight, r?.final_weight ?? null, tol);
              const untrimmed = compareWeight(panel.part_weight, r?.untrimmed_weight ?? null, tol);
              const diff = weightDifference(panel.part_weight, r?.final_weight ?? null);
              return (
                <tr key={panel.id}>
                  <td className="border-b px-4 py-2 align-top">
                    <p className="font-semibold">{panel.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {panel.part_number || "—"}
                      {panel.id_number ? ` · ID ${panel.id_number}` : ""}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[11px]",
                        untrimmed.verdict === "over" || untrimmed.verdict === "under"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      Untrimmed:{" "}
                      {untrimmed.verdict === "not_recorded"
                        ? "not recorded"
                        : untrimmed.deviationPct === null
                          ? `${fmt(untrimmed.actual)} (comparison unavailable)`
                          : `${fmt(untrimmed.actual)} (${formatDeviation(untrimmed.deviationPct)})`}
                    </p>
                  </td>
                  <td className="border-b px-4 py-2 align-top whitespace-nowrap">
                    {final.expected !== null ? fmt(final.expected) : "Unavailable"}
                    <span className="ml-1 text-xs text-muted-foreground">±{tol}%</span>
                  </td>
                  <td className="border-b px-4 py-2 align-top whitespace-nowrap">
                    {final.actual !== null ? fmt(final.actual) : "Not recorded"}
                  </td>
                  <td className="border-b px-4 py-2 align-top whitespace-nowrap">
                    {formatSignedKg(diff)}
                  </td>
                  <td className="border-b px-4 py-2 align-top">
                    <WeightBadge comparison={final} />
                  </td>
                  <td className="border-b px-4 py-2 text-right align-top">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit weights for ${panel.name}`}
                        onClick={() => open(panel)}
                      >
                        <Pencil className="mr-1 size-3.5" /> Edit
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SetWeightSummary
        setNumber={setNumber}
        projectTolerance={projectTolerance}
        items={(summaryPanels ?? panels).map((p) => ({
          expected: p.part_weight,
          finalWeight: record(p.id)?.final_weight ?? null,
        }))}
      />

      <Dialog open={!!editing} onOpenChange={(o) => !o && !saving && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Panel weights</DialogTitle>
            <DialogDescription>
              {editing?.name} · {formatSet(setNumber)} · expected{" "}
              {fmt(Number(editing?.part_weight ?? 0) || null)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(
              [
                ["Untrimmed weight (kg)", untrimmed, setUntrimmed],
                ["Final weight (kg)", final, setFinal],
              ] as const
            ).map(([label, value, setter]) => (
              <div key={label} className="space-y-1.5">
                <Label>
                  {label} <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                />
                <WeightBadge comparison={preview(value)} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Save weights
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassPanel>
  );
}

/** Totals for the whole set, from summed weights. Incomplete sets are labelled, never presented as final. */
export function SetWeightSummary({
  setNumber,
  projectTolerance,
  items,
}: {
  setNumber: number | null;
  projectTolerance: number | null | undefined;
  items: { expected: unknown; finalWeight: unknown }[];
}) {
  const t = effectiveTolerance(null, projectTolerance);
  const sum = summarizeSetWeights(items, t);
  const asComparison: WeightComparison | null =
    sum.verdict === "incomplete"
      ? null
      : {
          verdict: sum.verdict,
          deviationPct: sum.deviationPct,
          expected: sum.totalExpected,
          actual: sum.recordedFinalTotal,
          tolerance: t,
        };
  const pct = sum.panels > 0 ? Math.round((100 * sum.withFinal) / sum.panels) : 0;
  return (
    <div
      className="border-t bg-muted/30 px-4 py-4"
      aria-label={`Weight summary for ${formatSet(setNumber)}`}
    >
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {formatSet(setNumber)} weight summary
      </p>
      <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <dt className="text-xs text-muted-foreground">Total Expected Weight</dt>
          <dd className="text-lg font-bold">
            {sum.totalExpected === null ? "Unavailable" : fmt(sum.totalExpected)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Total Actual Final Weight
            {!sum.complete && sum.withFinal > 0 ? " (recorded so far)" : ""}
          </dt>
          <dd className="text-lg font-bold">
            {sum.withFinal === 0 ? "Not recorded" : fmt(sum.recordedFinalTotal)}
          </dd>
          {!sum.complete && sum.withFinal > 0 && (
            <dd className="text-[11px] font-semibold text-hold-foreground">
              Incomplete: not a set total
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total Weight Difference</dt>
          <dd className="text-lg font-bold">
            {sum.complete ? formatSignedKg(sum.difference) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Overall Weight Deviation</dt>
          <dd className="mt-1">
            {asComparison ? (
              <WeightBadge comparison={asComparison} />
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                <span className="size-1.5 rounded-full bg-current" />
                Incomplete
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Final Weights recorded</dt>
          <dd className="text-lg font-bold">
            {sum.withFinal} of {sum.panels}
          </dd>
          <dd className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </dd>
        </div>
      </dl>
      {!sum.complete && sum.panels > 0 && (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {sum.invalidExpected > 0
            ? `${sum.invalidExpected} panel${sum.invalidExpected === 1 ? " has" : "s have"} no valid expected weight, so the deviation is unavailable. `
            : ""}
          {sum.missingFinal > 0
            ? `Final Weight is missing for ${sum.missingFinal} panel${sum.missingFinal === 1 ? "" : "s"}, so this set's total is incomplete and its deviation is not shown as a confirmed result.`
            : ""}
          {sum.partial && (
            <span className="mt-1 block">
              Recorded panels only ({sum.partial.panels}): expected {fmt(sum.partial.expected)},
              actual {fmt(sum.partial.actual)} ({formatSignedKg(sum.partial.difference)}
              {sum.partial.deviationPct !== null
                ? `, ${formatDeviation(sum.partial.deviationPct)}`
                : ""}
              ). Partial comparison only.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
