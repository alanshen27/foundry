"use client";

/**
 * SIMULATED copilot sidebar for /demo/engineer: replays a scripted chat run
 * (user prompt → thinking → streamed answer → tool rows) with the same look
 * as the real ChatSidebar. Nothing here talks to a server.
 */
import { useEffect, useRef, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  Combine,
  Eye,
  ExternalLink,
  Hash,
  Loader2,
  Send,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { Button } from "@/components/ui/button";

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
    <div className="text-muted-foreground flex items-center gap-2.5 py-1">
      <AnimatedSignalGlyph
        seed="copilot-thinking"
        rows={3}
        cols={16}
        fontSize={8}
        color="currentColor"
        className="opacity-80"
      />
      <span className="animate-pulse font-mono text-[11px] tracking-[0.08em] uppercase">
        thinking…
      </span>
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
    <div className="text-muted-foreground flex flex-col gap-1.5 py-1.5 pl-0.5 text-xs">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <span className="text-foreground/70 font-medium">{running ? meta.doing : meta.done}</span>
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
      className="bg-card/40 relative flex w-[400px] shrink-0 flex-col border-l backdrop-blur-sm"
    >
      <div className="relative z-10 flex h-9 shrink-0 items-center gap-2 border-b px-2.5">
        <button
          type="button"
          className="hover:bg-muted flex h-7 items-center gap-1.5 rounded-none px-2 text-[13px] font-medium"
        >
          <Hash className="text-muted-foreground size-3.5" />
          general
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto size-7"
          aria-label="Open chat in a new window"
          title="Open in a new window"
        >
          <ExternalLink className="size-3.5" />
        </Button>
        <span className="text-muted-foreground shrink-0 font-mono text-[11px] tracking-[0.04em]">
          {busy ? "working…" : "ready"}
        </span>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-4 text-center">
              <div className="bg-primary relative flex h-20 w-full items-center justify-center overflow-hidden">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-30"
                  style={{
                    backgroundImage: "radial-gradient(circle, #faf9f5 0.55px, transparent 0.65px)",
                    backgroundSize: "3.5px 3.5px",
                  }}
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-70">
                  <AnimatedSignalGlyph seed="copilot-idle" rows={9} cols={34} fontSize={7} />
                </div>
                <Sparkles className="relative z-10 size-5 text-[#faf9f5]" />
              </div>
              <div>
                <p className="font-mono text-sm font-medium tracking-[0.04em]">Foundry Copilot</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  Mention <span className="text-foreground font-medium">@AI</span> to ask the
                  copilot — it fills out the brief, requirements, BOM, circuit, 3D model, and
                  checks.
                </p>
              </div>
            </div>
          ) : (
            items.map((item) => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="group relative flex flex-col items-end gap-1">
                    <div className="relative max-w-[92%]">
                      <div className="bg-primary text-primary-foreground rounded-none px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                        {item.text.split(/(@AI)/g).map((seg, i) =>
                          seg === "@AI" ? (
                            <span
                              key={i}
                              className="bg-primary-foreground/20 inline-flex items-center rounded-none px-1 font-medium"
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
                  <div key={item.id} className="group relative flex max-w-[95%] flex-col gap-1.5">
                    <div className="bg-muted/60 text-foreground rounded-none px-3.5 py-2.5 text-sm leading-relaxed">
                      <StreamedText text={item.text} />
                    </div>
                  </div>
                );
              }
              return (
                <div key={item.id} className="max-w-[95%]">
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
          className="shrink-0 border-t p-3"
        >
          <div className="bg-background focus-within:border-ring focus-within:ring-ring/50 flex items-end gap-2 rounded-none border p-2 focus-within:ring-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  trySend();
                }
              }}
              placeholder={
                busy
                  ? "Draft next message… stop to cancel the reply"
                  : "Message… type @ to mention AI"
              }
              rows={2}
              className="placeholder:text-muted-foreground max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
              aria-label="Copilot message"
            />
            <Button type="submit" size="icon-sm" disabled={!input.trim()} aria-label="Send">
              <Send className="size-3.5" />
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
