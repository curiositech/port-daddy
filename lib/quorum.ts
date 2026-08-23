/**
 * Quorum — tuple-backed proposal/vote primitive for swarm decisions.
 *
 * The point: agents notice they need a Promotion Coordinator (or any
 * other declared role), one of them proposes, others vote, and when
 * the threshold is met the daemon can act on the consensus.
 *
 * Phase 1 (this module): the primitive — propose / vote / list. No
 * auto-spawn. The result of a passing quorum is a *fact in the tuple
 * space* that operators or other modules can subscribe to. That keeps
 * this module composable with what already exists.
 *
 * Phase 2 (separate slice): wire the fleet daemon to listen for
 * `quorum:passed` tuples for proposals where `auto_spawn === true` and
 * `role` is in the project's `spawnable_roles:` registry, then run the
 * normal spawn pipeline (telemetry policy, wallet, bond all apply).
 *
 * Storage: tuples are durable, harbor-scoped, and already have
 * pattern-match semantics. Actor credentials have a separate durable
 * authority harbor so a tuple's coordination namespace cannot silently
 * become an identity namespace. Using tuples for proposals/votes means:
 * - subscribers can listen for `['quorum:proposal', '*', '*']` and react
 * - votes are append-only (no editing tuples)
 * - the proposal's authority harbor limits which canonical actors may vote
 * - TTL on proposals gives free expiry semantics
 *
 * Tuple shapes:
 *   ['quorum:proposal', proposalId, {role, reason, threshold,
 *                                    proposedBy, harbor, authorityHarbor,
 *                                    autoSpawn,
 *                                    expiresAt}]
 *   ['quorum:vote',     proposalId, voterId, {stance, weight, at}]
 *   ['quorum:passed',   proposalId, {role, votes, harbor, at}]
 *   ['quorum:expired',  proposalId, {role, votes, harbor, at}]
 *
 * Stance values: 'yes' | 'no' | 'abstain'. Abstain counts toward
 * participation but not toward the yes-threshold — same as how
 * standard governance bodies handle it.
 */

import { randomUUID } from 'node:crypto';

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
  rd(
    pattern: unknown[],
    options?: { harbor?: string; limit?: number },
  ): Array<{ id: number; fields: unknown[]; writtenBy: string | null; createdAt: number; expiresAt: number | null }>;
}

export type QuorumStance = 'yes' | 'no' | 'abstain';

export interface QuorumProposal {
  /** Durable tuple-space row that witnesses this proposal. */
  tupleId: number;
  proposalId: string;
  role: string;
  reason: string;
  /** Yes-votes required for the proposal to pass. Must be >= 1. */
  threshold: number;
  proposedBy: string;
  /** Actor-soul tenant used to authenticate authors and voters. */
  authorityHarbor: string;
  harbor: string;
  /** Whether a passing quorum should trigger an auto-spawn (Phase 2). */
  autoSpawn: boolean;
  expiresAt: number | null;
  createdAt: number;
}

export interface QuorumVote {
  /** Durable tuple-space row that witnesses this vote. */
  tupleId: number;
  proposalId: string;
  voterId: string;
  stance: QuorumStance;
  weight: number;
  at: number;
}

export interface QuorumStatus {
  proposal: QuorumProposal;
  votes: QuorumVote[];
  yesWeight: number;
  noWeight: number;
  abstainWeight: number;
  passed: boolean;
  expired: boolean;
  remainingNeeded: number;
}

export interface ProposeInput {
  role: string;
  reason: string;
  threshold: number;
  proposedBy: string;
  /** Trusted identity scope. HTTP routes derive this after credential proof. */
  authorityHarbor?: string;
  harbor?: string;
  autoSpawn?: boolean;
  ttlMs?: number;
}

export interface VoteInput {
  proposalId: string;
  voterId: string;
  stance: QuorumStance;
  weight?: number;
}

export interface QuorumDeps {
  tuples: TupleSpaceMin;
  /** Optional clock injection for tests. Defaults to Date.now(). */
  now?: () => number;
}

