import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";

import { AppShell, GlassPanel } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { STAGES, STAGE_LABEL, formatDate, formatTime } from "@/lib/domain";
import { exportCurrentView } from "@/lib/excel";
import { useProjects } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Production History — Production Tracker" },
      {
        name: "description",
        content:
          "Permanent, append-only record of every production status change with user and time.",
      },
      { property: "og:title", content: "Production History — Production Tracker" },
      {
        property: "og:description",
        content:
          "Permanent, append-only record of every production status change with user and time.",
      },
    ],
  }),
  component: HistoryPage,
});

const PAGE_SIZE = 25;

function HistoryPage() {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState("all");
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["history", projectId],
    queryFn: async () => {
      let q = supabase
        .from("production_history")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(2000);
      if (projectId !== "all") q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const codeById = new Map((projects ?? []).map((p) => [p.id, p.code]));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((h) => {
      if (stage !== "all" && h.stage !== stage) return false;
      if (q && !`${h.panel_name} ${h.changed_by_name ?? ""}`.toLowerCase().includes(q))
        return false;
      if (from && new Date(h.changed_at) < new Date(from)) return false;
      if (to && new Date(h.changed_at) > new Date(`${to}T23:59:59`)) return false;
      return true;
    });
  }, [data, stage, search, from, to]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  async function exportHistory() {
    const id = toast.loading("Preparing Excel workbook...");
    try {
      await exportCurrentView(
        "Production History",
        filtered.map((h) => ({
          Date: formatDate(h.changed_at),
          Time: formatTime(h.changed_at),
          User: h.changed_by_name ?? "",
          Project: codeById.get(h.project_id) ?? "",
          Set: `Set ${h.set_number}`,
          Panel: h.panel_name,
          Stage: STAGE_LABEL[h.stage],
          "Old Status": h.old_status ?? "",
          "New Status": h.new_status,
        })),
        `Exported ${filtered.length} history rows`,
      );
      toast.success("Excel file downloaded.", { id });
    } catch {
      toast.error("We couldn't build the Excel file. Please try again.", { id });
    }
  }

  return (
    <AppShell
      title="Production History"
      breadcrumb="Production Tracker · History"
      actions={
        <Button size="sm" variant="secondary" className="rounded-full" onClick={exportHistory}>
          <FileSpreadsheet className="mr-1 size-4" /> Export
        </Button>
      }
    >
      <GlassPanel className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            value={projectId}
            onValueChange={(v) => {
              setProjectId(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {(projects ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Input
            placeholder="Search panel or user"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </GlassPanel>

      <GlassPanel className="mt-4">
        {isLoading ? (
          <div className="p-5">
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left">
                  {["Date", "Time", "User", "Project", "Set", "Panel", "Stage", "From", "To"].map(
                    (h) => (
                      <th
                        key={h}
                        className="border-b px-4 py-3 text-[11px] tracking-wider uppercase"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((h) => (
                  <tr key={h.id} className="hover:bg-muted/40">
                    <td className="border-b px-4 py-2 whitespace-nowrap">
                      {formatDate(h.changed_at)}
                    </td>
                    <td className="border-b px-4 py-2 whitespace-nowrap">
                      {formatTime(h.changed_at)}
                    </td>
                    <td className="border-b px-4 py-2">{h.changed_by_name || "System"}</td>
                    <td className="border-b px-4 py-2">{codeById.get(h.project_id) ?? "—"}</td>
                    <td className="border-b px-4 py-2">Set {h.set_number}</td>
                    <td className="border-b px-4 py-2">{h.panel_name}</td>
                    <td className="border-b px-4 py-2">{STAGE_LABEL[h.stage]}</td>
                    <td className="border-b px-4 py-2">
                      {h.old_status ? <StatusBadge status={h.old_status} compact /> : "—"}
                    </td>
                    <td className="border-b px-4 py-2">
                      <StatusBadge status={h.new_status} compact />
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-10 text-center text-sm text-muted-foreground"
                    >
                      No history entries match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {filtered.length} entries · history is permanent and cannot be edited or deleted
        </p>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {current} / {pages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
