"use client";

/**
 * Monaco bound to a Yjs document via y-monaco + Hocuspocus.
 * Content and remote cursors are owned by the CRDT; do not pass a controlled value.
 */
import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import { MONACO_YTEXT_KEY, awarenessColorForUser } from "@foundry/collaboration/client";
import { defineFoundryMonacoThemes } from "@/lib/monaco-theme";
import { cn } from "@/lib/utils";

export type CollabSession = {
  url: string;
  token: string;
  documentName: string;
  canEdit: boolean;
  user: { id: string; name: string; avatarUrl?: string | null };
};

type Props = {
  session: CollabSession;
  language: string;
  theme: string;
  className?: string;
};

const STYLE_ID = "foundry-yjs-awareness-styles";

type AwarenessUser = { name?: string; color?: string };

/** y-monaco only adds classes; colors/labels must be injected per client id. */
function syncAwarenessStyles(awareness: {
  getStates: () => Map<number, Record<string, unknown>>;
}): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }

  const rules: string[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = state.user as AwarenessUser | undefined;
    if (!user?.color) return;
    const color = String(user.color);
    const name = String(user.name ?? "Collaborator").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    rules.push(`
.yRemoteSelection-${clientId} {
  background-color: ${color};
}
.yRemoteSelectionHead-${clientId} {
  border-color: ${color};
  border-left-color: ${color};
  border-top-color: ${color};
  border-bottom-color: ${color};
}
.yRemoteSelectionHead-${clientId}::after {
  content: "${name}";
  background: ${color};
}`);
  });
  el.textContent = rules.join("\n");
}

export function CollaborativeMonaco({ session, language, theme, className }: Props) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [sessionEpoch, setSessionEpoch] = useState(0);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: session.url,
      name: session.documentName,
      document: ydoc,
      token: session.token,
      onStatus: ({ status: next }) => {
        if (next === "connected") setStatus("connected");
        else if (next === "disconnected") setStatus("disconnected");
        else setStatus("connecting");
      },
    });

    const awareness = provider.awareness;
    awareness?.setLocalStateField("user", {
      name: session.user.name,
      color: awarenessColorForUser(session.user.id),
    });

    const onAwareness = () => {
      if (awareness) syncAwarenessStyles(awareness);
    };
    awareness?.on("change", onAwareness);
    onAwareness();

    ydocRef.current = ydoc;
    providerRef.current = provider;
    setSessionEpoch((n) => n + 1);

    return () => {
      awareness?.off("change", onAwareness);
      bindingRef.current?.destroy();
      bindingRef.current = null;
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
    };
    // Token rotation shouldn't tear the live session; auth is checked on connect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session.token omitted on purpose
  }, [session.url, session.documentName, session.user.id, session.user.name]);

  // Bind Monaco ↔ Yjs whenever both the editor and a live provider exist.
  useEffect(() => {
    const editor = editorRef.current;
    const ydoc = ydocRef.current;
    const provider = providerRef.current;
    const model = editor?.getModel();
    if (!editor || !ydoc || !provider || !model) return;

    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(
      ydoc.getText(MONACO_YTEXT_KEY),
      model,
      new Set([editor]),
      provider.awareness,
    );

    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, [sessionEpoch]);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    setSessionEpoch((n) => n + 1);
  };

  return (
    <div className={cn("relative h-full min-h-0", className)}>
      <Editor
        height="100%"
        theme={theme}
        language={language}
        defaultValue=""
        beforeMount={defineFoundryMonacoThemes}
        onMount={onMount}
        options={{
          readOnly: !session.canEdit,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          padding: { top: 12 },
          automaticLayout: true,
        }}
      />
      <div
        className={cn(
          "pointer-events-none absolute right-2 bottom-2 rounded-none px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm",
          status === "connected"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : status === "connecting"
              ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
              : "bg-destructive/15 text-destructive",
        )}
        aria-live="polite"
      >
        {status === "connected" ? "Live" : status === "connecting" ? "Connecting…" : "Disconnected"}
      </div>
    </div>
  );
}
