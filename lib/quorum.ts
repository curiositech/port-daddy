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
 * pattern-match semantics. Actor credentials are verified in the same
 * canonical harbor where proposal and vote evidence is persisted. Using
 * tuples for proposals/votes means:
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

interface TupleRowMin {
  id: number;
  harbor: string | null;
  fields: unknown[];
  writtenBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

interface TupleSpaceMin {
  out(
    fields: unknown[],
    options?: { harbor?: string; writtenBy?: string; ttlMs?: number },
  ): { id: number };
  rd(
    pattern: unknown[],
    options?: { harbor?: string; limit?: number },
  ): TupleRowMin[];
  poll(
    pattern: unknown[],
    options?: { harbor?: string; afterId?: number; limit?: number },
  ): { tuple: TupleRowMin | null; lastId: number };
}

/** The generic tuple APIs must never mint or delete daemon-authority facts. */
export const QUORUM_AUTHORITY_TUPLE_PREFIX = 'quorum:';

export function isQuorumAuthorityTuple(fields: unknown[]): boolean {
  return typeof fields[0] === 'string'
    && fields[0].startsWith(QUORUM_AUTHORITY_TUPLE_PREFIX);
}

/**
 * A destructive generic pattern is unsafe when its first field can select a
 * reserved quorum row. Empty, `null`, and `*` patterns all match every key.
 */
export function canMutateQuorumAuthorityTuple(pattern: unknown[]): boolean {
  if (pattern.length === 0 || pattern[0] === null || pattern[0] === '*') return true;
  return typeof pattern[0] === 'string'
    && pattern[0].startsWith(QUORUM_AUTHORITY_TUPLE_PREFIX);
}

export type QuorumStance = 'yes' | 'no' | 'abstain';

export interface QuorumProposal {
  /** Durable tuple-space row that witnesses this proposal. */
  tupleId: number;
  /** Daemon-authority schema. Rows without this stamp are read-only legacy evidence. */
  authorityVersion: 1;
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
  /** Daemon-authority schema. Unstamped legacy rows never affect the tally. */
  authorityVersion: 1;
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
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PASSED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function canonicalScope(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`quorum.propose: ${field} must be a non-empty string if provided`);
  }
  return value.trim();
}

function hasCurrentProposalAuthority(proposal: Partial<QuorumProposal>): proposal is QuorumProposal {
  return proposal.authorityVersion === 1
    && typeof proposal.harbor === 'string'
    && proposal.harbor.length > 0
    && proposal.harbor === proposal.harbor.trim()
    && typeof proposal.authorityHarbor === 'string'
    && proposal.authorityHarbor.length > 0
    && proposal.authorityHarbor === proposal.authorityHarbor.trim()
    && proposal.authorityHarbor === proposal.harbor;
}

function decodeProposalRow(row: TupleRowMin): QuorumProposal | null {
  const data = row.fields[2];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const proposal = data as Partial<QuorumProposal>;
  const durableProposalId = row.fields[1];
  if (
    typeof durableProposalId !== 'string'
    || proposal.proposalId !== durableProposalId
    || typeof proposal.proposedBy !== 'string'
    || !proposal.proposedBy
    || row.writtenBy !== proposal.proposedBy
    || typeof proposal.harbor !== 'string'
    || !proposal.harbor
    || proposal.harbor !== proposal.harbor.trim()
    || row.harbor !== proposal.harbor
    || typeof proposal.role !== 'string'
    || !proposal.role
    || typeof proposal.reason !== 'string'
    || !proposal.reason
    || typeof proposal.threshold !== 'number'
    || !Number.isFinite(proposal.threshold)
    || proposal.threshold < 1
    || typeof proposal.autoSpawn !== 'boolean'
    || typeof proposal.createdAt !== 'number'
    || !Number.isFinite(proposal.createdAt)
    || (proposal.expiresAt !== null && (
      typeof proposal.expiresAt !== 'number'
      || !Number.isFinite(proposal.expiresAt)
    ))
  ) {
    return null;
  }
  return { ...proposal, tupleId: row.id } as QuorumProposal;
}

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
    const harbor = canonicalScope(input.harbor, DEFAULT_HARBOR, 'harbor');
    const authorityHarbor = canonicalScope(
      input.authorityHarbor,
      harbor,
      'authorityHarbor',
    );
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const createdAt = now();
    const expiresAt = ttlMs > 0 ? createdAt + ttlMs : null;

    const storedProposal: Omit<QuorumProposal, 'tupleId'> = {
      authorityVersion: 1,
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
    return decodeProposalRow(matches[0]);
  }

  function listProposals(options: { harbor?: string; limit?: number } = {}): QuorumProposal[] {
    const matches = tuples.rd(
      ['quorum:proposal', '*', '*'],
      { harbor: options.harbor, limit: options.limit ?? 50 },
    );
    const proposals: QuorumProposal[] = [];
    for (const row of matches) {
      const proposal = decodeProposalRow(row);
      if (proposal) proposals.push(proposal);
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
    if (!hasCurrentProposalAuthority(proposal)) {
      throw new Error(`quorum.vote: proposal '${input.proposalId}' has no verified actor authority`);
    }
    const t = now();
    if (proposal.expiresAt !== null && t > proposal.expiresAt) {
      throw new Error(`quorum.vote: proposal '${input.proposalId}' has expired`);
    }

    const storedVote: Omit<QuorumVote, 'tupleId'> = {
      authorityVersion: 1,
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
    // Latest vote per voter wins (tuples are append-only; a voter
    // changing their stance writes a new row; we keep the freshest). Walk the
    // exact proposal stream by durable row ID so one actor cannot evict other
    // actors' effective ballots by appending more than a fixed read limit.
    const byVoter = new Map<string, QuorumVote>();
    let afterId = 0;
    while (true) {
      const result = tuples.poll(
        ['quorum:vote', proposalId, '*', '*'],
        { harbor, afterId, limit: 1000 },
      );
      const row = result.tuple;
      if (!row) {
        if (result.lastId <= afterId) break;
        afterId = result.lastId;
        continue;
      }
      afterId = row.id;
      const data = row.fields[3];
      if (!data || typeof data !== 'object') continue;
      const v = { ...(data as Omit<QuorumVote, 'tupleId'>), tupleId: row.id };
      const durableVoterId = row.fields[2];
      if (
        v.authorityVersion !== 1
        || v.proposalId !== proposalId
        || typeof durableVoterId !== 'string'
        || v.voterId !== durableVoterId
        || row.writtenBy !== durableVoterId
        || (v.stance !== 'yes' && v.stance !== 'no' && v.stance !== 'abstain')
        || !Number.isFinite(v.weight)
        || v.weight < 0
        || !Number.isFinite(v.at)
      ) {
        continue;
      }
      const existing = byVoter.get(v.voterId);
      // Tuple IDs are the durable append order. They remain deterministic
      // even when two votes share a millisecond timestamp or an injected
      // clock moves backwards.
      if (!existing || v.tupleId > existing.tupleId) {
        byVoter.set(v.voterId, v);
      }
    }
    const votes = [...byVoter.values()];
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
