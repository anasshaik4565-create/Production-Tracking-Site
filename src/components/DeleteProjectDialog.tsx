import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";

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
import { supabase } from "@/integrations/supabase/client";

type Summary = {
  sets: number;
  panels: number;
  records: number;
  completed: number;
  history: number;
};

async function countRows(
  table: "production_sets" | "panels" | "production_status" | "production_history",
  projectId: string,
  extra?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
) {
  let q = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Confirmation dialog for permanently deleting a project and everything inside it. */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: { id: string; code: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !project) return;
    setTyped("");
    setSummary(null);
    setLoadError(false);
    let cancelled = false;
    (async () => {
      try {
        const [sets, panels, records, completed, history] = await Promise.all([
          countRows("production_sets", project.id),
          countRows("panels", project.id),
          countRows("production_status", project.id),
          countRows("production_status", project.id, (q) => q.eq("status", "completed")),
          countRows("production_history", project.id),
        ]);
        if (!cancelled) setSummary({ sets, panels, records, completed, history });
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, project]);

  const matches = !!project && typed.trim().toUpperCase() === project.code.trim().toUpperCase();
  const hasWork = !!summary && (summary.history > 0 || summary.completed > 0);

  async function confirmDelete() {
    if (!project || !matches || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("delete_project", {
      p_project_id: project.id,
      p_confirm_code: typed.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message?.includes("confirmation")
          ? "The code you typed doesn't match this project."
          : "We couldn't delete the project. Nothing was removed — please try again.",
      );
      return;
    }
    const result = data as { code: string; panels: number; sets: number; records: number };
    toast.success(
      `Project ${result.code} deleted (${result.sets} sets, ${result.panels} panels, ${result.records} production records).`,
    );
    onOpenChange(false);
    await queryClient.invalidateQueries();
    onDeleted?.();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete project {project?.code}?</DialogTitle>
          <DialogDescription>
            {project?.name} and everything inside it will be permanently removed. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {!summary && !loadError && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking what will be deleted…
            </p>
          )}
          {loadError && (
            <p className="rounded-lg bg-hold px-3 py-2 text-hold-foreground">
              We couldn't check this project's contents. You can still delete it, but please make
              sure it is the right project.
            </p>
          )}
          {summary && (
            <ul className="grid grid-cols-2 gap-2">
              {[
                ["Sets", summary.sets],
                ["Panels", summary.panels],
                ["Production records", summary.records],
                ["History entries", summary.history],
              ].map(([label, n]) => (
                <li key={label as string} className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-lg font-bold">{n}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </li>
              ))}
            </ul>
          )}
          {hasWork && summary && (
            <div className="flex items-start gap-2 rounded-lg bg-rework px-3 py-2.5 text-rework-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-semibold">This project has recorded work.</span>{" "}
                {summary.completed > 0 ? `${summary.completed} stage records are completed. ` : ""}
                {summary.history > 0
                  ? `${summary.history} history entries (including remarks) will be lost.`
                  : ""}{" "}
                Consider exporting it from the Exports page first.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-code">
              Type <span className="font-bold">{project?.code}</span> to confirm
            </Label>
            <Input
              id="confirm-code"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={project?.code}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={!matches || busy}>
            {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
