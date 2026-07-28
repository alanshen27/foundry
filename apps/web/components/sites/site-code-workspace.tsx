"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { SiteFile } from "@foundry/sites";
import { Code2, FileCode2, LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";
import { monacoThemeFor } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Loading editor…
    </div>
  ),
});

const LANGUAGES: Record<string, string> = {
  css: "css",
  html: "html",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  mjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  yaml: "yaml",
  yml: "yaml",
};

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[extension] ?? "plaintext";
}

export function SiteCodeWorkspace({ files }: { files: SiteFile[] }) {
  const { theme } = useTheme();
  const monacoTheme = monacoThemeFor(theme.mode);
  const sortedFiles = useMemo(
    () => [...files].sort((left, right) => left.name.localeCompare(right.name)),
    [files],
  );
  const [activeName, setActiveName] = useState<string | null>(null);

  useEffect(() => {
    if (!activeName || !sortedFiles.some((file) => file.name === activeName)) {
      setActiveName(sortedFiles[0]?.name ?? null);
    }
  }, [activeName, sortedFiles]);

  const activeFile = sortedFiles.find((file) => file.name === activeName) ?? null;

  if (sortedFiles.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="bg-muted flex size-11 items-center justify-center rounded-xl">
          <Code2 className="size-5" />
        </span>
        <div>
          <p className="text-foreground text-sm font-medium">No generated source yet</p>
          <p className="mt-1 max-w-sm text-xs">
            Source files appear here after a real v0 generation completes. SIMULATED sites never
            invent files.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="bg-card/70 flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Code2 className="text-muted-foreground size-3.5" />
        <span className="text-xs font-medium">Generated source</span>
        <Badge className="ml-auto" variant="outline">
          Chat-controlled
        </Badge>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="bg-card/30 w-56 shrink-0 overflow-y-auto border-r p-2">
          <p className="text-muted-foreground px-2 py-1.5 text-[10px] font-semibold tracking-[0.15em] uppercase">
            Files
          </p>
          <div className="space-y-0.5">
            {sortedFiles.map((file) => (
              <button
                key={file.name}
                type="button"
                onClick={() => setActiveName(file.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                  activeName === file.name
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <FileCode2 className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {file.locked ? <LockKeyhole className="size-3 shrink-0" /> : null}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {activeFile ? (
            <>
              <div className="bg-card/40 flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
                <FileCode2 className="text-muted-foreground size-3.5" />
                <span className="truncate">{activeFile.name}</span>
                <span className="text-muted-foreground ml-auto text-[11px]">
                  Revise files through chat to keep v0 in sync
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <MonacoEditor
                  key={`${activeFile.name}-${monacoTheme}`}
                  height="100%"
                  theme={monacoTheme}
                  language={languageFor(activeFile.name)}
                  value={activeFile.content}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineHeight: 20,
                    scrollBeyondLastLine: false,
                    padding: { top: 12 },
                    automaticLayout: true,
                    wordWrap: "on",
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
