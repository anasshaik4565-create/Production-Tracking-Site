import { useEffect, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { clearAssistantStorage } from "@/lib/assistant/storage";

/**
 * Reader and Admin are two separate Supabase logins. The role is read from the signed
 * token (app_metadata.app_role), which can only be set from the Supabase dashboard / SQL.
 * The browser never decides the role: the database enforces it on every request.
 */
export const READER_EMAIL = "projectsreader@triovision.com";
export const ADMIN_EMAIL = "projectsadmin@triovision.com";

export type AccessRole = "reader" | "admin";

export function roleFromSession(session: Session | null | undefined): AccessRole | null {
  const role = (session?.user?.app_metadata as { app_role?: string } | undefined)?.app_role;
  return role === "admin" || role === "reader" ? role : null;
}

type AuthState = { session: Session | null; ready: boolean };
const SERVER_STATE: AuthState = { session: null, ready: false };
let state: AuthState = SERVER_STATE;
let started = false;
const listeners = new Set<() => void>();

function publish(next: AuthState) {
  // Whenever the signed-in user changes or the session ends, assistant chats are erased so
  // nothing can carry over to another login (Reader <-> Admin) or a later session.
  if ((state.session?.user.id ?? null) !== (next.session?.user.id ?? null) && state.ready) {
    clearAssistantStorage();
  }
  state = next;
  listeners.forEach((l) => l());
}

export function startAuth() {
  if (started || typeof window === "undefined") return;
  started = true;
  supabase.auth.getSession().then(({ data }) => {
    // No valid session when the page loads (expired / signed out elsewhere): erase any chats left over.
    if (!data.session) clearAssistantStorage();
    publish({ session: data.session, ready: true });
  });
  supabase.auth.onAuthStateChange((_event, session) => publish({ session, ready: true }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current role for non-React code (for example audit logging). */
export function currentRole(): AccessRole | null {
  return roleFromSession(state.session);
}

export function useAccess() {
  useEffect(() => {
    startAuth();
  }, []);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
  const role = roleFromSession(snapshot.session);
  return {
    ready: snapshot.ready,
    userId: snapshot.session?.user.id ?? null,
    role,
    isAdmin: role === "admin",
    isReader: role === "reader",
  };
}

export async function signInAs(mode: AccessRole, password: string): Promise<{ error?: string }> {
  await supabase.auth.signOut(); // never keep two sessions at once
  publish({ session: null, ready: true });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: mode === "admin" ? ADMIN_EMAIL : READER_EMAIL,
    password,
  });
  if (error) {
    return {
      error: /invalid login|credentials/i.test(error.message)
        ? "Incorrect password. Please try again."
        : "We couldn't sign you in. Please check your connection and try again.",
    };
  }
  if (roleFromSession(data.session) !== mode) {
    await supabase.auth.signOut();
    publish({ session: null, ready: true });
    return {
      error:
        "This login has not been set up for that access mode yet. Ask the administrator to run the access setup.",
    };
  }
  publish({ session: data.session, ready: true });
  return {};
}

export async function signOutAll() {
  await supabase.auth.signOut();
  publish({ session: null, ready: true });
}
