export type SwarmTopology =
  | 'single_agent'
  | 'single_agent_with_inspector'
  | 'read_only_council'
  | 'single_writer_council'
  | 'lab_only_swarm';

export type ReasoningShape = 'breadth_first' | 'depth_first' | 'mixed';
export type WriteContention = 'none' | 'low' | 'medium' | 'high';
export type SubtaskIndependence = 'none' | 'partial' | 'high';

export interface SwarmFitInput {
  reasoningShape: ReasoningShape;
  /** Estimated single-agent success rate, 0..1. Above ~0.45, coordination often has negative returns. */
  singleAgentBaseline?: number;
  fitsInOneContext: boolean;
  taskValueMultiplier: number;
  estimatedTokenMultiplier: number;
  subtaskIndependence: SubtaskIndependence;
  writeContention: WriteContention;
  verificationAvailable: boolean;
  heterogeneousAgents: boolean;
  maxConcurrentWriters?: number;
}

export interface SwarmFitDecision {
  topology: SwarmTopology;
  allowed: boolean;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
  requirements: string[];
  risks: string[];
}

export type CouncilStatus = 'succeeded' | 'failed' | 'timed_out';

export interface CouncilResult {
  role: string;
  status: CouncilStatus;
  vote?: string;
  confidence?: number;
  summary?: string;
}

export interface CouncilTallyOptions {
  quorum: number;
  requireUnanimity?: boolean;
}

