import { describe, expect, it } from "vitest";
import { awarenessColorForUser } from "../src/awareness";
import { codeFileRoom, parseCodeFileRoom } from "../src/rooms";
import { mintCollabToken, verifyCollabToken } from "../src/token";

describe("codeFileRoom", () => {
  it("round-trips file ids", () => {
    expect(codeFileRoom("abc")).toBe("codefile:abc");
    expect(parseCodeFileRoom("codefile:abc")).toBe("abc");
    expect(parseCodeFileRoom("other:abc")).toBeNull();
    expect(parseCodeFileRoom("codefile:")).toBeNull();
  });
});

describe("collab token", () => {
  const secret = "test-secret-material";

  it("mints and verifies claims", () => {
    const token = mintCollabToken(
      {
        fileId: "file_1",
        userId: "user_1",
        name: "Ada",
        avatarUrl: null,
        canEdit: true,
      },
      secret,
    );
    const claims = verifyCollabToken(token, secret);
    expect(claims).toMatchObject({
      fileId: "file_1",
      userId: "user_1",
      name: "Ada",
      canEdit: true,
    });
    expect(claims!.exp).toBeGreaterThan(Date.now());
  });

  it("rejects tampered or wrong-secret tokens", () => {
    const token = mintCollabToken(
      {
        fileId: "file_1",
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
        fileId: "file_1",
        userId: "user_1",
        name: "Ada",
        canEdit: true,
      },
      secret,
      -1,
    );
    expect(verifyCollabToken(token, secret)).toBeNull();
  });
});

describe("awarenessColorForUser", () => {
  it("is stable for the same user", () => {
    expect(awarenessColorForUser("u1")).toBe(awarenessColorForUser("u1"));
    expect(awarenessColorForUser("u1")).not.toBe(awarenessColorForUser("u2"));
  });
});
