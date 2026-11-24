/**
 * Google Gemini API client (generateContent REST endpoint) with a function-calling loop.
 * The API key is read from the GEMINI_API_KEY environment variable on the server and is never
 * sent to the browser. Plain `fetch` is used: Google documents this REST interface as a supported
 * way to call the Gemini API, and it avoids adding a dependency.
 */
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "@/lib/assistant/tools";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type Source = { tool: string; label: string };

export class ProviderError extends Error {
  /** Worth trying the same model again after a short wait (temporary trouble). */
  retryable = false;
  /** Another model may still be able to answer (not a key / billing / request problem). */
  fallbackOk = false;
  /** Wait suggested by Google (Retry-After or retryDelay), in milliseconds. */
  retryAfterMs: number | undefined;
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
    flags: { retryable?: boolean; fallbackOk?: boolean; retryAfterMs?: number | undefined } = {},
  ) {
    super(message);
    this.retryable = flags.retryable ?? false;
    this.fallbackOk = flags.fallbackOk ?? false;
    this.retryAfterMs = flags.retryAfterMs;
  }
}

type CompatibleProvider = { name: string; apiKey: string; apiUrl: string; model: string };

export type ProviderConfig = {
  compatibleProviders?: CompatibleProvider[];
  apiKey: string;
  model: string;
  /** Used only when the primary model keeps failing with temporary or "model not available" errors. */
  fallbackModel: string | null;
  apiUrl: string;
  /** "auto" = minimal for Flash-Lite, low for other Gemini 3 models; "model-default" = send nothing; or an explicit level. */
  thinkingLevel: "auto" | "model-default" | "low" | "medium" | "high";
  /** Time allowed for ONE request to Google. */
  requestTimeoutMs: number;
  /** First wait before a retry; it doubles each time (with a little random spread). */
  retryBaseMs: number;
  /** Total time for the whole question: every retry, tool round and fallback together. */
  totalTimeoutMs: number;
};

/** Primary model: Gemini 3.5 Flash-Lite. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/**
 * Default fallback: Gemini 4 Hydrogen.
 * Used when the primary model is unavailable,
 * rate-limited, or encounters temporary errors.
 */
export const DEFAULT_FALLBACK_MODEL = "gemini-4-hydrogen";

/** At most this many attempts per model for temporary errors (one attempt, then immediate fallback). */
export const MAX_ATTEMPTS = 1;
const MAX_BACKOFF_MS = 8_000;
/** A rate-limit wait longer than this is not worth holding the user for: use the fallback instead. */
const MAX_RATE_LIMIT_WAIT_MS = 5_000;
/** Do not start another attempt, or the fallback, with less time than this left. */
const MIN_TIME_LEFT_MS = 1_000;

const intFrom = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};

