import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { STAGE_LABEL, STATUS_LABEL, STATUSES, formatSet } from "@/lib/domain";
import { cn } from "@/lib/utils";

type SetCount = { set_number: number; to_change: number; already: number };
type Preview = {
  total: number;
  to_change: number;
  already: number;
  not_applicable_records: number;
  panels_without_stage: number;
  by_set: SetCount[];
};
type Failure = { panel: string; set_number: number; stage: string; error: string };
type Result = Preview & { updated: number; failed: Failure[] };

// Not Applicable is a stage-configuration choice, so it is not offered as a bulk status.
const BULK_STATUSES = STATUSES.filter((s) => s.value !== "not_applicable");

/**
 * "Apply Status to All Panels" for ONE stage, across every set of the project.
 * Shows what will change, asks for confirmation, then reports exactly what happened.
 */
export function BulkStatusDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
  initialStage,
  stageOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCode: string;
  initialStage: string | null;
  /** Stages in the order they appear in the project. */
  stageOrder: string[];
}) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<string>(initialStage ?? stageOrder[0] ?? "lamination");
  const [status, setStatus] = useState<string>("completed");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  // The choices are reset each time the dialog opens; only then is the first preview requested.
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (open) {
      setStage(initialStage ?? stageOrder[0] ?? "lamination");
      setStatus("completed");
      setResult(null);
      setError("");
      setSynced(true);
    } else {
      setSynced(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStage]);

  // Count what would change whenever the stage or status choice changes (nothing is written).
  useEffect(() => {
    if (!open || result || !synced) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setPreview(null);
    supabase
      .rpc("bulk_update_stage_status", {
        p_project_id: projectId,
        p_stage: stage,
        p_status: status,
        p_dry_run: true,
      })
      .then(({ data, error: e }) => {
        if (cancelled) return;
        setLoading(false);
        if (e) {
          setError(
            e.code === "P0001" && e.message
              ? e.message
              : e.code === "42501"
                ? "Only Admin can update statuses in bulk."
                : "We couldn't check the affected panels. Please try again.",
          );
          return;
        }
        setPreview(data as unknown as Preview);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, stage, status, result, synced]);

  async function confirm() {
    if (!preview || running) return;
    setRunning(true);
    const { data, error: e } = await supabase.rpc("bulk_update_stage_status", {
      p_project_id: projectId,
      p_stage: stage,
      p_status: status,
    });
    setRunning(false);
    if (e) {
      setError(
        e.code === "P0001" && e.message
          ? e.message
          : "The bulk update failed. Please check the statuses and try again.",
      );
      return;
    }
    const r = data as unknown as Result;
    setResult(r);
    await queryClient.invalidateQueries();
    if (r.failed.length === 0) {
      toast.success(
        `${STAGE_LABEL[stage]} set to ${STATUS_LABEL[status]} on ${r.updated} panel record${r.updated === 1 ? "" : "s"}.`,
      );
    } else {
      toast.warning(`${r.updated} updated, ${r.failed.length} could not be updated.`);
    }
  }

  const stageName = STAGE_LABEL[stage] ?? stage;
  const statusName = STATUS_LABEL[status] ?? status;

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apply Status to All Panels</DialogTitle>
          <DialogDescription>
            Sets one stage to one status for every panel in every set of this project. Other stages,
            remarks, QC status and weights are not changed.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Project</span>{" "}
              <span className="font-semibold">{projectCode}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Stage</Label>
                <Select value={stage} onValueChange={setStage} disabled={running}>
                  <SelectTrigger aria-label="Stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stageOrder.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STAGE_LABEL[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus} disabled={running}>
                  <SelectTrigger aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BULK_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border p-3 text-sm" aria-live="polite">
              {loading && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Checking affected panels…
                </p>
              )}
              {error && <p className="text-destructive">{error}</p>}
              {preview && !loading && (
                <div className="space-y-2">
                  <p>
                    <span className="text-2xl font-bold">{preview.to_change}</span>{" "}
                    <span className="text-muted-foreground">
                      panel record{preview.to_change === 1 ? "" : "s"} will change to{" "}
                      <span className="font-semibold text-foreground">{statusName}</span>
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.already} already {statusName} · {preview.total} panel
                    {preview.total === 1 ? "" : "s"} have {stageName} in this project
                  </p>
                  {preview.by_set.length > 0 && (
                    <ul className="divide-y rounded-md border text-xs">
                      {preview.by_set.map((s) => (
                        <li key={s.set_number} className="flex justify-between px-2.5 py-1.5">
                          <span className="font-medium">{formatSet(s.set_number)}</span>
                          <span className="text-muted-foreground">
                            {s.to_change} to change · {s.already} already {statusName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.panels_without_stage > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {preview.panels_without_stage} panel
                      {preview.panels_without_stage === 1 ? " does" : "s do"} not have {stageName}{" "}
                      assigned and will not be changed.
                    </p>
                  )}
                  {preview.not_applicable_records > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {preview.not_applicable_records} record
                      {preview.not_applicable_records === 1 ? " is" : "s are"} marked Not Applicable
                      and will be skipped.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3 text-sm" aria-live="polite">
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2.5",
                result.failed.length === 0
                  ? "bg-done text-done-foreground"
                  : "bg-hold text-hold-foreground",
              )}
            >
              {result.failed.length === 0 ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              )}
              <div>
                <p className="font-semibold">
                  {stageName} → {statusName}: {result.updated} of {result.to_change} updated
                </p>
                <p>
                  {result.already} were already {statusName}.
                </p>
              </div>
            </div>
            {result.failed.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wider text-destructive uppercase">
                  Could not be updated
                </p>
                <ul className="divide-y rounded-md border text-xs">
                  {result.failed.map((f, i) => (
                    <li key={i} className="px-2.5 py-1.5">
                      <span className="font-semibold">
                        {f.panel} · {formatSet(f.set_number)}
                      </span>
                      <span className="block text-muted-foreground">{f.error}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Everything else was updated. Fix these panels and run the update again.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={running}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button
              onClick={confirm}
              disabled={!preview || loading || running || preview.to_change === 0}
            >
              {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {preview && preview.to_change > 0
                ? `Apply to ${preview.to_change} panel${preview.to_change === 1 ? "" : "s"}`
                : "Nothing to change"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
