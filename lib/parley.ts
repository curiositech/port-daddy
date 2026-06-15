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

export type ParleyStatus = 'SUMMONED' | 'CONVENED' | 'COLLAPSED' | 'ESCALATED' | 'VOIDED';
export type ParleyPerformative = 'propose' | 'critique' | 'revise' | 'agree' | 'refuse' | 'inform';
export type ParleyTrigger = 'operator' | 'claim_overlap' | 'detector' | 'swarm_fit';

export interface ParleyRecord {
  parleyId: string;
  surface: string;
  reason: string;
  parties: string[];
  calledBy: string;
  trigger: ParleyTrigger;
  channel: string;
  status: ParleyStatus;
  harbor: string;
  responseDueAt: number | null;
  roundLimit: number;
  createdAt: number;
}

export interface ParleyTurn {
  parleyId: string;
  party: string;
  performative: ParleyPerformative;
  content: string;
  proposalId: string | null;
  evidenceRefs: string[];
  at: number;
}

export interface ParleyOutcome {
  parleyId: string;
  status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
  decision: string | null;
  reason: string | null;
  resolvedBy: string;
  dissenters: string[];
  at: number;
}

export interface ParleySummary {
  parley: ParleyRecord;
  status: ParleyStatus;
  turns: ParleyTurn[];
  outcome: ParleyOutcome | null;
  respondedParties: string[];
  missingParties: string[];
  expired: boolean;
  risks: string[];
}

export interface CallParleyInput {
  surface: string;
  reason: string;
  parties: string[];
  calledBy: string;
  trigger?: ParleyTrigger;
  harbor?: string;
  ttlMs?: number;
  roundLimit?: number;
}

export interface RespondParleyInput {
  parleyId: string;
  party: string;
  performative: ParleyPerformative;
  content: string;
  proposalId?: string | null;
  evidenceRefs?: string[];
}

export interface ResolveParleyInput {
  parleyId: string;
  status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
  resolvedBy: string;
  decision?: string | null;
  reason?: string | null;
  dissenters?: string[];
}

interface AgentInboxMin {
  send(
    agentId: string,
    content: unknown,
    options?: { from?: string; type?: string; contentType?: 'text' | 'json' | 'binary'; signal?: string },
  ): { success: boolean; error?: string };
}

export interface ParleyDeps {
  tuples: TupleSpaceMin;
  agentInbox?: AgentInboxMin;
  now?: () => number;
}

const DEFAULT_HARBOR = 'fleet';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ROUND_LIMIT = 3;
const OUTCOME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TERMINAL: ReadonlySet<ParleyStatus> = new Set(['COLLAPSED', 'ESCALATED', 'VOIDED']);
const BUDGETED_PERFORMATIVES: ReadonlySet<ParleyPerformative> = new Set(['propose', 'critique', 'revise', 'inform']);

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function isPerformative(value: string): value is ParleyPerformative {
  return value === 'propose'
    || value === 'critique'
    || value === 'revise'
    || value === 'agree'
    || value === 'refuse'
    || value === 'inform';
}

function isTerminal(status: ParleyStatus): boolean {
  return TERMINAL.has(status);
}