export function readProviderConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderConfig {
  const apiKey = env["GEMINI_API_KEY"]?.trim() || "";
  const compatibleProviders: CompatibleProvider[] = [];
  for (const [name, prefix, defaultUrl] of [
    ["groq", "GROQ", "https://api.groq.com/openai/v1"],
    ["openrouter", "OPENROUTER", "https://openrouter.ai/api/v1"],
    ["openai", "OPENAI", "https://api.openai.com/v1"],
    ["custom", "CUSTOM_AI", ""],
  ]) {
    const key = env[`${prefix}_API_KEY`]?.trim();
    const model = env[`${prefix}_MODEL`]?.trim();
    const apiUrl = (env[`${prefix}_API_URL`]?.trim() || defaultUrl).replace(/\/+$/, "");
    if (key && model && apiUrl) compatibleProviders.push({ name, apiKey: key, model, apiUrl });
  }
  if (!apiKey && !compatibleProviders.length) {
    throw new ProviderError(
      "not_configured",
      "The AI assistant is not configured yet. An administrator must configure at least one AI provider and model on the server.",
    );
  }
  const clean = (m: string) => m.trim().replace(/^models\//, "");
  const model = clean(env["GEMINI_MODEL"] || DEFAULT_GEMINI_MODEL);
  const rawFallback = env["GEMINI_FALLBACK_MODEL"]?.trim();
  const fallbackModel =
    rawFallback && /^(none|off|disabled?)$/i.test(rawFallback)
      ? null
      : clean(rawFallback || DEFAULT_FALLBACK_MODEL) === model
        ? null
        : clean(rawFallback || DEFAULT_FALLBACK_MODEL);
  const level = env["GEMINI_THINKING_LEVEL"]?.trim().toLowerCase();
  const thinkingLevel: ProviderConfig["thinkingLevel"] =
    level === "default" || level === "off"
      ? "model-default"
      : level === "low" || level === "medium" || level === "high"
        ? level
        : "auto";
  return {
    apiKey,
    compatibleProviders,
    model,
    fallbackModel,
    apiUrl: (env["GEMINI_API_URL"]?.trim() || "https://generativelanguage.googleapis.com").replace(
      /\/+$/,
      "",
    ),
    thinkingLevel,
    requestTimeoutMs: intFrom(env["GEMINI_REQUEST_TIMEOUT_MS"], 3_000, 1_000, 80_000),
    retryBaseMs: intFrom(env["GEMINI_RETRY_BASE_MS"], 1_000, 10, 10_000),
    totalTimeoutMs: intFrom(env["GEMINI_TOTAL_TIMEOUT_MS"], 12_000, 5_000, 95_000),
  };
}

/** The thinking level to send for a given model (Flash-Lite uses minimal thinking; other Gemini 3 models use low). */
function thinkingFor(cfg: ProviderConfig, model: string): string | null {
  if (cfg.thinkingLevel === "model-default") return null;
  if (cfg.thinkingLevel !== "auto") return cfg.thinkingLevel;
  if (model === "gemini-3.5-flash-lite") return "minimal";
  return model.startsWith("gemini-3") ? "low" : null;
}

const MAX_ROUNDS = 6;

function withinDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderError(
      "timeout", "The assistant took too long to answer. Please try again.",
      { fallbackOk: true },
    )), Math.max(0, deadline - Date.now()));
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Part = Record<string, unknown>;
type Content = { role: "user" | "model"; parts: Part[] };

