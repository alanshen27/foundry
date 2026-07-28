import { z } from "zod";

/**
 * Domain event envelope (PRD 22.3). Phase 0 emits the workspace/project
 * lifecycle events; later phases add engineering and validation events.
 */
export const DOMAIN_EVENT_TYPES = [
  "WorkspaceCreated",
  "WorkspaceMemberAdded",
  "WorkspaceMemberInvited",
  "ProjectCreated",
  "ProjectFolderCreated",
  "ProjectFolderRenamed",
  "ProjectFolderMoved",
  "ProjectFolderRecolored",
  "ProjectFolderDeleted",
  "ProjectMovedToFolder",
  "ProjectThumbnailRendered",
  "ProjectBranchCreated",
  "StageOpened",
  "StageStatusChanged",
  "ArtifactUploadRequested",
  // Ideate
  "BriefUpdated",
  "RequirementCreated",
  "RequirementUpdated",
  "RequirementDeleted",
  // Engineer
  "ComponentCreated",
  "ComponentUpdated",
  "ComponentDeleted",
  "RepoLinkCreated",
  "RepoLinkDeleted",
  "DesignDocUpdated",
  // AI copilot
  "ChatChannelCreated",
  "ChatChannelDeleted",
  "ChatChannelCategoryCreated",
  "ChatChannelCategoryDeleted",
  // Verify
  "ValidationCheckCreated",
  "ValidationCheckUpdated",
  "ValidationCheckDeleted",
  "ValidationCheckWaived",
  "VerificationApproved",
  // Launch
  "ReleaseCreated",
  "SiteCreated",
  "SiteRevised",
  "SitePublished",
  // Commerce
  "CheckoutConfigured",
  "ListingCreated",
  "ListingPublished",
  "ListingArchived",
  "CheckoutStarted",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const domainEventSchema = z.object({
  eventId: z.string(),
  type: z.enum(DOMAIN_EVENT_TYPES),
  schemaVersion: z.number().int().positive(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  branchId: z.string().nullable(),
  actorId: z.string(),
  actorType: z.enum(["USER", "AGENT", "SYSTEM"]),
  timestamp: z.string().datetime(),
  causationId: z.string().nullable(),
  correlationId: z.string().nullable(),
  payload: z.record(z.unknown()),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;

export type NewDomainEvent = Omit<DomainEvent, "eventId" | "timestamp" | "schemaVersion"> &
  Partial<Pick<DomainEvent, "schemaVersion">>;
