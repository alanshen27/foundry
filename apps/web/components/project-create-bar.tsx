"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignalGlowBackdrop } from "@/components/signal-glow-backdrop";
import { folderBreadcrumbs, type FolderRef } from "@/lib/workspace-folders";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** sessionStorage key — overview PipelineKickoff reads this once after create. */
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
 * Lovable-style create bar for the workspace projects page.
 * Prompt → create project (optional folder) → overview with AI kickoff.
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

  useEffect(() => {
    setTargetFolderId(defaultFolderId ?? "");
  }, [defaultFolderId]);

  const options = useMemo(() => folderOptions(folders), [folders]);

  const create = trpc.project.create.useMutation({
    onSuccess: (project) => {
      const text = prompt.trim();
      if (text) {
        try {
          sessionStorage.setItem(PROJECT_KICKOFF_KEY, text);
        } catch {
          // Private mode / quota — overview still opens; user can retype.
        }
      }
      setPrompt("");
      setNameOverride("");
      setError(null);
      router.push(`/w/${workspaceSlug}/projects/${project.slug}/overview`);
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  function submit() {
    if (!prompt.trim() || create.isPending) return;
    const name = nameOverride.trim() || nameFromPrompt(prompt);
    create.mutate({
      workspaceId,
      name,
      description: prompt.trim().slice(0, 500),
      folderId: targetFolderId || null,
    });
  }

  return (
    <section className={cn("relative", className)}>
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-2 pb-8 text-center sm:pb-10">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
          Projects
        </p>
        <h2 className="mt-3 font-mono text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.05] font-medium tracking-[-0.04em]">
          Build something Foundry
        </h2>
        <p className="text-muted-foreground mt-3 max-w-lg text-[15px] leading-relaxed">
          Describe the product. AI fills the pipeline — brief, requirements, BOM, circuit, model,
          and checks.
        </p>

        {error ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mt-4 w-full border px-3 py-2 text-left font-mono text-[12px]"
          >
            {error}
          </p>
        ) : null}

        <form
          className="relative mt-8 w-full"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {/* Soft signal glow + orange dots behind the white card */}
          <SignalGlowBackdrop />

          <div className="border-border relative z-10 border bg-white transition-colors focus-within:border-primary dark:bg-card">
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
              placeholder="A pocket-size air quality monitor with an e-ink display, under $60…"
              rows={4}
              maxLength={2000}
              disabled={create.isPending}
              aria-label="Describe the product to build"
              className="placeholder:text-muted-foreground min-h-[120px] w-full resize-none bg-transparent px-4 py-4 text-left text-[15px] leading-relaxed outline-none disabled:opacity-60"
            />
            <div className="border-border flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
              <label className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-xs">
                <Folder className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="sr-only">Folder</span>
                <select
                  id="project-create-folder"
                  className="text-foreground min-w-0 flex-1 truncate bg-transparent font-mono text-[11px] tracking-[0.04em] outline-none"
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
              <button
                type="button"
                onClick={() => setShowOptions((v) => !v)}
                className="text-muted-foreground hover:text-foreground font-mono text-[11px] tracking-[0.1em] uppercase transition-colors"
              >
                {showOptions ? "Hide" : "More"}
              </button>
              <Button
                type="submit"
                disabled={create.isPending || !prompt.trim()}
                className="ml-auto rounded-none px-5 font-mono text-[12px] tracking-[0.1em] uppercase"
              >
                {create.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {create.isPending ? "Creating…" : "Build"}
              </Button>
            </div>
          </div>

          {showOptions ? (
            <div className="border-border relative z-10 mt-3 border bg-white px-4 py-3 text-left dark:bg-card">
              <label
                htmlFor="project-create-name"
                className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase"
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
                className="border-input placeholder:text-muted-foreground mt-1.5 h-9 w-full border bg-white px-3 text-sm outline-none dark:bg-card"
              />
            </div>
          ) : null}
        </form>

        <p className="text-muted-foreground mt-4 font-mono text-[11px]">⌘/Ctrl + Enter to build</p>
      </div>
    </section>
  );
}
