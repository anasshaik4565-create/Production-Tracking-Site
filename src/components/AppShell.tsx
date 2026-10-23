import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  FileSpreadsheet,
  Folders,
  Gauge,
  History,
  LayoutDashboard,
  Info,
  LogOut,
  Menu,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";
import { QcBadge } from "@/components/StatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { clearAssistantStorage } from "@/lib/assistant/storage";
import {
  ASSISTANT_NAME,
  COMPANY_ADDRESS,
  COMPANY_NAME,
  COMPANY_SHORT,
  COMPANY_SUFFIX,
} from "@/lib/brand";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QC_STATUS_LABEL, STAGE_LABEL, STATUS_LABEL, formatSet, formatTime } from "@/lib/domain";
import { signOutAll, useAccess } from "@/lib/access";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { to: "/projects", label: "Projects", icon: Folders },
      { to: "/production", label: "Production", icon: Gauge },
      { to: "/history", label: "History", icon: History },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/assistant", label: ASSISTANT_NAME, icon: Sparkles },
      { to: "/exports", label: "Exports", icon: FileSpreadsheet },
    ],
  },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.16em] text-sidebar-foreground/50 uppercase">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-1 before:w-1 before:rounded-full before:bg-sidebar-primary",
                }}
              >
                <item.icon className="size-[18px] shrink-0" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** The company logo on a white tile so it reads clearly on the dark sidebar in both themes. */
export function LogoTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-white p-1 shadow-sm ring-1 ring-black/10",
        className ?? "size-11",
      )}
    >
      <img
        src="/trio-logo.png"
        alt={`${COMPANY_NAME} logo`}
        width={369}
        height={356}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-3 px-1" title={COMPANY_NAME}>
      <LogoTile />
      <div className="min-w-0">
        <p className="text-[17px] leading-none font-bold tracking-tight text-sidebar-accent-foreground">
          {COMPANY_SHORT}
        </p>
        <p className="mt-1 text-[10.5px] leading-tight font-medium text-sidebar-foreground/70">
          {COMPANY_SUFFIX}
        </p>
      </div>
    </div>
  );
}

function AboutDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Info className="size-4 shrink-0" />
        About {COMPANY_SHORT}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-3">
              <LogoTile className="size-14" />
              <div>
                <DialogTitle className="text-left">{COMPANY_NAME}</DialogTitle>
                <DialogDescription className="text-left">Production Tracker</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="text-sm">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Company address
            </p>
            <p className="mt-1">{COMPANY_ADDRESS}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Shows which access mode is active and lets the user sign out. */
