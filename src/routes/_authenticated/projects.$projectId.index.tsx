import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Gauge, Settings2 } from "lucide-react";
import { useState } from "react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { ProgressBar, ProjectStatusBadge, StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  STAGE_LABEL,
  STATUSES,
  countryLabel,
  formatDate,
} from "@/lib/domain";
import { exportProjectWorkbook } from "@/lib/excel";
import { usePanels, useProject, useProjectProgress, useSets } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/projects/$projectId/")({
  head: () => ({
    meta: [
      { title: "Project Overview — Production Tracker" },
      {
        name: "description",
        content:
          "Project progress by set, panel and stage with configuration and export shortcuts.",
      },
      { property: "og:title", content: "Project Overview — Production Tracker" },
      {
        property: "og:description",
        content:
          "Project progress by set, panel and stage with configuration and export shortcuts.",
      },
    ],
  }),
  component: ProjectOverview,
});

function ProjectOverview() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: project, isLoading } = useProject(projectId);
  const { data: sets } = useSets(projectId);
  const { data: panels } = usePanels(projectId);
  const { data: progress } = useProjectProgress(projectId);
  const [exporting, setExporting] = useState(false);

  const archived = project?.status === "archived";
  const canConfigure = !archived;

  async function changeStatus(status: string) {
    const { error } = await supabase
      .from("projects")
      .update({ status: status as never })
      .eq("id", projectId);
    if (error) {
      toast.error("You do not have permission to change this project's status.");
      return;
    }
    await logAudit(
      "Change Project Status",
      `Project ${project?.code} set to ${PROJECT_STATUS_LABEL[status]}`,
      projectId,
    );
    await queryClient.invalidateQueries();
    toast.success(`Project marked ${PROJECT_STATUS_LABEL[status]}.`);
  }

  async function exportAll() {
    if (exporting) return;
    setExporting(true);
    const id = toast.loading("Preparing Excel workbook...");
    try {
      await exportProjectWorkbook(projectId);
      toast.success("Excel file downloaded.", { id });
    } catch {
      toast.error("We couldn't build the Excel file. Please try again.", { id });
    } finally {
      setExporting(false);
    }
  }

  if (isLoading) {
    return (
      <AppShell title="Loading project" breadcrumb="Production Tracker · Projects">
        <Skeleton className="h-64 rounded-3xl" />
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell title="Project unavailable" breadcrumb="Production Tracker · Projects">
        <GlassPanel className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            This project doesn't exist or you don't have access to it.
          </p>
          <Button asChild className="mt-4 rounded-full">
            <Link to="/projects">Back to projects</Link>
          </Button>
        </GlassPanel>
      </AppShell>
    );
  }

  const counts = progress?.counts ?? {};

  return (
    <AppShell
      title={project.name}
      breadcrumb={`Production Tracker · Projects · ${project.code}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="rounded-full">
            <Link to="/projects/$projectId/production" params={{ projectId }}>
              <Gauge className="mr-1 size-4" /> Production
            </Link>
          </Button>
          {
            <Button asChild size="sm" variant="secondary" className="rounded-full">
              <Link to="/projects/$projectId/panels" params={{ projectId }}>
                <Settings2 className="mr-1 size-4" /> Configure
              </Link>
            </Button>
          }
          {
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={exportAll}
              disabled={exporting}
            >
              <FileSpreadsheet className="mr-1 size-4" /> Export
            </Button>
          }
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassPanel className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight">Project details</h2>
              <p className="text-xs text-muted-foreground">Code {project.code}</p>
            </div>
            <div className="flex items-center gap-2">
              <ProjectStatusBadge status={project.status} />
              {
                <Select value={project.status} onValueChange={changeStatus}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            </div>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">
                Country
              </dt>
              <dd className="font-semibold">
                {countryLabel(project.country, project.country_other)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">Sets</dt>
              <dd className="font-semibold">{sets?.length ?? 0}</dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">
                Active panels
              </dt>
              <dd className="font-semibold">{(panels ?? []).filter((p) => p.is_active).length}</dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">
                Created
              </dt>
              <dd className="font-semibold">{formatDate(project.created_at)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] tracking-wider text-muted-foreground uppercase">
                Process
              </dt>
              <dd className="text-sm">{project.process || "Not specified"}</dd>
            </div>
          </dl>
          {archived && (
            <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              This project is archived and read-only. Change the status to resume work.
            </p>
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <h2 className="font-display text-lg font-bold tracking-tight">Overall progress</h2>
          <p className="mt-4 font-display text-5xl font-bold prism-text">
            {progress?.overall ?? 0}%
          </p>
          <ProgressBar value={progress?.overall ?? 0} className="mt-3" />
          <ul className="mt-5 space-y-2">
            {STATUSES.map((s) => (
              <li key={s.value} className="flex items-center justify-between text-sm">
                <StatusBadge status={s.value} />
                <span className="font-semibold">{counts[s.value] ?? 0}</span>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <GlassPanel className="p-5">
          <h3 className="font-display font-bold">Progress by set</h3>
          <ul className="mt-4 space-y-3">
            {(progress?.sets ?? []).map((s) => (
              <li key={s.set_number}>
                <div className="flex justify-between text-sm">
                  <span>Set {s.set_number}</span>
                  <span className="font-semibold">{s.progress}%</span>
                </div>
                <ProgressBar value={s.progress} className="mt-1 h-1.5" />
              </li>
            ))}
            {(progress?.sets ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">No sets yet.</li>
            )}
          </ul>
        </GlassPanel>

        <GlassPanel className="p-5">
          <h3 className="font-display font-bold">Progress by panel</h3>
          <ul className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
            {(progress?.panels ?? []).map((p) => (
              <li key={p.panel}>
                <div className="flex justify-between text-sm">
                  <span className="truncate">{p.panel}</span>
                  <span className="font-semibold">{p.progress}%</span>
                </div>
                <ProgressBar value={p.progress} className="mt-1 h-1.5" />
              </li>
            ))}
            {(progress?.panels ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">No panels yet.</li>
            )}
          </ul>
        </GlassPanel>

        <GlassPanel className="p-5">
          <h3 className="font-display font-bold">Progress by stage</h3>
          <ul className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
            {(progress?.stages ?? []).map((s) => (
              <li key={s.stage}>
                <div className="flex justify-between text-sm">
                  <span className="truncate">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                  <span className="font-semibold">{s.progress}%</span>
                </div>
                <ProgressBar value={s.progress} className="mt-1 h-1.5" />
              </li>
            ))}
            {(progress?.stages ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">
                No production records yet.{" "}
                {canConfigure ? "Configure panels and generate workflows." : ""}
              </li>
            )}
          </ul>
        </GlassPanel>
      </div>
    </AppShell>
  );
}
