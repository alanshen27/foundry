"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  AtSign,
  Camera,
  ChevronDown,
  ChevronRight,
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
  Sparkles,
  Square,
  Wrench,
  XCircle,
} from "lucide-react";
import type { UIMessage } from "ai";
import { usePathname } from "next/navigation";
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
import {
  CAD_PHASE_LABEL,
  formatElapsed,
  readToolProgressLog,
  type CadProgressLogEntry,
} from "@/lib/copilot/cad-progress";
import { useCadProgress, useCadProgressLog } from "./cad-progress-context";
import { CANCELLED_TOOL_ERROR_TEXT, isAssistantFailureText } from "@/lib/copilot/messages";
import { shouldShowStandaloneChatError } from "@/lib/copilot/failure-banner";
import {
  CHAT_SIDEBAR_DEFAULT_WIDTH,
  CHAT_SIDEBAR_MIN_WIDTH,
  CHAT_SIDEBAR_STORAGE_KEY,
  clampChatSidebarWidth,
  keyboardChatSidebarWidth,
  maxChatSidebarWidth,
  readChatSidebarWidth,
} from "@/lib/copilot/sidebar-width";
import {
  isMessageDeleted,
  isOwnUserMessage,
  messageDisplayName,
  messagePlainText,
  readChatMeta,
  type ChatReactionEmoji,
  type FoundryUIMessage,
} from "@/lib/copilot/chat-message-meta";
import { Markdown } from "./markdown";
import { ChannelSwitcher } from "./channel-switcher";
import { ProposalInboxTrigger } from "@/components/graph/proposal-inbox";
import {
  MessageActionBar,
  MessageEditForm,
  MessageReactions,
  MessageReplyQuote,
  ReplyPreviewBar,
} from "./message-actions";
import { useCopilot } from "./copilot-provider";

const TOOL_META: Record<
  string,
  { doing: string; done: string; failed: string; icon: typeof Sparkles }
> = {
  get_engineering_status: {
    doing: "Checking connected design",
    done: "Checked design readiness",
    failed: "Could not check design readiness",
    icon: ClipboardCheck,
  },
  read_cad_file: {
    doing: "Reading CAD file",
    done: "Read CAD file",
    failed: "Could not read CAD file",
    icon: ClipboardCheck,
  },
  sync_pcb_to_cad: {
    doing: "Updating CAD from boards",
    done: "Updated board geometry",
    failed: "Board geometry needs review",
    icon: CircuitBoard,
  },
  build_linked_assembly: {
    doing: "Building linked assembly",
    done: "Built linked assembly",
    failed: "Assembly needs review",
    icon: Boxes,
  },
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
  install_pcb_footprint: {
    doing: "Installing footprint",
    done: "Installed footprint (UNVERIFIED)",
    failed: "Failed to install footprint",
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
    doing: "Generating CAD (Astra)",
    done: "Generated the 3D model",
    failed: "CAD generation failed",
    icon: Boxes,
  },
  save_cad_script: {
    doing: "Writing Python CAD",
    done: "Saved the 3D model",
    failed: "Failed to save Python CAD",
    icon: Boxes,
  },
  patch_cad_script: {
    doing: "Patching Python CAD",
    done: "Patched the 3D model",
    failed: "Python patch failed",
    icon: Boxes,
  },
  python_cad: {
    doing: "Modeling in Python CAD",
    done: "Modeled the part in Python CAD",
    failed: "Python CAD failed",
    icon: Boxes,
  },
  define_part_models: {
    doing: "Defining simulation models",
    done: "Defined simulation models",
    failed: "Failed to define models",
    icon: CircuitBoard,
  },
  check_integration: {
    doing: "Running fit check",
    done: "Fit check complete",
    failed: "Fit check failed",
    icon: ClipboardCheck,
  },
  analyze_impact: {
    doing: "Tracing what this affects",
    done: "Traced the downstream impact",
    failed: "Impact analysis failed",
    icon: GitBranch,
  },
  explain_provenance: {
    doing: "Tracing where this came from",
    done: "Traced the provenance",
    failed: "Provenance lookup failed",
    icon: GitBranch,
  },
  link_nodes: {
    doing: "Proposing a link",
    done: "Proposed a link — pending review",
    failed: "Link proposal failed",
    icon: GitBranch,
  },
  add_tasks: {
    doing: "Proposing tasks",
    done: "Proposed tasks — pending review",
    failed: "Failed to propose tasks",
    icon: ListChecks,
  },
  add_risks: {
    doing: "Proposing risks",
    done: "Proposed risks — pending review",
    failed: "Failed to propose risks",
    icon: ListChecks,
  },
  add_part_to_assembly: {
    doing: "Building product preview",
    done: "Product preview ready",
    failed: "Product preview failed",
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
  if (toolPartCancelled(part)) return false;
  if (part.state === "output-error") return true;
  return (
    part.state === "output-available" &&
    typeof (part.output as Record<string, unknown> | undefined)?.error === "string"
  );
}

function toolPartCancelled(part: ToolPart): boolean {
  return part.state === "output-error" && part.errorText === CANCELLED_TOOL_ERROR_TEXT;
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
  if (name === "extract_product_images" && Array.isArray(out.images)) {
    bits.push(`${out.images.length} images`);
    // An empty result is usually the distributor refusing robots, not a bug.
    if (out.problem === "blocked") bits.push("distributor blocked the reader");
    else if (out.problem === "browser-unavailable") bits.push("page could not be read");
  }
  if (name === "add_components" && typeof out.created === "number")
    bits.push(`${out.created} parts`);
  if (name === "text_to_cad" && typeof out.generated === "number" && out.generated > 1)
    bits.push(`${out.generated} parts in parallel`);
  if (name === "text_to_cad" && Array.isArray(out.failed) && out.failed.length > 0)
    bits.push(`${out.failed.length} failed`);
  if (name === "add_part_to_assembly" && Array.isArray(out.manufacturingRefs))
    bits.push(`${out.manufacturingRefs.length} mfg refs`);
  if (
    (name === "save_cad_script" || name === "text_to_cad" || name === "python_cad") &&
    typeof out.sourceChars === "number"
  )
    bits.push(`${out.sourceChars} chars`);
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

/**
 * Optimistic "AI is working" row shown between sending an @AI message and the
 * first streamed chunk (also on reload while a run is still warming up).
 */
export function CopilotThinkingRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] uppercase",
        className,
      )}
    >
      <Loader2 className="size-3 animate-spin" aria-hidden />
      <span>Thinking…</span>
    </div>
  );
}

