export const CAPABILITIES = [
  "project.read",
  "project.manage",
  "research.edit",
  "ideate.edit",
  "electronics.edit",
  "mechanical.edit",
  "software.edit",
  "verification.run",
  "verification.approve",
  "release.create",
  "release.approve",
  "agent.invoke",
  "agent.apply",
  "github.connect",
  "site.edit",
  "site.publish",
  "commerce.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES;

const MEMBER_CAPABILITIES: readonly Capability[] = [
  "project.read",
  "research.edit",
  "ideate.edit",
  "electronics.edit",
  "mechanical.edit",
  "software.edit",
  "verification.run",
  "agent.invoke",
  "agent.apply",
  "site.edit",
];

const GUEST_CAPABILITIES: readonly Capability[] = ["project.read"];

/**
 * Default capability set derived from a workspace role. Explicit
 * CapabilityGrant rows can extend (never reduce) a role's defaults;
 * PRD 7.2 requires capability-based checks, not role checks.
 */
export function defaultCapabilitiesForRole(role: WorkspaceRole): readonly Capability[] {
  switch (role) {
    case "OWNER":
    case "ADMIN":
      return ALL_CAPABILITIES;
    case "MEMBER":
      return MEMBER_CAPABILITIES;
    case "GUEST":
      return GUEST_CAPABILITIES;
  }
}

export function hasCapability(
  role: WorkspaceRole,
  grants: readonly Capability[],
  capability: Capability,
): boolean {
  return defaultCapabilitiesForRole(role).includes(capability) || grants.includes(capability);
}

/** Roles that a given actor role may assign when inviting members. */
export function assignableRoles(actor: WorkspaceRole): readonly WorkspaceRole[] {
  switch (actor) {
    case "OWNER":
      return ["ADMIN", "MEMBER", "GUEST"];
    case "ADMIN":
      return ["MEMBER", "GUEST"];
    default:
      return [];
  }
}
