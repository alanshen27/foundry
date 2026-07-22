"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CircuitBoard,
  Boxes,
  ClipboardCheck,
  Eye,
  FileText,
  GitBranch,
  ListChecks,
  Loader2,
  Package,
  Send,
  Sparkles,
  Square,
  Wrench,
} from "lucide-react";
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCopilot } from "./copilot-provider";

const TOOL_META: Record<string, { label: string; icon: typeof Sparkles }> = {
  get_project_state: { label: "Reading project", icon: Eye },
  update_brief: { label: "Updating brief", icon: FileText },
  add_requirements: { label: "Adding requirements", icon: ListChecks },
  add_components: { label: "Adding components", icon: Package },
  save_circuit: { label: "Drawing circuit", icon: CircuitBoard },
  save_model3d: { label: "Building 3D model", icon: Boxes },
  add_repo_link: { label: "Linking repository", icon: GitBranch },
  add_validation_checks: { label: "Creating checks", icon: ClipboardCheck },
  request_review: { label: "Requesting review", icon: Wrench },
};

function ToolChip({ part }: { part: { type: string; state?: string } }) {
  const name = part.type.replace(/^tool-/, "");
  const meta = TOOL_META[name] ?? { label: name.replaceAll("_", " "), icon: Sparkles };
  const Icon = meta.icon;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        failed
          ? "border-destructive/40 text-destructive"
          : running
            ? "border-primary/30 text-foreground/80"
            : "border-border text-muted-foreground",
      )}
    >
      {running ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
      {meta.label}
      {failed ? " — failed" : null}
    </span>
  );
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted/60 text-foreground rounded-bl-sm",
        )}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") return <span key={i}>{part.text}</span>;
          return null;
        })}
        {message.parts.every((p) => p.type !== "text") && !isUser ? (
          <span className="text-muted-foreground text-xs">Working…</span>
        ) : null}
      </div>
      {!isUser ? (
        <div className="flex max-w-[92%] flex-wrap gap-1.5">
          {message.parts
            .filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool")
            .map((part, i) => (
              <ToolChip key={i} part={part as { type: string; state?: string }} />
            ))}
        </div>
      ) : null}
    </div>
  );
}

const SUGGESTIONS = [
  "Design a smart plant moisture sensor under $30",
  "Add battery-life requirements and matching checks",
  "Review the BOM for cost savings",
];

export function ChatSidebar() {
  const { messages, status, error, open, send, stop } = useCopilot();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    send(input);
    setInput("");
  }

  if (!open) return null;

  return (
    <aside
      aria-label="AI copilot"
      className="bg-card/40 flex w-95 shrink-0 flex-col border-l backdrop-blur-sm"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Sparkles className="text-primary size-4" />
        <span className="text-sm font-semibold">Copilot</span>
        <span className="text-muted-foreground ml-auto text-xs">
          {busy ? "working…" : "ready"}
        </span>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-4 text-center">
            <div className="bg-primary/10 flex size-12 items-center justify-center rounded-2xl">
              <Sparkles className="text-primary size-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Build with the copilot</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Describe your product and it fills out the brief, requirements, BOM, circuit, 3D
                model, and validation checks — or ask it to fix any stage.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="border-border/70 hover:bg-muted/50 rounded-lg border px-3 py-2 text-left text-xs transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} message={m} />)
        )}
        {error ? (
          <p className="text-destructive text-xs leading-relaxed">
            {error.message.includes("OPENAI_API_KEY") || error.message.includes("not configured")
              ? "AI is not configured. Add OPENAI_API_KEY to the root .env and restart the dev server."
              : error.message}
          </p>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t p-3">
        <div className="bg-background focus-within:border-ring focus-within:ring-ring/50 flex items-end gap-2 rounded-xl border p-2 focus-within:ring-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy) {
                  send(input);
                  setInput("");
                }
              }
            }}
            placeholder="Ask the copilot…"
            rows={2}
            className="placeholder:text-muted-foreground max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
            aria-label="Copilot message"
          />
          {busy ? (
            <Button type="button" size="icon-sm" variant="outline" onClick={stop} aria-label="Stop">
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" disabled={!input.trim()} aria-label="Send">
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
      </form>
    </aside>
  );
}
