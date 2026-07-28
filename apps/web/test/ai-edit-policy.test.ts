import { describe, expect, it } from "vitest";
import { holdsAiEditLock } from "@/lib/ai-edit-policy";

describe("AI edit lock policy", () => {
  it.each(["PENDING", "RUNNING"])("locks the workspace for %s runs", (status) => {
    expect(holdsAiEditLock(status)).toBe(true);
  });

  it.each(["DONE", "ERROR", "CANCELLED"])(
    "releases the workspace for terminal %s runs",
    (status) => {
      expect(holdsAiEditLock(status)).toBe(false);
    },
  );
});
