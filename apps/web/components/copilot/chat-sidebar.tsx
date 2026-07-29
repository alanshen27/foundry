"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  AtSign,
  Camera,
  CheckCircle2,
  CircuitBoard,
  Boxes,
  ClipboardCheck,
  Code2,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  GitBranch,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Package,
  Send,
  Sparkles,
  Square,
  Wrench,
  XCircle,
} from "lucide-react";
import type { UIMessage } from "ai";
import { usePathname } from "next/navigation";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  filterMentionTargets,
  insertMention,
  mentionQueryAt,
  mentionsAi,
  splitMentions,
  type MentionTarget,
} from "@/lib/copilot/mentions";
import { groupAssistantPartBlocks } from "@/lib/copilot/part-blocks";
import { isAssistantFailureText } from "@/lib/copilot/messages";
import { Markdown } from "./markdown";
import { ChannelSwitcher } from "./channel-switcher";
import { useCopilot } from "./copilot-provider";

const TOOL_META: Record<
  string,
  { doing: string; done: string; failed: string; icon: typeof Sparkles }
> = {
  get_project_state: {
    doing: "Reading project",
    done: "Read project state",
    failed: "Failed to read project",
    icon: Eye,
  },
  update_brief: {
    doing: "Updating brief",
    done: "Updated the brief",
    failed: "Failed to update brief",
    icon: FileText,
  },
  add_requirements: {
    doing: "Adding requirements",
    done: "Added requirements",
    failed: "Failed to add requirements",
    icon: ListChecks,
  },
  remove_requirements: {
    doing: "Removing requirements",
    done: "Removed requirements",
    failed: "Failed to remove requirements",
    icon: ListChecks,
  },
  add_components: {
    doing: "Adding components",
    done: "Updated the BOM",
    failed: "Failed to update BOM",
    icon: Package,
  },
  remove_components: {
    doing: "Removing components",
    done: "Removed BOM parts",
    failed: "Failed to remove parts",
    icon: Package,
  },
  remove_validation_checks: {
    doing: "Removing checks",
    done: "Removed validation checks",
    failed: "Failed to remove checks",
    icon: ClipboardCheck,
  },
  delete_code_file: {
    doing: "Deleting code file",
    done: "Deleted code file",
    failed: "Failed to delete code",
    icon: Code2,
  },
  clear_circuit: {
    doing: "Clearing schematic",
    done: "Cleared the schematic",
    failed: "Failed to clear schematic",
    icon: CircuitBoard,
  },
  extract_product_images: {
    doing: "Extracting product images",
    done: "Extracted product images",
    failed: "Image extraction failed",
    icon: ImageIcon,
  },
  save_circuit: {
    doing: "Drawing circuit",
    done: "Saved the schematic",
    failed: "Failed to save schematic",
    icon: CircuitBoard,
  },
  import_wokwi_diagram: {
    doing: "Importing schematic",
    done: "Imported Wokwi schematic",
    failed: "Failed to import schematic",
    icon: FileDown,
  },
  save_pcb: {
    doing: "Laying out PCB",
    done: "Saved the PCB",
    failed: "Failed to save PCB",
    icon: CircuitBoard,
  },
  clear_pcb: {
    doing: "Clearing PCB",
    done: "Cleared the PCB",
    failed: "Failed to clear PCB",
    icon: CircuitBoard,
  },
  web_search: {
    doing: "Searching the web",
    done: "Searched the web",
    failed: "Web search failed",
    icon: Globe,
  },
  create_cad_component: {
    doing: "Adding CAD component",
    done: "Added CAD component",
    failed: "Failed to add CAD component",
    icon: Boxes,
  },
  delete_cad_component: {
    doing: "Deleting CAD file",
    done: "Deleted CAD file",
    failed: "Failed to delete CAD file",
    icon: Boxes,
  },
  text_to_cad: {
    doing: "Generating CAD (Zoo)",
    done: "Generated the 3D model",
    failed: "CAD generation failed",
    icon: Boxes,
  },
  save_cad_script: {
    doing: "Writing KCL",
    done: "Saved the 3D model",
    failed: "Failed to save KCL",
    icon: Boxes,
  },
  add_part_to_assembly: {
    doing: "Assembling (Zoo Zookeeper)",
    done: "Assembled parts",
    failed: "Assembly failed",
    icon: Boxes,
  },
  generate_concept_image: {
    doing: "Rendering concept image",
    done: "Generated concept image",
    failed: "Concept image failed",
    icon: ImageIcon,
  },
  render_model_views: {
    doing: "Inspecting 3D model",
    done: "Inspected the 3D model",
    failed: "Model inspect failed",
    icon: Camera,
  },
  render_circuit: {
    doing: "Inspecting schematic",
    done: "Inspected the schematic",
    failed: "Schematic inspect failed",
    icon: Camera,
  },
  render_pcb: {
    doing: "Inspecting PCB",
    done: "Inspected the PCB",
    failed: "PCB inspect failed",
    icon: Camera,
  },
  add_repo_link: {
    doing: "Linking repository",
    done: "Linked repository",
    failed: "Failed to link repository",
    icon: GitBranch,
  },
  write_code_file: {
    doing: "Writing code",
    done: "Wrote code file",
    failed: "Failed to write code",
    icon: Code2,
  },
  add_validation_checks: {
    doing: "Creating checks",
    done: "Added validation checks",
    failed: "Failed to add checks",
    icon: ClipboardCheck,
  },
  request_review: {
    doing: "Requesting review",
    done: "Flagged for review",
    failed: "Failed to request review",
    icon: Wrench,
  },
};

