"use client";

/**
 * SIMULATED copilot sidebar for /demo/engineer: replays a scripted chat run
 * (user prompt → thinking → streamed answer → tool rows) with the same look
 * as the real ChatSidebar. Nothing here talks to a server.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Boxes,
  CheckCircle2,
  Combine,
  Eye,
  ExternalLink,
  Hash,
  Loader2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DemoToolName = "get_project_state" | "text_to_cad" | "add_part_to_assembly";

export type DemoChatItem =
  | { kind: "user"; id: string; author: string; text: string }
  | { kind: "assistant-text"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: DemoToolName;
      state: "running" | "done";
      detail?: string;
    };

const TOOL_META: Record<DemoToolName, { doing: string; done: string; icon: LucideIcon }> = {
  get_project_state: { doing: "Reading project", done: "Read project state", icon: Eye },
  text_to_cad: { doing: "Generating CAD", done: "Generated CAD parts", icon: Boxes },
  add_part_to_assembly: {
    doing: "Assembling product",
    done: "Added parts to assembly",
    icon: Combine,
  },
};

function ThinkingRow() {
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-1 font-mono text-[10px] tracking-[0.08em] uppercase">
      <Loader2 className="size-3 animate-spin" aria-hidden />
      <span>Thinking…</span>
    </div>
  );
}

/** Reveals text with a typewriter effect, like a live stream. */
function StreamedText({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(timer);
          return n;
        }
        return n + 2;
      });
    }, 18);
    return () => clearInterval(timer);
  }, [text]);
  return <>{text.slice(0, shown)}</>;
}

function ToolRow({ item }: { item: Extract<DemoChatItem, { kind: "tool" }> }) {
  const meta = TOOL_META[item.name];
  const Icon = meta.icon;
  const running = item.state === "running";
  return (
    <div className="text-muted-foreground flex flex-col gap-1 py-1.5 text-xs leading-relaxed">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <span className="text-foreground/75">{running ? meta.doing : meta.done}</span>
          {item.detail && !running ? (
            <span className="text-muted-foreground block truncate" title={item.detail}>
              {item.detail}
            </span>
          ) : null}
        </div>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin opacity-60" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 opacity-50" />
        )}
      </div>
    </div>
  );
}

export function DemoChatSidebar({
  items,
  busy,
  onSendNote,
}: {
  items: DemoChatItem[];
  busy: boolean;
  /** Free-typed messages append as plain notes (no AI run). */
  onSendNote: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const timer = setInterval(() => el.scrollTo({ top: el.scrollHeight }), 250);
    return () => clearInterval(timer);
  }, []);

  function trySend() {
    const text = input.trim();
    if (!text) return;
    onSendNote(text);
    setInput("");
  }

  return (
    <aside
      aria-label="AI copilot (simulated)"
      className="bg-background border-border absolute inset-y-0 right-0 z-30 flex w-[352px] max-w-[min(600px,calc(100vw_-_24px))] shrink-0 flex-col border-l shadow-lg lg:relative lg:z-auto lg:max-w-[min(44vw,600px)] lg:shadow-none"
    >
      <div className="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b px-2.5">
        <button
          type="button"
          className="hover:bg-muted flex h-7 items-center gap-1.5 rounded-none px-2 font-mono text-[11px] font-medium tracking-[0.08em] uppercase"
        >
          <Hash className="text-muted-foreground size-3.5" />
          General
        </button>
        <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase">
          <span
            aria-hidden
            className={cn("size-1.5", busy ? "bg-primary animate-pulse" : "bg-muted-foreground/45")}
          />
          {busy ? "Working" : "Ready"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground size-7"
          aria-label="Open chat in a new window"
          title="Open in a new window"
        >
          <ExternalLink className="size-3.5" />
        </Button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5"
        >
          {items.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-4">
              <div className="border-border flex size-9 items-center justify-center rounded-none border bg-[radial-gradient(var(--border)_0.75px,transparent_0.75px)] bg-[size:4px_4px]">
                <Sparkles className="text-primary size-4" />
              </div>
              <div>
                <p className="font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
                  Build with Copilot
                </p>
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                  Mention <span className="text-primary font-medium">@AI</span> to ask the copilot
                  to design, build, or check your project.
                </p>
              </div>
            </div>
          ) : (
            items.map((item) => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="group relative flex flex-col items-end gap-1">
                    <div className="relative max-w-[94%]">
                      <div className="border-border border-l-foreground/40 bg-muted/25 text-foreground rounded-none border border-l-2 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
                        {item.text.split(/(@AI)/g).map((seg, i) =>
                          seg === "@AI" ? (
                            <span
                              key={i}
                              className="bg-primary/10 text-primary inline-flex items-center rounded-none px-0.5 font-medium"
                            >
                              @AI
                            </span>
                          ) : (
                            <span key={i}>{seg}</span>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              if (item.kind === "assistant-text") {
                return (
                  <div key={item.id} className="group relative flex min-w-0 flex-col gap-1.5">
                    <div className="text-foreground min-w-0 py-1 text-[13px] leading-relaxed">
                      <StreamedText text={item.text} />
                    </div>
                  </div>
                );
              }
              return (
                <div key={item.id} className="min-w-0">
                  <ToolRow item={item} />
                </div>
              );
            })
          )}
          {busy && items[items.length - 1]?.kind === "user" ? <ThinkingRow /> : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            trySend();
          }}
          className="border-border shrink-0 border-t border-dotted p-3"
        >
          <div className="bg-background border-foreground/25 focus-within:border-foreground focus-within:ring-foreground/10 flex items-end gap-2 rounded-none border p-2.5 transition-colors focus-within:ring-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  trySend();
                }
              }}
              placeholder="Write a note…"
              rows={2}
              className="placeholder:text-muted-foreground max-h-40 min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none"
              aria-label="Copilot message"
            />
            <Button
              type="submit"
              size="icon-sm"
              className="size-7 shrink-0 rounded-none"
              disabled={!input.trim()}
              aria-label="Send"
            >
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
