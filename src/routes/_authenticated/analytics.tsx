import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { ProgressBar, StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGE_LABEL, STATUSES } from "@/lib/domain";
import { useProjectProgress, useProjects } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Production Tracker" },
      {
        name: "description",
        content: "Progress and status analytics by project, set, panel and production stage.",
      },
      { property: "og:title", content: "Analytics — Production Tracker" },
      {
        property: "og:description",
        content: "Progress and status analytics by project, set, panel and production stage.",
      },
    ],
  }),
  component: Analytics,
});

function Analytics() {
  const { data: projects, isLoading } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const active = projectId ?? projects?.[0]?.id ?? "";
  const { data: progress } = useProjectProgress(active);

  const counts = progress?.counts ?? {};
  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <AppShell
      title="Analytics"
      breadcrumb="Production Tracker · Analytics"
      actions={
        <Select value={active} onValueChange={setProjectId}>
          <SelectTrigger className="w-48">
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
      }
    >
      {isLoading ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : (projects ?? []).length === 0 ? (
        <GlassPanel className="p-10 text-center">
          <p className="text-sm text-muted-foreground">No projects available to analyse yet.</p>
        </GlassPanel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <GlassPanel className="p-5">
              <p className="text-[11px] tracking-wider text-muted-foreground uppercase">
                Overall progress
              </p>
              <p className="mt-2 font-display text-5xl font-bold prism-text">
                {progress?.overall ?? 0}%
              </p>
              <ProgressBar value={progress?.overall ?? 0} className="mt-3" />
              <p className="mt-3 text-xs text-muted-foreground">
                {totalRecords} production records tracked
              </p>
            </GlassPanel>

            <GlassPanel className="p-5 lg:col-span-2">
              <p className="text-[11px] tracking-wider text-muted-foreground uppercase">
                Status distribution
              </p>
              <ul className="mt-4 space-y-3">
                {STATUSES.map((s) => {
                  const value = counts[s.value] ?? 0;
                  const pct = totalRecords ? Math.round((value / totalRecords) * 100) : 0;
                  return (
                    <li key={s.value}>
                      <div className="flex items-center justify-between text-sm">
                        <StatusBadge status={s.value} />
                        <span className="font-semibold">
                          {value} · {pct}%
                        </span>
                      </div>
                      <ProgressBar value={pct} className="mt-1 h-1.5" />
                    </li>
                  );
                })}
              </ul>
            </GlassPanel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <GlassPanel className="p-5">
              <h3 className="font-display font-bold">By set</h3>
              <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                {(progress?.sets ?? []).map((s) => (
                  <li key={s.set_number}>
                    <div className="flex justify-between text-sm">
                      <span>Set {s.set_number}</span>
                      <span className="font-semibold">{s.progress}%</span>
                    </div>
                    <ProgressBar value={s.progress} className="mt-1 h-1.5" />
                  </li>
                ))}
              </ul>
            </GlassPanel>
            <GlassPanel className="p-5">
              <h3 className="font-display font-bold">By panel</h3>
              <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                {(progress?.panels ?? []).map((p) => (
                  <li key={p.panel}>
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{p.panel}</span>
                      <span className="font-semibold">{p.progress}%</span>
                    </div>
                    <ProgressBar value={p.progress} className="mt-1 h-1.5" />
                  </li>
                ))}
              </ul>
            </GlassPanel>
            <GlassPanel className="p-5">
              <h3 className="font-display font-bold">By stage</h3>
              <ul className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                {(progress?.stages ?? []).map((s) => (
                  <li key={s.stage}>
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                      <span className="font-semibold">{s.progress}%</span>
                    </div>
                    <ProgressBar value={s.progress} className="mt-1 h-1.5" />
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </div>
        </>
      )}
    </AppShell>
  );
}