export type ToolPart = {
  type: string;
  state?: string;
  output?: unknown;
  input?: unknown;
  errorText?: string;
  toolName?: string;
  toolCallId?: string;
};

function toolPartName(part: ToolPart): string {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }
  return part.type.replace(/^tool-/, "");
}

function toolPartRunning(part: ToolPart): boolean {
  return part.state === "input-streaming" || part.state === "input-available";
}

function toolPartFailed(part: ToolPart): boolean {
  if (part.state === "output-error") return true;
  return (
    part.state === "output-available" &&
    typeof (part.output as Record<string, unknown> | undefined)?.error === "string"
  );
}

/** Compact detail line for an edit confirmation, derived from tool output. */
function toolDetail(name: string, part: ToolPart): string | null {
  const bits: string[] = [];
  if (name === "web_search") {
    const input = part.input as Record<string, unknown> | undefined;
    if (input && typeof input.query === "string") bits.push(input.query);
  }
  const out = part.output as Record<string, unknown> | undefined;
  if (!out || typeof out !== "object") return bits.length > 0 ? bits.join(" · ") : null;
  if (name === "add_requirements" && typeof out.created === "number")
    bits.push(`${out.created} added`);
  if (
    (name === "remove_requirements" ||
      name === "remove_components" ||
      name === "remove_validation_checks" ||
      name === "delete_code_file" ||
      name === "delete_cad_component") &&
    typeof out.deleted === "number"
  )
    bits.push(`${out.deleted} deleted`);
  if (name === "extract_product_images" && Array.isArray(out.images))
    bits.push(`${out.images.length} images`);
  if (name === "add_components" && typeof out.created === "number")
    bits.push(`${out.created} parts`);
  if (name === "text_to_cad" && typeof out.generated === "number" && out.generated > 1)
    bits.push(`${out.generated} parts in parallel`);
  if (name === "text_to_cad" && Array.isArray(out.failed) && out.failed.length > 0)
    bits.push(`${out.failed.length} failed`);
  if ((name === "save_cad_script" || name === "text_to_cad") && typeof out.kclChars === "number")
    bits.push(`${out.kclChars} chars KCL`);
  if (
    (name === "save_circuit" || name === "import_wokwi_diagram") &&
    typeof out.parts === "number" &&
    typeof out.wires === "number"
  )
    bits.push(`${out.parts} parts · ${out.wires} wires`);
  if (name === "save_pcb") {
    if (typeof out.footprints === "number") bits.push(`${out.footprints} footprints`);
    if (typeof out.tracks === "number" && out.tracks > 0) bits.push(`${out.tracks} tracks`);
    if (typeof out.routed === "string") bits.push(`routed ${out.routed}`);
    const drc = out.drc as { errors?: number } | undefined;
    if (drc && typeof drc.errors === "number" && drc.errors > 0)
      bits.push(`${drc.errors} DRC errors`);
  }
  if (name === "write_code_file" && typeof out.path === "string") bits.push(out.path);
  if (name === "add_validation_checks" && typeof out.created === "number")
    bits.push(`${out.created} checks`);
  if (name === "request_review" && typeof out.reason === "string") bits.push(out.reason);
  const stale = out.staleStages;
  if (Array.isArray(stale) && stale.length > 0) {
    bits.push(`marked ${stale.map((s) => String(s).toLowerCase()).join(", ")} stale`);
  }
  return bits.length > 0 ? bits.join(" · ") : null;
}

