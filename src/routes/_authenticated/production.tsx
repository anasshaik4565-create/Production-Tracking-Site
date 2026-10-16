import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { ProgressBar, ProjectStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { countryLabel } from "@/lib/domain";
import { useProjects } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/production")({
  head: () => ({
    meta: [
      { title: "Production — Production Tracker" },
      { name: "description", content: "Pick a project to update its panel and stage production." },
      { property: "og:title", content: "Production — Production Tracker" },
      {
        property: "og:description",
        content: "Pick a project to update its panel and stage production.",
      },
    ],
  }),
  component: ProductionPicker,
});

function ProductionPicker() {
  const { data, isLoading } = useProjects();

  return (
    <AppShell title="Production" breadcrumb="Production Tracker · Production">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-3xl" />)}
        {(data ?? []).map((p) => (
          <GlassPanel key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-bold">{p.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {p.code} · {countryLabel(p.country, p.country_other)} · {p.setsCreated} sets
                </p>
              </div>
              <ProjectStatusBadge status={p.status} />
            </div>
            <ProgressBar value={p.progress} className="mt-4" />
            <Button asChild size="sm" className="mt-4 w-full rounded-full">
              <Link to="/projects/$projectId/production" params={{ projectId: p.id }}>
                Open production board
              </Link>
            </Button>
          </GlassPanel>
        ))}
        {!isLoading && (data ?? []).length === 0 && (
          <GlassPanel className="p-10 text-center md:col-span-2 xl:col-span-3">
            <p className="text-sm text-muted-foreground">You have no projects assigned yet.</p>
          </GlassPanel>
        )}
      </div>
    </AppShell>
  );
}
