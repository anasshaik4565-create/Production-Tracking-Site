import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, MoreVertical, Trash2, ExternalLink } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { useAccess } from "@/lib/access";
import { DeleteProjectDialog } from "@/components/DeleteProjectDialog";
import { ProgressBar, ProjectStatusBadge } from "@/components/StatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PROJECT_STATUSES, countryLabel, formatDate } from "@/lib/domain";
import { useProjects } from "@/lib/queries";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: pageTitle("Projects") },
      {
        name: "description",
        content: "Search, filter and open every production project you have access to.",
      },
      { property: "og:title", content: "Projects — Production Tracker" },
      {
        property: "og:description",
        content: "Search, filter and open every production project you have access to.",
      },
    ],
  }),
  component: ProjectsPage,
});

const PAGE_SIZE = 9;

function ProjectsPage() {
  const { data, isLoading } = useProjects();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let list = [...(data ?? [])];
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          p.process.toLowerCase().includes(q),
      );
    if (status !== "all") list = list.filter((p) => p.status === status);
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "progress") return b.progress - a.progress;
      if (sort === "oldest")
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [data, search, status, sort]);

  const { isAdmin } = useAccess();
  const [toDelete, setToDelete] = useState<{ id: string; code: string; name: string } | null>(null);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <AppShell title="Projects" breadcrumb="Production Tracker · Projects">
      <GlassPanel className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name, code or process"
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PROJECT_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recently updated</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name (A–Z)</SelectItem>
              <SelectItem value="progress">Highest progress</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GlassPanel>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading &&
          [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        {!isLoading && visible.length === 0 && (
          <GlassPanel className="p-10 text-center md:col-span-2 xl:col-span-3">
            <p className="text-sm text-muted-foreground">No projects match your filters.</p>
          </GlassPanel>
        )}
        {visible.map((p) => (
          <GlassPanel key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-bold tracking-tight">{p.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {p.code} · {countryLabel(p.country, p.country_other)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ProjectStatusBadge status={p.status} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Actions for ${p.code}`}
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to="/projects/$projectId" params={{ projectId: p.id }}>
                        <ExternalLink className="mr-2 size-4" /> Open project
                      </Link>
                    </DropdownMenuItem>
                    {isAdmin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setToDelete({ id: p.id, code: p.code, name: p.name })}
                        >
                          <Trash2 className="mr-2 size-4" /> Delete project
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <p className="mt-3 line-clamp-1 text-sm text-muted-foreground">
              {p.process || "Process not specified"}
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-muted/60 py-2">
                <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">Sets</dt>
                <dd className="font-display text-lg font-bold">{p.setsCreated}</dd>
              </div>
              <div className="rounded-xl bg-muted/60 py-2">
                <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">
                  Panels
                </dt>
                <dd className="font-display text-lg font-bold">{p.panelCount}</dd>
              </div>
              <div className="rounded-xl bg-muted/60 py-2">
                <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">Done</dt>
                <dd className="font-display text-lg font-bold">{p.progress}%</dd>
              </div>
            </dl>
            <ProgressBar value={p.progress} className="mt-4" />
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Created {formatDate(p.created_at)}
              </span>
              <Button asChild size="sm" variant="secondary" className="rounded-full">
                <Link to="/projects/$projectId" params={{ projectId: p.id }}>
                  Open
                </Link>
              </Button>
            </div>
          </GlassPanel>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {current} of {pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={current === pages}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      )}
      <DeleteProjectDialog
        project={toDelete}
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
      />
    </AppShell>
  );
}
