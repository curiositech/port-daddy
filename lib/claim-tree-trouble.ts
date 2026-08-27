/**
 * Claim-tree trouble projection.
 *
 * The claim forest is intentionally richer than a red/yellow/green score. This
 * module turns evidence about one potential interaction into an ordered,
 * explainable state. The ordering is the contract: a later state must never
 * hide an earlier uncertainty or safety problem.
 */

export type ClaimTreeTroubleState =
  | 'VERIFY'
  | 'RESCUE'
  | 'COORDINATE'
  | 'INSPECT'
  | 'RECONCILE'
  | 'WATCH'
  | 'PROCEED';

export interface ClaimTreeTroubleEvidence {
  /** The source returned enough provenance to identify both claims. */
  sourceComplete: boolean;
  /** Both claims describe the same repo/world, rather than merely the same path spelling. */
  worldComparable: boolean;
  /** The other claimant is still live enough to coordinate with. */
  counterpartActive: boolean;
  /** Claim provenance is current enough to act on without refreshing it. */
  claimFresh: boolean;
  /** The claims collide according to the claim forest's declared-claim rules. */
  directOverlap: boolean;
  /** Both claims identify a symbol or a complete line range. */
  precisionKnown: boolean;
  /** A dependency edge raises blast radius despite no direct collision. */
  dependencyReachable: boolean;
}

export interface ClaimTreeTroubleFinding {
  state: ClaimTreeTroubleState;
  reason: string;
  action: string;
}

/**
 * Ordered finite-state classifier for a claim-tree interaction.
 *
 * This is deliberately a total function. "PROCEED" means the supplied
 * evidence showed no earlier concern; it never means the world is safe or
 * that claims are truthful.
 */
export function classifyClaimTreeTrouble(evidence: ClaimTreeTroubleEvidence): ClaimTreeTroubleFinding {
  if (!evidence.sourceComplete || !evidence.worldComparable) {
    return {
      state: 'VERIFY',
      reason: 'claim provenance is incomplete or names different worlds',
      action: 'refresh the claim tree and compare the intended merge world before editing',
    };
  }
  if (!evidence.counterpartActive) {
    return {
      state: 'RESCUE',
      reason: 'the counterpart claim is no longer backed by a live session',
      action: 'inspect salvage or handoff evidence before reclaiming the surface',
    };
  }
  if (evidence.directOverlap) {
    return {
      state: 'COORDINATE',
      reason: 'two live sessions claim the same declared surface',
      action: 'open a parley, hand off, or split the surface before proceeding',
    };
  }
  if (!evidence.precisionKnown) {
    return {
      state: 'INSPECT',
      reason: 'the shared surface lacks symbol or complete range precision',
      action: 'resolve symbols or ranges, then re-scan before editing',
    };
  }
  if (!evidence.claimFresh) {
    return {
      state: 'RECONCILE',
      reason: 'the claim tree is older than its freshness boundary',
      action: 'refresh provenance and reconcile the claim with current work',
    };
  }
  if (evidence.dependencyReachable) {
    return {
      state: 'WATCH',
      reason: 'a dependency connects otherwise separate claimed surfaces',
      action: 'proceed with a narrow change and watch the dependent surface',
    };
  }
  return {
    state: 'PROCEED',
    reason: 'no trouble is visible in the supplied evidence',
    action: 'proceed, keeping the claim current',
  };
}

/** Mermaid is the portable agent-facing projection; it is data, not a screenshot. */
export function claimTreeTroubleStateMachineMermaid(): string {
  return [
    'stateDiagram-v2',
    '  [*] --> VERIFY',
    '  VERIFY --> RESCUE: provenance/world confirmed',
    '  RESCUE --> COORDINATE: counterpart live',
    '  COORDINATE --> INSPECT: no direct overlap',
    '  INSPECT --> RECONCILE: precision known',
    '  RECONCILE --> WATCH: claim fresh',
    '  WATCH --> PROCEED: no dependency concern',
    '  VERIFY --> VERIFY: incomplete or cross-world evidence',
    '  RESCUE --> RESCUE: counterpart inactive',
    '  COORDINATE --> COORDINATE: overlap remains',
    '  INSPECT --> INSPECT: imprecise claim',
    '  RECONCILE --> RECONCILE: stale claim',
    '  WATCH --> WATCH: dependency remains',
  ].join('\n');
}

/** A small, bounded ego graph for one delivered suggestion. */
export function renderClaimTreeTroubleMermaid(input: {
  filePath: string;
  selfSessionId: string;
  otherSessionId: string;
  state: ClaimTreeTroubleState;
}): string {
  const safe = (value: string) => value.replace(/["\n\r]/g, '_');
  return [
    'flowchart LR',
    `  YOU["you: ${safe(input.selfSessionId)}"] --> FILE["${safe(input.filePath)}"]`,
    `  OTHER["other: ${safe(input.otherSessionId)}"] --> FILE`,
    `  FILE --> STATE{{"${input.state}"}}`,
  ].join('\n');
}
