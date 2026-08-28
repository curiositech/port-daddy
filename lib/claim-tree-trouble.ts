/**
 * Claim-tree trouble projection.
 *
 * The claim forest is intentionally richer than a red/yellow/green score. This
 * module turns evidence about one potential interaction into an ordered,
 * explainable state. The ordering is the contract: a later state must never
 * hide an earlier uncertainty or safety problem.
 */

export const CLAIM_TREE_TROUBLE_STATE_ORDER = [
  'VERIFY',
  'RESCUE',
  'COORDINATE',
  'INSPECT',
  'RECONCILE',
  'WATCH',
  'PROCEED',
] as const;

export type ClaimTreeTroubleState = (typeof CLAIM_TREE_TROUBLE_STATE_ORDER)[number];

type ClaimTreeTroubleStageState = Exclude<ClaimTreeTroubleState, 'PROCEED'>;

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

export interface ClaimTreeTroubleTransitionRow {
  state: ClaimTreeTroubleStageState;
  advanceTo: ClaimTreeTroubleState;
  advanceWhen: string;
  advanceLabel: string;
  holdLabel: string;
  reason: string;
  action: string;
}

export interface ClaimTreeTroubleTerminalRow {
  state: Extract<ClaimTreeTroubleState, 'PROCEED'>;
  reason: string;
  action: string;
}

export interface ClaimTreeTroubleTransitionTable {
  stages: ClaimTreeTroubleTransitionRow[];
  terminal: ClaimTreeTroubleTerminalRow;
}

export interface ClaimTreeTroubleStateMachineEdge {
  from: '[*]' | ClaimTreeTroubleState;
  to: ClaimTreeTroubleState;
  label: string;
}

export interface ClaimTreeTroubleStateMachineValidation {
  ok: boolean;
  expectedEdges: ClaimTreeTroubleStateMachineEdge[];
  actualEdges: ClaimTreeTroubleStateMachineEdge[];
  missingEdges: ClaimTreeTroubleStateMachineEdge[];
  extraEdges: ClaimTreeTroubleStateMachineEdge[];
}

interface ClaimTreeTroubleTransitionRule extends ClaimTreeTroubleTransitionRow {
  matches: (evidence: ClaimTreeTroubleEvidence) => boolean;
}

const CLAIM_TREE_TROUBLE_STATE_SET = new Set<ClaimTreeTroubleState>(CLAIM_TREE_TROUBLE_STATE_ORDER);

const CLAIM_TREE_TROUBLE_RULES: readonly ClaimTreeTroubleTransitionRule[] = [
  {
    state: 'VERIFY',
    advanceTo: 'RESCUE',
    advanceWhen: 'sourceComplete && worldComparable',
    advanceLabel: 'provenance/world confirmed',
    holdLabel: 'incomplete or cross-world evidence',
    reason: 'claim provenance is incomplete or names different worlds',
    action: 'refresh the claim tree and compare the intended merge world before editing',
    matches: (evidence) => !evidence.sourceComplete || !evidence.worldComparable,
  },
  {
    state: 'RESCUE',
    advanceTo: 'COORDINATE',
    advanceWhen: 'counterpartActive',
    advanceLabel: 'counterpart live',
    holdLabel: 'counterpart inactive',
    reason: 'the counterpart claim is no longer backed by a live session',
    action: 'inspect salvage or handoff evidence before reclaiming the surface',
    matches: (evidence) => !evidence.counterpartActive,
  },
  {
    state: 'COORDINATE',
    advanceTo: 'INSPECT',
    advanceWhen: '!directOverlap',
    advanceLabel: 'no direct overlap',
    holdLabel: 'overlap remains',
    reason: 'two live sessions claim the same declared surface',
    action: 'open a parley, hand off, or split the surface before proceeding',
    matches: (evidence) => evidence.directOverlap,
  },
  {
    state: 'INSPECT',
    advanceTo: 'RECONCILE',
    advanceWhen: 'precisionKnown',
    advanceLabel: 'precision known',
    holdLabel: 'imprecise claim',
    reason: 'the shared surface lacks symbol or complete range precision',
    action: 'resolve symbols or ranges, then re-scan before editing',
    matches: (evidence) => !evidence.precisionKnown,
  },
  {
    state: 'RECONCILE',
    advanceTo: 'WATCH',
    advanceWhen: 'claimFresh',
    advanceLabel: 'claim fresh',
    holdLabel: 'stale claim',
    reason: 'the claim tree is older than its freshness boundary',
    action: 'refresh provenance and reconcile the claim with current work',
    matches: (evidence) => !evidence.claimFresh,
  },
  {
    state: 'WATCH',
    advanceTo: 'PROCEED',
    advanceWhen: '!dependencyReachable',
    advanceLabel: 'no dependency concern',
    holdLabel: 'dependency remains',
    reason: 'a dependency connects otherwise separate claimed surfaces',
    action: 'proceed with a narrow change and watch the dependent surface',
    matches: (evidence) => evidence.dependencyReachable,
  },
];

const CLAIM_TREE_TROUBLE_TERMINAL: ClaimTreeTroubleTerminalRow = {
  state: 'PROCEED',
  reason: 'no trouble is visible in the supplied evidence',
  action: 'proceed, keeping the claim current',
};

