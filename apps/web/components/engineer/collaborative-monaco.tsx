"use client";

/**
 * Monaco bound to a Yjs document via y-monaco + Hocuspocus.
 * Content and remote cursors are owned by the CRDT; do not pass a controlled value.
 */
import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import { MONACO_YTEXT_KEY, awarenessColorForUser } from "@foundry/collaboration/client";
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

export function CollaborativeMonaco({ session, language, theme, className }: Props) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting",
  );

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

    provider.awareness?.setLocalStateField("user", {
      name: session.user.name,
      color: awarenessColorForUser(session.user.id),
    });

    ydocRef.current = ydoc;
    providerRef.current = provider;

    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
    };
  }, [session.url, session.documentName, session.token, session.user.id, session.user.name]);

  const onMount: OnMount = (editor) => {
    const model = editor.getModel();
    const ydoc = ydocRef.current;
    const provider = providerRef.current;
    if (!model || !ydoc || !provider) return;

    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(
      ydoc.getText(MONACO_YTEXT_KEY),
      model,
      new Set([editor]),
      provider.awareness,
    );
  };

  return (
    <div className={cn("relative h-full min-h-0", className)}>
      <Editor
        height="100%"
        theme={theme}
        language={language}
        defaultValue=""
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
        {status === "connected"
          ? "Live"
          : status === "connecting"
            ? "Connecting…"
            : "Disconnected"}
      </div>
    </div>
  );
}