/**
 * Phase + ticking elapsed + Astra's latest progress for a running CAD tool.
 * Astra generations take minutes; a bare spinner is indistinguishable from a
 * hung request.
 */
function CadProgressLine({ toolCallId }: { toolCallId: string | undefined }) {
  const progress = useCadProgress(toolCallId);
  const startedAt = progress?.startedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!progress) return null;

  return (
    <span className="text-muted-foreground mt-0.5 block text-[11px] leading-relaxed">
      <span className="font-mono tabular-nums">
        {CAD_PHASE_LABEL[progress.phase]} · {formatElapsed(now - progress.startedAt)} total
      </span>
      {progress.note ? (
        <span className="block truncate" title={progress.note}>
          <Markdown text={progress.note} inline />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Expandable narration timeline for a CAD tool: the live accumulated log while
 * it runs, or the `progressLog` persisted on its output after the run.
 */
function CadProgressTimeline({ entries }: { entries: CadProgressLogEntry[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  const t0 = entries[0]!.at;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-0.5 rounded-none py-0.5 font-mono text-[10px] tracking-[0.04em] uppercase outline-none focus-visible:ring-2"
      >
        <Chevron className="size-3" />
        Timeline ({entries.length})
      </button>
      {open ? (
        <ol
          className="border-border/60 mt-1 max-h-48 space-y-0.5 overflow-y-auto border-l pl-2 pr-1"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}
        >
          {entries.map((entry, i) => (
            <li
              key={`${entry.at}-${i}`}
              className="text-muted-foreground text-[11px] leading-relaxed"
            >
              <span className="font-mono tabular-nums">+{formatElapsed(entry.at - t0)}</span>{" "}
              <span className="text-foreground/80">{CAD_PHASE_LABEL[entry.phase]}</span>
              {entry.note ? (
                <span className="block break-words text-foreground/60">
                  <Markdown text={entry.note} />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Live (still-running) variant — subscribes to the progress store. */
function LiveCadProgressTimeline({ toolCallId }: { toolCallId: string | undefined }) {
  const entries = useCadProgressLog(toolCallId);
  if (!entries || entries.length === 0) return null;
  return <CadProgressTimeline entries={entries} />;
}

/** Tool rows stay unboxed; failures are red text only (no card / tint fill). */
function toolRowClass(failed: boolean): string {
  return cn(
    "flex flex-col gap-1 py-1.5 text-xs leading-relaxed",
    failed ? "text-destructive" : "text-muted-foreground",
  );
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
  const cancelled = toolPartCancelled(part);
  const detail =
    part.state === "output-error"
      ? (part.errorText ?? "failed")
      : (softError ?? toolDetail(name, part));
  const images = toolImages(part);
  const title = running
    ? meta.doing
    : cancelled
      ? `Stopped: ${name.replaceAll("_", " ")}`
      : failed
        ? meta.failed
        : meta.done;

  return (
    <div className={toolRowClass(failed)}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <span className={cn(!failed && "text-foreground/75")}>{title}</span>
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
          {running ? (
            <>
              <CadProgressLine toolCallId={part.toolCallId} />
              <LiveCadProgressTimeline toolCallId={part.toolCallId} />
            </>
          ) : (
            <CadProgressTimeline
              entries={readToolProgressLog(
                part.state === "output-available" ? part.output : undefined,
              )}
            />
          )}
        </div>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin opacity-60" />
        ) : cancelled ? (
          <Square className="size-3.5 shrink-0 opacity-60" />
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

  const runningCount = parts.filter(toolPartRunning).length;
  const running = runningCount > 0;
  const failedCount = parts.filter(toolPartFailed).length;
  const cancelledCount = parts.filter(toolPartCancelled).length;
  const images = parts.flatMap(toolImages);
  const n = parts.length;

  let title: string;
  if (running) {
    const doneCount = n - runningCount - failedCount - cancelledCount;
    title = [
      `${runningCount} running`,
      doneCount ? `${doneCount} done` : null,
      failedCount ? `${failedCount} failed` : null,
      cancelledCount ? `${cancelledCount} stopped` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (cancelledCount === n) title = `Stopped ${n} tools`;
  else if (cancelledCount > 0)
    title = `Worked ${n - cancelledCount} tool${n - cancelledCount === 1 ? "" : "s"} · ${cancelledCount} stopped${failedCount ? ` · ${failedCount} failed` : ""}`;
  else if (failedCount === n) title = `Failed ${n} tools`;
  else if (failedCount > 0) title = `Worked ${n} tools · ${failedCount} failed`;
  else title = `Worked ${n} tools`;

  return (
    <div className={toolRowClass(failedCount > 0 && !running)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="hover:text-foreground focus-visible:ring-ring flex w-full items-center gap-2 rounded-none text-left outline-none focus-visible:ring-2"
      >
        <Wrench className="size-3.5 shrink-0 opacity-70" />
        <span className={cn("min-w-0 flex-1", failedCount === 0 && "text-foreground/75")}>
          {title}
        </span>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin opacity-60" />
        ) : cancelledCount > 0 ? (
          <Square className="size-3.5 shrink-0 opacity-60" />
        ) : failedCount > 0 ? (
          <XCircle className="size-3.5 shrink-0" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 opacity-50" />
        )}
        <ChevronDown
          className={cn(
            "size-3 shrink-0 opacity-60 transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {!expanded && running
        ? parts
            .filter(toolPartRunning)
            .map((part, i) => (
              <CadProgressLine
                key={typeof part.toolCallId === "string" ? part.toolCallId : `progress-${i}`}
                toolCallId={part.toolCallId}
              />
            ))
        : null}
      {expanded ? (
        <div className="border-border ml-1.5 flex flex-col border-l border-dotted pl-3">
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
  viewerId,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  message: UIMessage;
  /** Live stream just errored on this (usually last) assistant turn. */
  failed?: boolean;
  viewerId: string;
  onReply: () => void;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onReact: (emoji: ChatReactionEmoji) => void;
}) {
  const [editing, setEditing] = useState(false);
  const isUser = message.role === "user";
  const own = isOwnUserMessage(message, viewerId);
  const deleted = isMessageDeleted(message);
  const meta = readChatMeta(message);
  const authorName = messageDisplayName(message);

  if (isUser) {
    return (
      <div className={cn("group relative flex flex-col gap-1", own ? "items-end" : "items-start")}>
        {!own ? (
          <span className="text-muted-foreground px-0.5 font-mono text-[10px] tracking-[0.08em] uppercase">
            {authorName}
            {meta.editedAt && !deleted ? " · edited" : ""}
          </span>
        ) : meta.editedAt && !deleted ? (
          <span className="text-muted-foreground px-0.5 font-mono text-[10px]">edited</span>
        ) : null}
        <div className="relative max-w-[94%]">
          {!deleted ? (
            <MessageActionBar
              message={message}
              viewerId={viewerId}
              align={own ? "right" : "left"}
              onReply={onReply}
              onEdit={() => setEditing(true)}
              onDelete={() => void onDelete()}
              onReact={onReact}
            />
          ) : null}
          <MessageReplyQuote message={message} />
          {editing ? (
            <MessageEditForm
              initialText={messagePlainText(message)}
              onCancel={() => setEditing(false)}
              onSave={async (text) => {
                await onEdit(text);
                setEditing(false);
              }}
            />
          ) : deleted ? (
            <div className="bg-muted/25 text-muted-foreground rounded-none border border-dotted px-3 py-2 text-[13px] italic">
              Message deleted
            </div>
          ) : (
            <div
              className={cn(
                "text-foreground rounded-none border px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                own
                  ? "border-border border-l-2 border-l-foreground/40 bg-muted/25"
                  : "border-border bg-card/60",
              )}
            >
              {message.parts.map((part, i) =>
                part.type === "text" ? (
                  <span key={i}>
                    {splitMentions(part.text).map((seg, j) =>
                      seg.kind === "mention" ? (
                        <span
                          key={j}
                          className="bg-primary/10 text-primary inline-flex items-center rounded-none px-0.5 font-medium"
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
          )}
          {!editing && !deleted ? <MessageReactions message={message} onToggle={onReact} /> : null}
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
    <div className="group relative flex min-w-0 flex-col gap-1.5">
      {!deleted ? (
        <MessageActionBar
          message={message}
          viewerId={viewerId}
          onReply={onReply}
          onEdit={() => setEditing(true)}
          onDelete={() => void onDelete()}
          onReact={onReact}
        />
      ) : null}
      <MessageReplyQuote message={message} />
      {groupAssistantPartBlocks(message.parts, message.id).map((block) => {
        if (block.type === "text") {
          if (isAssistantFailureText(block.part.text)) {
            return (
              <p
                key={block.key}
                className="text-destructive flex items-start gap-1.5 text-xs leading-relaxed"
              >
                <XCircle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 whitespace-pre-wrap">{block.part.text}</span>
              </p>
            );
          }
          return (
            <div
              key={block.key}
              className="text-foreground min-w-0 py-1 text-[13px] leading-relaxed"
            >
              <Markdown text={block.part.text} />
            </div>
          );
        }
        return <ToolCallGroup key={block.key} parts={block.parts as ToolPart[]} />;
      })}
      <MessageReactions message={message} onToggle={onReact} />
      {!hasContent ? (
        showFailed ? (
          <p className="text-destructive flex items-center gap-1.5 text-xs">
            <XCircle className="size-3.5 shrink-0" />
            Failed
          </p>
        ) : (
          <div className="text-muted-foreground py-1 text-xs">Working…</div>
        )
      ) : showFailed && !stampedFailed ? (
        <p className="text-destructive flex items-center gap-1.5 text-[11px]">
          <XCircle className="size-3 shrink-0" />
          Failed
        </p>
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
  const {
    messages,
    status,
    busy,
    error,
    open,
    send,
    stop,
    viewer,
    replyingTo,
    setReplyingTo,
    editMessage,
    deleteMessage,
    toggleReaction,
    projectId,
    branchId,
  } = useCopilot();
  const [input, setInput] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [width, setWidth] = useState(CHAT_SIDEBAR_DEFAULT_WIDTH);
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [isResizing, setIsResizing] = useState(false);
  const [hasResized, setHasResized] = useState(false);

  useEffect(() => {
    try {
      setWidth(readChatSidebarWidth(localStorage.getItem(CHAT_SIDEBAR_STORAGE_KEY)));
    } catch {
      // The sidebar remains usable when the browser blocks local storage.
    }
    const onResize = () => setViewportWidth(document.documentElement.clientWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    function onMouseMove(e: MouseEvent) {
      const viewport = document.documentElement.clientWidth;
      setWidth(clampChatSidebarWidth(viewport - e.clientX, viewport));
      setHasResized(true);
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
    // Save only deliberate resizing. Loading or narrowing the window must not
    // overwrite a preferred width before it has been restored from storage.
    if (!isResizing && hasResized) {
      try {
        localStorage.setItem(CHAT_SIDEBAR_STORAGE_KEY, width.toString());
      } catch {
        // Resizing still works for this session without persistent storage.
      }
    }
  }, [hasResized, isResizing, width]);

  // Notes (no @AI) stay sendable; Stop only appears while an @AI run is busy.
  const canSend = Boolean(input.trim()) && !busy;

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
    // busy: keep the optimistic thinking row in view before the first chunk.
  }, [messages, status, busy]);

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
    if (!send(input, replyingTo ? { replyToId: replyingTo.id } : undefined)) return;
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
        "bg-background border-border absolute inset-y-0 right-0 z-30 flex max-w-[min(600px,calc(100vw_-_24px))] shrink-0 flex-col border-l shadow-lg lg:relative lg:z-auto lg:max-w-[min(44vw,600px)] lg:shadow-none",
        isResizing && "select-none",
      )}
      style={{ width }}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize chat sidebar"
        aria-orientation="vertical"
        aria-valuemin={Math.min(CHAT_SIDEBAR_MIN_WIDTH, maxChatSidebarWidth(viewportWidth))}
        aria-valuemax={maxChatSidebarWidth(viewportWidth)}
        aria-valuenow={clampChatSidebarWidth(width, viewportWidth)}
        className="hover:bg-primary/50 focus-visible:bg-primary/50 absolute top-0 bottom-0 left-0 z-50 w-1.5 -translate-x-1/2 cursor-col-resize outline-none transition-colors"
        onMouseDown={() => setIsResizing(true)}
        onKeyDown={(event) => {
          const nextWidth = keyboardChatSidebarWidth(
            width,
            event.key,
            document.documentElement.clientWidth,
          );
          if (nextWidth === null) return;
          event.preventDefault();
          setWidth(nextWidth);
          setHasResized(true);
        }}
      />
      <div className="border-border relative z-10 flex h-10 shrink-0 items-center gap-2 border-b px-2.5">
        <ChannelSwitcher />
        <ProposalInboxTrigger projectId={projectId} branchId={branchId} />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground ml-auto size-7"
          onClick={() => openChatPopout(pathname)}
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
          {messages.length === 0 ? (
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
              <div className="border-border flex w-full flex-col divide-y divide-dotted border-y border-dotted">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => send(s)}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/40 focus-visible:ring-ring flex items-center gap-3 px-1 py-3 text-left text-xs leading-relaxed outline-none transition-colors focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="flex-1">{s.replace(/^@AI /, "")}</span>
                    <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                viewerId={viewer.id}
                failed={status === "error" && m.role === "assistant" && i === messages.length - 1}
                onReply={() => {
                  setReplyingTo(m as FoundryUIMessage);
                  textareaRef.current?.focus();
                }}
                onEdit={(text) => editMessage(m.id, text)}
                onDelete={() => deleteMessage(m.id)}
                onReact={(emoji) => void toggleReaction(m.id, emoji)}
              />
            ))
          )}
          {busy && messages[messages.length - 1]?.role === "user" ? (
            <CopilotThinkingRow className="py-1" />
          ) : null}
          {error && shouldShowStandaloneChatError(messages, error) ? (
            <p className="text-destructive text-xs leading-relaxed">
              {error.message.includes("OPENAI_API_KEY") || error.message.includes("not configured")
                ? "AI is not configured. Add OPENAI_API_KEY to the root .env and restart the dev server."
                : error.message.includes("Unexpected end of JSON") || error.message.includes("431")
                  ? "Request failed (cookies/headers too large or empty response). Clear cookies for localhost:3000, reload, and try again."
                  : error.message}
            </p>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="border-border shrink-0 border-t border-dotted p-3">
          <div className="relative">
            {replyingTo ? (
              <ReplyPreviewBar message={replyingTo} onClear={() => setReplyingTo(null)} />
            ) : null}
            {mentionOpen ? (
              <div
                role="listbox"
                aria-label="Mentions"
                className="bg-background absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-none border shadow-md"
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
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
                      i === mentionIndex ? "bg-primary/10" : "hover:bg-muted/40",
                    )}
                  >
                    <AtSign className="text-muted-foreground size-3.5 shrink-0" />
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

            <div className="bg-background border-foreground/25 focus-within:border-foreground focus-within:ring-foreground/10 flex items-end gap-2 rounded-none border p-2.5 transition-colors focus-within:ring-1">
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
                    ? "Draft your next message…"
                    : replyingTo
                      ? `Reply to ${messageDisplayName(replyingTo)}`
                      : "Message or @AI…"
                }
                rows={2}
                className="placeholder:text-muted-foreground max-h-40 min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none"
                aria-label="Copilot message"
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="border-foreground/30 text-foreground size-7 shrink-0 rounded-none"
                  onClick={(e) => {
                    e.preventDefault();
                    stop();
                  }}
                  aria-label="Stop stream"
                  title="Stop reply"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  className="size-7 shrink-0 rounded-none"
                  disabled={!canSend}
                  aria-label="Send"
                >
                  <ArrowUp className="size-3.5" />
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
