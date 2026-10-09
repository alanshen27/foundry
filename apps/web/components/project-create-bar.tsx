"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronDown, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { folderBreadcrumbs, type FolderRef } from "@/lib/workspace-folders";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { projectKickoffs } from "@/lib/copilot/project-kickoff";

/** sessionStorage key — the workbench PipelineKickoff reads this once after create. */
export const PROJECT_KICKOFF_KEY = "foundry:project-kickoff";

function nameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(/[.!?\n]/)[0]
    ?.trim()
    .slice(0, 48);
  return cleaned && cleaned.length >= 3 ? cleaned : "Untitled project";
}

function folderOptions(folders: FolderRef[]): { id: string; label: string }[] {
  return folders
    .map((folder) => ({
      id: folder.id,
      label: folderBreadcrumbs(folders, folder.id)
        .map((c) => c.name)
        .join(" / "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Prompt composer for the workspace projects page.
 * Prompt → create project (optional folder) → workbench with AI kickoff.
 */
export function ProjectCreateBar({
  workspaceId,
  workspaceSlug,
  folders,
  defaultFolderId = null,
  className,
}: {
  workspaceId: string;
  workspaceSlug: string;
  folders: FolderRef[];
  /** Prefill folder when browsing inside one. */
  defaultFolderId?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [nameOverride, setNameOverride] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<string>(defaultFolderId ?? "");
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedPrompt = useRef<string | null>(null);

  useEffect(() => {
    setTargetFolderId(defaultFolderId ?? "");
  }, [defaultFolderId]);

  const options = useMemo(() => folderOptions(folders), [folders]);

  const create = trpc.project.create.useMutation({
    onSuccess: (project) => {
      const text = (submittedPrompt.current ?? prompt).trim();
      if (text) {
        // Copilot consumes this on every project route; workbench PipelineKickoff
        // still reads the unscoped session key once after create.
        projectKickoffs.save(project.id, text);
        try {
          sessionStorage.setItem(PROJECT_KICKOFF_KEY, text);
        } catch {
          // Private mode / quota — the workbench still opens; user can retype.
        }
      }
      submittedPrompt.current = null;
      setPrompt("");
      setNameOverride("");
      setError(null);
      router.push(`/w/${workspaceSlug}/projects/${project.slug}/engineer?view=assembly`);
      router.refresh();
    },
    onError: (err) => {
      submittedPrompt.current = null;
      setError(err.message);
    },
  });

  function submit() {
    if (!prompt.trim() || create.isPending || submittedPrompt.current !== null) return;
    const name = nameOverride.trim() || nameFromPrompt(prompt);
    submittedPrompt.current = prompt;
    create.mutate({
      workspaceId,
      name,
      description: prompt.trim().slice(0, 500),
      folderId: targetFolderId || null,
    });
  }

  return (
    <section className={cn("relative mb-8", className)}>
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mb-3 border px-3 py-2 text-left font-mono text-[12px]"
        >
          {error}
        </p>
      ) : null}

      <form
        className="border-border bg-card w-full border transition-colors focus-within:border-primary/60"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label
          htmlFor="project-create-prompt"
          className="text-muted-foreground block px-5 pt-4 font-mono text-[10px] tracking-[0.12em] uppercase"
        >
          Start something new
        </label>
        <textarea
          id="project-create-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="What would you like to build? Describe your product…"
          rows={3}
          maxLength={2000}
          disabled={create.isPending}
          aria-label="Describe the product to build"
          className="placeholder:text-muted-foreground/70 block min-h-[100px] w-full resize-none bg-transparent px-5 py-3 text-[15px] leading-relaxed outline-none disabled:opacity-60 sm:text-base"
        />

        <div className="border-border bg-muted/25 flex flex-wrap items-center gap-2 border-t px-3 py-2.5 sm:gap-4 sm:px-4">
          <label className="text-muted-foreground focus-within:text-foreground flex min-w-[8rem] flex-1 items-center gap-2 sm:max-w-xs">
            <Folder className="size-3.5 shrink-0" strokeWidth={1.5} />
            <span className="sr-only">Folder</span>
            <select
              id="project-create-folder"
              className="min-w-0 flex-1 cursor-pointer truncate bg-transparent py-1.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
              value={targetFolderId}
              onChange={(event) => setTargetFolderId(event.target.value)}
              disabled={create.isPending}
              aria-label="Project folder"
            >
              <option value="">Workspace root</option>
              {options.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.label}
                </option>
              ))}
            </select>
          </label>

          <span className="text-muted-foreground ml-auto hidden font-mono text-[10px] lg:block">
            ⌘/Ctrl + Enter
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              aria-controls="project-create-options"
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-8 items-center gap-1 px-2 font-mono text-[11px] outline-none transition-colors focus-visible:ring-1"
            >
              Options
              <ChevronDown
                className={cn("size-3 transition-transform", showOptions && "rotate-180")}
                strokeWidth={1.5}
              />
            </button>
            <Button
              type="submit"
              disabled={create.isPending || !prompt.trim()}
              className="h-9 min-w-[88px] gap-3 rounded-none px-4 text-[13px]"
            >
              {create.isPending ? "Creating…" : "Build"}
              {create.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
              )}
            </Button>
          </div>
        </div>
        {showOptions ? (
          <div id="project-create-options" className="border-border border-t px-5 py-4">
            <label
              htmlFor="project-create-name"
              className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase"
            >
              Project name
            </label>
            <input
              id="project-create-name"
              type="text"
              value={nameOverride}
              onChange={(event) => setNameOverride(event.target.value)}
              placeholder={prompt.trim() ? nameFromPrompt(prompt) : "Derived from prompt"}
              maxLength={80}
              disabled={create.isPending}
              className="border-input placeholder:text-muted-foreground focus:border-primary mt-1.5 h-9 w-full border bg-transparent px-3 text-sm outline-none"
            />
          </div>
        ) : null}
      </form>
    </section>
  );
}
