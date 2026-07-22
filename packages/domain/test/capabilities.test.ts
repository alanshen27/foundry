import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  CAPABILITIES,
  defaultCapabilitiesForRole,
  hasCapability,
} from "../src/capabilities";

describe("defaultCapabilitiesForRole", () => {
  it("gives owners and admins every capability", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(defaultCapabilitiesForRole(role)).toEqual(CAPABILITIES);
    }
  });

  it("restricts members from approvals, releases, publishing, and commerce", () => {
    const member = defaultCapabilitiesForRole("MEMBER");
    for (const denied of [
      "project.manage",
      "verification.approve",
      "release.create",
      "release.approve",
      "site.publish",
      "commerce.manage",
      "github.connect",
    ] as const) {
      expect(member).not.toContain(denied);
    }
    expect(member).toContain("project.read");
    expect(member).toContain("electronics.edit");
  });

  it("scopes guests to read only", () => {
    expect(defaultCapabilitiesForRole("GUEST")).toEqual(["project.read"]);
  });
});

describe("hasCapability", () => {
  it("honors explicit grants beyond role defaults", () => {
    expect(hasCapability("GUEST", [], "research.edit")).toBe(false);
    expect(hasCapability("GUEST", ["research.edit"], "research.edit")).toBe(true);
  });

  it("never removes role defaults", () => {
    expect(hasCapability("OWNER", [], "release.approve")).toBe(true);
  });
});

describe("assignableRoles", () => {
  it("only owners can mint admins", () => {
    expect(assignableRoles("OWNER")).toContain("ADMIN");
    expect(assignableRoles("ADMIN")).not.toContain("ADMIN");
  });

  it("members and guests cannot invite", () => {
    expect(assignableRoles("MEMBER")).toHaveLength(0);
    expect(assignableRoles("GUEST")).toHaveLength(0);
  });
});
