import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { createProjectKickoffStore, projectKickoffMessage } from "@/lib/copilot/project-kickoff";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function userMessage(text: string): UIMessage {
  return { id: "initial-user", role: "user", parts: [{ type: "text", text }] };
}

describe("project creation prompt handoff", () => {
  it("preserves the entire multiline creation input across navigation and reload", () => {
    const session = storage();
    const creation = createProjectKickoffStore(() => session);
    const prompt = `  A meeting recorder\n\nRequirements:\n${"a detailed requirement; ".repeat(65)}\n  Keep the enclosure serviceable.  `;
    expect(prompt.length).toBeGreaterThan(500);
    creation.save("created-project", prompt);
    const initializedProject = createProjectKickoffStore(() => session);
    const send = vi.fn((_text: string) => true);
    expect(initializedProject.read("created-project")?.prompt).toBe(prompt);
    expect(
      initializedProject.deliver({ projectId: "created-project", busy: false, messages: [], send }),
    ).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(projectKickoffMessage(prompt));
    expect(send.mock.calls[0]![0]).toContain(prompt);
    expect(initializedProject.read("created-project")).toBeNull();
  });

  it("never delivers a prompt into another project or consumes an unscoped legacy prompt", () => {
    const session = storage();
    session.values.set("foundry:project-kickoff", "Legacy prompt without a known project");
    const handoff = createProjectKickoffStore(() => session);
    handoff.save("project-a", "Project A product");
    const send = vi.fn((_text: string) => true);
    expect(handoff.deliver({ projectId: "project-b", busy: false, messages: [], send })).toBe(
      "missing",
    );
    expect(send).not.toHaveBeenCalled();
    expect(handoff.read("project-a")?.prompt).toBe("Project A product");
    expect(session.values.get("foundry:project-kickoff")).toBe(
      "Legacy prompt without a known project",
    );
  });

  it("waits through busy initialization and consumes only an accepted send", () => {
    const session = storage();
    const handoff = createProjectKickoffStore(() => session);
    handoff.save("project", "Product brief");
    const send = vi.fn((_text: string) => true);
    const input = { projectId: "project", messages: [], send };
    expect(handoff.deliver({ ...input, busy: true })).toBe("busy");
    expect(send).not.toHaveBeenCalled();
    expect(session.removeItem).not.toHaveBeenCalled();
    send.mockReturnValueOnce(false);
    expect(handoff.deliver({ ...input, busy: false })).toBe("declined");
    expect(handoff.read("project")?.prompt).toBe("Product brief");
    expect(session.removeItem).not.toHaveBeenCalled();
    expect(handoff.deliver({ ...input, busy: false })).toBe("sent");
    expect(session.removeItem).toHaveBeenCalledOnce();
  });

  it("cannot double-send during Strict Mode effects, navigation, or reload", () => {
    const session = storage();
    const handoff = createProjectKickoffStore(() => session);
    handoff.save("project", "Product brief");
    const send = vi.fn((_text: string) => true);
    const input = { projectId: "project", busy: false, messages: [], send };
    expect(handoff.deliver(input)).toBe("sent");
    expect(handoff.deliver(input)).toBe("missing");
    expect(createProjectKickoffStore(() => session).deliver(input)).toBe("missing");
    expect(send).toHaveBeenCalledOnce();
  });

  it("uses memory when storage is blocked and preserves a synchronously failed handoff", () => {
    const handoff = createProjectKickoffStore(() => {
      throw new Error("Storage blocked");
    });
    handoff.save("project", "Full prompt\nSecond line");
    const send = vi.fn((_text: string) => true);
    send.mockImplementationOnce(() => {
      throw new Error("Send declined");
    });
    const input = { projectId: "project", busy: false, messages: [], send };
    expect(handoff.deliver(input)).toBe("declined");
    expect(handoff.read("project")?.prompt).toBe("Full prompt\nSecond line");
    expect(handoff.deliver(input)).toBe("sent");
    expect(handoff.deliver(input)).toBe("missing");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("uses the persisted or local transcript to avoid replay when removing storage fails", () => {
    const session = storage();
    session.removeItem.mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const handoff = createProjectKickoffStore(() => session);
    handoff.save("project", "Product brief");
    const send = vi.fn((_text: string) => true);
    const input = { projectId: "project", busy: false, messages: [], send };
    expect(handoff.deliver(input)).toBe("sent");
    expect(handoff.deliver(input)).toBe("missing");
    // A failed transport already stashed this turn before kickoff was consumed.
    const reloaded = createProjectKickoffStore(() => session);
    expect(
      reloaded.deliver({
        ...input,
        busy: true,
        messages: [userMessage(projectKickoffMessage("Product brief"))],
      }),
    ).toBe("already-sent");
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not discard existing messages while delivering the creation prompt", () => {
    const session = storage();
    const handoff = createProjectKickoffStore(() => session);
    handoff.save("project", "Creation prompt");
    const messages = [userMessage("A note already in the project")];
    const snapshot = structuredClone(messages);
    const send = vi.fn((_text: string) => true);
    expect(handoff.deliver({ projectId: "project", busy: false, messages, send })).toBe("sent");
    expect(messages).toEqual(snapshot);
    expect(send).toHaveBeenCalledWith(projectKickoffMessage("Creation prompt"));
  });

  it("rejects malformed and incorrectly scoped saved entries without dispatching them", () => {
    const session = storage();
    const send = vi.fn((_text: string) => true);
    for (const value of [
      "not json",
      "null",
      JSON.stringify({ version: 1, projectId: "other", prompt: "Product" }),
      JSON.stringify({ version: 1, projectId: "project", prompt: 42 }),
    ]) {
      session.values.set("foundry:project-kickoff:project", value);
      expect(
        createProjectKickoffStore(() => session).deliver({
          projectId: "project",
          busy: false,
          messages: [],
          send,
        }),
      ).toBe("missing");
    }
    expect(send).not.toHaveBeenCalled();
  });
});
