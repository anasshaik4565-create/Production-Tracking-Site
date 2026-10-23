import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Copy,
  Loader2,
  Menu,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell, LogoTile } from "@/components/AppShell";
import { Markdown } from "@/components/assistant/Markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { fmtIST } from "@/lib/assistant/analytics";
import type { Chat, ChatMessage } from "@/lib/assistant/storage";
import { useChats } from "@/lib/assistant/useChats";
import { useAccess } from "@/lib/access";
import { ASSISTANT_NAME, ASSISTANT_SUBTITLE, COMPANY_NAME, pageTitle } from "@/lib/brand";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({ meta: [{ title: pageTitle(ASSISTANT_NAME) }] }),
  component: AssistantPage,
});

const MAX_CHARS = 4000;
const STARTERS = [
  "Give me a production summary of each project.",
  "Which panels are QC Pending or marked Not OK?",
  "Which panels are overweight or underweight?",
  "Which stages have the highest backlog?",
  "Summarize today's recorded production updates.",
  "What are the pending activities for the latest project?",
];

function copyText(text: string) {
  const done = () => toast.success("Copied to clipboard.");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(done, () => toast.error("Could not copy. Select the text and copy it manually."));
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    toast.error("Could not copy. Select the text and copy it manually.");
  }
  ta.remove();
}