function isClaimTreeTroubleState(value: string): value is ClaimTreeTroubleState {
  return CLAIM_TREE_TROUBLE_STATE_SET.has(value as ClaimTreeTroubleState);
}

function claimTreeTroubleEdgeKey(edge: ClaimTreeTroubleStateMachineEdge): string {
  return `${edge.from}->${edge.to}:${edge.label}`;
}

function formatClaimTreeTroubleEdge(edge: ClaimTreeTroubleStateMachineEdge): string {
  return edge.label.length > 0 ? `  ${edge.from} --> ${edge.to}: ${edge.label}` : `  ${edge.from} --> ${edge.to}`;
}

function parseClaimTreeTroubleStateMachineMermaid(mermaid: string): ClaimTreeTroubleStateMachineEdge[] {
  const edges: ClaimTreeTroubleStateMachineEdge[] = [];
  for (const line of mermaid.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed === 'stateDiagram-v2') continue;
    const match = trimmed.match(/^(\[\*\]|[A-Z]+)\s*-->\s*([A-Z]+)(?::\s*(.*))?$/);
    if (!match) {
      throw new Error(`invalid claim-tree Mermaid line: ${line}`);
    }
    const from = match[1] === '[*]' ? '[*]' : match[1];
    const to = match[2];
    if (from !== '[*]' && !isClaimTreeTroubleState(from)) {
      throw new Error(`invalid claim-tree Mermaid state: ${from}`);
    }
    if (!isClaimTreeTroubleState(to)) {
      throw new Error(`invalid claim-tree Mermaid state: ${to}`);
    }
    edges.push({
      from,
      label: match[3] ?? '',
      to,
    });
  }
  return edges;
}

/** Plain-data projection of the ordered classifier contract. */
export function claimTreeTroubleTransitionTable(): ClaimTreeTroubleTransitionTable {
  return {
    stages: CLAIM_TREE_TROUBLE_RULES.map(({ matches: _matches, state, advanceTo, advanceWhen, advanceLabel, holdLabel, reason, action }) => ({
      action,
      advanceLabel,
      advanceTo,
      advanceWhen,
      holdLabel,
      reason,
      state,
    })),
    terminal: {
      action: CLAIM_TREE_TROUBLE_TERMINAL.action,
      reason: CLAIM_TREE_TROUBLE_TERMINAL.reason,
      state: CLAIM_TREE_TROUBLE_TERMINAL.state,
    },
  };
}

/**
 * Ordered finite-state classifier for a claim-tree interaction.
 *
 * This is deliberately a total function. "PROCEED" means the supplied
 * evidence showed no earlier concern; it never means the world is safe or
 * that claims are truthful.
 */
export function classifyClaimTreeTrouble(evidence: ClaimTreeTroubleEvidence): ClaimTreeTroubleFinding {
  for (const rule of CLAIM_TREE_TROUBLE_RULES) {
    if (rule.matches(evidence)) {
      return {
        state: rule.state,
        reason: rule.reason,
        action: rule.action,
      };
    }
  }
  return {
    state: CLAIM_TREE_TROUBLE_TERMINAL.state,
    reason: CLAIM_TREE_TROUBLE_TERMINAL.reason,
    action: CLAIM_TREE_TROUBLE_TERMINAL.action,
  };
}

/** Mermaid is the portable agent-facing projection; it is data, not a screenshot. */
export function claimTreeTroubleStateMachineEdges(): ClaimTreeTroubleStateMachineEdge[] {
  const table = claimTreeTroubleTransitionTable();
  if (table.stages.length === 0) {
    return [];
  }
  const edges: ClaimTreeTroubleStateMachineEdge[] = [
    { from: '[*]', label: '', to: table.stages[0].state },
  ];
  for (const stage of table.stages) {
    edges.push({ from: stage.state, label: stage.advanceLabel, to: stage.advanceTo });
  }
  for (const stage of table.stages) {
    edges.push({ from: stage.state, label: stage.holdLabel, to: stage.state });
  }
  return edges;
}

export function claimTreeTroubleStateMachineMermaid(): string {
  return ['stateDiagram-v2', ...claimTreeTroubleStateMachineEdges().map(formatClaimTreeTroubleEdge)].join('\n');
}

/** Compare the Mermaid graph to the machine-readable transition table. */
export function validateClaimTreeTroubleStateMachineMermaid(
  mermaid: string = claimTreeTroubleStateMachineMermaid(),
): ClaimTreeTroubleStateMachineValidation {
  const expectedEdges = claimTreeTroubleStateMachineEdges();
  const actualEdges = parseClaimTreeTroubleStateMachineMermaid(mermaid);
  const expectedKeys = new Set(expectedEdges.map(claimTreeTroubleEdgeKey));
  const actualKeys = new Set(actualEdges.map(claimTreeTroubleEdgeKey));
  const missingEdges = expectedEdges.filter((edge) => !actualKeys.has(claimTreeTroubleEdgeKey(edge)));
  const extraEdges = actualEdges.filter((edge) => !expectedKeys.has(claimTreeTroubleEdgeKey(edge)));
  return {
    actualEdges,
    expectedEdges,
    extraEdges,
    missingEdges,
    ok: missingEdges.length === 0 && extraEdges.length === 0,
  };
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
