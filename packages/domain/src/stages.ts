export const STAGES = ["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_STATUSES = [
  "NOT_STARTED",
  "DRAFT",
  "RUNNING",
  "NEEDS_REVIEW",
  "APPROVED",
  "BLOCKED",
  "STALE",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/**
 * Stage lifecycle graph (PRD 5.x). A stage is opened (NOT_STARTED -> DRAFT),
 * worked on (DRAFT/RUNNING), submitted for review (NEEDS_REVIEW), and gated by
 * an approval (APPROVED). Any stage can be re-opened for edits, blocked, or
 * marked STALE when an upstream dependency changes.
 */
const STAGE_TRANSITIONS: Record<StageStatus, readonly StageStatus[]> = {
  NOT_STARTED: ["DRAFT"],
  DRAFT: ["RUNNING", "NEEDS_REVIEW", "BLOCKED"],
  RUNNING: ["DRAFT", "NEEDS_REVIEW", "BLOCKED"],
  NEEDS_REVIEW: ["APPROVED", "DRAFT", "BLOCKED"],
  APPROVED: ["STALE", "DRAFT"],
  BLOCKED: ["DRAFT"],
  STALE: ["DRAFT", "RUNNING", "NEEDS_REVIEW"],
};

export function canTransitionStage(from: StageStatus, to: StageStatus): boolean {
  if (from === to) return true;
  return STAGE_TRANSITIONS[from].includes(to);
}

export const STAGE_LABELS: Record<Stage, string> = {
  IDEATE: "Ideate",
  ENGINEER: "Engineer",
  VERIFY: "Verify",
  LAUNCH: "Launch",
};
