import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  loadChats,
  newId,
  onChatsCleared,
  purgeOtherUsers,
  removeChats,
  saveChats,
  titleFromText,
  type Chat,
  type ChatMessage,
} from "@/lib/assistant/storage";

const REQUEST_TIMEOUT_MS = 100_000;

type Reply = { answer: string; sources: { tool: string; label: string }[]; asOf: string };

async function askServer(messages: ChatMessage[], signal: AbortSignal): Promise<Reply> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has ended. Please sign in again.");
  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: messages
          .filter((m) => !m.error)
          .map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if ((e as Error).name === "TimeoutError")
      throw new Error("The assistant took too long to answer. Please try again.");
    throw new Error("The assistant could not be reached. Check your connection and try again.");
  }
  let body: {
    answer?: string;
    sources?: Reply["sources"];
    asOf?: string;
    error?: { message?: string };
  } = {};
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || !body.answer) {
    throw new Error(
      body.error?.message ?? "The assistant could not answer right now. Please try again.",
    );
  }
  return {
    answer: body.answer,
    sources: body.sources ?? [],
    asOf: body.asOf ?? new Date().toISOString(),
  };
}

/**
 * Chat state for the assistant: session-scoped, per signed-in user, never sent to a database.
 */
export function useChats(userId: string | null) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;

  // Load this user's chats for the current tab session (and drop anyone else's).
  useEffect(() => {
    if (!userId) return;
    purgeOtherUsers(userId);
    const saved = loadChats(userId);
    setChats(saved);
    setActiveId(saved[0]?.id ?? null);
    setLoaded(true);
  }, [userId]);

  // Persist after every change (only once loaded, so a refresh never wipes saved chats).
  useEffect(() => {
    if (!userId || !loaded) return;
    if (chats.length === 0) removeChats(userId);
    else saveChats(userId, chats);
  }, [userId, loaded, chats]);

  // When storage is cleared (logout, session end) forget everything held in memory too.
  useEffect(
    () =>
      onChatsCleared(() => {
        abortRef.current?.abort();
        setChats([]);
        setActiveId(null);
        setPendingChatId(null);
        chatsRef.current = [];
      }),
    [],
  );

  const patchChat = useCallback((id: string, fn: (c: Chat) => Chat) => {
    setChats((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const run = useCallback(
    async (chatId: string, history: ChatMessage[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPendingChatId(chatId);
      try {
        const reply = await askServer(history, controller.signal);
        const msg: ChatMessage = {
          id: newId(),
          role: "assistant",
          content: reply.answer,
          createdAt: new Date().toISOString(),
          sources: reply.sources,
          asOf: reply.asOf,
        };
        patchChat(chatId, (c) => ({
          ...c,
          messages: [...c.messages, msg],
          updatedAt: msg.createdAt,
        }));
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patchChat(chatId, (c) => ({
            ...c,
            messages: [
              ...c.messages,
              {
                id: newId(),
                role: "assistant",
                content: "Stopped. No answer was produced.",
                createdAt: new Date().toISOString(),
                error: true,
              },
            ],
          }));
        } else {
          patchChat(chatId, (c) => ({
            ...c,
            messages: [
              ...c.messages,
              {
                id: newId(),
                role: "assistant",
                content: (e as Error).message,
                createdAt: new Date().toISOString(),
                error: true,
              },
            ],
          }));
        }
      } finally {
        setPendingChatId((p) => (p === chatId ? null : p));
        abortRef.current = null;
      }
    },
    [patchChat],
  );

  const newChat = useCallback(() => {
    const current = chatsRef.current.find((c) => c.id === activeId);
    if (current && current.messages.length === 0) return current.id; // reuse the empty one
    const now = new Date().toISOString();
    const chat: Chat = {
      id: newId(),
      title: "New chat",
      titleEdited: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    setChats((prev) => [chat, ...prev]);
    setActiveId(chat.id);
    return chat.id;
  }, [activeId]);

  const send = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || pendingChatId) return;
      let chatId = activeId;
      if (!chatId || !chatsRef.current.some((c) => c.id === chatId)) chatId = newChat();
      const existing = chatsRef.current.find((c) => c.id === chatId);
      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: clean,
        createdAt: new Date().toISOString(),
      };
      const history = [...(existing?.messages ?? []), userMsg];
      const id = chatId;
      setChats((prev) => {
        const exists = prev.some((c) => c.id === id);
        const base = exists
          ? prev
          : [
              {
                id,
                title: "New chat",
                titleEdited: false,
                createdAt: userMsg.createdAt,
                updatedAt: userMsg.createdAt,
                messages: [] as ChatMessage[],
              },
              ...prev,
            ];
        return base.map((c) =>
          c.id === id
            ? {
                ...c,
                messages: history,
                updatedAt: userMsg.createdAt,
                title: !c.titleEdited && c.messages.length === 0 ? titleFromText(clean) : c.title,
              }
            : c,
        );
      });
      setActiveId(id);
      void run(id, history);
    },
    [activeId, newChat, pendingChatId, run],
  );

  /** Edit a question: everything after it is removed so no stale answers remain, then it is re-asked. */
  const editMessage = useCallback(
    (chatId: string, messageId: string, text: string) => {
      const clean = text.trim();
      if (!clean || pendingChatId) return;
      const chat = chatsRef.current.find((c) => c.id === chatId);
      const index = chat?.messages.findIndex((m) => m.id === messageId) ?? -1;
      if (!chat || index < 0) return;
      const edited: ChatMessage = {
        ...chat.messages[index]!,
        content: clean,
        createdAt: new Date().toISOString(),
      };
      const history = [...chat.messages.slice(0, index), edited];
      patchChat(chatId, (c) => ({
        ...c,
        messages: history,
        updatedAt: edited.createdAt,
        title: !c.titleEdited && index === 0 ? titleFromText(clean) : c.title,
      }));
      void run(chatId, history);
    },
    [patchChat, pendingChatId, run],
  );

  const regenerate = useCallback(
    (chatId: string) => {
      if (pendingChatId) return;
      const chat = chatsRef.current.find((c) => c.id === chatId);
      if (!chat) return;
      const history = [...chat.messages];
      while (history.length && history.at(-1)!.role === "assistant") history.pop();
      if (history.length === 0 || history.at(-1)!.role !== "user") return;
      patchChat(chatId, (c) => ({ ...c, messages: history }));
      void run(chatId, history);
    },
    [patchChat, pendingChatId, run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const renameChat = useCallback(
    (id: string, title: string) => {
      const t = title.trim().slice(0, 80);
      if (!t) return false;
      patchChat(id, (c) => ({ ...c, title: t, titleEdited: true }));
      return true;
    },
    [patchChat],
  );

  const deleteChat = useCallback(
    (id: string) => {
      if (pendingChatId === id) abortRef.current?.abort();
      const remaining = chatsRef.current.filter((c) => c.id !== id);
      setChats(remaining);
      setActiveId((cur) => (cur === id ? (remaining[0]?.id ?? null) : cur));
    },
    [pendingChatId],
  );

  return {
    chats,
    activeId,
    setActiveId,
    active: chats.find((c) => c.id === activeId) ?? null,
    pendingChatId,
    loaded,
    newChat,
    send,
    editMessage,
    regenerate,
    stop,
    renameChat,
    deleteChat,
  };
}
