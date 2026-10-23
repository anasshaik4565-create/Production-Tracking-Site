import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { systemPrompt } from "@/lib/assistant/prompt";
import {
  ProviderError,
  readProviderConfig,
  runAssistant,
  type ChatTurn,
} from "@/lib/assistant/provider.server";
import { acquire } from "@/lib/assistant/ratelimit.server";

const MAX_MESSAGE_CHARS = 4000;
const MAX_TURNS = 16;
const MAX_TOTAL_CHARS = 24000;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

const fail = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  json(status, { error: { code, message } }, headers);

/** Validate the browser's message list. Returns the cleaned turns or an error message. */
export function validateTurns(body: unknown): { turns: ChatTurn[] } | { error: string } {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Send at least one message." };
  const turns: ChatTurn[] = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string")
      return { error: "Each message needs a role and text." };
    const text = content.trim();
    if (!text) continue;
    if (text.length > MAX_MESSAGE_CHARS)
      return { error: `A message is longer than ${MAX_MESSAGE_CHARS} characters.` };
    turns.push({ role, content: text });
  }
  while (turns.length && turns[0]!.role !== "user") turns.shift();
  // The provider needs strictly alternating roles ending with the user's question.
  const merged: ChatTurn[] = [];
  for (const t of turns) {
    const last = merged.at(-1);
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else merged.push({ ...t });
  }
  if (merged.length === 0 || merged.at(-1)!.role !== "user")
    return { error: "The last message must be a question." };
  if (merged.reduce((n, t) => n + t.content.length, 0) > MAX_TOTAL_CHARS)
    return { error: "The conversation is too long. Start a new chat." };
  return { turns: merged };
}

export async function handleAssistantChat(request: Request): Promise<Response> {
  // 1. Configuration (never reveals the key itself).
  let cfg;
  try {
    cfg = readProviderConfig();
  } catch (e) {
    return fail(503, (e as ProviderError).code, (e as Error).message);
  }
  const url =
    process.env["VITE_SUPABASE_URL"] ??
    import.meta.env["VITE_SUPABASE_URL"] ??
    process.env["SUPABASE_URL"];
  const anon =
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
    process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !anon)
    return fail(503, "not_configured", "The database connection is not configured on the server.");

  // 2. Who is asking? The browser's signed login token is verified by Supabase Auth.
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return fail(401, "auth", "Please sign in again.");
  const db = createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } }, // all reads run as this user (RLS applies)
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user)
    return fail(401, "auth", "Your session has expired. Please sign in again.");
  const role = (user.app_metadata as { app_role?: string } | undefined)?.app_role;
  if (role !== "reader" && role !== "admin")
    return fail(403, "forbidden", "This account is not allowed to use the assistant.");

  // 3. Input.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad_request", "The request could not be read.");
  }
  const checked = validateTurns(body);
  if ("error" in checked) return fail(400, "bad_request", checked.error);

  // 4. Limits: one question at a time per user, and a fair-use cap.
  const slot = acquire(user.id);
  if (!slot.ok) {
    if (slot.reason === "busy")
      return fail(429, "busy", "The assistant is still answering your previous question.");
    return fail(
      429,
      slot.reason,
      slot.reason === "rate_limited"
        ? "You have asked a lot of questions in a short time. Please wait a few minutes."
        : "The assistant is busy. Please try again in a moment.",
      slot.retryAfterSec ? { "retry-after": String(slot.retryAfterSec) } : undefined,
    );
  }

  // 5. Ask the model, with read-only tools bound to this user's session.
  try {
    const now = new Date();
    const out = await runAssistant({
      cfg,
      system: systemPrompt(now, role),
      turns: checked.turns,
      ctx: { db, now },
    });
    return json(200, { answer: out.answer, sources: out.sources, asOf: now.toISOString(), role });
  } catch (e) {
    if (e instanceof ProviderError) {
      const status =
        e.code === "timeout"
          ? 504
          : e.code === "rate_limited"
            ? 429
            : e.code === "auth" || e.code === "billing" || e.code === "not_configured"
              ? 503
              : 502;
      return fail(status, e.code, e.message);
    }
    console.error("[assistant] unexpected failure:", (e as Error).message);
    return fail(500, "internal", "Something went wrong while answering. Please try again.");
  } finally {
    slot.release();
  }
}