const DEFAULT_HARBOR = 'fleet';
const DEFAULT_AUTHORITY_HARBOR = 'local';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PASSED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createQuorum(deps: QuorumDeps) {
  const { tuples } = deps;
  const now = deps.now ?? (() => Date.now());

  function propose(input: ProposeInput): QuorumProposal {
    if (!input.role || typeof input.role !== 'string') {
      throw new Error('quorum.propose: role is required (string)');
    }
    if (!input.reason || typeof input.reason !== 'string') {
      throw new Error('quorum.propose: reason is required (string)');
    }
    if (!Number.isFinite(input.threshold) || input.threshold < 1) {
      throw new Error('quorum.propose: threshold must be >= 1');
    }
    if (!input.proposedBy || typeof input.proposedBy !== 'string') {
      throw new Error('quorum.propose: proposedBy is required (string)');
    }

    const proposalId = randomUUID();
    const harbor = input.harbor ?? DEFAULT_HARBOR;
    const authorityHarbor = input.authorityHarbor?.trim() || DEFAULT_AUTHORITY_HARBOR;
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const createdAt = now();
    const expiresAt = ttlMs > 0 ? createdAt + ttlMs : null;

    const storedProposal: Omit<QuorumProposal, 'tupleId'> = {
      proposalId,
      role: input.role,
      reason: input.reason,
      threshold: Math.floor(input.threshold),
      proposedBy: input.proposedBy,
      authorityHarbor,
      harbor,
      autoSpawn: input.autoSpawn === true,
      expiresAt,
      createdAt,
    };

    const tuple = tuples.out(['quorum:proposal', proposalId, storedProposal], {
      harbor,
      writtenBy: input.proposedBy,
      ttlMs: ttlMs > 0 ? ttlMs : undefined,
    });

    return { ...storedProposal, tupleId: tuple.id };
  }

  function findProposal(proposalId: string): QuorumProposal | null {
    const matches = tuples.rd(['quorum:proposal', proposalId, '*'], { limit: 1 });
    if (matches.length === 0) return null;
    const row = matches[0];
    const data = row.fields[2] as Omit<QuorumProposal, 'tupleId'> | undefined;
    if (!data || typeof data !== 'object') return null;
    return { ...data, tupleId: row.id };
  }

  function listProposals(options: { harbor?: string; limit?: number } = {}): QuorumProposal[] {
    const matches = tuples.rd(
      ['quorum:proposal', '*', '*'],
      { harbor: options.harbor, limit: options.limit ?? 50 },
    );
    const proposals: QuorumProposal[] = [];
    for (const row of matches) {
      const data = row.fields[2];
      if (data && typeof data === 'object') {
        proposals.push({ ...(data as Omit<QuorumProposal, 'tupleId'>), tupleId: row.id });
      }
    }
    return proposals;
  }

  function vote(input: VoteInput): QuorumVote {
    if (!input.proposalId || typeof input.proposalId !== 'string') {
      throw new Error('quorum.vote: proposalId is required (string)');
    }
    if (!input.voterId || typeof input.voterId !== 'string') {
      throw new Error('quorum.vote: voterId is required (string)');
    }
    if (input.stance !== 'yes' && input.stance !== 'no' && input.stance !== 'abstain') {
      throw new Error('quorum.vote: stance must be yes/no/abstain');
    }
    const weight = input.weight ?? 1;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error('quorum.vote: weight must be >= 0 if provided');
    }

    const proposal = findProposal(input.proposalId);
    if (!proposal) {
      throw new Error(`quorum.vote: no proposal '${input.proposalId}' found`);
    }
    const t = now();
    if (proposal.expiresAt !== null && t > proposal.expiresAt) {
      throw new Error(`quorum.vote: proposal '${input.proposalId}' has expired`);
    }

    const storedVote: Omit<QuorumVote, 'tupleId'> = {
      proposalId: input.proposalId,
      voterId: input.voterId,
      stance: input.stance,
      weight,
      at: t,
    };

    const tuple = tuples.out(
      ['quorum:vote', input.proposalId, input.voterId, storedVote],
      { harbor: proposal.harbor, writtenBy: input.voterId },
    );
    const voteRecord: QuorumVote = { ...storedVote, tupleId: tuple.id };

    // If this vote pushes us over the threshold, write a 'quorum:passed'
    // tuple so subscribers (and Phase 2 auto-spawner) can react without
    // re-tallying. Idempotent: only emit if no prior passed tuple exists
    // for this proposal.
    const status = getStatus(proposal);
    if (status.passed) {
      const alreadyPassed = tuples.rd(
        ['quorum:passed', input.proposalId, '*'],
        { harbor: proposal.harbor, limit: 1 },
      );
      if (alreadyPassed.length === 0) {
        tuples.out(
          ['quorum:passed', input.proposalId, {
            role: proposal.role,
            votes: status.votes.length,
            yesWeight: status.yesWeight,
            harbor: proposal.harbor,
            at: t,
          }],
          { harbor: proposal.harbor, writtenBy: 'quorum', ttlMs: PASSED_TTL_MS },
        );
      }
    }

    return voteRecord;
  }

  function getVotes(proposalId: string, harbor?: string): QuorumVote[] {
    const matches = tuples.rd(['quorum:vote', proposalId, '*', '*'], { harbor, limit: 1000 });
    const votes: QuorumVote[] = [];
    // Latest vote per voter wins (tuples are append-only; a voter
    // changing their stance writes a new row; we keep the freshest).
    const byVoter = new Map<string, QuorumVote>();
    for (const row of matches) {
      const data = row.fields[3];
      if (!data || typeof data !== 'object') continue;
      const v = { ...(data as Omit<QuorumVote, 'tupleId'>), tupleId: row.id };
      const existing = byVoter.get(v.voterId);
      // Tuple IDs are the durable append order. They remain deterministic
      // even when two votes share a millisecond timestamp or an injected
      // clock moves backwards.
      if (!existing || v.tupleId > existing.tupleId) {
        byVoter.set(v.voterId, v);
      }
    }
    for (const v of byVoter.values()) votes.push(v);
    votes.sort((a, b) => a.at - b.at || a.tupleId - b.tupleId);
    return votes;
  }

  function getStatus(proposal: QuorumProposal): QuorumStatus {
    const votes = getVotes(proposal.proposalId, proposal.harbor);
    let yes = 0;
    let no = 0;
    let abstain = 0;
    for (const v of votes) {
      if (v.stance === 'yes') yes += v.weight;
      else if (v.stance === 'no') no += v.weight;
      else abstain += v.weight;
    }
    const passed = yes >= proposal.threshold;
    const expired = proposal.expiresAt !== null && now() > proposal.expiresAt;
    return {
      proposal,
      votes,
      yesWeight: yes,
      noWeight: no,
      abstainWeight: abstain,
      passed,
      expired,
      remainingNeeded: Math.max(0, proposal.threshold - yes),
    };
  }

  function getStatusById(proposalId: string): QuorumStatus | null {
    const proposal = findProposal(proposalId);
    if (!proposal) return null;
    return getStatus(proposal);
  }

  return {
    propose,
    vote,
    listProposals,
    getStatusById,
    getVotes,
  };
}

export type Quorum = ReturnType<typeof createQuorum>;
