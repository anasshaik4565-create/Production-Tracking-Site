import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Folders,
  PlayCircle,
  CheckCircle2,
  PauseCircle,
  Gauge,
  ClipboardCheck,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

import { AppShell, GlassPanel, StatCard } from "@/components/AppShell";
import { ProgressBar, ProjectStatusBadge, QcBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/lib/access";
import { STAGE_LABEL, STATUS_LABEL, countryLabel, formatDateTime, formatSet } from "@/lib/domain";
import { useProjects } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Production Tracker" },
      {
        name: "description",
        content: "Live overview of projects, production progress and recent shop-floor activity.",
      },
      { property: "og:title", content: "Dashboard — Production Tracker" },
      {
        property: "og:description",
        content: "Live overview of projects, production progress and recent shop-floor activity.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { isAdmin } = useAccess();
  const { data: projects, isLoading } = useProjects();
  const { data: activity } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_history")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const { data: qcCounts } = useQuery({
    queryKey: ["dashboard-qc"],
    queryFn: async () => {
      const count = async (status: "qc_pending" | "qc_approved" | "not_ok") => {
        const { count } = await supabase
          .from("production_status")
          .select("id", { count: "exact", head: true })
          .eq("qc_status", status);
        return count ?? 0;
      };
      const [pending, approved, notOk] = await Promise.all([
        count("qc_pending"),
        count("qc_approved"),
        count("not_ok"),
      ]);
      return { pending, approved, notOk };
    },
  });

  const list = projects ?? [];
  const total = list.length;
  const active = list.filter((p) => p.status === "active").length;
  const completed = list.filter((p) => p.status === "completed").length;
  const onHold = list.filter((p) => p.status === "on_hold").length;
  const overall = total ? Math.round(list.reduce((sum, p) => sum + p.progress, 0) / total) : 0;

  return (
    <AppShell
      title="Production Tracker"
      breadcrumb="Production Tracker · Dashboard"
      actions={
        isAdmin ? (
          <Button asChild>
            <Link to="/projects/new">
              <Plus className="mr-1 size-4" /> Create New Project
            </Link>
          </Button>
        ) : undefined
      }
    >
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard
          label="Total projects"
          value={total}
          hint="All projects"
          icon={<Folders className="size-4" />}
        />
        <StatCard
          label="Active projects"
          value={active}
          hint="In production"
          tone="default"
          icon={<PlayCircle className="size-4" />}
        />
        <StatCard
          label="Completed"
          value={completed}
          hint="Delivered"
          tone="good"
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          label="On hold"
          value={onHold}
          hint="Paused production"
          tone="warn"
          icon={<PauseCircle className="size-4" />}
        />
        <GlassPanel className="col-span-2 p-4 lg:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Overall progress</p>
              <p className="mt-1 text-2xl font-bold tracking-tight">{overall}%</p>
            </div>
            <div className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
              <Gauge className="size-4" />
            </div>
          </div>
          <ProgressBar value={overall} className="mt-3" />
        </GlassPanel>
      </section>

      <section className="mt-3 grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          label="QC Pending"
          value={qcCounts?.pending ?? "—"}
          hint="Awaiting inspection"
          tone="qc"
          icon={<ClipboardCheck className="size-4" />}
        />
        <StatCard
          label="QC Approved"
          value={qcCounts?.approved ?? "—"}
          hint="Passed inspection"
          tone="good"
          icon={<ShieldCheck className="size-4" />}
        />
        <StatCard
          label="Not OK"
          value={qcCounts?.notOk ?? "—"}
          hint="Needs rework"
          tone="bad"
          icon={<ShieldAlert className="size-4" />}
        />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <GlassPanel className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight">Recent Projects</h2>
              <p className="text-xs text-muted-foreground">Most recently updated first</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">View all</Link>
            </Button>
          </div>
          <div className="space-y-2 px-3 pb-4">
            {isLoading &&
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            {!isLoading && list.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No projects yet. Create your first project to get started.
              </p>
            )}
            {list.slice(0, 6).map((p) => (
              <Link
                key={p.id}
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                className="flex flex-col gap-2 rounded-lg px-3 py-3 transition hover:bg-card sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{p.name}</span>
                    <ProjectStatusBadge status={p.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.code} · {countryLabel(p.country, p.country_other)} · {p.setsCreated} sets ·{" "}
                    {p.panelCount} panels
                  </p>
                </div>
                <div className="w-full sm:w-40">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-semibold">{p.progress}%</span>
                  </div>
                  <ProgressBar value={p.progress} className="mt-1 h-1.5" />
                </div>
              </Link>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold tracking-tight">Production Activity</h2>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Live
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {(activity ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">No production updates yet.</li>
            )}
            {(activity ?? []).map((a) => (
              <li key={a.id} className="flex gap-3">
                <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0">
                  <p className="text-sm leading-snug">
                    {a.panel_name} · {formatSet(a.set_number)} · {STAGE_LABEL[a.stage]} →{" "}
                    <span className="font-semibold">{STATUS_LABEL[a.new_status]}</span>
                  </p>
                  {a.new_qc_status !== a.old_qc_status && a.new_qc_status && (
                    <div className="mt-1">
                      <QcBadge status={a.new_qc_status} />
                    </div>
                  )}
                  {a.remarks && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground italic">
                      “{a.remarks}”
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {a.changed_by_name || "System"} · {formatDateTime(a.changed_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </div>
    </AppShell>
  );
}
