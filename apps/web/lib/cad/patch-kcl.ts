/**
 * Exact-match text edits for KCL sources. Used by the copilot's
 * patch_cad_script tool: each edit must match exactly once so a small,
 * high-confidence change (a dimension, a binding) can't silently rewrite
 * the wrong place.
 */

export type KclEdit = {
  /** Exact substring to replace — must occur exactly once. */
  find: string;
  replace: string;
};

export type KclPatchResult = { ok: true; content: string } | { ok: false; error: string };

export function applyKclEdits(content: string, edits: KclEdit[]): KclPatchResult {
  let next = content;
  for (const [i, edit] of edits.entries()) {
    const first = next.indexOf(edit.find);
    if (first === -1) {
      return {
        ok: false,
        error: `edit ${i + 1}: find text not present — re-read the current script and retry`,
      };
    }
    if (next.indexOf(edit.find, first + 1) !== -1) {
      return {
        ok: false,
        error: `edit ${i + 1}: find text matches more than once — include more surrounding context`,
      };
    }
    next = next.slice(0, first) + edit.replace + next.slice(first + edit.find.length);
  }
  if (next === content) {
    return { ok: false, error: "edits are a no-op — replace equals find" };
  }
  return { ok: true, content: next };
}
