"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { type UIMessage } from "ai";
import {
  copilotBroadcastChannel,
  createOffBroadcastPort,
  createSupabaseBroadcastPort,
  type BroadcastPort,
} from "@foundry/realtime";
import { BackgroundChatTransport } from "@/lib/copilot/background-chat-transport";
import {
  seedTranscriptWithLocalBackup,
  writeLocalTranscript,
} from "@/lib/copilot/local-transcript";
import { mentionsAi } from "@/lib/copilot/mentions";
import {
  markFailedAssistantMessages,
  mergeTranscriptPreferringUserTurns,
  pruneEmptyAssistantMessages,
} from "@/lib/copilot/messages";
import { trpc } from "@/lib/trpc";

export type ChatChannel = {
  id: string;
  name: string;
  categoryId: string | null;
  sortOrder: number;
};

export type ChatCategory = {
  id: string;
  name: string;
  sortOrder: number;
};

type CopilotContextValue = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  /** True while a local stream or server-side run is in flight. */
  busy: boolean;
  error: Error | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  send: (text: string) => void;
  stop: () => void;
  channels: ChatChannel[];
  categories: ChatCategory[];
  activeChannelId: string;
  switchChannel: (channelId: string) => void;
  createChannel: (name: string, categoryId?: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  createCategory: (name: string) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
  projectId: string;
  branchId: string;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot must be used inside CopilotProvider");
  return ctx;
}

