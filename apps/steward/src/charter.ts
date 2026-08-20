import type { Charter } from './types.js';

/**
 * The default charter every Steward seat is born with.
 *
 * PHILOSOPHY: the charter is not a prompt — it is the seat's constitution,
 * re-read at every wake and self-audited against (THE_FULL_WHEEL.md §5.2).
 * The defaults below transcribe ADR-0109 and the plan's §2 authority table
 * verbatim rather than paraphrasing them, because the charter is the one
 * place where drift between "what the canon says" and "what the agent
 * believes" must be structurally impossible. Revisions come only from the
 * operator or reviewed PRs; the seat itself can never edit its own charter
 * (that would be widening its own permissions, which the charter forbids).
 */
export const DEFAULT_CHARTER: Omit<Charter, 'version' | 'updatedAt'> = {
  mission:
    'Sole owner of the PR lifecycle for this repo, from open to merged (ADR-0109). ' +
    'Render LAND / NEEDS-WORK / SURFACE verdicts with evidence, land approved work through ' +
    'the merge queue, answer review bots, and keep the merge ledger and deck log complete. ' +
    'Cartographer surfaces; the Steward ships.',
  hardLimits: [
    'Never raise a design question — SURFACE it to the operator instead.',
    'Never widen this seat’s own permissions or edit this charter.',
    'Never land over a real red required check.',
    'Never merge outside the merge queue once one is active.',
    'Never let a wake pass without a deck-log entry, ALL QUIET included.',
  ],
  escalationRules: [
    'A protected-path change lands only after an explicit operator "ship it".',
    'Three landing failures on one PR for three distinct causes trips the clusterfudge freeze.',
    'Contradiction between a standing preference and a live instruction is a SURFACE, never a coin flip.',
    'Evidence divergence (ledger vs daemon-witnessed state) quarantines this seat until reconciled.',
  ],
  updatedBy: 'default (apps/steward scaffold)',
};

/**
 * Materialize the charter a brand-new seat starts from.
 *
 * WHY A FUNCTION AND NOT A CONSTANT: `version` and `updatedAt` are birth
 * facts, not design facts — freezing them into a module constant would stamp
 * every seat with the deploy time of the code rather than the moment the seat
 * actually took office, corrupting the provenance the sanity protocol depends
 * on.
 *
 * @param nowMs - Epoch milliseconds of the seat's first wake.
 * @returns A version-1 charter carrying the canonical defaults.
 */
export function birthCharter(nowMs: number): Charter {
  return { ...DEFAULT_CHARTER, version: 1, updatedAt: nowMs };
}

/**
 * Apply an operator/PR revision to an existing charter.
 *
 * DESIGN: revisions are whole-field replacements with a monotonic version
 * bump — no in-place mutation, no partial merges of individual list entries.
 * The motivation is auditability: each ledgered revision must be readable as
 * "version N said exactly this, authored by X", which patch semantics would
 * blur. Fields the revision omits are carried forward unchanged.
 *
 * @param current - The charter being revised.
 * @param patch - Replacement fields plus the mandatory author attribution.
 * @param nowMs - Epoch milliseconds of the revision.
 * @returns The next charter, version bumped by exactly one.
 */
export function reviseCharter(
  current: Charter,
  patch: Partial<Pick<Charter, 'mission' | 'hardLimits' | 'escalationRules'>> & { updatedBy: string },
  nowMs: number,
): Charter {
  return {
    mission: patch.mission ?? current.mission,
    hardLimits: patch.hardLimits ?? current.hardLimits,
    escalationRules: patch.escalationRules ?? current.escalationRules,
    version: current.version + 1,
    updatedBy: patch.updatedBy,
    updatedAt: nowMs,
  };
}
