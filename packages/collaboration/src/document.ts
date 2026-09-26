import * as Y from "yjs";
import { diffArrays, diffChars, type Change } from "diff";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const MAX_DESIGN_DOCUMENT_BYTES = 4_000_000;
export const MAX_DESIGN_TEXT_LENGTH = 1_000_000;
const MAX_NODES = 50_000;
const MAX_DEPTH = 48;
const TEXT_FIELDS = new Set(["content", "script", "notes", "markdown", "code", "text"]);
type JsonObject = { [key: string]: JsonValue };
type Encoded = JsonValue | Y.Map<unknown> | Y.Text;

function object(value: unknown): value is JsonObject {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Validate the complete snapshot before making any shared-state mutation. */
function validate(value: unknown): asserts value is JsonValue {
  const seen = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error("Design document is too complex");
    if (typeof item === "string") {
      if (item.length > MAX_DESIGN_TEXT_LENGTH)
        throw new Error("Design text exceeds the size limit");
      bytes += new TextEncoder().encode(item).length;
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("Design numbers must be finite");
      bytes += 16;
    } else if (item === null || typeof item === "boolean") bytes += 5;
    else if (Array.isArray(item) || object(item)) {
      if (seen.has(item)) throw new Error("Design documents cannot contain cycles");
      seen.add(item);
      if (Array.isArray(item)) {
        const ids = new Set<string>();
        for (const entry of item) {
          if (object(entry) && typeof entry.id === "string") {
            if (!entry.id || ids.has(entry.id))
              throw new Error("Design entity IDs must be unique and nonempty");
            ids.add(entry.id);
          }
          visit(entry, depth + 1);
        }
      } else
        for (const [key, entry] of Object.entries(item)) {
          // Optional TypeScript properties serialize as absent in SQL JSON.
          // Arrays still reject undefined, as do every non-JSON value below.
          if (entry === undefined) continue;
          bytes += new TextEncoder().encode(key).length + 4;
          visit(entry, depth + 1);
        }
      seen.delete(item);
    } else throw new Error("Design documents must contain only JSON values");
    if (bytes > MAX_DESIGN_DOCUMENT_BYTES)
      throw new Error("Design document exceeds the size limit");
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_DESIGN_DOCUMENT_BYTES)
    throw new Error("Design document exceeds the size limit");
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}

function entities(value: unknown): value is Array<JsonObject & { id: string }> {
  return (
    Array.isArray(value) &&
    value.every((entry) => object(entry) && typeof entry.id === "string" && entry.id.length > 0)
  );
}

function encode(value: JsonValue, key: string): Encoded {
  if (typeof value === "string" && TEXT_FIELDS.has(key)) return new Y.Text(value);
  if (object(value)) {
    const fields = new Y.Map<unknown>();
    for (const [name, entry] of Object.entries(value)) fields.set(name, encode(entry, name));
    const result = new Y.Map<unknown>();
    result.set("kind", "object");
    result.set("fields", fields);
    return result;
  }
  if (entities(value)) {
    const items = new Y.Map<unknown>();
    const order = new Y.Array<string>();
    for (const entry of value) items.set(entry.id, encode(entry, ""));
    order.insert(
      0,
      value.map((entry) => entry.id),
    );
    const result = new Y.Map<unknown>();
    result.set("kind", "entities");
    result.set("items", items);
    result.set("order", order);
    return result;
  }
  return structuredClone(value);
}

