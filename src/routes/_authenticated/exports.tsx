import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGES, STATUSES } from "@/lib/domain";
import { exportProjectWorkbook } from "@/lib/excel";
import { usePanels, useProjects, useSets } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/exports")({
  head: () => ({
    meta: [
      { title: "Excel Exports — Production Tracker" },
      {
        name: "description",
        content: "Download .xlsx workbooks for a whole project or a filtered set, panel or stage.",
      },
      { property: "og:title", content: "Excel Exports — Production Tracker" },
      {
        property: "og:description",
        content: "Download .xlsx workbooks for a whole project or a filtered set, panel or stage.",
      },
    ],
  }),
  component: Exports,
});

function Exports() {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState("");
  const active = projectId || projects?.[0]?.id || "";
  const { data: sets } = useSets(active);
  const { data: panels } = usePanels(active);

  const [setId, setSetId] = useState("all");
  const [panelId, setPanelId] = useState("all");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!active || busy) return;
    setBusy(true);
    const id = toast.loading("Building your Excel workbook...");
    try {
      await exportProjectWorkbook(active, {
        setId: setId === "all" ? null : setId,
        panelId: panelId === "all" ? null : panelId,
        stage: stage === "all" ? null : stage,
        status: status === "all" ? null : status,
      });
      toast.success("Excel file downloaded.", { id });
    } catch {
      toast.error("We couldn't build the Excel file. Please try again.", { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Excel Exports" breadcrumb="Production Tracker · Exports">
      <GlassPanel className="p-5">
        <h2 className="font-display text-lg font-bold tracking-tight">Build a workbook</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every download is a real .xlsx file with Project Summary, Sets, Panels, Production Status
          and Production History sheets. Filters apply to the status and history sheets.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={active} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Set</Label>
            <Select value={setId} onValueChange={setSetId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sets</SelectItem>
                {(sets ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    Set {s.set_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Panel</Label>
            <Select value={panelId} onValueChange={setPanelId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All panels</SelectItem>
                {(panels ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
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
          </div>
          <div className="flex items-end">
            <Button className="w-full rounded-full" onClick={run} disabled={busy || !active}>
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 size-4" />
              )}
              Download .xlsx
            </Button>
          </div>
        </div>
      </GlassPanel>
    </AppShell>
  );
}
