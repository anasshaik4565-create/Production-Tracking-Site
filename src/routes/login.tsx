import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Eye, Factory, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { GlassPanel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { roleFromSession, signInAs, type AccessRole } from "@/lib/access";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Production Tracker" }] }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (roleFromSession(data.session)) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

const MODES: { value: AccessRole; label: string; hint: string; icon: typeof Eye }[] = [
  { value: "reader", label: "Login Reader", hint: "View only", icon: Eye },
  { value: "admin", label: "Login Admin", hint: "Full access", icon: ShieldCheck },
];

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AccessRole>("reader");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setError("Please enter the password.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await signInAs(mode, password);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPassword("");
    toast.success(mode === "admin" ? "Signed in as Admin." : "Signed in as Reader.");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <GlassPanel className="w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Factory className="size-6" />
          </div>
          <div>
            <h1 className="text-xl leading-tight font-bold tracking-tight">Production Tracker</h1>
            <p className="text-sm text-muted-foreground">Choose how you want to sign in</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Access mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => {
                setMode(m.value);
                setError("");
              }}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left",
                mode === m.value
                  ? "border-primary bg-accent text-accent-foreground ring-2 ring-primary/30"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <m.icon className="size-5" />
              <span className="text-sm font-bold">{m.label}</span>
              <span className="text-xs">{m.hint}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">
              {mode === "admin" ? "Admin password" : "Reader password"}
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {mode === "admin" ? "Login Admin" : "Login Reader"}
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
          Readers can view everything but cannot change data. Admins can create and edit.
        </p>
      </GlassPanel>
    </div>
  );
}