const REALTIME_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE ?? "off";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function createBroadcastPort(): BroadcastPort {
  if (REALTIME_MODE === "supabase" && SUPABASE_URL && SUPABASE_ANON_KEY) {
    return createSupabaseBroadcastPort({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  }
  return createOffBroadcastPort();
}

/**
 * One useChat session bound to a single channel. Remounted (via key) when the
 * active channel changes; latest messages are reported up so switching back
 * doesn't lose in-memory history.
 */
function ChatEngine({
  projectId,
  branchId,
  channelId,
  initialMessages,
  onMessages,
  shell,
  children,
}: {
  projectId: string;
  branchId: string;
  channelId: string;
  initialMessages: UIMessage[];
  onMessages: (channelId: string, messages: UIMessage[]) => void;
  shell: Omit<CopilotContextValue, "messages" | "status" | "busy" | "error" | "send" | "stop">;
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const cancelMutation = trpc.chat.cancelActiveRun.useMutation();
  const persistMutation = trpc.chat.persistMessages.useMutation();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<"submitted" | "streaming" | "ready" | "error">("ready");
  const busyRef = useRef(false);
  /** True when this tab started the run — skip resumeStream (avoids dual SSE). */
  const selfRunRef = useRef(false);
  /** Bumps on every send so a late cancel from a prior failure can't kill the new run. */
  const sendEpochRef = useRef(0);
  /** Server run id for the in-flight send (set by transport). */
  const ownedRunIdRef = useRef<string | null>(null);
  /** Last user text we tried to send — restored if useChat drops it on error. */
  const pendingUserTextRef = useRef<string | null>(null);
  // Freeze the seed so RSC re-renders / prop updates never reset the live chat.
  // Merge sessionStorage so a reload after a failed POST still shows the turn.
  const seedRef = useRef(
    seedTranscriptWithLocalBackup(channelId, pruneEmptyAssistantMessages(initialMessages)),
  );
  // Flip true synchronously on send so the stop square appears before status catches up.
  const [localBusy, setLocalBusy] = useState(false);
  const messagesRef = useRef<UIMessage[]>(seedRef.current);

  // Broadcast handles most start/finish updates. Keep polling sparse — every
  // hit runs Supabase getUser via createContext and was rate-limiting Auth (429).
  const activeRunQuery = trpc.chat.activeRun.useQuery(
    { projectId, channelId },
    {
      refetchInterval: (q) => {
        if (typeof document !== "undefined" && document.hidden) return false;
        if (q.state.error) return 15_000;
        // Poll only while something is actually in flight locally, or the
        // server still reports an active run (so stale expiry can clear it).
        return q.state.data || localBusy ? 5_000 : false;
      },
      retry: false,
      refetchOnWindowFocus: true,
    },
  );

  const refreshProjectData = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void Promise.all([
        utils.design.invalidate(),
        utils.ideate.invalidate(),
        utils.engineer.invalidate(),
        utils.verify.invalidate(),
        utils.project.invalidate(),
        utils.stage.invalidate(),
        utils.code.invalidate(),
      ]);
    }, 200);
  }, [utils]);

  /** Soft @AI nudge from a note send — applied in onFinish so prune can't drop it. */
  const pendingPingTipRef = useRef<{ id: string; text: string } | null>(null);

  const transport = useMemo(
    () =>
      new BackgroundChatTransport({
        projectId,
        branchId,
        channelId,
        onRunId: (runId) => {
          ownedRunIdRef.current = runId;
        },
        onPingTip: (tip) => {
          pendingPingTipRef.current = tip;
        },
      }),
    [projectId, branchId, channelId],
  );

  /** Cancel only the run this tab owned for `epoch` (never a newer send). */
  const releaseOwnedRun = useCallback(
    (epoch: number) => {
      if (epoch !== sendEpochRef.current) return;
      const runId = ownedRunIdRef.current;
      ownedRunIdRef.current = null;
      if (!runId) return;
      void cancelMutation
        .mutateAsync({ projectId, runId })
        .catch(() => undefined)
        .finally(() => {
          if (epoch === sendEpochRef.current) {
            void utils.chat.activeRun.invalidate({ projectId, channelId });
          }
        });
    },
    [cancelMutation, utils, projectId, channelId],
  );

  const persistFailureStampRef = useRef<(reason?: string) => void>(() => undefined);

  const { messages, sendMessage, status, error, stop, resumeStream, setMessages } = useChat({
    id: channelId,
    transport,
    messages: seedRef.current,
    // Manual resume only (see effect below). SDK auto-resume + our send SSE
    // both attach to the same run and the UI flashes as chunks replay twice.
    resume: false,
    onFinish: () => {
      const epoch = sendEpochRef.current;
      selfRunRef.current = false;
      setLocalBusy(false);
      if (epoch === sendEpochRef.current) ownedRunIdRef.current = null;
      void utils.chat.activeRun.invalidate({ projectId, channelId });
      const tip = pendingPingTipRef.current;
      pendingPingTipRef.current = null;
      if (statusRef.current === "error") {
        persistFailureStampRef.current(error?.message);
      } else {
        setMessages((prev) => {
          const next = pruneEmptyAssistantMessages(prev);
          if (!tip || next.some((message) => message.id === tip.id)) return next;
          return [
            ...next,
            {
              id: tip.id,
              role: "assistant" as const,
              parts: [{ type: "text" as const, text: tip.text }],
            },
          ];
        });
      }
      refreshProjectData();
    },
    onError: (err) => {
      const reason = err instanceof Error ? err.message : String(err);
      pendingPingTipRef.current = null;
      // Lock rejection is handled in send() (clear branch + retry). Do not
      // cancel here — a concurrent retry may already own a new runId.
      if (/workspace is locked/i.test(reason)) {
        selfRunRef.current = false;
        setLocalBusy(false);
        void utils.chat.activeRun.invalidate({ projectId, channelId });
        return;
      }
      const epoch = sendEpochRef.current;
      selfRunRef.current = false;
      setLocalBusy(false);
      persistFailureStampRef.current(reason);
      // Only the run that failed — never wipe a newer send's ChatRun.
      releaseOwnedRun(epoch);
    },
  });

  /**
   * On failure, re-read history from the server (user turns are saved at POST)
   * and merge with whatever the client still holds so a flaky stream/useChat
   * rollback cannot erase messages the user already sent.
   */
  const persistFailureStamp = useCallback(
    (reason?: string) => {
      void (async () => {
        let local: UIMessage[] = [];
        setMessages((prev) => {
          local = prev;
          return prev;
        });

        // useChat sometimes drops the optimistic user turn on transport errors.
        const pending = pendingUserTextRef.current?.trim();
        if (pending) {
          const hasPending = local.some(
            (m) =>
              m.role === "user" &&
              m.parts.some((p) => p.type === "text" && p.text.trim() === pending),
          );
          if (!hasPending) {
            local = [
              ...local,
              {
                id: `local_user_${Date.now()}`,
                role: "user",
                parts: [{ type: "text", text: pending }],
              } as UIMessage,
            ];
          }
        }

        let server: UIMessage[] = [];
        try {
          const rows = await utils.client.chat.messages.query({ projectId, channelId });
          server = rows.map((row) => ({
            id: row.id,
            role: row.role as UIMessage["role"],
            parts: row.parts as unknown as UIMessage["parts"],
          }));
        } catch (err) {
          console.error("failed to reload chat history after error", err);
        }
        const merged = markFailedAssistantMessages(
          mergeTranscriptPreferringUserTurns(server, local),
          reason,
        );
        setMessages(merged);
        writeLocalTranscript(channelId, merged);
        pendingUserTextRef.current = null;
        void persistMutation
          .mutateAsync({ projectId, branchId, channelId, messages: merged, error: reason })
          .catch((err) => console.error("failed to persist chat transcript", err));
      })();
    },
    [setMessages, persistMutation, projectId, branchId, channelId, utils],
  );
  persistFailureStampRef.current = persistFailureStamp;
  statusRef.current = status;
  messagesRef.current = messages;
  // Stop / "working" only for real @AI runs — notes (no @AI) briefly hit
  // submitted/streaming via useChat but must not flip the button to Stop.
  const busy = localBusy || Boolean(activeRunQuery.data);
  busyRef.current = busy;

  // Clear optimistic busy once the server agrees there's no active run and
  // the local stream is idle. Never cancel from here — that raced with enqueue.
  useEffect(() => {
    if (selfRunRef.current) return;
    if (
      localBusy &&
      !activeRunQuery.data &&
      status !== "submitted" &&
      status !== "streaming" &&
      !activeRunQuery.isFetching
    ) {
      setLocalBusy(false);
      if (status === "error") {
        persistFailureStamp(error?.message);
      } else {
        setMessages((prev) => pruneEmptyAssistantMessages(prev));
      }
    }
  }, [
    localBusy,
    activeRunQuery.data,
    activeRunQuery.isFetching,
    status,
    error,
    setMessages,
    persistFailureStamp,
  ]);

  // After reload / other-tab start: reattach SSE only when this tab is not
  // already the stream owner (sendMessages opened the run stream).
  const resumedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const runId = activeRunQuery.data?.id ?? null;
    if (!runId) {
      resumedRunIdRef.current = null;
      return;
    }
    if (selfRunRef.current) return;
    if (ownedRunIdRef.current === runId) return;
    if (resumedRunIdRef.current === runId) return;
    if (status === "submitted" || status === "streaming") return;
    resumedRunIdRef.current = runId;
    setLocalBusy(true);
    ownedRunIdRef.current = runId;
    void resumeStream();
  }, [activeRunQuery.data?.id, status, resumeStream]);

  useEffect(() => {
    const broadcast = createBroadcastPort();
    const sub = broadcast.subscribe(copilotBroadcastChannel(channelId), (message) => {
      if (message.event === "run-started") {
        setLocalBusy(true);
        void utils.chat.activeRun.invalidate({ projectId, channelId });
        const startedRunId = (message.payload as { runId?: string } | undefined)?.runId ?? null;
        const streaming =
          statusRef.current === "submitted" || statusRef.current === "streaming";
        // Other tabs / reloads only — never open a second SSE for our own
        // send, and never attach twice to the same run (the resume effect
        // above may have already claimed it).
        if (
          !selfRunRef.current &&
          !streaming &&
          (statusRef.current === "ready" || statusRef.current === "error") &&
          (!startedRunId || resumedRunIdRef.current !== startedRunId)
        ) {
          if (startedRunId) {
            resumedRunIdRef.current = startedRunId;
            ownedRunIdRef.current = startedRunId;
          }
          void resumeStream();
        }
      }
      if (message.event === "run-finished") {
        const payload = message.payload as
          { runId?: string; status?: string; error?: string } | undefined;
        // Never let another run's finish clear our in-flight send/stream.
        if (payload?.runId && ownedRunIdRef.current && payload.runId !== ownedRunIdRef.current) {
          return;
        }
        if (selfRunRef.current && !ownedRunIdRef.current) {
          // Still waiting for our runId from POST — ignore stray finishes.
          return;
        }
        // Still consuming our own SSE — onFinish will prune. Avoid a second
        // setMessages that flashes the transcript mid-close.
        if (
          selfRunRef.current ||
          statusRef.current === "submitted" ||
          statusRef.current === "streaming"
        ) {
          if (payload?.status === "error" && !selfRunRef.current) {
            persistFailureStamp(payload.error);
          }
          return;
        }
        selfRunRef.current = false;
        setLocalBusy(false);
        if (payload?.runId && ownedRunIdRef.current === payload.runId) {
          ownedRunIdRef.current = null;
        }
        void utils.chat.activeRun.invalidate({ projectId, channelId });
        if (payload?.status === "error") {
          persistFailureStamp(payload.error);
        } else {
          setMessages((prev) => pruneEmptyAssistantMessages(prev));
        }
        if (statusRef.current === "ready") {
          refreshProjectData();
        }
      }
    });
    return () => {
      sub.leave();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [
    channelId,
    projectId,
    resumeStream,
    refreshProjectData,
    utils,
    setMessages,
    persistFailureStamp,
  ]);

  useEffect(() => {
    onMessages(channelId, messages);
    // Skip sessionStorage writes while tokens stream — JSON.stringify on every
    // chunk was janking the main thread and amplifying UI flicker.
    if (status === "submitted" || status === "streaming") return;
    writeLocalTranscript(channelId, messages);
  }, [channelId, messages, onMessages, status]);

  // Do NOT persist mid-stream from the client. That path used persistRunMessages
  // upserts and routinely overwrote richer worker checkpoints (tool cards/text)
  // with a thinner UI snapshot — LLM turns "deleted themselves" from the DB.
  // Worker checkpoints + post-terminal safety-net persists cover reload.

  const stopRun = useCallback(() => {
    const epoch = sendEpochRef.current;
    selfRunRef.current = false;
    stop();
    setLocalBusy(false);
    busyRef.current = false;
    setMessages((prev) => pruneEmptyAssistantMessages(prev));
    releaseOwnedRun(epoch);
    // Also clear any other stuck branch locks when the user hits Stop.
    void cancelMutation
      .mutateAsync({ projectId, branchId })
      .catch(() => undefined)
      .finally(() => {
        void utils.chat.activeRun.invalidate({ projectId, channelId });
      });
  }, [cancelMutation, projectId, branchId, channelId, stop, utils, setMessages, releaseOwnedRun]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Only @AI runs own the stop button / send lock. Notes can always go out.
      const wantsAi = mentionsAi(trimmed);
      if (wantsAi && busyRef.current) return;
      shell.setOpen(true);

      const epoch = ++sendEpochRef.current;
      ownedRunIdRef.current = null;
      selfRunRef.current = wantsAi;
      pendingUserTextRef.current = trimmed;
      // Stash before POST so a reload mid-flight / after 401 still keeps the turn.
      writeLocalTranscript(channelId, [
        ...messagesRef.current,
        {
          id: `local_user_${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: trimmed }],
        } as UIMessage,
      ]);
      if (wantsAi) {
        setLocalBusy(true);
        busyRef.current = true;
      }

      const fail = (reason: string) => {
        if (epoch !== sendEpochRef.current) return;
        selfRunRef.current = false;
        setLocalBusy(false);
        busyRef.current = false;
        persistFailureStamp(reason);
        releaseOwnedRun(epoch);
      };

      void sendMessage({ text: trimmed })
        .then(() => {
          // Stream finished — server persisted at POST; drop the local safety net.
          if (epoch === sendEpochRef.current) {
            pendingUserTextRef.current = null;
            if (!wantsAi) {
              selfRunRef.current = false;
              setLocalBusy(false);
            }
          }
        })
        .catch(async (err) => {
          const reason = err instanceof Error ? err.message : "request failed";
          if (wantsAi && /workspace is locked/i.test(reason)) {
            try {
              // Clear the dead lock, then start a fresh epoch for the retry so a
              // late cancel from the failed attempt can't touch the new run.
              await cancelMutation.mutateAsync({ projectId, branchId });
              if (epoch !== sendEpochRef.current) return;
              const retryEpoch = ++sendEpochRef.current;
              ownedRunIdRef.current = null;
              selfRunRef.current = true;
              setLocalBusy(true);
              busyRef.current = true;
              await sendMessage({ text: trimmed });
              if (retryEpoch !== sendEpochRef.current) return;
              pendingUserTextRef.current = null;
              return;
            } catch (retryErr) {
              fail(retryErr instanceof Error ? retryErr.message : reason);
              return;
            }
          }
          if (wantsAi) fail(reason);
          else {
            if (epoch === sendEpochRef.current) {
              selfRunRef.current = false;
              pendingUserTextRef.current = null;
            }
            persistFailureStamp(reason);
          }
        });
      if (wantsAi) {
        void utils.chat.activeRun.invalidate({ projectId, channelId });
      }
    },
    [
      sendMessage,
      shell,
      utils,
      projectId,
      branchId,
      channelId,
      cancelMutation,
      persistFailureStamp,
      releaseOwnedRun,
    ],
  );
  const value = useMemo(
    () => ({ ...shell, messages, status, busy, error, send, stop: stopRun }),
    [shell, messages, status, busy, error, send, stopRun],
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function CopilotProvider({
  projectId,
  branchId,
  channels: initialChannels,
  categories: initialCategories,
  defaultChannelId,
  initialMessages,
  children,
}: {
  projectId: string;
  branchId: string;
  channels: ChatChannel[];
  categories: ChatCategory[];
  defaultChannelId: string;
  initialMessages: UIMessage[];
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const createChannelMutation = trpc.chat.createChannel.useMutation();
  const deleteChannelMutation = trpc.chat.deleteChannel.useMutation();
  const createCategoryMutation = trpc.chat.createCategory.useMutation();
  const deleteCategoryMutation = trpc.chat.deleteCategory.useMutation();

  const [open, setOpen] = useState(true);
  const [channels, setChannels] = useState(initialChannels);
  const [categories, setCategories] = useState(initialCategories);
  const [activeChannelId, setActiveChannelId] = useState(defaultChannelId);

  const cacheRef = useRef(
    new Map<string, UIMessage[]>([
      [
        defaultChannelId,
        seedTranscriptWithLocalBackup(
          defaultChannelId,
          pruneEmptyAssistantMessages(initialMessages),
        ),
      ],
    ]),
  );
  const onMessages = useCallback((channelId: string, messages: UIMessage[]) => {
    cacheRef.current.set(channelId, messages);
    writeLocalTranscript(channelId, messages);
  }, []);

  const switchChannel = useCallback(
    (channelId: string) => {
      if (channelId === activeChannelId) return;
      if (cacheRef.current.has(channelId)) {
        setActiveChannelId(channelId);
        return;
      }
      void utils.client.chat.messages
        .query({ projectId, channelId })
        .then((rows) => {
          const fromServer = pruneEmptyAssistantMessages(
            rows.map((row) => ({
              id: row.id,
              role: row.role as UIMessage["role"],
              parts: row.parts as unknown as UIMessage["parts"],
            })),
          );
          cacheRef.current.set(
            channelId,
            seedTranscriptWithLocalBackup(channelId, fromServer),
          );
          setActiveChannelId(channelId);
        })
        // Stay put rather than opening a channel whose history failed to load:
        // an empty transcript is indistinguishable from lost history.
        .catch((err) => console.error("failed to load channel history", err));
    },
    [activeChannelId, projectId, utils],
  );

  const createChannel = useCallback(
    async (name: string, categoryId?: string) => {
      const channel = await createChannelMutation.mutateAsync({
        projectId,
        branchId,
        name,
        categoryId,
      });
      cacheRef.current.set(channel.id, []);
      setChannels((prev) => [...prev, channel]);
      setActiveChannelId(channel.id);
    },
    [createChannelMutation, projectId, branchId],
  );

  const deleteChannel = useCallback(
    async (channelId: string) => {
      await deleteChannelMutation.mutateAsync({ projectId, channelId });
      cacheRef.current.delete(channelId);
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
      if (channelId === activeChannelId) setActiveChannelId(defaultChannelId);
    },
    [deleteChannelMutation, projectId, activeChannelId, defaultChannelId],
  );

  const createCategory = useCallback(
    async (name: string) => {
      const category = await createCategoryMutation.mutateAsync({
        projectId,
        branchId,
        name,
      });
      setCategories((prev) => [...prev, category]);
    },
    [createCategoryMutation, projectId, branchId],
  );

  const deleteCategory = useCallback(
    async (categoryId: string) => {
      await deleteCategoryMutation.mutateAsync({ projectId, categoryId });
      const fallbackId = categories.find((c) => c.id !== categoryId)?.id ?? null;
      setCategories((prev) => prev.filter((c) => c.id !== categoryId));
      setChannels((prev) =>
        prev.map((ch) => (ch.categoryId === categoryId ? { ...ch, categoryId: fallbackId } : ch)),
      );
    },
    [deleteCategoryMutation, projectId, categories],
  );

  const shell = useMemo(
    () => ({
      open,
      setOpen,
      channels,
      categories,
      activeChannelId,
      switchChannel,
      createChannel,
      deleteChannel,
      createCategory,
      deleteCategory,
      projectId,
      branchId,
    }),
    [
      open,
      channels,
      categories,
      activeChannelId,
      switchChannel,
      createChannel,
      deleteChannel,
      createCategory,
      deleteCategory,
      projectId,
      branchId,
    ],
  );

  return (
    <ChatEngine
      key={activeChannelId}
      projectId={projectId}
      branchId={branchId}
      channelId={activeChannelId}
      initialMessages={cacheRef.current.get(activeChannelId) ?? []}
      onMessages={onMessages}
      shell={shell}
    >
      {children}
    </ChatEngine>
  );
}
