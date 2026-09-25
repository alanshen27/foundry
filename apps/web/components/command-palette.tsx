"use client";

/**
 * Cmd/Ctrl+K — jump anywhere in the project without hunting through the
 * Stage Rail and the Engineer document row. Pure client-side navigation:
 * every entry here is a route this app already has, so there's no new query.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useCopilot } from "@/components/copilot/copilot-provider";
import { ProposalInboxOverlay } from "@/components/graph/proposal-inbox";
import { cn } from "@/lib/utils";

type Command = {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  basePath,
  projectId,
  branchId,
}: {
  basePath: string;
  projectId: string;
  branchId: string;
}) {
  const router = useRouter();
  const { open: copilotOpen, setOpen: setCopilotOpen } = useCopilot();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    return [
      { id: "overview", label: "Overview", group: "Stage", run: go(`${basePath}/overview`) },
      {
        id: "ideate",
        label: "Ideate",
        group: "Stage",
        run: go(`${basePath}/engineer?view=ideate`),
      },
      {
        id: "engineer",
        label: "Engineer",
        group: "Stage",
        run: go(`${basePath}/engineer?view=assembly`),
      },
      {
        id: "verify",
        label: "Verify",
        group: "Stage",
        run: go(`${basePath}/engineer?view=verify`),
      },
      {
        id: "launch",
        label: "Launch",
        group: "Stage",
        keywords: "release",
        run: go(`${basePath}/engineer?view=launch`),
      },
      {
        id: "assembly",
        label: "Assembly",
        group: "Engineer",
        run: go(`${basePath}/engineer?view=assembly`),
      },
      { id: "pcb", label: "PCB", group: "Engineer", run: go(`${basePath}/engineer?view=pcb`) },
      {
        id: "sourcing",
        label: "Sourcing",
        group: "Engineer",
        keywords: "bom parts cost",
        run: go(`${basePath}/engineer?view=sourcing`),
      },
      {
        id: "checks",
        label: "Checks",
        group: "Engineer",
        run: go(`${basePath}/engineer?view=checks`),
      },
      {
        id: "repository",
        label: "Repository",
        group: "Engineer",
        keywords: "code repo",
        run: go(`${basePath}/engineer?view=code`),
      },
      {
        id: "compare",
        label: "Releases & branch compare",
        group: "Actions",
        keywords: "diff branch compare",
        run: go(`${basePath}/engineer?view=launch`),
      },
      {
        id: "proposals",
        label: "Review copilot proposals",
        group: "Actions",
        keywords: "inbox approve reject agent",
        run: () => setInboxOpen(true),
      },
      {
        id: "copilot",
        label: "Toggle copilot",
        group: "Actions",
        keywords: "chat ai",
        run: () => setCopilotOpen(!copilotOpen),
      },
    ];
  }, [basePath, router, setCopilotOpen, copilotOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords?.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) {
    return inboxOpen ? (
      <ProposalInboxOverlay
        projectId={projectId}
        branchId={branchId}
        onClose={() => setInboxOpen(false)}
      />
    ) : null;
  }

  function runAt(index: number) {
    const cmd = filtered[index];
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[15vh]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 cursor-default"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        className="bg-popover text-popover-foreground relative z-10 w-full max-w-md overflow-hidden rounded-none border shadow-xl"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(activeIndex);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Jump to a stage, document, or action…"
            className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">No matches.</p>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                onMouseMove={() => setActiveIndex(i)}
                onClick={() => runAt(i)}
                className={cn(
                  "flex w-full items-center justify-between rounded-none px-3 py-1.5 text-left text-sm",
                  i === activeIndex ? "bg-muted text-foreground" : "text-foreground/90",
                )}
              >
                <span>{cmd.label}</span>
                <span className="text-muted-foreground font-mono text-[10px] tracking-wide uppercase">
                  {cmd.group}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
