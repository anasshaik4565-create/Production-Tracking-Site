import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { GlassPanel } from "@/components/AppShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { roleFromSession, signInAs, type AccessRole } from "@/lib/access";
import { APP_NAME, COMPANY_ADDRESS, COMPANY_NAME, WELCOME, pageTitle } from "@/lib/brand";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: pageTitle("Sign in") }] }),
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
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const welcome = WELCOME[mode];

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
    setShowPassword(false);
    toast.success(mode === "admin" ? "Signed in as Admin." : "Signed in as Reader.");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white p-1 shadow-sm ring-1 ring-border">
            <img
              src="/trio-logo.png"
              alt=""
              width={369}
              height={356}
              className="h-full w-full object-contain"
            />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight">{COMPANY_NAME}</p>
            <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
              {APP_NAME}
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-4 py-6 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <section className="order-2 lg:order-1">
          <picture>
            <source srcSet="/trio-wordmark.webp" type="image/webp" />
            <img
              src="/trio-wordmark.png"
              alt="TrioVision Composite Technologies"
              width={1200}
              height={386}
              className="mx-auto h-auto w-full max-w-[420px] object-contain drop-shadow-sm dark:drop-shadow-[0_0_1px_rgba(255,255,255,0.45)] lg:mx-0 lg:max-w-[520px]"
            />
          </picture>
          <div className="mt-6 max-w-xl text-center lg:text-left" aria-live="polite">
            <h1 className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">
              {welcome.title}
            </h1>
            <p className="mt-3 text-base text-muted-foreground">{welcome.body}</p>
            <p className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground">
              {welcome.note}
            </p>
          </div>
        </section>

        <section className="order-1 mx-auto w-full max-w-md lg:order-2">
          <GlassPanel className="p-6 sm:p-8">
            <h2 className="text-lg font-bold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">Choose how you want to sign in</p>

            <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Access mode">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => {
                    setMode(m.value);
                    setError("");
                    setShowPassword(false);
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

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="password">
                  {mode === "admin" ? "Admin password" : "Reader password"}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    autoFocus
                    className="pr-11"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!error}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    title={showPassword ? "Hide password" : "Show password"}
                    className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
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
          </GlassPanel>
        </section>
      </main>

      <footer className="px-4 py-5 text-center text-xs text-muted-foreground sm:px-8">
        <p className="font-semibold text-foreground/80">{COMPANY_NAME}</p>
        <p className="mt-0.5">{COMPANY_ADDRESS}</p>
      </footer>
    </div>
  );
}
