import type { UIMessage } from "ai";
import { messagePlainText } from "./chat-message-meta";

const STORAGE_PREFIX = "foundry:project-kickoff:";
type Kickoff = { version: 1; projectId: string; prompt: string };
type KickoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DeliveryInput = {
  projectId: string;
  busy: boolean;
  messages: UIMessage[];
  /** True means accepted locally; transport failures remain visible in chat. */
  send: (text: string) => boolean;
};

export function projectKickoffMessage(prompt: string): string {
  return `@AI Bootstrap this project end-to-end:\n\n${prompt}\n\nFill the brief, requirements, BOM, circuit, 3D model, and validation checks.`;
}

/**
 * One creation prompt per project, surviving client navigation and reloads.
 * Memory is the fallback when session storage is blocked or out of space.
 * The old unscoped key is intentionally not consumed: its project is unknown.
 */
export function createProjectKickoffStore(getStorage: () => KickoffStorage | null) {
  const pending = new Map<string, Kickoff>();
  const acknowledged = new Set<string>();
  const key = (projectId: string) => `${STORAGE_PREFIX}${encodeURIComponent(projectId)}`;

  function read(projectId: string): Kickoff | null {
    if (acknowledged.has(projectId)) return null;
    const cached = pending.get(projectId);
    if (cached) return cached;
    try {
      const raw = getStorage()?.getItem(key(projectId));
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<Kickoff> | null;
      if (
        value?.version !== 1 ||
        value.projectId !== projectId ||
        typeof value.prompt !== "string" ||
        !value.prompt.trim()
      )
        return null;
      const entry: Kickoff = { version: 1, projectId, prompt: value.prompt };
      pending.set(projectId, entry);
      return entry;
    } catch {
      return null;
    }
  }

  function acknowledge(projectId: string) {
    pending.delete(projectId);
    acknowledged.add(projectId);
    try {
      getStorage()?.removeItem(key(projectId));
    } catch {
      // The in-memory acknowledgement suppresses repeats during navigation.
      // After reload, the persisted/local transcript is the second safeguard.
    }
  }

  return {
    save(projectId: string, prompt: string) {
      if (!projectId || !prompt.trim()) return;
      const entry: Kickoff = { version: 1, projectId, prompt };
      pending.set(projectId, entry);
      acknowledged.delete(projectId);
      try {
        getStorage()?.setItem(key(projectId), JSON.stringify(entry));
      } catch {
        // Keep the exact prompt in memory for the imminent client navigation.
      }
    },
    read,
    deliver({ projectId, busy, messages, send }: DeliveryInput) {
      const entry = read(projectId);
      if (!entry) return "missing" as const;
      const text = projectKickoffMessage(entry.prompt);
      if (
        messages.some((message) => message.role === "user" && messagePlainText(message) === text)
      ) {
        acknowledge(projectId);
        return "already-sent" as const;
      }
      if (busy) return "busy" as const;
      try {
        // send() stashes its user turn before starting the transport. Never
        // discard the handoff when a busy/empty guard declines that send.
        if (!send(text)) return "declined" as const;
      } catch {
        return "declined" as const;
      }
      acknowledge(projectId);
      return "sent" as const;
    },
  };
}

export const projectKickoffs = createProjectKickoffStore(() =>
  typeof window === "undefined" ? null : window.sessionStorage,
);
