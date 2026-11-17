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

export type ProviderConfig = {
  apiKey: string;
  model: string;
  apiUrl: string;
  /** "low" | "medium" | "high", or null to use the model's own default. */
  thinkingLevel: string | null;
};

/** Google's recommended model for new projects (checked against ai.google.dev model docs). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export function readProviderConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderConfig {
  const apiKey = env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) {
    throw new ProviderError(
      "not_configured",
      "The AI assistant is not configured yet. An administrator must set GEMINI_API_KEY on the server.",
    );
  }
  const model = (env["GEMINI_MODEL"]?.trim() || DEFAULT_GEMINI_MODEL).replace(/^models\//, "");
  const level = env["GEMINI_THINKING_LEVEL"]?.trim().toLowerCase();
  const thinkingLevel =
    level === "default" || level === "off"
      ? null
      : level === "low" || level === "medium" || level === "high"
        ? level
        : model.startsWith("gemini-3")
          ? "low"
          : null;
  return {
    apiKey,
    model,
    apiUrl: (env["GEMINI_API_URL"]?.trim() || "https://generativelanguage.googleapis.com").replace(
      /\/+$/,
      "",
    ),
    thinkingLevel,
  };
}

const MAX_ROUNDS = 6;
const REQUEST_TIMEOUT_MS = 45_000;
const TOTAL_TIMEOUT_MS = 85_000;

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

async function callModel(
  cfg: ProviderConfig,
  system: string,
  contents: Content[],
  deadline: number,
  useThinking = true,
): Promise<GeminiResponse> {
  const remaining = deadline - Date.now();
  if (remaining < 2000)
    throw new ProviderError("timeout", "The assistant took too long to answer. Please try again.");
  const generationConfig: Record<string, unknown> = { maxOutputTokens: 4096 };
  if (useThinking && cfg.thinkingLevel)
    generationConfig["thinkingConfig"] = { thinkingLevel: cfg.thinkingLevel };

  let res: Response;
  try {
    res = await fetch(
      `${cfg.apiUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig,
        }),
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
      },
    );
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
    let status = "";
    try {
      const body = (await res.json()) as { error?: { message?: string; status?: string } };
      detail = body.error?.message ?? "";
      status = body.error?.status ?? "";
    } catch {
      /* ignore */
    }
    console.error(
      `[assistant] Gemini returned ${res.status} ${status}: ${redact(detail, cfg.apiKey).slice(0, 300)}`,
    );
    // Some models reject the thinking setting: retry once without it.
    if (res.status === 400 && useThinking && cfg.thinkingLevel && /thinking/i.test(detail)) {
      return callModel(cfg, system, contents, deadline, false);
    }
    if (
      res.status === 401 ||
      res.status === 403 ||
      /API key (not valid|expired)|API_KEY_INVALID/i.test(detail)
    )
      throw new ProviderError(
        "auth",
        "The AI service rejected the server's API key. An administrator must check GEMINI_API_KEY.",
      );
    if (res.status === 429 || status === "RESOURCE_EXHAUSTED")
      throw new ProviderError(
        "rate_limited",
        "The AI service is busy or its usage limit was reached. Please try again in a minute.",
      );
    if (res.status === 404)
      throw new ProviderError(
        "unavailable",
        "The configured AI model is not available. An administrator must check GEMINI_MODEL.",
      );
    if (status === "FAILED_PRECONDITION" || /billing|free tier is not available/i.test(detail))
      throw new ProviderError(
        "billing",
        "The AI service needs billing enabled for this Google project. An administrator must check the Google AI Studio account.",
      );
    if (res.status >= 500)
      throw new ProviderError(
        "unavailable",
        "The AI service is temporarily unavailable. Please try again shortly.",
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
  const contents: Content[] = opts.turns.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));
  const sources: Source[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reply = await callModel(opts.cfg, opts.system, contents, deadline);
    const candidate = reply.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const calls = parts.filter((p) => p["functionCall"]) as (Part & {
      functionCall: { name: string; args?: unknown; id?: string };
    })[];

    if (calls.length > 0) {
      // Keep every part exactly as returned (Gemini 3 needs its thought signatures sent back).
      contents.push({ role: "model", parts });
      const responses = await Promise.all(
        calls.map(async (c) => {
          const out = await runTool(c.functionCall.name, c.functionCall.args, opts.ctx);
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
      );
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