export interface CouncilTally {
  total: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  quorumMet: boolean;
  consensus: 'unanimous' | 'majority' | 'plurality' | 'blocked' | 'none';
  leadingVote: string | null;
  voteCounts: Record<string, number>;
  dissenters: string[];
  missingRoles: string[];
  risks: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function confidenceFrom(reasons: string[], risks: string[]): SwarmFitDecision['confidence'] {
  if (risks.length >= 3) return 'low';
  if (reasons.length >= 3 && risks.length <= 1) return 'high';
  return 'medium';
}

export function evaluateSwarmFit(input: SwarmFitInput): SwarmFitDecision {
  const reasons: string[] = [];
  const requirements: string[] = [];
  const risks: string[] = [];
  const baseline = input.singleAgentBaseline === undefined ? null : clamp01(input.singleAgentBaseline);
  const maxConcurrentWriters = input.maxConcurrentWriters ?? 1;

  if (baseline !== null && baseline > 0.45) {
    risks.push('single-agent baseline is above the empirical multi-agent breakeven threshold');
  }
  if (input.reasoningShape === 'depth_first') {
    risks.push('strict sequential reasoning pays a handoff tax');
  } else if (input.reasoningShape === 'breadth_first') {
    reasons.push('breadth-first work can be explored in isolated contexts');
  }
  if (!input.fitsInOneContext) {
    reasons.push('task exceeds one context window');
  }
  if (input.taskValueMultiplier >= 10) {
    reasons.push('task value can absorb coordination overhead');
  } else {
    risks.push('task value is too low for expensive coordination');
  }
  if (input.estimatedTokenMultiplier > input.taskValueMultiplier) {
    risks.push('estimated token multiplier exceeds task value multiplier');
  }
  if (input.subtaskIndependence === 'high') {
    reasons.push('subtasks are independently explorable');
  } else if (input.subtaskIndependence === 'partial') {
    requirements.push('define shared contracts before parallel work');
  } else {
    risks.push('subtasks are not independently decomposable');
  }
  if (input.verificationAvailable) {
    requirements.push('run an inspector outside the worker context before accepting output');
  } else {
    risks.push('no independent verification path is available');
  }
  if (input.heterogeneousAgents) {
    reasons.push('agent heterogeneity can reduce correlated errors');
  } else {
    risks.push('homogeneous agents are more likely to reinforce the same mistake');
  }
  if (maxConcurrentWriters > 1) {
    risks.push('parallel write authority is unsafe outside a lab');
    requirements.push('collapse to one writer before publication');
  }

  if (
    input.reasoningShape === 'depth_first'
    || input.subtaskIndependence === 'none'
    || (baseline !== null && baseline > 0.45 && input.fitsInOneContext)
    || input.taskValueMultiplier < 10
  ) {
    return {
      topology: input.verificationAvailable ? 'single_agent_with_inspector' : 'single_agent',
      allowed: true,
      confidence: confidenceFrom(reasons, risks),
      reasons,
      requirements,
      risks,
    };
  }

  if (maxConcurrentWriters > 1) {
    return {
      topology: 'lab_only_swarm',
      allowed: false,
      confidence: 'medium',
      reasons,
      requirements,
      risks,
    };
  }

  if (input.writeContention === 'medium' || input.writeContention === 'high' || input.subtaskIndependence === 'partial') {
    requirements.push('keep writes single-threaded while distributing read-only intelligence');
    return {
      topology: 'single_writer_council',
      allowed: true,
      confidence: confidenceFrom(reasons, risks),
      reasons,
      requirements,
      risks,
    };
  }

  return {
    topology: 'read_only_council',
    allowed: true,
    confidence: confidenceFrom(reasons, risks),
    reasons,
    requirements,
    risks,
  };
}

export function tallyCouncilVotes(results: CouncilResult[], options: CouncilTallyOptions): CouncilTally {
  if (!Number.isInteger(options.quorum) || options.quorum < 1) {
    throw new Error('tallyCouncilVotes: quorum must be a positive integer');
  }

  const voteCounts: Record<string, number> = {};
  const missingRoles: string[] = [];
  const completedVotes: CouncilResult[] = [];
  let failed = 0;
  let timedOut = 0;

  for (const result of results) {
    if (!result.role || typeof result.role !== 'string') {
      throw new Error('tallyCouncilVotes: every result needs a role');
    }
    if (result.status === 'failed') {
      failed += 1;
      missingRoles.push(result.role);
      continue;
    }
    if (result.status === 'timed_out') {
      timedOut += 1;
      missingRoles.push(result.role);
      continue;
    }
    if (!result.vote) {
      missingRoles.push(result.role);
      continue;
    }
    completedVotes.push(result);
    voteCounts[result.vote] = (voteCounts[result.vote] ?? 0) + 1;
  }

  const succeeded = completedVotes.length;
  const quorumMet = succeeded >= options.quorum;
  const risks: string[] = [];
  if (!quorumMet) risks.push('quorum not met');
  if (failed + timedOut > 0) risks.push('partial council failure must remain visible');

  let leadingVote: string | null = null;
  let leadingCount = 0;
  let tied = false;
  for (const [vote, count] of Object.entries(voteCounts)) {
    if (count > leadingCount) {
      leadingVote = vote;
      leadingCount = count;
      tied = false;
    } else if (count === leadingCount) {
      tied = true;
    }
  }

  if (!quorumMet || !leadingVote) {
    return {
      total: results.length,
      succeeded,
      failed,
      timedOut,
      quorumMet,
      consensus: 'none',
      leadingVote: null,
      voteCounts,
      dissenters: [],
      missingRoles,
      risks,
    };
  }

  const dissenters = completedVotes
    .filter((result) => result.vote !== leadingVote)
    .map((result) => result.role);
  const unanimous = dissenters.length === 0;
  const majority = leadingCount > succeeded / 2;
  const consensus = options.requireUnanimity && !unanimous
    ? 'blocked'
    : unanimous
      ? 'unanimous'
      : tied
        ? 'blocked'
        : majority
          ? 'majority'
          : 'plurality';

  if (consensus === 'blocked') {
    risks.push(options.requireUnanimity ? 'unanimity required but dissent exists' : 'vote is tied');
  }

  return {
    total: results.length,
    succeeded,
    failed,
    timedOut,
    quorumMet,
    consensus,
    leadingVote,
    voteCounts,
    dissenters,
    missingRoles,
    risks,
  };
}