function decode(value: unknown, budget = { nodes: 0, bytes: 0 }, depth = 0): JsonValue {
  if (++budget.nodes > MAX_NODES || depth > MAX_DEPTH)
    throw new Error("Shared design document is too complex");
  if (value instanceof Y.Text) {
    if (value.length > MAX_DESIGN_TEXT_LENGTH)
      throw new Error("Shared design text exceeds the size limit");
    const text = value.toString();
    budget.bytes += new TextEncoder().encode(text).length;
    if (budget.bytes > MAX_DESIGN_DOCUMENT_BYTES)
      throw new Error("Shared design document exceeds the size limit");
    return text;
  }
  if (value instanceof Y.Map) {
    if (value.get("kind") === "object") {
      const fields = value.get("fields");
      if (!(fields instanceof Y.Map)) throw new Error("Malformed shared design object");
      const result: JsonObject = {};
      for (const [key, entry] of fields) {
        budget.bytes += new TextEncoder().encode(key).length;
        if (budget.bytes > MAX_DESIGN_DOCUMENT_BYTES)
          throw new Error("Shared design document exceeds the size limit");
        Object.defineProperty(result, key, {
          value: decode(entry, budget, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    }
    if (value.get("kind") === "entities") {
      const items = value.get("items"),
        order = value.get("order");
      if (
        !(items instanceof Y.Map) ||
        !(order instanceof Y.Array) ||
        items.size > MAX_NODES ||
        order.length > MAX_NODES
      )
        throw new Error("Malformed shared design entity array");
      const ids = order.toArray();
      if (ids.some((id) => typeof id !== "string"))
        throw new Error("Malformed shared design entity order");
      // Concurrent moves can insert the same ID twice in Y.Array; expose each
      // existing entity once, and recover concurrently added items deterministically.
      const ordered = [...new Set([...ids, ...[...items.keys()].sort()])];
      const result: JsonValue[] = [];
      for (const id of ordered) {
        if (!items.has(id)) continue;
        const entry = decode(items.get(id), budget, depth + 1);
        if (!object(entry) || entry.id !== id)
          throw new Error("Malformed shared design entity identity");
        result.push(entry);
      }
      return result;
    }
    throw new Error("Unsupported shared design document representation");
  }
  validate(value);
  budget.bytes += new TextEncoder().encode(JSON.stringify(value)).length;
  if (budget.bytes > MAX_DESIGN_DOCUMENT_BYTES)
    throw new Error("Shared design document exceeds the size limit");
  return structuredClone(value);
}

/** Undefined means the room has not been seeded from its persisted document. */
export function readDesignDocument(doc: Y.Doc): unknown {
  const root = doc.getMap<unknown>("design");
  if (!root.has("value")) return undefined;
  if (root.get("version") !== 1) throw new Error("Unsupported shared design document version");
  const result = decode(root.get("value"));
  validate(result);
  return result;
}

type TextHunk = { start: number; end: number; text: string };
function hunks(changes: Change[]): TextHunk[] {
  const out: TextHunk[] = [];
  let offset = 0;
  let pending: TextHunk | undefined;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      if (pending) {
        out.push(pending);
        pending = undefined;
      }
      offset += change.value.length;
    } else {
      pending ??= { start: offset, end: offset, text: "" };
      if (change.removed) {
        offset += change.value.length;
        pending.end = offset;
      } else pending.text += change.value;
    }
  }
  if (pending) out.push(pending);
  return out;
}

function checkedDiff(before: string, after: string): Change[] {
  // Anchor unchanged ends first. Without this, a shortest character diff can
  // match the 'w' inside an inserted 'new ' to the 'w' in baseline 'world',
  // splitting a peer's insertion when that baseline word is replaced.
  let prefix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(before.length, after.length) - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const changes = diffChars(
    before.slice(prefix, before.length - suffix),
    after.slice(prefix, after.length - suffix),
    { timeout: 200, maxEditLength: 20_000 },
  );
  if (!changes)
    throw new Error("Text change is too large to merge safely; split it into smaller edits");
  return [
    ...(prefix
      ? [{ value: before.slice(0, prefix), count: prefix, added: false, removed: false }]
      : []),
    ...changes,
    ...(suffix
      ? [
          {
            value: before.slice(before.length - suffix),
            count: suffix,
            added: false,
            removed: false,
          },
        ]
      : []),
  ];
}

/**
 * Apply only the author's multi-hunk edit, rebased onto the current shared text.
 * Delete surviving baseline characters, never text inserted by another author.
 * This also works when the editor's before-snapshot is older than the room.
 */
function prepareTextSnapshot(text: Y.Text, before: string, after: string): () => void {
  if (typeof before !== "string" || typeof after !== "string")
    throw new Error("Text snapshots must be strings");
  if (Math.max(before.length, after.length, text.length) > MAX_DESIGN_TEXT_LENGTH)
    throw new Error("Design text exceeds the size limit");
  const current = text.toString();
  if (before === after || current === after) return () => {};
  const desired = hunks(checkedDiff(before, after));
  const remote = checkedDiff(before, current);
  const existing = hunks(remote);
  const matches: Array<{ start: number; end: number; current: number }> = [];
  let original = 0,
    newOffset = 0;
  for (const change of remote) {
    if (change.added) newOffset += change.value.length;
    else if (change.removed) original += change.value.length;
    else {
      matches.push({ start: original, end: original + change.value.length, current: newOffset });
      original += change.value.length;
      newOffset += change.value.length;
    }
  }
  const anchor = (position: number): number => {
    let old = 0,
      next = 0;
    for (const change of remote) {
      if (change.added) {
        next += change.value.length;
        continue;
      }
      if (change.removed) {
        if (position < old + change.value.length) return next;
        old += change.value.length;
      } else {
        if (position < old + change.value.length) return next + position - old;
        old += change.value.length;
        next += change.value.length;
      }
    }
    return next;
  };
  const operations = desired
    .filter((hunk) => !existing.some((other) => equal(hunk, other)))
    .map((hunk) => ({
      index: anchor(hunk.start),
      text: hunk.text,
      deletes: matches.flatMap((match) => {
        const start = Math.max(hunk.start, match.start),
          end = Math.min(hunk.end, match.end);
        return end > start
          ? [{ index: match.current + start - match.start, length: end - start }]
          : [];
      }),
    }));
  return () => {
    for (const operation of operations.reverse()) {
      for (const deletion of operation.deletes.reverse())
        text.delete(deletion.index, deletion.length);
      if (operation.text) text.insert(operation.index, operation.text);
    }
  };
}

export function applyTextSnapshot(text: Y.Text, before: string, after: string): void {
  const run = prepareTextSnapshot(text, before, after);
  if (text.doc) text.doc.transact(run, "snapshot");
  else run();
}

function patch(
  current: Encoded,
  before: JsonValue,
  after: JsonValue,
  key: string,
  operations: Array<() => void>,
): Encoded {
  if (equal(before, after)) return current;
  if (current instanceof Y.Text && typeof before === "string" && typeof after === "string") {
    operations.push(prepareTextSnapshot(current, before, after));
    return current;
  }
  if (
    current instanceof Y.Map &&
    current.get("kind") === "object" &&
    object(before) &&
    object(after)
  ) {
    const fields = current.get("fields") as Y.Map<Encoded>;
    for (const name of Object.keys(before))
      if (!Object.hasOwn(after, name))
        operations.push(() => {
          fields.delete(name);
        });
    for (const [name, value] of Object.entries(after)) {
      if (!Object.hasOwn(before, name)) {
        const encoded = encode(value, name);
        operations.push(() => {
          fields.set(name, encoded);
        });
        continue;
      }
      // A concurrent explicit deletion wins over an edit to an old snapshot.
      if (!fields.has(name)) continue;
      const existing = fields.get(name)!;
      const next = patch(existing, before[name]!, value, name, operations);
      if (next !== existing)
        operations.push(() => {
          fields.set(name, next);
        });
    }
    return current;
  }
  if (
    current instanceof Y.Map &&
    current.get("kind") === "entities" &&
    entities(before) &&
    entities(after)
  ) {
    const items = current.get("items") as Y.Map<Encoded>;
    const order = current.get("order") as Y.Array<string>;
    const old = new Map(before.map((entry) => [entry.id, entry]));
    const next = new Map(after.map((entry) => [entry.id, entry]));
    const removeOrder = (id: string) => {
      for (let index = order.length - 1; index >= 0; index--)
        if (order.get(index) === id) order.delete(index, 1);
    };
    for (const id of old.keys())
      if (!next.has(id))
        operations.push(() => {
          items.delete(id);
          removeOrder(id);
        });
    for (const [id, entry] of next) {
      if (!old.has(id)) {
        if (!items.has(id)) {
          const encoded = encode(entry, "");
          operations.push(() => {
            items.set(id, encoded);
          });
        } else patch(items.get(id)!, {}, entry, "", operations);
      } else if (items.has(id)) {
        const existing = items.get(id)!;
        const result = patch(existing, old.get(id)!, entry, "", operations);
        if (result !== existing)
          operations.push(() => {
            items.set(id, result);
          });
      }
    }
    const oldIds = [...old.keys()],
      nextIds = [...next.keys()];
    const moved = new Set(
      diffArrays(oldIds, nextIds)
        .filter((change) => change.added)
        .flatMap((change) => change.value),
    );
    operations.push(() => {
      for (let index = 0; index < nextIds.length; index++) {
        const id = nextIds[index]!;
        if (!moved.has(id) || !items.has(id)) continue;
        removeOrder(id);
        const currentIds = order.toArray();
        let insertion = -1;
        for (let previous = index - 1; previous >= 0; previous--) {
          const at = currentIds.indexOf(nextIds[previous]!);
          if (at >= 0) {
            insertion = at + 1;
            break;
          }
        }
        if (insertion < 0) {
          for (let following = index + 1; following < nextIds.length; following++) {
            const at = currentIds.indexOf(nextIds[following]!);
            if (at >= 0) {
              insertion = at;
              break;
            }
          }
        }
        order.insert(insertion < 0 ? currentIds.length : insertion, [id]);
      }
    });
    return current;
  }
  return encode(after, key);
}

/**
 * Diff a caller's before/after snapshots into stable shared entities and fields.
 * Seed only after room synchronization; clients must share the server's seed.
 */
export function applyDesignSnapshot(doc: Y.Doc, before: unknown, after: unknown): void {
  if (before != null) validate(before);
  validate(after);
  // Normalize optional object fields only after validation, so NaN, cycles,
  // functions and unsupported objects cannot be silently coerced by JSON.
  if (before != null) before = JSON.parse(JSON.stringify(before));
  after = JSON.parse(JSON.stringify(after)) as JsonValue;
  const root = doc.getMap<Encoded>("design");
  if (root.has("value")) readDesignDocument(doc); // reject malformed remote state before editing
  const current = root.get("value");
  // Prepare every edit first: Yjs transactions group events but cannot roll
  // back. A malformed or unmergeable later field must not partially apply.
  const operations: Array<() => void> = [];
  const next =
    before == null || current === undefined
      ? undefined
      : patch(current, before as JsonValue, after as JsonValue, "", operations);
  const seed = before == null && current === undefined ? encode(after as JsonValue, "") : undefined;
  doc.transact(() => {
    if (before == null) {
      if (seed !== undefined) {
        root.set("version", 1);
        root.set("value", seed);
      }
      return;
    }
    if (current === undefined) return;
    for (const operation of operations) operation();
    if (current !== next && next !== undefined) root.set("value", next);
  }, "snapshot");
}
