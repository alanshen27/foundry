"use client";

import { createContext, useContext } from "react";
import type { BackgroundChatTransport } from "@/lib/copilot/background-chat-transport";

/** Scoped UI fixture dependencies. Ordinary workspaces never receive these overrides. */
export type WorkspaceUiPreview = {
  meshResponse: (requestBody: string) => Promise<Response>;
  chatTransport: BackgroundChatTransport;
};

export const WorkspaceUiPreviewContext = createContext<WorkspaceUiPreview | null>(null);

export function useWorkspaceUiPreview(): WorkspaceUiPreview | null {
  const preview = useContext(WorkspaceUiPreviewContext);
  return process.env.NODE_ENV === "production" ? null : preview;
}
