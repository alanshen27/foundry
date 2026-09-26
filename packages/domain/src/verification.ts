/** Completed results and skip decisions apply only to the source that was checked. */
export const VERIFICATION_RERUN_STATUSES = ["PASS", "WARNING", "SIMULATED", "SKIPPED"] as const;

/** Shared by HTTP and collaboration writers; retain evidence as historical context. */
export function verificationResetForEngineeringChange() {
  return {
    status: "PENDING" as const,
    waived: false,
    waiverReason: null,
    approvedById: null,
    approvedAt: null,
  };
}
