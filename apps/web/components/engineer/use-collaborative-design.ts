"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import {
  applyDesignSnapshot,
  readDesignDocument,
  awarenessColorForUser,
  type DesignKind,
} from "@foundry/collaboration/client";
import { trpc } from "@/lib/trpc";

const LOCAL_EDIT = "foundry-local-design-edit";
type Status = "connecting" | "connected" | "disconnected" | "local";

/** Shared Yjs transport for every engineering JSON editor. */
export function useCollaborativeDesign(input: {
  projectId: string;
  branchId: string;
  kind: DesignKind;
  canEdit: boolean;
  onRemoteData: (data: unknown) => void;
}) {
  const { projectId, branchId, kind } = input;
  const hasScope = Boolean(projectId && branchId);
  const session = trpc.collaboration.designSession.useQuery(
    { projectId, branchId, kind },
    { enabled: hasScope, refetchInterval: 30 * 60_000, retry: false },
  );
  const utils = trpc.useUtils();
  const callback = useRef(input.onRemoteData);
  callback.current = input.onRemoteData;
  const docRef = useRef<Y.Doc | null>(null);
  const syncedRef = useRef(false);
  const sessionRef = useRef(session.data);
  sessionRef.current = session.data;
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const invalidateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidate = useCallback(() => {
    if (invalidateRef.current) return;
    invalidateRef.current = setTimeout(() => {
      invalidateRef.current = null;
      void utils.design.get.invalidate({ projectId, branchId });
      void utils.engineering.status.invalidate({ projectId, branchId });
      void utils.verify.invalidate();
      void utils.project.invalidate();
    }, 300);
  }, [utils, projectId, branchId]);
  const invalidateCallback = useRef(invalidate);
  invalidateCallback.current = invalidate;

  const active = hasScope ? session.data : null;
  useEffect(() => {
    if (!active) {
      syncedRef.current = false;
      setReady(active === null);
      setStatus(active === null ? "local" : "connecting");
      return;
    }
    const doc = new Y.Doc();
    docRef.current = doc;
    setReady(false);
    setError(null);
    const emit = () => {
      if (!syncedRef.current) return;
      const data = readDesignDocument(doc);
      callback.current(data ?? null);
    };
    const provider = new HocuspocusProvider({
      url: active.url,
      name: active.documentName,
      document: doc,
      token: () => sessionRef.current?.token ?? active.token,
      onStatus: ({ status: next }) => {
        setStatus(
          next === "connected"
            ? "connected"
            : next === "disconnected"
              ? "disconnected"
              : "connecting",
        );
        if (next !== "connected") {
          syncedRef.current = false;
          setReady(false);
        }
      },
      onSynced: ({ state }) => {
        syncedRef.current = state;
        setReady(state);
        if (state) {
          setError(null);
          emit();
        }
      },
      onAuthenticationFailed: ({ reason }) => {
        setError(reason || "Live editing access denied");
        setReady(false);
        syncedRef.current = false;
      },
      onClose: ({ event }) => {
        if (event.code !== 1000 && event.reason) setError(event.reason);
      },
      onStateless: ({ payload }) => {
        try {
          if ((JSON.parse(payload) as { type?: unknown }).type === "committed")
            invalidateCallback.current();
        } catch {
          /* Ignore unrelated presence messages. */
        }
      },
    });
    provider.awareness?.setLocalStateField("user", {
      name: active.user.name,
      color: awarenessColorForUser(active.user.id),
    });
    doc.on("update", emit);
    return () => {
      syncedRef.current = false;
      docRef.current = null;
      doc.off("update", emit);
      provider.destroy();
      doc.destroy();
      if (invalidateRef.current) clearTimeout(invalidateRef.current);
      invalidateRef.current = null;
    };
    // Keep CRDT identities and unacknowledged updates across token rotation.
  }, [active?.url, active?.documentName, active?.user.id]);

  const mode = !hasScope || session.data === null ? "local" : session.data ? "live" : "loading";
  const applySnapshot = useCallback(
    (before: unknown, after: unknown): boolean => {
      if (!hasScope || session.data === null) return false;
      if (!syncedRef.current || !docRef.current)
        throw new Error("Live document is reconnecting. Wait before editing.");
      if (!input.canEdit || !session.data?.canEdit) throw new Error("This document is read-only");
      const doc = docRef.current;
      doc.transact(
        () => applyDesignSnapshot(doc, readDesignDocument(doc) == null ? null : before, after),
        LOCAL_EDIT,
      );
      return true;
    },
    [session.data, input.canEdit, hasScope],
  );

  return {
    mode: mode as "loading" | "local" | "live",
    ready,
    canEdit: input.canEdit && (mode === "local" || (ready && session.data?.canEdit === true)),
    status,
    error: error ?? session.error?.message ?? null,
    applySnapshot,
  };
}
