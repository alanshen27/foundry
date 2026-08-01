/**
 * Grouping helpers for validation checks shown inside the Engineer workbench.
 *
 * A check may carry a `targetPath` — the repo-relative file/part it is about
 * (e.g. `parts/bracket.kcl`); null means the check is project-wide.
 */

/** Statuses that block Verify approval unless the check is waived. */
export const BLOCKING_CHECK_STATUSES = new Set(["PENDING", "FAIL", "ERROR"]);

export type GroupableCheck = {
  targetPath: string | null;
  status: string;
  waived: boolean;
};

export type CheckGroup<T extends GroupableCheck> = {
  /** Null for the project-wide bucket. */
  target: string | null;
  checks: T[];
  blocking: number;
};

/**
 * Group checks by target path: targeted groups alphabetically, the
 * project-wide bucket last. Waived checks never count as blocking.
 */
export function groupChecksByTarget<T extends GroupableCheck>(checks: T[]): CheckGroup<T>[] {
  const byTarget = new Map<string | null, T[]>();
  for (const check of checks) {
    const target = check.targetPath?.trim() || null;
    const bucket = byTarget.get(target);
    if (bucket) bucket.push(check);
    else byTarget.set(target, [check]);
  }

  const groups = [...byTarget.entries()].map(([target, grouped]) => ({
    target,
    checks: grouped,
    blocking: grouped.filter((c) => !c.waived && BLOCKING_CHECK_STATUSES.has(c.status)).length,
  }));

  return groups.sort((a, b) => {
    if (a.target === null) return 1;
    if (b.target === null) return -1;
    return a.target.localeCompare(b.target);
  });
}
