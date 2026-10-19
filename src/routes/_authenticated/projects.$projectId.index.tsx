import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Gauge, Layers, MoreHorizontal, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { DeleteProjectDialog } from "@/components/DeleteProjectDialog";
import { ProgressBar, ProjectStatusBadge, QcBadge, StatusBadge } from "@/components/StatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  QC_STATUSES,
  STAGE_LABEL,
  STATUSES,
  countryLabel,
  formatDate,
  formatSet,
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
  const [deleting, setDeleting] = useState(false);
  const [setFilter, setSetFilter] = useState("all");
  const navigate = useNavigate();

  const { isAdmin } = useAccess();
  const archived = project?.status === "archived";
  const canConfigure = !archived && isAdmin;

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
        <Skeleton className="h-64 rounded-xl" />
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
          <Button asChild className="mt-4">
            <Link to="/projects">Back to projects</Link>
          </Button>
        </GlassPanel>
      </AppShell>
    );
  }

  const counts = progress?.counts ?? {};
  const setProgressByNumber = new Map(
    (progress?.sets ?? []).map((x) => [x.set_number, x.progress]),
  );
  const panelGroups = Array.from(
    (progress?.panels ?? []).reduce((map, pn) => {
      const list = map.get(pn.set_number) ?? [];
      list.push(pn);
      map.set(pn.set_number, list);
      return map;
    }, new Map<number | null, NonNullable<typeof progress>["panels"]>()),
  )
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a - b))
    .map(([setNumber, panels]) => ({
      setNumber,
      panels,
      setProgress: setNumber === null ? 0 : (setProgressByNumber.get(setNumber) ?? 0),
    }));

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
          {isAdmin && (
            <Button asChild size="sm" variant="secondary" className="rounded-full">
              <Link to="/projects/$projectId/panels" params={{ projectId }}>
                <Settings2 className="mr-1 size-4" /> Configure
              </Link>
            </Button>
          )}
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
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleting(true)}
                >
                  <Trash2 className="mr-2 size-4" /> Delete project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
              {isAdmin ? (
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
              ) : (
                <ProjectStatusBadge status={project.status} />
              )}
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
          <p className="mt-5 mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Quality control
          </p>
          <ul className="space-y-2">
            {QC_STATUSES.map((q) => (
              <li key={q.value} className="flex items-center justify-between text-sm">
                <QcBadge status={q.value} />
                <span className="font-semibold">{progress?.qc?.[q.value] ?? 0}</span>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <h3 className="font-display font-bold">Progress by set</h3>
          <ul className="mt-4 space-y-3">
            {(progress?.sets ?? []).map((s) => (
              <li key={s.set_number}>
                <div className="flex justify-between text-sm">
                  <span>{formatSet(s.set_number)}</span>
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
      <GlassPanel className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-display font-bold">
              <Layers className="size-4 text-primary" /> Panels by set
            </h3>
            <p className="text-xs text-muted-foreground">
              Project → Set → Panel. Progress counts completed stages for each panel.
            </p>
          </div>
          <Select value={setFilter} onValueChange={setSetFilter}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sets</SelectItem>
              {(sets ?? []).map((x) => (
                <SelectItem key={x.id} value={String(x.set_number)}>
                  {formatSet(x.set_number)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4 space-y-5">
          {panelGroups
            .filter((g) => setFilter === "all" || String(g.setNumber) === setFilter)
            .map((g) => (
              <div key={g.setNumber ?? "legacy"}>
                <div className="mb-2 flex items-center justify-between border-b pb-1.5">
                  <p className="text-sm font-bold">
                    {formatSet(g.setNumber)}
                    <span className="ml-2 text-xs font-medium text-muted-foreground">
                      {g.panels.length} panel{g.panels.length === 1 ? "" : "s"}
                    </span>
                  </p>
                  {g.setNumber !== null && (
                    <span className="text-xs font-semibold">{g.setProgress}%</span>
                  )}
                </div>
                <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
                  {g.panels.map((pn) => (
                    <li key={pn.id}>
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="truncate">
                          {pn.panel}
                          {pn.part_number && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              #{pn.part_number}
                            </span>
                          )}
                        </span>
                        <span className="font-semibold">{pn.progress}%</span>
                      </div>
                      <ProgressBar value={pn.progress} className="mt-1 h-1.5" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {panelGroups.length === 0 && (
            <p className="text-sm text-muted-foreground">No panels yet.</p>
          )}
        </div>
      </GlassPanel>

      <DeleteProjectDialog
        project={{ id: project.id, code: project.code, name: project.name }}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => navigate({ to: "/projects" })}
      />
    </AppShell>
  );
}