function AccessChip() {
  const { role, ready } = useAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eraseError, setEraseError] = useState("");

  // Session ended (sign-out in another tab, expired token): go back to the login page.
  useEffect(() => {
    if (ready && !role) navigate({ to: "/login", replace: true });
  }, [ready, role, navigate]);

  async function finishLogout() {
    await signOutAll();
    queryClient.clear();
    navigate({ to: "/login", replace: true });
  }

  /** Erase the assistant chats first, verify it, and only then sign out. */
  async function logoutAndClear() {
    if (busy) return;
    setBusy(true);
    setEraseError("");
    const result = clearAssistantStorage();
    if (!result.ok) {
      setBusy(false);
      setEraseError(
        `${result.error ?? "The chat history could not be erased."} Your chat history has NOT been confirmed as erased.`,
      );
      return;
    }
    await finishLogout();
    setBusy(false);
    setConfirmOpen(false);
  }

  if (!role) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "hidden rounded-md px-2 py-1 text-[11px] font-bold tracking-wide uppercase sm:inline-block",
          role === "admin"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {role === "admin" ? "Admin" : "Reader"}
      </span>
      <button
        aria-label="Sign out"
        title="Sign out"
        onClick={() => {
          setEraseError("");
          setConfirmOpen(true);
        }}
        className="grid size-9 place-items-center rounded-lg border bg-card text-muted-foreground shadow-sm hover:text-foreground"
      >
        <LogOut className="size-4" />
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !busy && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Logging Out – AI Chat History Will Be Erased</AlertDialogTitle>
            <AlertDialogDescription>
              Logging out will permanently clear your Trio AI Assistant chat history for this
              session. This action cannot be undone. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {eraseError && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {eraseError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={logoutAndClear} disabled={busy}>
              {eraseError ? "Try again" : "Logout and Clear History"}
            </Button>
            {eraseError && (
              <Button variant="outline" onClick={finishLogout} disabled={busy}>
                Logout anyway
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Notifications() {
  const { data } = useQuery({
    queryKey: ["recent-activity"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_history")
        .select(
          "id,panel_name,stage,old_status,new_status,old_qc_status,new_qc_status,remarks,changed_by_name,changed_at,set_number",
        )
        .order("changed_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Notifications"
          className="relative grid size-9 place-items-center rounded-lg border bg-card text-muted-foreground shadow-sm hover:text-foreground"
        >
          <Bell className="size-4" />
          {(data?.length ?? 0) > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-card" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-bold">Recent activity</p>
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto">
          {(data ?? []).length === 0 && (
            <li className="px-4 py-6 text-sm text-muted-foreground">No recent activity yet.</li>
          )}
          {(data ?? []).map((n) => {
            const qcChanged = n.new_qc_status !== n.old_qc_status && n.new_qc_status;
            const statusChanged = n.new_status !== n.old_status;
            return (
              <li key={n.id} className="px-4 py-3">
                <p className="text-sm leading-snug">
                  {n.panel_name} · {formatSet(n.set_number)} · {STAGE_LABEL[n.stage] ?? n.stage}
                  {statusChanged || !qcChanged ? (
                    <>
                      {" "}
                      → <span className="font-semibold">{STATUS_LABEL[n.new_status]}</span>
                    </>
                  ) : null}
                </p>
                {qcChanged ? (
                  <div className="mt-1">
                    <QcBadge status={n.new_qc_status as string} />
                  </div>
                ) : n.old_qc_status && !n.new_qc_status ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {QC_STATUS_LABEL[n.old_qc_status]} cleared
                  </p>
                ) : null}
                {n.remarks && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground italic">
                    “{n.remarks}”
                  </p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {n.changed_by_name || "System"} · {formatTime(n.changed_at)}
                </p>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function AppShell({
  title,
  breadcrumb,
  actions,
  children,
}: {
  title: string;
  breadcrumb?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <Brand />
        <NavLinks />
        <AboutDialog />
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-72 border-sidebar-border bg-sidebar p-4 text-sidebar-foreground"
              >
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand />
                <NavLinks />
                <AboutDialog />
              </SheetContent>
            </Sheet>
            <LogoTile className="size-9 lg:hidden" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                {[COMPANY_NAME, breadcrumb?.replace(/^Production Tracker\s*·\s*/, "")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <h1 className="truncate text-xl font-bold tracking-tight lg:text-2xl">{title}</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <ThemeToggle />
            <Notifications />
            <AccessChip />
          </div>
        </header>
        <div className="pt-fade-in mx-auto max-w-[1500px] px-4 py-6 pb-12 lg:px-8">{children}</div>
      </div>
    </div>
  );
}

export function GlassPanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("glass relative overflow-hidden rounded-xl border", className)}>
      {children}
    </section>
  );
}

/** Small KPI tile used on dashboards. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad" | "qc";
}) {
  const toneClass = {
    default: "bg-accent text-accent-foreground",
    good: "bg-done text-done-foreground",
    warn: "bg-hold text-hold-foreground",
    bad: "bg-rework text-rework-foreground",
    qc: "bg-qc-pending text-qc-pending-foreground",
  }[tone];
  return (
    <GlassPanel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
          {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        {icon && (
          <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", toneClass)}>
            {icon}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
