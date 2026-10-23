/**
 * Trio AI Assistant chat storage.
 *
 * Chats live only in this browser tab's sessionStorage (and in memory), keyed by the signed-in
 * user's id. They are never sent to a database and never shared between users or sessions:
 *   - closing the tab erases them,
 *   - a different user signing in sees nothing,
 *   - confirmed logout (or the session ending) erases them and the erase is verified.
 */
export type ToolSource = { tool: string; label: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  error?: boolean;
  sources?: ToolSource[];
  asOf?: string;
};

export type Chat = {
  id: string;
  title: string;
  titleEdited: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export const CHAT_PREFIX = "pt-chat:v1:";
const MAX_CHATS = 50;
const MAX_MESSAGES = 100;

const listeners = new Set<() => void>();
/** Pages subscribe so they can drop their in-memory chats the moment storage is cleared. */
export function onChatsCleared(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadChats(userId: string): Chat[] {
  const s = store();
  if (!s || !userId) return [];
  try {
    const raw = s.getItem(CHAT_PREFIX + userId);
    if (!raw) return [];
    const data = JSON.parse(raw) as Chat[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveChats(userId: string, chats: Chat[]): boolean {
  const s = store();
  if (!s || !userId) return false;
  try {
    const trimmed = chats.slice(0, MAX_CHATS).map((c) => ({
      ...c,
      messages: c.messages.slice(-MAX_MESSAGES),
    }));
    s.setItem(CHAT_PREFIX + userId, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

/** Remove one user's saved chats (used when the list becomes empty, so no empty record is left behind). */
export function removeChats(userId: string) {
  const s = store();
  if (!s || !userId) return;
  try {
    s.removeItem(CHAT_PREFIX + userId);
  } catch {
    /* best effort; clearAssistantStorage verifies erasure separately */
  }
}

function remainingKeys(s: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(CHAT_PREFIX)) keys.push(k);
  }
  return keys;
}

/** Remove chats stored for anyone other than `userId` (stale data from an earlier login in this tab). */
export function purgeOtherUsers(userId: string) {
  const s = store();
  if (!s) return;
  try {
    for (const key of remainingKeys(s)) {
      if (key !== CHAT_PREFIX + userId) s.removeItem(key);
    }
  } catch {
    /* best effort */
  }
}

/**
 * Erase every assistant chat held by this browser tab and verify it.
 * Returns ok:false (with a reason) if anything could not be confirmed erased.
 */
export function clearAssistantStorage(): { ok: boolean; error?: string } {
  const s = store();
  if (!s) {
    // No browser storage available: nothing was ever persisted, only memory state to drop.
    listeners.forEach((fn) => fn());
    return { ok: true };
  }
  try {
    for (const key of remainingKeys(s)) s.removeItem(key);
    const left = remainingKeys(s);
    if (left.length > 0) {
      return { ok: false, error: "Some chat data could not be removed from this browser." };
    }
  } catch {
    return { ok: false, error: "This browser blocked erasing the chat data." };
  }
  listeners.forEach((fn) => fn());
  return { ok: true };
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** First line of the first question, shortened, used as an automatic chat title. */
export function titleFromText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? `${clean.slice(0, 45).trimEnd()}…` : clean;
}
