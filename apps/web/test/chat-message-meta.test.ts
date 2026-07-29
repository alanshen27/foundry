import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  historyRowToUIMessage,
  isOwnUserMessage,
  messageAuthorKey,
  messageDisplayName,
  stampLatestUserAuthor,
  withChatMeta,
} from "@/lib/copilot/chat-message-meta";

function user(id: string, text: string, authorUserId?: string): UIMessage {
  return withChatMeta(
    { id, role: "user", parts: [{ type: "text", text }] } as UIMessage,
    authorUserId ? { authorUserId, authorName: "Alice" } : {},
  );
}

describe("stampLatestUserAuthor", () => {
  it("stamps only the newest user turn", () => {
    const stamped = stampLatestUserAuthor(
      [
        user("m1", "old"),
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] } as UIMessage,
        user("m2", "new"),
      ],
      { id: "u2", name: "Bob" },
    );
    expect(stamped[0]?.metadata).toEqual({});
    expect(stamped[2]?.metadata).toMatchObject({
      authorUserId: "u2",
      authorName: "Bob",
    });
  });

  it("does not overwrite an existing author on the latest turn", () => {
    const stamped = stampLatestUserAuthor([user("m1", "hi", "u1")], {
      id: "u2",
      name: "Bob",
    });
    expect(stamped[0]?.metadata).toMatchObject({ authorUserId: "u1", authorName: "Alice" });
  });
});

describe("message attribution helpers", () => {
  it("groups by author, not by role alone", () => {
    const a = user("m1", "hi", "u1");
    const b = user("m2", "yo", "u2");
    expect(messageAuthorKey(a)).toBe("u1");
    expect(messageAuthorKey(b)).toBe("u2");
    expect(messageAuthorKey(a)).not.toBe(messageAuthorKey(b));
  });

  it("never falls back to the viewer name for unlabeled users", () => {
    expect(messageDisplayName(user("m1", "hi"))).toBe("Member");
  });

  it("detects own messages via authorUserId", () => {
    expect(isOwnUserMessage(user("m1", "hi", "u1"), "u1")).toBe(true);
    expect(isOwnUserMessage(user("m1", "hi", "u1"), "u2")).toBe(false);
    expect(isOwnUserMessage(user("m1", "hi"), "u1")).toBe(false);
  });

  it("maps history rows into UIMessage metadata", () => {
    const message = historyRowToUIMessage({
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
      authorUserId: "u1",
      authorName: "Ada",
      authorAvatarUrl: null,
      replyToId: null,
      replyPreview: null,
      editedAt: null,
      deletedAt: null,
      reactions: [{ emoji: "👍", count: 1, me: true }],
      createdAt: new Date().toISOString(),
    });
    expect(message.metadata).toMatchObject({
      authorUserId: "u1",
      authorName: "Ada",
      reactions: [{ emoji: "👍", count: 1, me: true }],
    });
  });
});
