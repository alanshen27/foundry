import type { UIMessage } from "ai";

export function isToolUiPart(part: UIMessage["parts"][number]): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export type AssistantPartBlock =
  | {
      type: "text";
      part: Extract<UIMessage["parts"][number], { type: "text" }>;
      key: string;
    }
  | {
      type: "tools";
      parts: UIMessage["parts"];
      key: string;
    };

/**
 * Collapse consecutive tool parts (parallel / back-to-back calls) into one
 * block so the chat can render a single "Worked N tools" row.
 *
 * Keys are stable across streaming inserts: text uses ordinal among text
 * blocks (not absolute part index), tools use the first toolCallId.
 */
export function groupAssistantPartBlocks(
  parts: UIMessage["parts"],
  messageId?: string,
): AssistantPartBlock[] {
  const blocks: AssistantPartBlock[] = [];
  const prefix = messageId ? `${messageId}:` : "";
  let textOrdinal = 0;
  let toolsOrdinal = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === "text" && part.text.trim()) {
      blocks.push({
        type: "text",
        part,
        key: `${prefix}text-${textOrdinal++}`,
      });
      continue;
    }

    if (!isToolUiPart(part)) continue;

    const group: UIMessage["parts"] = [part];
    let j = i + 1;
    while (j < parts.length) {
      const next = parts[j]!;
      if (isToolUiPart(next)) {
        group.push(next);
        j++;
        continue;
      }
      // Empty text between tools is noise from streaming — keep the group.
      if (next.type === "text" && !next.text.trim()) {
        j++;
        continue;
      }
      break;
    }

    const firstToolId =
      "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : null;
    blocks.push({
      type: "tools",
      parts: group,
      key: firstToolId ? `${prefix}tools-${firstToolId}` : `${prefix}tools-${toolsOrdinal}`,
    });
    toolsOrdinal++;
    i = j - 1;
  }

  return blocks;
}
