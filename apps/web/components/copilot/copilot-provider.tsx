"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { trpc } from "@/lib/trpc";

type CopilotContextValue = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  send: (text: string) => void;
  stop: () => void;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot must be used inside CopilotProvider");
  return ctx;
}

export function CopilotProvider({
  projectId,
  branchId,
  initialMessages,
  children,
}: {
  projectId: string;
  branchId: string;
  initialMessages: UIMessage[];
  children: ReactNode;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(true);
  // Refresh server components and client caches after each streamed response
  // so stage badges, tables, and editors reflect what the copilot changed.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { projectId, branchId },
    }),
    messages: initialMessages,
    onFinish: () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        router.refresh();
        void utils.invalidate();
      }, 150);
    },
  });

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setOpen(true);
      void sendMessage({ text: trimmed });
    },
    [sendMessage],
  );

  const value = useMemo(
    () => ({ messages, status, error, open, setOpen, send, stop }),
    [messages, status, error, open, send, stop],
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}
