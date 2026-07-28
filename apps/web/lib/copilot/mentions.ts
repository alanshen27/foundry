/** Mention targets available in the composer `@` menu. */
export type MentionTarget = {
  id: string;
  /** Inserted token, e.g. `@AI`. */
  token: string;
  label: string;
  description: string;
  /** Only AI mentions enqueue a copilot run. */
  invokesAi: boolean;
};

export const MENTION_TARGETS: MentionTarget[] = [
  {
    id: "ai",
    token: "@AI",
    label: "AI",
    description: "Ask the copilot",
    invokesAi: true,
  },
];

/** Word-boundary match for an AI mention (`@AI`, `@ai`, …). */
const AI_MENTION_RE = /(^|[\s([{])@AI\b/i;

export function mentionsAi(text: string): boolean {
  return AI_MENTION_RE.test(text);
}

/** Active `@query` at the caret, if any. */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|[\s([{])@([\w.-]*)$/);
  if (!match) return null;
  const atIndex = before.lastIndexOf("@");
  return { start: atIndex, query: match[2] ?? "" };
}

export function filterMentionTargets(query: string): MentionTarget[] {
  const q = query.toLowerCase();
  return MENTION_TARGETS.filter(
    (t) =>
      t.label.toLowerCase().startsWith(q) ||
      t.token.toLowerCase().slice(1).startsWith(q) ||
      t.id.toLowerCase().startsWith(q),
  );
}

/** Replace the active `@query` with the chosen mention token. */
export function insertMention(
  text: string,
  caret: number,
  target: MentionTarget,
): { text: string; caret: number } {
  const active = mentionQueryAt(text, caret);
  if (!active) {
    const insert = `${target.token} `;
    const next = text.slice(0, caret) + insert + text.slice(caret);
    return { text: next, caret: caret + insert.length };
  }
  const insert = `${target.token} `;
  const next = text.slice(0, active.start) + insert + text.slice(caret);
  return { text: next, caret: active.start + insert.length };
}

export type TextSegment =
  { kind: "text"; text: string } | { kind: "mention"; text: string; invokesAi: boolean };

/** Split message text so mentions can be highlighted in the transcript. */
export function splitMentions(text: string): TextSegment[] {
  const re = /@AI\b/gi;
  const segments: TextSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ kind: "text", text: text.slice(last, match.index) });
    }
    segments.push({ kind: "mention", text: match[0]!, invokesAi: true });
    last = match.index + match[0]!.length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  return segments.length > 0 ? segments : [{ kind: "text", text }];
}
