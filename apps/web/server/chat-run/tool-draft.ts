import { parsePartialJson } from "ai";
import type { CadDraftUpdate } from "./cad-draft";

const SOURCES = new Set([
  "write_code_file",
  "save_cad_script",
  "patch_cad_script",
  "create_cad_component",
  "save_circuit",
  "save_pcb",
]);
type StreamingOptions = { toolCallId: string; inputTextDelta: string; abortSignal?: AbortSignal };
type ToolLike = {
  execute?: (...args: any[]) => unknown;
  onInputDelta?: (options: StreamingOptions) => unknown;
  [key: string]: unknown;
};

/** Stream source arguments without executing partial tool calls or touching Yjs. */
export function withLiveToolDrafts<T extends Record<string, ToolLike>>(
  tools: T,
  observer: { emit: (draft: CadDraftUpdate) => void; end: (toolCallId: string) => void },
): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      if (!SOURCES.has(name)) return [name, tool];
      const inputs = new Map<string, { text: string; at: number }>();
      return [
        name,
        {
          ...tool,
          onInputDelta: async (options: StreamingOptions) => {
            await tool.onInputDelta?.(options);
            if (options.abortSignal?.aborted) {
              inputs.delete(options.toolCallId);
              return;
            }
            const previous = inputs.get(options.toolCallId) ?? { text: "", at: 0 };
            if (previous.text.length > 1_000_000) return;
            previous.text += options.inputTextDelta;
            inputs.set(options.toolCallId, previous);
            if (Date.now() - previous.at < 350) return;
            previous.at = Date.now();
            const { value } = await parsePartialJson(previous.text);
            if (!value || typeof value !== "object" || Array.isArray(value)) return;
            const input = value as Record<string, unknown>;
            let path = String(input.path ?? input.partName ?? input.name ?? name).slice(0, 300);
            let content =
              typeof input.content === "string"
                ? input.content
                : typeof input.script === "string"
                  ? input.script
                  : JSON.stringify(input, null, 2);
            if (name === "save_circuit") path = "schematic.json";
            if (name === "save_pcb")
              path = `pcb/${String(input.boardId ?? "active").slice(0, 100)}.json`;
            if (name === "patch_cad_script") content = JSON.stringify(input.edits ?? [], null, 2);
            try {
              observer.emit({ toolCallId: options.toolCallId, path, content });
            } catch {
              /* Display only. */
            }
          },
          execute: async (...args: any[]) => {
            const toolCallId = args[1]?.toolCallId as string | undefined;
            try {
              return await tool.execute?.(...args);
            } finally {
              if (toolCallId) {
                inputs.delete(toolCallId);
                observer.end(toolCallId);
              }
            }
          },
        },
      ];
    }),
  ) as T;
}