/** Gemini wants OpenAPI-style upper-case types. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      out[k] = k === "type" && typeof v === "string" ? v.toUpperCase() : toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

const FUNCTION_DECLARATIONS = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: toGeminiSchema(t.input_schema),
}));

type GeminiResponse = {
  candidates?: { content?: { role?: string; parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

function redact(text: string, key: string) {
  return text
    .split(key)
    .join("***")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "***");
}

/** "35s", "0.5s" or a plain number of seconds -> milliseconds. */
function parseDelay(value: unknown): number | undefined {
  if (typeof value === "number") return value >= 0 ? Math.round(value * 1000) : undefined;
  if (typeof value !== "string") return undefined;
  const m = value.trim().match(/^(\d+(?:\.\d+)?)s?$/i);
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/**
 * ONE request to Google. Temporary trouble throws a retryable error; permanent trouble
 * (bad key, billing, bad request, missing model) throws a non-retryable one.
 */
async function callOnce(
  cfg: ProviderConfig,
  model: string,
  system: string,
  contents: Content[],
  deadline: number,
  useThinking = true,
): Promise<GeminiResponse> {
  const remaining = deadline - Date.now();
  if (remaining < 500)
    throw new ProviderError("timeout", "The assistant took too long to answer. Please try again.", { fallbackOk: true });
  const generationConfig: Record<string, unknown> = { maxOutputTokens: 1024 };
  const level = useThinking ? thinkingFor(cfg, model) : null;
  if (level) generationConfig["thinkingConfig"] = { thinkingLevel: level };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig,
      }),
      signal: AbortSignal.timeout(Math.min(cfg.requestTimeoutMs, remaining)),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError")
      throw new ProviderError(
        "timeout",
        "The assistant took too long to answer. Please try again.",
        {
          retryable: true,
          fallbackOk: true,
        },
      );
    throw new ProviderError(
      "unavailable",
      "The AI service could not be reached. Please try again shortly.",
      {
        retryable: true,
        fallbackOk: true,
      },
    );
  }

  if (!res.ok) {
    let detail = "";
    let status = "";
    let retryDelay: number | undefined;
    try {
      const body = (await res.json()) as {
        error?: { message?: string; status?: string; details?: { retryDelay?: unknown }[] };
      };
      detail = body.error?.message ?? "";
      status = body.error?.status ?? "";
      retryDelay = parseDelay(
        body.error?.details?.find((d) => d && d.retryDelay !== undefined)?.retryDelay,
      );
    } catch {
      /* ignore */
    }
    const retryAfter = parseDelay(res.headers.get("retry-after") ?? undefined) ?? retryDelay;
    console.error(
      `[assistant] Gemini ${model} returned ${res.status} ${status}: ${redact(detail, cfg.apiKey).slice(0, 300)}`,
    );

    // Some models reject the thinking setting: send the same request once more without it.
    if (res.status === 400 && level && /thinking/i.test(detail)) {
      return callOnce(cfg, model, system, contents, deadline, false);
    }
    // Permanent problems: never retried, and a different model would not help.
    if (
      res.status === 401 ||
      res.status === 403 ||
      /API key (not valid|expired)|API_KEY_INVALID/i.test(detail)
    )
      throw new ProviderError(
        "auth",
        "The AI service rejected the server's API key. An administrator must check GEMINI_API_KEY.",
      );
    if (status === "FAILED_PRECONDITION" || /billing|free tier is not available/i.test(detail))
      throw new ProviderError(
        "billing",
        "The AI service needs billing enabled for this Google project. An administrator must check the Google AI Studio account.",
        { fallbackOk: true },
      );
    // This model is not available to this key: never retried, but the fallback model may work.
    if (res.status === 404)
      throw new ProviderError(
        "unavailable",
        "The configured AI model is not available. An administrator must check GEMINI_MODEL.",
        {
          fallbackOk: true,
        },
      );
    // Rate limit: retry only if Google says the wait is short; otherwise move on (limits are per model).
    if (res.status === 429 || status === "RESOURCE_EXHAUSTED") {
      const shortWait = retryAfter === undefined || retryAfter <= MAX_RATE_LIMIT_WAIT_MS;
      throw new ProviderError(
        "rate_limited",
        "The AI service is busy or its usage limit was reached. Please try again in a minute.",
        {
          retryable: shortWait,
          fallbackOk: true,
          retryAfterMs: shortWait ? retryAfter : undefined,
        },
      );
    }
    // Overloaded or failing on Google's side (500, 502, 503, 504) and request timeouts (408).
    if (res.status >= 500 || res.status === 408)
      throw new ProviderError(
        "unavailable",
        "The AI service is temporarily unavailable. Please try again shortly.",
        {
          retryable: true,
          fallbackOk: true,
          retryAfterMs: retryAfter,
        },
      );
    throw new ProviderError(
      "bad_response",
      "The AI service could not process that request. Please try again.",
    );
  }
  try {
    return (await res.json()) as GeminiResponse;
  } catch {
    throw new ProviderError(
      "bad_response",
      "The AI service returned an unreadable answer. Please try again.",
      {
        retryable: true,
        fallbackOk: true,
      },
    );
  }
}

/**
 * Up to MAX_ATTEMPTS tries of ONE model call, with exponential backoff (1s, 2s, ... plus a little
 * random spread) for temporary errors only. Retrying a request never changes the conversation:
 * history is only extended after a call succeeds.
 */
