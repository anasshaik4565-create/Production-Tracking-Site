/**
 * Anthropic (Claude) Messages API client with a tool-use loop.
 * The API key is read from a server environment variable and never leaves the server.
 */
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "@/lib/assistant/tools";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type Source = { tool: string; label: string };

export class ProviderError extends Error {
  constructor(
    public code:
      | "not_configured"
      | "auth"
      | "billing"
      | "rate_limited"
      | "unavailable"
      | "timeout"
      | "bad_response",
    message: string,
  ) {
    super(message);
  }
}

export type ProviderConfig = { apiKey: string; model: string; apiUrl: string };

export function readProviderConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderConfig {
  const apiKey = env["ANTHROPIC_API_KEY"]?.trim();
  if (!apiKey) {
    throw new ProviderError(
      "not_configured",
      "The AI assistant is not configured yet. An administrator must set ANTHROPIC_API_KEY on the server.",
    );
  }
  return {
    apiKey,
    model: env["ANTHROPIC_MODEL"]?.trim() || "claude-sonnet-5-5",
    apiUrl: (env["ANTHROPIC_API_URL"]?.trim() || "https://api.anthropic.com").replace(/\/+$/, ""),
  };
}

const MAX_ROUNDS = 6;
const REQUEST_TIMEOUT_MS = 45_000;
const TOTAL_TIMEOUT_MS = 85_000;

type Block = { type: string; [k: string]: unknown };
type ApiMessage = { role: "user" | "assistant"; content: string | Block[] };

async function callModel(
  cfg: ProviderConfig,
  system: string,
  messages: ApiMessage[],
  deadline: number,
) {
  const remaining = deadline - Date.now();
  if (remaining < 2000)
    throw new ProviderError("timeout", "The assistant took too long to answer. Please try again.");
  let res: Response;
  try {
    res = await fetch(`${cfg.apiUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 2500,
        system,
        tools: TOOL_DEFINITIONS,
        messages,
      }),
      signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError")
      throw new ProviderError(
        "timeout",
        "The assistant took too long to answer. Please try again.",
      );
    throw new ProviderError(
      "unavailable",
      "The AI service could not be reached. Please try again shortly.",
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json()).slice(0, 400);
    } catch {
      /* ignore */
    }
    console.error(
      `[assistant] provider returned ${res.status}: ${detail.replace(cfg.apiKey, "***")}`,
    );
    if (res.status === 401 || res.status === 403)
      throw new ProviderError(
        "auth",
        "The AI service rejected the server's API key. An administrator must check ANTHROPIC_API_KEY.",
      );
    if (res.status === 429)
      throw new ProviderError(
        "rate_limited",
        "The AI service is busy or its usage limit was reached. Please try again in a minute.",
      );
    if (res.status === 400 && /credit balance|billing/i.test(detail))
      throw new ProviderError(
        "billing",
        "The AI service account has no remaining credit. An administrator must add credit in the Claude Console.",
      );
    if (res.status === 400 && /model/i.test(detail) && /(not found|invalid|unknown)/i.test(detail))
      throw new ProviderError(
        "unavailable",
        "The configured AI model is not available. An administrator must check ANTHROPIC_MODEL.",
      );
    throw new ProviderError(
      "unavailable",
      "The AI service is temporarily unavailable. Please try again shortly.",
    );
  }
  try {
    return (await res.json()) as { content?: Block[]; stop_reason?: string };
  } catch {
    throw new ProviderError(
      "bad_response",
      "The AI service returned an unreadable answer. Please try again.",
    );
  }
}

export async function runAssistant(opts: {
  cfg: ProviderConfig;
  system: string;
  turns: ChatTurn[];
  ctx: ToolContext;
}): Promise<{ answer: string; sources: Source[]; rounds: number }> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const messages: ApiMessage[] = opts.turns.map((t) => ({ role: t.role, content: t.content }));
  const sources: Source[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reply = await callModel(opts.cfg, opts.system, messages, deadline);
    const content = Array.isArray(reply.content) ? reply.content : [];
    const toolCalls = content.filter((b) => b.type === "tool_use") as (Block & {
      id: string;
      name: string;
      input: unknown;
    })[];

    if (reply.stop_reason === "tool_use" && toolCalls.length > 0) {
      messages.push({ role: "assistant", content }); // keep every block exactly as returned
      const results = await Promise.all(
        toolCalls.map(async (call) => {
          const out = await runTool(call.name, call.input, opts.ctx);
          if (!sources.some((s) => s.label === out.label))
            sources.push({ tool: call.name, label: out.label });
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: out.content,
            is_error: out.isError,
          } as Block;
        }),
      );
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = content
      .filter((b) => b.type === "text" && typeof b["text"] === "string")
      .map((b) => b["text"] as string)
      .join("\n\n")
      .trim();
    if (!text)
      throw new ProviderError(
        "bad_response",
        "The assistant returned an empty answer. Please try again.",
      );
    const cut =
      reply.stop_reason === "max_tokens"
        ? "\n\n_(The answer was cut short. Ask for a narrower summary to see the rest.)_"
        : "";
    return { answer: text + cut, sources, rounds: round };
  }
  throw new ProviderError(
    "bad_response",
    "That question needed too many data lookups. Please ask a narrower question.",
  );
}
