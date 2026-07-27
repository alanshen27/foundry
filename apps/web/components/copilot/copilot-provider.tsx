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
import { mentionsAi } from "@/lib/copilot/mentions";
import { pruneEmptyAssistantMessages } from "@/lib/copilot/messages";
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
  shell: Omit<
    CopilotContextValue,
    "messages" | "status" | "busy" | "error" | "send" | "stop"
  >;
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const cancelMutation = trpc.chat.cancelActiveRun.useMutation();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<"submitted" | "streaming" | "ready" | "error">("ready");
  const busyRef = useRef(false);
  /** True when this tab started the run — skip resumeStream (avoids dual SSE). */
  const selfRunRef = useRef(false);
  // Freeze the seed so RSC re-renders / prop updates never reset the live chat.
  const seedRef = useRef(pruneEmptyAssistantMessages(initialMessages));
  // Flip true synchronously on send so the stop square appears before status catches up.
  const [localBusy, setLocalBusy] = useState(false);

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

  const transport = useMemo(
    () => new BackgroundChatTransport({ projectId, branchId, channelId }),
    [projectId, branchId, channelId],
  );

  const { messages, sendMessage, status, error, stop, resumeStream, setMessages } = useChat({
    id: channelId,
    transport,
    messages: seedRef.current,
    // Resume was attaching to stuck PENDING/RUNNING streams (keepalive SSE for
    // minutes), leaving status="streaming" so send never fired. Re-enable once
    // worker+queue reliability is solid; broadcast still drives cross-tab attach.
    resume: false,
    onFinish: () => {
      selfRunRef.current = false;
      setLocalBusy(false);
      void utils.chat.activeRun.invalidate({ projectId, channelId });
      setMessages((prev) => pruneEmptyAssistantMessages(prev));
      refreshProjectData();
    },
    onError: () => {
      selfRunRef.current = false;
      setLocalBusy(false);
      void utils.chat.activeRun.invalidate({ projectId, channelId });
      setMessages((prev) => pruneEmptyAssistantMessages(prev));
    },
  });

  statusRef.current = status;
  // Gate send on local stream state only. A stuck ChatRun row / hung resume
  // SSE used to set busy forever via activeRun, so Enter did nothing and the
  // composer never cleared (no POST /api/ai/chat).
  const sending =
    localBusy || status === "submitted" || status === "streaming";
  busyRef.current = sending;
  // Stop button: local send OR a server-side run the user may want to cancel.
  const busy = sending || Boolean(activeRunQuery.data);

  // Clear optimistic busy once the server agrees there's no active run and
  // the local stream is idle.
  useEffect(() => {
    if (
      localBusy &&
      !activeRunQuery.data &&
      status !== "submitted" &&
      status !== "streaming" &&
      !activeRunQuery.isFetching
    ) {
      setLocalBusy(false);
      setMessages((prev) => pruneEmptyAssistantMessages(prev));
    }
  }, [localBusy, activeRunQuery.data, activeRunQuery.isFetching, status, setMessages]);

  useEffect(() => {
    const broadcast = createBroadcastPort();
    const sub = broadcast.subscribe(copilotBroadcastChannel(channelId), (message) => {
      if (message.event === "run-started") {
        setLocalBusy(true);
        void utils.chat.activeRun.invalidate({ projectId, channelId });
        // Only attach if another client started the run. Resuming our own send
        // opens a second SSE and tool parts land on the wrong message.
        if (
          !selfRunRef.current &&
          (statusRef.current === "ready" || statusRef.current === "error")
        ) {
          void resumeStream();
        }
      }
      if (message.event === "run-finished") {
        selfRunRef.current = false;
        setLocalBusy(false);
        void utils.chat.activeRun.invalidate({ projectId, channelId });
        setMessages((prev) => pruneEmptyAssistantMessages(prev));
        if (statusRef.current === "ready") {
          refreshProjectData();
        }
      }
    });
    return () => {
      sub.leave();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [channelId, projectId, resumeStream, refreshProjectData, utils, setMessages]);

  useEffect(() => {
    onMessages(channelId, messages);
  }, [channelId, messages, onMessages]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (busyRef.current) return;
      if (!mentionsAi(trimmed)) return;
      shell.setOpen(true);
      selfRunRef.current = true;
      setLocalBusy(true);
      busyRef.current = true;
      void sendMessage({ text: trimmed }).catch(() => {
        selfRunRef.current = false;
        setLocalBusy(false);
        busyRef.current = false;
        setMessages((prev) => pruneEmptyAssistantMessages(prev));
      });
      void utils.chat.activeRun.invalidate({ projectId, channelId });
    },
    [sendMessage, shell, utils, projectId, channelId, setMessages],
  );

  const stopRun = useCallback(() => {
    selfRunRef.current = false;
    stop();
    setLocalBusy(false);
    busyRef.current = false;
    setMessages((prev) => pruneEmptyAssistantMessages(prev));
    void cancelMutation
      .mutateAsync({ projectId, channelId })
      .catch(() => undefined)
      .finally(() => {
        void utils.chat.activeRun.invalidate({ projectId, channelId });
      });
  }, [cancelMutation, projectId, channelId, stop, utils, setMessages]);

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
      [defaultChannelId, pruneEmptyAssistantMessages(initialMessages)],
    ]),
  );
  const onMessages = useCallback((channelId: string, messages: UIMessage[]) => {
    cacheRef.current.set(channelId, messages);
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
          cacheRef.current.set(
            channelId,
            pruneEmptyAssistantMessages(
              rows.map((row) => ({
                id: row.id,
                role: row.role as UIMessage["role"],
                parts: row.parts as unknown as UIMessage["parts"],
              })),
            ),
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
        prev.map((ch) =>
          ch.categoryId === categoryId ? { ...ch, categoryId: fallbackId } : ch,
        ),
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