async function callWithRetry(
  cfg: ProviderConfig,
  model: string,
  system: string,
  contents: Content[],
  deadline: number,
): Promise<GeminiResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce(cfg, model, system, contents, deadline);
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || attempt >= MAX_ATTEMPTS) throw e;
      const spread = 0.75 + Math.random() * 0.5;
      const wait = Math.min(
        MAX_BACKOFF_MS,
        Math.max(e.retryAfterMs ?? 0, Math.round(cfg.retryBaseMs * 2 ** (attempt - 1) * spread)),
      );
      if (deadline - Date.now() < wait + MIN_TIME_LEFT_MS) throw e; // not enough time left for another try
      console.warn(
        `[assistant] ${model} attempt ${attempt}/${MAX_ATTEMPTS} failed (${e.code}); retrying in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
}

/** The question-and-tools loop for ONE model, always starting from the original conversation. */
async function runLoop(
  cfg: ProviderConfig,
  model: string,
  system: string,
  turns: ChatTurn[],
  ctx: ToolContext,
  deadline: number,
): Promise<{ answer: string; sources: Source[]; rounds: number }> {
  const contents: Content[] = turns.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));
  const sources: Source[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reply = await callWithRetry(cfg, model, system, contents, deadline);
    const candidate = reply.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const calls = parts.filter((p) => p["functionCall"]) as (Part & {
      functionCall: { name: string; args?: unknown; id?: string };
    })[];

    if (calls.length > 0) {
      // Keep every part exactly as returned (Gemini 3 needs its thought signatures sent back).
      contents.push({ role: "model", parts });
      const responses = await withinDeadline(Promise.all(
        calls.map(async (c) => {
          const out = await runTool(c.functionCall.name, c.functionCall.args, ctx);
          if (!sources.some((s) => s.label === out.label))
            sources.push({ tool: c.functionCall.name, label: out.label });
          let parsed: unknown;
          try {
            parsed = JSON.parse(out.content);
          } catch {
            parsed = { text: out.content };
          }
          return {
            functionResponse: {
              ...(c.functionCall.id ? { id: c.functionCall.id } : {}),
              name: c.functionCall.name,
              response: out.isError ? { error: parsed } : { result: parsed },
            },
          } as Part;
        }),
      ), deadline);
      contents.push({ role: "user", parts: responses });
      continue;
    }

    const text = parts
      .filter((p) => typeof p["text"] === "string" && p["thought"] !== true)
      .map((p) => p["text"] as string)
      .join("")
      .trim();
    if (!text) {
      const blocked =
        reply.promptFeedback?.blockReason ||
        /SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII/i.test(candidate?.finishReason ?? "");
      throw new ProviderError(
        "bad_response",
        blocked
          ? "The AI service declined to answer that. Please rephrase the question."
          : "The assistant returned an empty answer. Please try again.",
        blocked ? {} : { retryable: false, fallbackOk: true },
      );
    }
    const cut =
      candidate?.finishReason === "MAX_TOKENS"
        ? "\n\n_(The answer was cut short. Ask for a narrower summary to see the rest.)_"
        : "";
    return { answer: text + cut, sources, rounds: round };
  }
  throw new ProviderError(
    "bad_response",
    "That question needed too many data lookups. Please ask a narrower question.",
  );
}

/** OpenAI-compatible Chat Completions adapter, including application function calls. */
type CompatibleCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type CompatibleMessage = { role: string; content?: string | null; tool_calls?: CompatibleCall[]; tool_call_id?: string };
async function runCompatible(
  provider: CompatibleProvider, cfg: ProviderConfig, system: string,
  turns: ChatTurn[], ctx: ToolContext, deadline: number,
): Promise<{ answer: string; sources: Source[]; rounds: number }> {
  const messages: CompatibleMessage[] = [{ role: "system", content: system }, ...turns];
  const sources: Source[] = [];
  const tools = TOOL_DEFINITIONS.map(t => ({ type: "function", function: {
    name: t.name, description: t.description, parameters: t.input_schema,
  } }));
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ProviderError("timeout", "AI provider timed out.", { fallbackOk: true });
    let data: { choices?: { message?: CompatibleMessage; finish_reason?: string }[] };
    try {
      const response = await fetch(`${provider.apiUrl}/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model: provider.model, messages, tools, tool_choice: "auto", max_completion_tokens: 1024 }),
        signal: AbortSignal.timeout(Math.min(remaining, cfg.requestTimeoutMs)),
      });
      if (!response.ok) {
        const code = response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "auth" : response.status === 402 ? "billing" : "unavailable";
        throw new ProviderError(code, `${provider.name} returned HTTP ${response.status}.`, { fallbackOk: true });
      }
      data = await response.json();
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError("unavailable", `${provider.name} request failed.`, { fallbackOk: true });
    }
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (choice?.finish_reason === "content_filter") throw new ProviderError("bad_response", "The AI service declined to answer that.");
    if (message?.tool_calls?.length) {
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
      const results = await withinDeadline(Promise.all(message.tool_calls.map(async call => {
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { return { role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Invalid tool arguments" }) }; }
        const out = await runTool(call.function.name, args, ctx);
        if (!sources.some(s => s.label === out.label)) sources.push({ tool: call.function.name, label: out.label });
        return { role: "tool", tool_call_id: call.id, content: JSON.stringify({ [out.isError ? "error" : "result"]: out.content }) };
      })), deadline);
      messages.push(...results);
      continue;
    }
    const answer = message?.content?.trim();
    if (answer) return { answer: answer + (choice?.finish_reason === "length" ? "\n\n_(Answer truncated.)_" : ""), sources, rounds: round };
    throw new ProviderError("bad_response", "The AI service returned an empty answer.", { fallbackOk: true });
  }
  throw new ProviderError("bad_response", "Too many data lookups. Please ask a narrower question.");
}