function ChatList({
  chats,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  chats: Chat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (chat: Chat) => void;
  onDelete: (chat: Chat) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Button onClick={onNew} className="w-full">
        <Plus className="mr-1.5 size-4" /> New Chat
      </Button>
      <p className="mt-4 mb-1.5 px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        This session
      </p>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {chats.length === 0 && (
          <li className="px-1 py-2 text-sm text-muted-foreground">No chats yet.</li>
        )}
        {chats.map((c) => (
          <li key={c.id} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "w-full rounded-lg px-3 py-2 pr-9 text-left",
                c.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <span className="block truncate text-sm font-medium">{c.title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {new Date(c.updatedAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Chat options for ${c.title}`}
                  className="absolute top-1.5 right-1 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onRename(c)}>
                  <Pencil className="mr-2 size-4" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onDelete(c)}
                >
                  <Trash2 className="mr-2 size-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
        Chats are kept for this login session only and are erased when you log out.
      </p>
    </div>
  );
}

function UserMessage({
  message,
  disabled,
  onEdit,
}: {
  message: ChatMessage;
  disabled: boolean;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  if (editing) {
    return (
      <div className="ml-auto w-full max-w-[85%] space-y-2 rounded-2xl border bg-card p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHARS}
          rows={3}
          autoFocus
          aria-label="Edit your message"
        />
        <p className="text-xs text-muted-foreground">
          Saving replaces every answer after this message with a fresh one.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(false);
              setText(message.content);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!text.trim() || disabled}
            onClick={() => {
              setEditing(false);
              onEdit(text);
            }}
          >
            Save and resubmit
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="group ml-auto flex max-w-[85%] flex-col items-end gap-1">
      <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
        {message.content}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setText(message.content);
          setEditing(true);
        }}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Edit message"
      >
        <Pencil className="size-3" /> Edit
      </button>
    </div>
  );
}

function AssistantMessage({
  message,
  isLast,
  disabled,
  onRegenerate,
}: {
  message: ChatMessage;
  isLast: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-[95%] items-start gap-2.5">
      <LogoTile className="mt-0.5 size-8 !shadow-none ring-1 ring-border" />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "rounded-2xl rounded-tl-md border px-4 py-3",
            message.error ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-card",
          )}
        >
          {message.error ? (
            <p className="text-sm">{message.content}</p>
          ) : (
            <Markdown>{message.content}</Markdown>
          )}
        </div>
        {!message.error && message.sources && message.sources.length > 0 && (
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            Live production data · {message.sources.map((s) => s.label).join(" · ")}
            {message.asOf ? ` · as of ${fmtIST(message.asOf)}` : ""}
          </p>
        )}
        <div className="mt-1 flex items-center gap-1 px-1">
          {!message.error && (
            <button
              type="button"
              onClick={() => {
                copyText(message.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Copy response"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{" "}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {isLast && (
            <button
              type="button"
              disabled={disabled}
              onClick={onRegenerate}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              aria-label={message.error ? "Try again" : "Regenerate response"}
            >
              <RefreshCw className="size-3" /> {message.error ? "Try again" : "Regenerate"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantPage() {
  const { userId, role } = useAccess();
  const chatsApi = useChats(userId);
  const { chats, active, activeId, pendingChatId } = chatsApi;
  const [input, setInput] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [renaming, setRenaming] = useState<Chat | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const thinking = pendingChatId !== null && pendingChatId === activeId;
  const busy = pendingChatId !== null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, thinking, activeId]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  function submit(text = input) {
    if (!text.trim() || busy) return;
    chatsApi.send(text);
    setInput("");
  }

  const list = (
    <ChatList
      chats={chats}
      activeId={activeId}
      onSelect={(id) => {
        chatsApi.setActiveId(id);
        setListOpen(false);
      }}
      onNew={() => {
        chatsApi.newChat();
        setListOpen(false);
        boxRef.current?.focus();
      }}
      onRename={(c) => {
        setRenaming(c);
        setRenameText(c.title);
      }}
      onDelete={(c) => setDeleting(c)}
    />
  );

  return (
    <AppShell title={ASSISTANT_NAME}>
      <div className="flex h-[calc(100dvh-10rem)] min-h-[520px] gap-4">
        <aside className="hidden w-72 shrink-0 rounded-xl border bg-card p-3 md:block">
          {list}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setListOpen(true)}
              aria-label="Chats"
            >
              <Menu className="size-5" />
            </Button>
            <LogoTile className="size-10 !shadow-none ring-1 ring-border" />
            <div className="min-w-0">
              <h2 className="truncate text-base leading-tight font-bold tracking-tight">
                {ASSISTANT_NAME}
              </h2>
              <p className="truncate text-xs text-muted-foreground">{ASSISTANT_SUBTITLE}</p>
            </div>
            <span className="ml-auto hidden rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground sm:inline">
              Read-only
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5" aria-live="polite">
            {messages.length === 0 && !thinking && (
              <div className="mx-auto flex max-w-xl flex-col items-center pt-6 text-center">
                <LogoTile className="size-16 !shadow-none ring-1 ring-border" />
                <h3 className="mt-4 text-lg font-bold">{ASSISTANT_NAME}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask about project progress, pending activities, QC status, weights and recent
                  production updates. Answers come from your live production data.
                </p>
                <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => submit(s)}
                      className="rounded-lg border bg-background px-3 py-2.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {role === "admin" ? "Signed in as Admin." : "Signed in as Reader."} The assistant
                  only reads data; it cannot change records.
                </p>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <UserMessage
                  key={m.id}
                  message={m}
                  disabled={busy}
                  onEdit={(text) => active && chatsApi.editMessage(active.id, m.id, text)}
                />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  isLast={i === messages.length - 1}
                  disabled={busy}
                  onRegenerate={() => active && chatsApi.regenerate(active.id)}
                />
              ),
            )}

            {thinking && (
              <div className="flex max-w-[95%] items-start gap-2.5">
                <LogoTile className="mt-0.5 size-8 !shadow-none ring-1 ring-border" />
                <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Checking production data…
                  <Button size="sm" variant="ghost" onClick={chatsApi.stop} className="h-7 px-2">
                    <Square className="mr-1 size-3" /> Stop
                  </Button>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={boxRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                maxLength={MAX_CHARS}
                placeholder="Ask about projects, sets, panels, QC, weights or pending work…"
                aria-label="Message"
                className="max-h-42 min-h-11 resize-none"
              />
              <Button
                onClick={() => submit()}
                disabled={!input.trim() || busy}
                aria-label="Send"
                className="h-11 px-4"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line. AI answers can contain mistakes; check
              important figures in the app.
            </p>
          </div>
        </section>
      </div>

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="w-80 p-4">
          <SheetTitle className="mb-3">Chats</SheetTitle>
          <div className="h-[calc(100%-2.5rem)]">{list}</div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Give this chat a clear title.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameText}
            maxLength={80}
            autoFocus
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renaming && chatsApi.renameChat(renaming.id, renameText))
                setRenaming(null);
            }}
            aria-label="Chat title"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameText.trim()}
              onClick={() =>
                renaming && chatsApi.renameChat(renaming.id, renameText) && setRenaming(null)
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” and all of its messages will be permanently deleted. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) chatsApi.deleteChat(deleting.id);
                setDeleting(null);
                toast.success("Chat deleted.");
              }}
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