/** Image URLs (concept renders, screenshots) attached to a tool output. */
function toolImages(part: ToolPart): string[] {
  const out = part.output as Record<string, unknown> | undefined;
  if (!out || typeof out !== "object") return [];
  const urls: string[] = [];
  if (typeof out.imageUrl === "string") urls.push(out.imageUrl);
  if (Array.isArray(out.images)) {
    for (const image of out.images) {
      const url = (image as Record<string, unknown>).imageUrl;
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}

export function ToolCard({ part }: { part: ToolPart }) {
  const name = toolPartName(part);
  const meta = TOOL_META[name] ?? {
    doing: name.replaceAll("_", " "),
    done: name.replaceAll("_", " "),
    failed: `Failed: ${name.replaceAll("_", " ")}`,
    icon: Sparkles,
  };
  const Icon = meta.icon;
  const running = toolPartRunning(part);
  // Tools report soft failures as { error } outputs; show those as failures
  // too, not as a green check / success title.
  const softError =
    part.state === "output-available" &&
    typeof (part.output as Record<string, unknown> | undefined)?.error === "string"
      ? String((part.output as Record<string, unknown>).error)
      : null;
  const failed = toolPartFailed(part);
  const detail =
    part.state === "output-error"
      ? (part.errorText ?? "failed")
      : (softError ?? toolDetail(name, part));
  const images = toolImages(part);
  const title = running ? meta.doing : failed ? meta.failed : meta.done;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 py-1.5 text-xs",
        failed
          ? "border-destructive/30 bg-destructive/5 text-destructive border-l-2 pl-2"
          : "text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <span className={cn("font-medium", !failed && "text-foreground/70")}>{title}</span>
          {detail ? (
            <span
              className={cn(
                "block",
                failed
                  ? "text-destructive/80 whitespace-pre-wrap break-words"
                  : "text-muted-foreground truncate",
              )}
              title={detail}
            >
              {detail}
            </span>
          ) : null}
        </div>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin opacity-60" />
        ) : failed ? (
          <XCircle className="size-3.5 shrink-0" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 opacity-50" />
        )}
      </div>
      {images.length > 0 ? (
        <div className={cn("grid gap-1.5", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {images.map((src) => (
            <img
              key={src}
              src={src}
              alt="Copilot render"
              className="w-full rounded-none object-cover"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One row for a parallel / consecutive batch of tool calls. */
export function ToolCallGroup({ parts }: { parts: ToolPart[] }) {
  const [expanded, setExpanded] = useState(false);

  if (parts.length === 0) return null;
  // Single tool keeps the detailed card; batches collapse to one summary row.
  if (parts.length === 1) return <ToolCard part={parts[0]!} />;

  const running = parts.some(toolPartRunning);
  const failedCount = parts.filter(toolPartFailed).length;
  const images = parts.flatMap(toolImages);
  const n = parts.length;

  let title: string;
  if (running) title = `Working ${n} tools`;
  else if (failedCount === n) title = `Failed ${n} tools`;
  else if (failedCount > 0) title = `Worked ${n} tools · ${failedCount} failed`;
  else title = `Worked ${n} tools`;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 py-1.5 text-xs",
        failedCount > 0 && !running
          ? "border-destructive/30 bg-destructive/5 text-destructive border-l-2 pl-2"
          : "text-muted-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Wrench className="size-3.5 shrink-0 opacity-70" />
        <span className={cn("min-w-0 flex-1 font-medium", failedCount === 0 && "text-foreground/70")}>
          {title}
        </span>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin opacity-60" />
        ) : failedCount > 0 ? (
          <XCircle className="size-3.5 shrink-0" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 opacity-50" />
        )}
      </button>
      {expanded ? (
        <div className="border-border/60 ml-1.5 flex flex-col border-l pl-2">
          {parts.map((part, i) => (
            <ToolCard
              key={
                typeof part.toolCallId === "string" ? part.toolCallId : `${toolPartName(part)}-${i}`
              }
              part={part}
            />
          ))}
        </div>
      ) : null}
      {!expanded && images.length > 0 ? (
        <div className={cn("grid gap-1.5", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {images.map((src) => (
            <img
              key={src}
              src={src}
              alt="Copilot render"
              className="w-full rounded-none object-cover"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Message({
  message,
  failed,
}: {
  message: UIMessage;
  /** Live stream just errored on this (usually last) assistant turn. */
  failed?: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[92%] rounded-none px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {message.parts.map((part, i) =>
            part.type === "text" ? (
              <span key={i}>
                {splitMentions(part.text).map((seg, j) =>
                  seg.kind === "mention" ? (
                    <span
                      key={j}
                      className="bg-primary-foreground/20 inline-flex items-center rounded-none px-1 font-medium"
                    >
                      {seg.text}
                    </span>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  ),
                )}
              </span>
            ) : null,
          )}
        </div>
      </div>
    );
  }

  // Assistant: interleave text and tool cards in part order.
  const hasContent = message.parts.some(
    (p) =>
      (p.type === "text" && p.text.trim().length > 0) ||
      p.type.startsWith("tool-") ||
      p.type === "dynamic-tool",
  );
  const stampedFailed = message.parts.some(
    (p) => p.type === "text" && isAssistantFailureText(p.text),
  );
  const showFailed = Boolean(failed) || stampedFailed;

  return (
    <div className="flex max-w-[95%] flex-col gap-1.5">
      {groupAssistantPartBlocks(message.parts, message.id).map((block) => {
        if (block.type === "text") {
          if (isAssistantFailureText(block.part.text)) {
            return (
              <div
                key={block.key}
                className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-none border px-3.5 py-2.5 text-xs leading-relaxed"
              >
                <XCircle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 whitespace-pre-wrap">{block.part.text}</span>
              </div>
            );
          }
          return (
            <div
              key={block.key}
              className="bg-muted/60 text-foreground rounded-none px-3.5 py-2.5 text-sm leading-relaxed"
            >
              <Markdown text={block.part.text} />
            </div>
          );
        }
        return (
          <ToolCallGroup key={block.key} parts={block.parts as ToolPart[]} />
        );
      })}
      {!hasContent ? (
        showFailed ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-none border px-3.5 py-2.5 text-xs">
            <XCircle className="size-3.5 shrink-0" />
            Failed
          </div>
        ) : (
          <div className="bg-muted/60 text-muted-foreground rounded-none px-3.5 py-2.5 text-xs">
            Working…
          </div>
        )
      ) : showFailed && !stampedFailed ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-none border px-3 py-1.5 text-[11px]">
          <XCircle className="size-3 shrink-0" />
          Failed
        </div>
      ) : null}
    </div>
  );
}

const SUGGESTIONS = [
  "@AI Design a smart plant moisture sensor under $30",
  "@AI Add battery-life requirements and matching checks",
  "@AI Review the BOM for cost savings",
];

function openChatPopout(pathname: string | null) {
  if (!pathname) return;
  const base = pathname.replace(/\/(overview|ideate|engineer|verify|launch|chat)(\/.*)?$/, "");
  const url = `${base}/chat`;
  window.open(url, "foundry-chat", "popup=yes,width=1100,height=760");
}

export function ChatSidebar() {
  const pathname = usePathname();
  const { messages, status, busy, error, open, send, stop } = useCopilot();
  const [input, setInput] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [width, setWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("foundry:chat-width");
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 300 && parsed <= 1200) {
        setWidth(parsed);
      }
    }
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    function onMouseMove(e: MouseEvent) {
      const newWidth = document.documentElement.clientWidth - e.clientX;
      if (newWidth >= 300 && newWidth <= 1200) {
        setWidth(newWidth);
      }
    }

    function onMouseUp() {
      setIsResizing(false);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isResizing) {
      localStorage.setItem("foundry:chat-width", width.toString());
    }
  }, [isResizing, width]);

  // Send any non-empty message. @AI forces a reply; otherwise a light model
  // decides. provider.send() no-ops if a local stream is already in flight.
  const canSend = Boolean(input.trim()) && status !== "submitted" && status !== "streaming";

  const mentionActive = useMemo(() => mentionQueryAt(input, caret), [input, caret]);
  const mentionOptions = useMemo(
    () => (mentionActive ? filterMentionTargets(mentionActive.query) : []),
    [mentionActive],
  );
  const mentionOpen = mentionOptions.length > 0 && !mentionDismissed;

  useEffect(() => {
    setMentionIndex(0);
    setMentionDismissed(false);
  }, [mentionActive?.start, mentionActive?.query]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function applyMention(target: MentionTarget) {
    const next = insertMention(input, caret, target);
    setInput(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function trySend() {
    if (!canSend) return;
    send(input);
    setInput("");
    setCaret(0);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    trySend();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const target = mentionOptions[mentionIndex];
        if (target) applyMention(target);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      trySend();
    }
  }

  if (!open) return null;

  return (
    <aside
      aria-label="AI copilot"
      className={cn(
        "bg-card/40 relative flex shrink-0 flex-col border-l backdrop-blur-sm",
        isResizing && "select-none",
      )}
      style={{ width }}
    >
      <div
        className="absolute top-0 bottom-0 left-0 z-50 w-1.5 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-primary/50"
        onMouseDown={() => setIsResizing(true)}
      />
      <div className="relative z-10 flex h-9 shrink-0 items-center gap-2 border-b px-2.5">
        <ChannelSwitcher />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto size-7"
          onClick={() => openChatPopout(pathname)}
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
          {messages.length === 0 ? (
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
              <div className="flex w-full flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => send(s)}
                    className="border-border/70 hover:bg-muted/50 rounded-none border px-3 py-2 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                failed={status === "error" && m.role === "assistant" && i === messages.length - 1}
              />
            ))
          )}
          {error ? (
            <p className="text-destructive text-xs leading-relaxed">
              {error.message.includes("OPENAI_API_KEY") || error.message.includes("not configured")
                ? "AI is not configured. Add OPENAI_API_KEY to the root .env and restart the dev server."
                : error.message.includes("Unexpected end of JSON") || error.message.includes("431")
                  ? "Request failed (cookies/headers too large or empty response). Clear cookies for localhost:3000, reload, and try again."
                  : error.message}
            </p>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="shrink-0 border-t p-3">
          <div className="relative">
            {mentionOpen ? (
              <div
                role="listbox"
                aria-label="Mentions"
                className="bg-popover absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-none border shadow-lg"
              >
                {mentionOptions.map((option, i) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={i === mentionIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(option);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                      i === mentionIndex ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <AtSign className="text-primary size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {option.description}
                      </span>
                    </span>
                    {option.invokesAi ? (
                      <Sparkles className="text-primary size-3.5 shrink-0" />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="bg-background focus-within:border-ring focus-within:ring-ring/50 flex items-end gap-2 rounded-none border p-2 focus-within:ring-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setCaret(e.target.selectionStart);
                }}
                onClick={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyDown={onKeyDown}
                placeholder={
                  busy
                    ? "Draft next message… stop to cancel the reply"
                    : "Message… type @ to mention AI"
                }
                rows={2}
                className="placeholder:text-muted-foreground max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
                aria-label="Copilot message"
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="default"
                  onClick={(e) => {
                    e.preventDefault();
                    stop();
                  }}
                  aria-label="Stop stream"
                  title="Stop"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" disabled={!canSend} aria-label="Send">
                  <Send className="size-3.5" />
                </Button>
              )}
            </div>
            {!busy && input.trim() && !mentionsAi(input) ? (
              <p className="text-muted-foreground mt-1.5 px-1 text-[11px]">
                Sends as a note — mention <span className="text-foreground font-medium">@AI</span>{" "}
                to talk to the copilot
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </aside>
  );
}
