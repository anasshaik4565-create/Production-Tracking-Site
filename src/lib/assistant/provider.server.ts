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
