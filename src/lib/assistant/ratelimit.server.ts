/** Small in-memory limiter. One Render instance = one process, which is what this app runs on. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const MAX_GLOBAL_IN_FLIGHT = 8;

const hits = new Map<string, number[]>();
const inFlight = new Set<string>();

export type LimitResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: "busy" | "rate_limited" | "server_busy"; retryAfterSec?: number };

export function acquire(userId: string, now = Date.now()): LimitResult {
  if (inFlight.has(userId)) return { ok: false, reason: "busy" };
  if (inFlight.size >= MAX_GLOBAL_IN_FLIGHT)
    return { ok: false, reason: "server_busy", retryAfterSec: 5 };
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    const wait = Math.ceil((WINDOW_MS - (now - recent[0]!)) / 1000);
    hits.set(userId, recent);
    return { ok: false, reason: "rate_limited", retryAfterSec: wait };
  }
  recent.push(now);
  hits.set(userId, recent);
  inFlight.add(userId);
  return { ok: true, release: () => void inFlight.delete(userId) };
}

export function _resetForTests() {
  hits.clear();
  inFlight.clear();
}
