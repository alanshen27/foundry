import type { UIMessageChunk } from "ai";
import { CAD_DRAFT_LIMIT, cadDraftChunk } from "@/lib/copilot/cad-draft";

export type CadDraftUpdate = { toolCallId: string; path: string; content: string };

/** Full snapshots recover on stream replay; bounded and throttled per file. */
export function createCadDraftEmitter(publish: (chunk: UIMessageChunk) => void) {
  const last = new Map<string, { at: number; content: string }>();
  return {
    emit(update: CadDraftUpdate) {
      const key = `${update.toolCallId}:${update.path}`;
      const previous = last.get(key);
      const content = update.content.slice(0, CAD_DRAFT_LIMIT);
      if (
        previous &&
        (previous.content === content || (content.length && Date.now() - previous.at < 750))
      )
        return;
      last.set(key, { at: Date.now(), content });
      publish(
        cadDraftChunk({
          ...update,
          content,
          truncated: update.content.length > CAD_DRAFT_LIMIT,
          clear: false,
        }),
      );
    },
    end(toolCallId: string) {
      for (const key of last.keys()) if (key.startsWith(`${toolCallId}:`)) last.delete(key);
      publish(cadDraftChunk({ toolCallId, clear: true }));
    },
  };
}
