/**
 * Force-zoom gating for the NeedsYou hero (legibility F3).
 *
 * An operator must not be able to acknowledge/dismiss an IRREVERSIBLE or P0
 * attention item without first EXPANDING it to read the action/command + meta.
 * Stakes-proportional friction: there is no approve-without-seeing at scale.
 *
 * Lives in `lib/` (not the component file) so the predicate is independently
 * importable/testable and the component module stays component-only.
 */
import type { NeedsYouCode, NeedsYouItem } from '../types';

/**
 * Codes whose `action` is irreversible / high-stakes once enacted: shipping a
 * dispatch to a fleet, overriding a coordination-guard violation, or blowing
 * through a budget ceiling. Dismissing these blind is the F3 legibility gap.
 * Mirrors the priority-0/1/2 band of the operator-state contract
 * (docs/design/operator-state-contract.md § needsYou Ranking).
 */
export const IRREVERSIBLE_CODES: ReadonlySet<NeedsYouCode> = new Set<NeedsYouCode>([
  'dispatch_review',
  'guard_violation',
  'budget_ceiling',
]);

/**
 * A row is force-zoom-gated when it is P0 (the engine's most-urgent band) OR
 * its code is in the irreversible set, regardless of the numeric priority the
 * engine happened to assign. Gated rows cannot be dismissed until expanded.
 */
export function isForceZoomGated(item: Pick<NeedsYouItem, 'priority' | 'code'>): boolean {
  return item.priority === 0 || IRREVERSIBLE_CODES.has(item.code);
}
