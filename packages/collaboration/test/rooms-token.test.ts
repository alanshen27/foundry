import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { awarenessColorForUser } from "../src/awareness";
import { codeFileRoom, parseCodeFileRoom, parseSitePromptRoom, sitePromptRoom } from "../src/rooms";
import { mintCollabToken, verifyCollabToken } from "../src/token";

describe("codeFileRoom", () => {
  it("round-trips file ids", () => {
    expect(codeFileRoom("abc")).toBe("codefile:abc");
    expect(parseCodeFileRoom("codefile:abc")).toBe("abc");
    expect(parseCodeFileRoom("other:abc")).toBeNull();
    expect(parseCodeFileRoom("codefile:")).toBeNull();
  });
});

describe("sitePromptRoom", () => {
  it("round-trips site ids", () => {
    expect(sitePromptRoom("site_1")).toBe("siteprompt:site_1");
    expect(parseSitePromptRoom("siteprompt:site_1")).toBe("site_1");
    expect(parseSitePromptRoom("codefile:site_1")).toBeNull();
    expect(parseSitePromptRoom("siteprompt:")).toBeNull();
  });
});

describe("collab token", () => {
  const secret = "test-secret-material";

  it("mints and verifies codefile claims", () => {
    const token = mintCollabToken(
      {
        kind: "codefile",
        resourceId: "file_1",
        userId: "user_1",
        name: "Ada",
        avatarUrl: null,
        canEdit: true,
      },
      secret,
    );
    const claims = verifyCollabToken(token, secret);
    expect(claims).toMatchObject({
      kind: "codefile",
      resourceId: "file_1",
      userId: "user_1",
      name: "Ada",
      canEdit: true,
    });
    expect(claims!.exp).toBeGreaterThan(Date.now());
  });

  it("mints and verifies siteprompt claims", () => {
    const token = mintCollabToken(
      {
        kind: "siteprompt",
        resourceId: "site_1",
        userId: "user_1",
        name: "Ada",
        canEdit: false,
      },
      secret,
    );
    expect(verifyCollabToken(token, secret)).toMatchObject({
      kind: "siteprompt",
      resourceId: "site_1",
      canEdit: false,
    });
  });

  it("rejects tampered or wrong-secret tokens", () => {
    const token = mintCollabToken(
      {
        kind: "codefile",
        resourceId: "file_1",
        userId: "user_1",
        name: "Ada",
        canEdit: false,
      },
      secret,
    );
    expect(verifyCollabToken(token + "x", secret)).toBeNull();
    expect(verifyCollabToken(token, "other-secret")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = mintCollabToken(
      {
        kind: "codefile",
        resourceId: "file_1",
        userId: "user_1",
        name: "Ada",
        canEdit: true,
      },
      secret,
      -1,
    );
    expect(verifyCollabToken(token, secret)).toBeNull();
  });

  it("rejects legacy fileId-shaped claims", () => {
    const payload = Buffer.from(
      JSON.stringify({
        fileId: "file_1",
        userId: "user_1",
        name: "Ada",
        canEdit: true,
        exp: Date.now() + 60_000,
      }),
    ).toString("base64url");
    const key = createHash("sha256").update(`foundry-collab:${secret}`).digest();
    const mac = createHmac("sha256", key).update(payload).digest("base64url");
    expect(verifyCollabToken(`${payload}.${mac}`, secret)).toBeNull();
  });
});

describe("awarenessColorForUser", () => {
  it("is stable for the same user", () => {
    expect(awarenessColorForUser("u1")).toBe(awarenessColorForUser("u1"));
    expect(awarenessColorForUser("u1")).not.toBe(awarenessColorForUser("u2"));
  });
});