export function createParley(deps: ParleyDeps) {
  const { tuples, agentInbox } = deps;
  const now = deps.now ?? (() => Date.now());

  function call(input: CallParleyInput): ParleyRecord {
    const surface = input.surface?.trim();
    if (!surface) throw new Error('parley.call: surface is required');
    const reason = input.reason?.trim();
    if (!reason) throw new Error('parley.call: reason is required');
    const calledBy = input.calledBy?.trim();
    if (!calledBy) throw new Error('parley.call: calledBy is required');
    const parties = uniqueNonEmpty(input.parties ?? []);
    if (parties.length < 2) throw new Error('parley.call: at least two parties are required');
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error('parley.call: ttlMs must be >= 0');
    const roundLimit = input.roundLimit ?? DEFAULT_ROUND_LIMIT;
    if (!Number.isInteger(roundLimit) || roundLimit < 1) throw new Error('parley.call: roundLimit must be >= 1');

    const parleyId = randomUUID();
    const t = now();
    const harbor = input.harbor ?? DEFAULT_HARBOR;
    const parley: ParleyRecord = {
      parleyId,
      surface,
      reason,
      parties,
      calledBy,
      trigger: input.trigger ?? 'operator',
      channel: `parley:${parleyId}`,
      status: 'SUMMONED',
      harbor,
      responseDueAt: ttlMs > 0 ? t + ttlMs : null,
      roundLimit,
      createdAt: t,
    };

    tuples.out(['parley:opened', parleyId, parley], { harbor, writtenBy: calledBy });
    const notificationFailures: string[] = [];
    for (const party of parties) {
      const summons = {
        surface,
        reason,
        channel: parley.channel,
        calledBy,
        responseDueAt: parley.responseDueAt,
        roundLimit: parley.roundLimit,
        at: t,
      };
      tuples.out(['parley:summons', parleyId, party, summons], { harbor, writtenBy: calledBy, ttlMs: ttlMs > 0 ? ttlMs : undefined });
      if (agentInbox) {
        const result = agentInbox.send(party, {
          kind: 'parley_summons',
          parleyId,
          ...summons,
        }, {
          from: calledBy,
          type: 'parley_summons',
          contentType: 'json',
          signal: 'parley_summons',
        });
        if (!result.success) notificationFailures.push(`${party}: ${result.error ?? 'send failed'}`);
      }
    }
    if (notificationFailures.length > 0) {
      throw new Error(`parley.call: failed to notify parties: ${notificationFailures.join('; ')}`);
    }
    return parley;
  }

  function findOpened(parleyId: string): ParleyRecord | null {
    const rows = tuples.rd(['parley:opened', parleyId, '*'], { limit: 1 });
    const data = rows[0]?.fields[2];
    return data && typeof data === 'object' ? data as ParleyRecord : null;
  }

  function getTurns(parleyId: string, harbor?: string): ParleyTurn[] {
    const rows = tuples.rd(['parley:turn', parleyId, '*', '*'], { harbor, limit: 1000 });
    return rows
      .map((row) => row.fields[3])
      .filter((data): data is ParleyTurn => Boolean(data && typeof data === 'object'))
      .sort((a, b) => a.at - b.at);
  }

  function getOutcome(parleyId: string, harbor?: string): ParleyOutcome | null {
    const rows = tuples.rd(['parley:outcome', parleyId, '*'], { harbor, limit: 1 });
    const data = rows[0]?.fields[2];
    return data && typeof data === 'object' ? data as ParleyOutcome : null;
  }

  function writeOutcome(parley: ParleyRecord, input: {
    status: Extract<ParleyStatus, 'COLLAPSED' | 'ESCALATED' | 'VOIDED'>;
    resolvedBy: string;
    decision?: string | null;
    reason?: string | null;
    dissenters?: string[];
  }): ParleyOutcome {
    const outcome: ParleyOutcome = {
      parleyId: parley.parleyId,
      status: input.status,
      decision: input.decision?.trim() || null,
      reason: input.reason?.trim() || null,
      resolvedBy: input.resolvedBy,
      dissenters: uniqueNonEmpty(input.dissenters ?? []),
      at: now(),
    };
    tuples.out(['parley:outcome', parley.parleyId, outcome], {
      harbor: parley.harbor,
      writtenBy: input.resolvedBy,
      ttlMs: OUTCOME_TTL_MS,
    });
    return outcome;
  }

  function summarize(parley: ParleyRecord): ParleySummary {
    const turns = getTurns(parley.parleyId, parley.harbor);
    const outcome = getOutcome(parley.parleyId, parley.harbor);
    const responded = new Set<string>();
    for (const turn of turns) responded.add(turn.party);
    const respondedParties = parley.parties.filter((party) => responded.has(party));
    const missingParties = parley.parties.filter((party) => !responded.has(party));
    const expired = parley.responseDueAt !== null && now() > parley.responseDueAt;
    const refused = turns.some((turn) => turn.performative === 'refuse');
    const allResponded = missingParties.length === 0;
    const risks: string[] = [];
    if (expired && !outcome) risks.push('response TTL expired without terminal outcome');
    if (refused && !outcome) risks.push('party refused; operator escalation required');
    if (!allResponded && !outcome) risks.push('not all parties have responded');

    let status: ParleyStatus = parley.status;
    if (outcome) {
      status = outcome.status;
    } else if (refused || expired) {
      status = 'ESCALATED';
    } else if (allResponded) {
      status = 'CONVENED';
    }

    return {
      parley,
      status,
      turns,
      outcome,
      respondedParties,
      missingParties,
      expired,
      risks,
    };
  }

  function get(parleyId: string): ParleySummary | null {
    const parley = findOpened(parleyId);
    return parley ? summarize(parley) : null;
  }

  function list(options: { harbor?: string; status?: ParleyStatus; limit?: number } = {}): ParleySummary[] {
    const rows = tuples.rd(['parley:opened', '*', '*'], { harbor: options.harbor, limit: options.limit ?? 50 });
    const summaries: ParleySummary[] = [];
    for (const row of rows) {
      const data = row.fields[2];
      if (!data || typeof data !== 'object') continue;
      const summary = summarize(data as ParleyRecord);
      if (options.status && summary.status !== options.status) continue;
      summaries.push(summary);
    }
    return summaries;
  }

  function respond(input: RespondParleyInput): ParleyTurn {
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.respond: parleyId is required');
    const summary = get(parleyId);
    if (!summary) throw new Error(`parley.respond: parley '${parleyId}' not found`);
    if (isTerminal(summary.status)) throw new Error(`parley.respond: parley '${parleyId}' is already ${summary.status}`);
    const party = input.party?.trim();
    if (!party) throw new Error('parley.respond: party is required');
    if (!summary.parley.parties.includes(party)) {
      throw new Error(`parley.respond: party '${party}' was not summoned`);
    }
    if (!isPerformative(input.performative)) {
      throw new Error('parley.respond: performative must be propose/critique/revise/agree/refuse/inform');
    }
    if (BUDGETED_PERFORMATIVES.has(input.performative)) {
      const usedTurns = summary.turns.filter((turn) => (
        turn.party === party && BUDGETED_PERFORMATIVES.has(turn.performative)
      )).length;
      if (usedTurns >= summary.parley.roundLimit) {
        writeOutcome(summary.parley, {
          status: 'ESCALATED',
          resolvedBy: 'port-daddy:parley',
          reason: `round limit exhausted for ${party}`,
          dissenters: [party],
        });
        throw new Error(`parley.respond: round limit exhausted for ${party}; parley escalated`);
      }
    }
    const content = input.content?.trim();
    if (!content) throw new Error('parley.respond: content is required');
    const evidenceRefs = Array.isArray(input.evidenceRefs)
      ? input.evidenceRefs.filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
      : [];
    const turn: ParleyTurn = {
      parleyId,
      party,
      performative: input.performative,
      content,
      proposalId: input.proposalId?.trim() || null,
      evidenceRefs,
      at: now(),
    };
    tuples.out(['parley:turn', parleyId, party, turn], {
      harbor: summary.parley.harbor,
      writtenBy: party,
    });
    return turn;
  }

  function resolve(input: ResolveParleyInput): ParleyOutcome {
    const parleyId = input.parleyId?.trim();
    if (!parleyId) throw new Error('parley.resolve: parleyId is required');
    const summary = get(parleyId);
    if (!summary) throw new Error(`parley.resolve: parley '${parleyId}' not found`);
    if (summary.outcome) throw new Error(`parley.resolve: parley '${parleyId}' already has outcome ${summary.outcome.status}`);
    const resolvedBy = input.resolvedBy?.trim();
    if (!resolvedBy) throw new Error('parley.resolve: resolvedBy is required');
    if (input.status !== 'COLLAPSED' && input.status !== 'ESCALATED' && input.status !== 'VOIDED') {
      throw new Error('parley.resolve: status must be COLLAPSED, ESCALATED, or VOIDED');
    }
    const decision = input.decision?.trim() || null;
    if (input.status === 'COLLAPSED' && !decision) {
      throw new Error('parley.resolve: decision is required when status is COLLAPSED');
    }
    const dissenters = uniqueNonEmpty(input.dissenters ?? []);
    const unknownDissenters = dissenters.filter((party) => !summary.parley.parties.includes(party));
    if (unknownDissenters.length > 0) {
      throw new Error(`parley.resolve: unknown dissenters: ${unknownDissenters.join(', ')}`);
    }
    const outcome = writeOutcome(summary.parley, {
      status: input.status,
      decision,
      resolvedBy,
      reason: input.reason?.trim() || null,
      dissenters,
    });
    return outcome;
  }

  return {
    call,
    respond,
    resolve,
    get,
    list,
  };
}

export type Parley = ReturnType<typeof createParley>;
