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
import { compareWeight, effectiveTolerance } from "@/lib/weights";

type PanelLite = {
  id: string;
  name: string;
  part_number: string;
  id_number: string | null;
  part_weight: number | string;
  weight_tolerance_pct: number | null;
};

const fmt = (n: number | null) => (n === null ? "—" : `${Number(n.toFixed(3))} kg`);

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
  projectTolerance,
  canEdit,
}: {
  projectId: string;
  setId: string | null;
  setNumber: number | null;
  panels: PanelLite[];
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
              {["Panel", "Weight type", "Expected", "Actual", "Deviation (%)", ""].map((h, i) => (
                <th key={i} className="border-b px-4 py-2 font-semibold">
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
            {panels.flatMap((panel) => {
              const r = record(panel.id);
              const tol = effectiveTolerance(panel.weight_tolerance_pct, projectTolerance);
              const rows: { label: string; actual: number | null }[] = [
                { label: "Untrimmed Weight", actual: r?.untrimmed_weight ?? null },
                { label: "Final Weight", actual: r?.final_weight ?? null },
              ];
              return rows.map((row, i) => {
                const c = compareWeight(panel.part_weight, row.actual, tol);
                return (
                  <tr key={`${panel.id}-${row.label}`}>
                    <td className="border-b px-4 py-2 align-top">
                      {i === 0 && (
                        <>
                          <p className="font-semibold">{panel.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {panel.part_number || "—"}
                            {panel.id_number ? ` · ID ${panel.id_number}` : ""}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="border-b px-4 py-2 whitespace-nowrap">{row.label}</td>
                    <td className="border-b px-4 py-2 whitespace-nowrap">
                      {c.expected !== null ? fmt(c.expected) : "—"}
                      <span className="ml-1 text-xs text-muted-foreground">±{tol}%</span>
                    </td>
                    <td className="border-b px-4 py-2 whitespace-nowrap">{fmt(row.actual)}</td>
                    <td className="border-b px-4 py-2">
                      <WeightBadge comparison={c} />
                    </td>
                    <td className="border-b px-4 py-2 text-right">
                      {i === 0 && canEdit && (
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
              });
            })}
          </tbody>
        </table>
      </div>

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