/** Fast sequential failover across configured providers; no duplicate parallel model requests. */
export async function runAssistant(opts: {
  cfg: ProviderConfig; system: string; turns: ChatTurn[]; ctx: ToolContext;
}): Promise<{ answer: string; sources: Source[]; rounds: number; model: string }> {
  const { cfg } = opts;
  const deadline = Date.now() + cfg.totalTimeoutMs;
  const routes: { name: string; model: string; run: (until: number) => Promise<{ answer: string; sources: Source[]; rounds: number }> }[] = [];
  if (cfg.apiKey) for (const model of [cfg.model, ...(cfg.fallbackModel ? [cfg.fallbackModel] : [])]) {
    routes.push({ name: "gemini", model, run: until => runLoop(cfg, model, opts.system, opts.turns, opts.ctx, until) });
  }
  for (const p of cfg.compatibleProviders ?? []) routes.push({ name: p.name, model: p.model, run: until => runCompatible(p, cfg, opts.system, opts.turns, opts.ctx, until) });
  let last: unknown = new ProviderError("not_configured", "No AI provider configured.");
  let skipGemini = false;
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]!;
    if (skipGemini && route.name === "gemini") continue;
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    const until = i === routes.length - 1 ? deadline : Math.min(deadline, Date.now() + Math.max(3000, Math.floor(remaining / (routes.length - i))));
    const started = Date.now();
    try {
      const out = await withinDeadline(route.run(until), until);
      console.info(`[assistant] ${route.name}/${route.model} answered in ${Date.now() - started}ms`);
      return { ...out, model: route.model };
    } catch (e) {
      last = e;
      if (!(e instanceof ProviderError)) throw e;
      if (e.code === "auth" || e.code === "billing") { if (route.name === "gemini") skipGemini = true; }
      else if (!e.fallbackOk) throw e;
      console.warn(`[assistant] ${route.name}/${route.model} failed (${e.code}); trying next provider`);
    }
  }
  throw last;
}
