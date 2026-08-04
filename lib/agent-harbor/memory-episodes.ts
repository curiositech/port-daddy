/**
 * Agent Harbor M6 — Episodic memory: extraction + task-conditioned recall
 * (binder ch04 "Memory tiers" / "Retrieval policy"; ch07 Milestone 6
 * "episodic memory extraction" + "graph facts with validity intervals";
 * ADR-0097 phase 3, `adr-0097-phase-3-episode-extraction`).
 *
 * Contract authority: schemas/agent-harbor/v0/memory-episode.schema.json,
 * transcript-search-query.schema.json, transcript-search-result.schema.json
 * (M6 F0-delta, ADR-0097). Every episode this module persists and every
 * search result it returns is validated against the frozen schemas via
 * assertAgainstSchema — drift from the contract throws, it never ships.
 *
 * This module is DERIVED memory over the sacred event ledger
 * (lib/agent-harbor/event-ledger.ts): the ledger is never written here, only
 * read. Episodes live in their own tables because supersession closure
 * ("closing their validUntil is the runtime effect", memory-episode schema)
 * is a legitimate mutation of a distillation, not of a fact of record.
 *
 * This module is THE episode store. The pre-existing lib/episodic-memory.ts
 * is the deprecated legacy note-promotion system, now a read-only transition
 * surface: session-note harvesting (lib/session-harvest.ts) persists through
 * `persistEpisode` below, and the legacy table is dropped when the
 * deprecation window closes (see lib/episodic-memory.ts header).
 *
 * Skill grafts honored (cited in the PR):
 *   - episodic-memory-algorithms: bi-temporal validity (validFrom/validUntil
 *     world time + ingestedAt system time, the Zep/Graphiti model);
 *     contradiction-driven supersession; importance-scored forgetting
 *     policies (never-forget / half-life decay / session-scoped);
 *     token-budgeted retrieval as a hard failure-mode guard (failure mode #2
 *     "Token Budget Overflow"); salience filtering so successful no-op events
 *     do not become graph explosion (failure mode #5).
 *   - always-on-agent-architecture: memory-tier routing (recall vs graph),
 *     retrieval weights blending relevance / recency / importance.
 *   - sqlite-durable-agent-state: idempotent CREATE IF NOT EXISTS schema with
 *     a post-apply verification probe that inspects the real tables; single
 *     shared DatabaseInstance (canonical PORT_DADDY_DB path via lib/db.ts);
 *     derived-store writes wrapped in transactions.
 *   - agent-interchange-formats: schema-first envelopes; tolerant reader —
 *     unknown transcript kinds are skipped, never rejected; every payload
 *     self-identifies via its `schema` const.
 *
 * NORMATIVE RULES implemented here (ADR-0097):
 *   - CITATION: every episode carries >= 1 citation back to its source
 *     transcript event ("a memory without a source is a suggestion, not a
 *     fact", ch04). Extraction derives from ledger rows, so citations are
 *     structural, not best-effort.
 *   - VALIDITY: retrieval never serves an episode whose validUntil has
 *     passed as a current fact (stale-memory-pollution guard). `asOf`
 *     supports "what did we believe on date D" bi-temporal audits.
 *   - BUDGET: recall NEVER exceeds the query's configured budget (ch18 M6
 *     gate). maxResults and maxContextTokens are enforced caps — the result
 *     echoes configured vs used vs truncated so the invariant is auditable
 *     per response.
 *   - MODE: hybrid/semantic retrieval requires an embedder; lexical-only is
 *     an explicit opt-in (query.mode === 'lexical'), never a silent fallback.
 *     A hybrid query without an embedder throws.
 *   - CROSS-FIELD CITATIONS: kind=transcript-event requires
 *     transcriptEventId (etc.) — runtime-enforced here, per the
 *     compaction-packet normative-module pattern (the frozen keyword subset
 *     cannot express conditionals).
 */

import { createHash } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import type { LocalEmbedder } from '../semantic-resolver.js';
import { readEvents, ledgerHeadSeq, type LedgerRow } from './event-ledger.js';
import { assertAgainstSchema } from './schema-validate.js';
import { UnsupportedScopeError } from './transcript-search.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types mirroring the frozen v0 contracts (schemas win on any disagreement)
// ─────────────────────────────────────────────────────────────────────────────

export const MEMORY_EPISODE_SCHEMA = 'pd.agent-harbor.memory-episode.v0' as const;
export const SEARCH_QUERY_SCHEMA = 'pd.agent-harbor.transcript-search-query.v0' as const;
export const SEARCH_RESULT_SCHEMA = 'pd.agent-harbor.transcript-search-result.v0' as const;

export interface Citation {
  kind: 'transcript-event' | 'file' | 'claim';
  transcriptEventId?: string;
  span?: { start?: number; end?: number };
  fileRef?: string;
  claimRef?: string;
  sessionId?: string;
  [k: string]: unknown;
}

export interface GraphFact {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  validFrom?: string;
  validUntil?: string | null;
  /**
   * Marks a fact whose (subject, predicate) can hold only ONE object at a
   * time (e.g. deployed-via, status). Only single-valued facts participate in
   * contradiction-driven supersession — multi-valued predicates like
   * worked-on accumulate instead ("agent worked on B" does not un-happen
   * "agent worked on A"). Extra field, tolerated by the frozen schema.
   */
  singleValued?: boolean;
  [k: string]: unknown;
}

/**
 * Predicates that are single-valued by convention: a new open fact with the
 * same (subject, predicate) but a different object CONTRADICTS the prior one
 * and closes its validity interval (ADR-0097 §3 supersession).
 */
export const SINGLE_VALUED_PREDICATES: ReadonlySet<string> = new Set([
  'deployed-via',
  'status',
  'current-branch',
  'assigned-to',
  'owned-by',
  'located-at',
  'pinned-to',
]);

function isSingleValued(fact: GraphFact): boolean {
  return fact.singleValued === true || SINGLE_VALUED_PREDICATES.has(fact.predicate);
}

export interface MemoryEpisode {
  schema: typeof MEMORY_EPISODE_SCHEMA;
  episodeId: string;
  harborId?: string;
  tier: 'core' | 'recall' | 'archival' | 'graph';
  agentNodeId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  scope?: {
    projectId?: string | null;
    repoRef?: string | null;
    workgroupId?: string | null;
    paths?: string[];
  };
  summary: string;
  facts?: GraphFact[];
  validFrom: string;
  validUntil: string | null;
  ingestedAt: string;
  supersedes?: string[];
  supersededBy?: string | null;
  extractedBy: { kind: 'longshoreman' | 'self' | 'daemon' | 'operator'; agentNodeId?: string | null };
  citations: Citation[];
  sourcePayloadState: 'present' | 'redacted' | 'deleted' | 'expired';
  sourceTombstone?: { originalEventHash: string; derivationTransform?: string; digest?: string | null };
  importance?: number;
  confidence?: number;
  forgettingPolicy?: { kind: 'never-forget' | 'decay' | 'session-scoped'; halfLifeHours?: number | null };
  embeddingRef?: string | null;
  retentionPolicyId?: string;
  [k: string]: unknown;
}

export class MemoryValidationError extends Error {
  code = 'MEMORY_VALIDATION' as const;
}

export class RetrievalModeError extends Error {
  code = 'RETRIEVAL_MODE' as const;
}

/**
 * Re-exported from transcript-search.ts: the SAME scope-refusal contract
 * (ADR-0097 §2) — a scope narrowing this v0 engine cannot honor (harborId,
 * projectId, repoRef, eventKinds; harbor_memory_episodes/-facts carry no
 * columns to filter on for any of these) refuses rather than silently
 * returning broader-than-requested results (R2 fix).
 */
export { UnsupportedScopeError };

// ─────────────────────────────────────────────────────────────────────────────
// Runtime citation cross-field enforcement (compaction-packet pattern)
// ─────────────────────────────────────────────────────────────────────────────

/** kind=transcript-event requires transcriptEventId; kind=file requires fileRef; kind=claim requires claimRef. */
export function assertCitationCrossFields(citations: Citation[], where: string): void {
  for (const [i, c] of citations.entries()) {
    const need: Record<string, string> = {
      'transcript-event': 'transcriptEventId',
      file: 'fileRef',
      claim: 'claimRef',
    };
    const field = need[c.kind];
    if (!field) {
      throw new MemoryValidationError(`${where}/citations/${i}: unknown citation kind ${JSON.stringify(c.kind)}`);
    }
    const value = (c as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new MemoryValidationError(
        `${where}/citations/${i}: kind=${c.kind} requires non-empty ${field} (ADR-0097 §2 runtime rule)`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived-store schema (idempotent) + post-apply verification
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS harbor_memory_episodes (
    episode_id            TEXT PRIMARY KEY,
    tier                  TEXT NOT NULL,
    agent_node_id         TEXT,
    session_id            TEXT,
    run_id                TEXT,
    summary               TEXT NOT NULL,
    valid_from            TEXT NOT NULL,
    valid_until           TEXT,
    ingested_at           TEXT NOT NULL,
    superseded_by         TEXT,
    importance            REAL,
    source_event_id       TEXT,
    source_ledger_seq     INTEGER,
    payload_json          TEXT NOT NULL
  );

  -- Graph facts get their own rows so contradiction closure and
  -- (subject, predicate) lookups are indexed, not JSON scans.
  CREATE TABLE IF NOT EXISTS harbor_memory_facts (
    fact_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id   TEXT NOT NULL,
    subject      TEXT NOT NULL,
    predicate    TEXT NOT NULL,
    object       TEXT NOT NULL,
    confidence   REAL,
    valid_from   TEXT NOT NULL,
    valid_until  TEXT
  );

  -- Extraction watermark for the projection freshness envelope.
  CREATE TABLE IF NOT EXISTS harbor_memory_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
`;

// Indexes are applied AFTER the column-verification probe so a partial
// pre-existing table fails with the honest "missing columns" diagnosis, not
// an incidental index error.
const MEMORY_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_harbor_memory_episodes_session
    ON harbor_memory_episodes(session_id);
  CREATE INDEX IF NOT EXISTS idx_harbor_memory_episodes_agent
    ON harbor_memory_episodes(agent_node_id);
  CREATE INDEX IF NOT EXISTS idx_harbor_memory_episodes_validity
    ON harbor_memory_episodes(valid_until);
  CREATE INDEX IF NOT EXISTS idx_harbor_memory_facts_sp
    ON harbor_memory_facts(subject, predicate, valid_until);
  CREATE INDEX IF NOT EXISTS idx_harbor_memory_facts_episode
    ON harbor_memory_facts(episode_id);
`;

const REQUIRED_TABLES: Record<string, string[]> = {
  harbor_memory_episodes: [
    'episode_id', 'tier', 'agent_node_id', 'session_id', 'run_id', 'summary',
    'valid_from', 'valid_until', 'ingested_at', 'superseded_by', 'importance',
    'source_event_id', 'source_ledger_seq', 'payload_json',
  ],
  harbor_memory_facts: [
    'fact_id', 'episode_id', 'subject', 'predicate', 'object', 'confidence',
    'valid_from', 'valid_until',
  ],
  harbor_memory_meta: ['key', 'value'],
};

/**
 * Idempotent schema apply + post-apply verification probe
 * (sqlite-durable-agent-state: "Migration History Is Not Migration" — inspect
 * the real tables, never trust that DDL ran).
 */
export function ensureMemoryEpisodeSchema(db: DatabaseInstance): void {
  db.exec(MEMORY_TABLES_SQL);
  for (const [table, required] of Object.entries(REQUIRED_TABLES)) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const present = new Set(cols.map((c) => c.name));
    const missing = required.filter((c) => !present.has(c));
    if (missing.length > 0) {
      throw new Error(
        `${table} migration verification failed: missing columns ${missing.join(', ')}. ` +
        'The episodic memory store cannot run against a partial schema.',
      );
    }
  }
  db.exec(MEMORY_INDEXES_SQL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction rules — deterministic over STRUCTURED transcript fields only
// ─────────────────────────────────────────────────────────────────────────────
//
// Rules match on the transcript event `kind` (a structured, ledger-indexed
// field) and read structured payloadJson fields. No free-text keyword
// classification happens here — unknown kinds are skipped (tolerant reader),
// and salience filtering keeps successful no-op noise out of the store
// (episodic-memory-algorithms failure mode #5: knowledge graph explosion).

interface EventPayloadView {
  row: LedgerRow;
  payload: Record<string, unknown>;
  payloadJson: Record<string, unknown>;
}

type ExtractionRule = (view: EventPayloadView, nowIso: string) => MemoryEpisode[];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** Deterministic episode id from rule + source event + discriminator (idempotent re-extraction). */
export function deriveEpisodeId(ruleId: string, sourceEventId: string, discriminator = ''): string {
  const digest = createHash('sha256').update(`${ruleId}:${sourceEventId}:${discriminator}`).digest('hex');
  return `memep_${digest.slice(0, 24)}`;
}

/** ch04 distilled-source contract: map the event's redactionState onto sourcePayloadState. */
function sourceState(row: LedgerRow, payload: Record<string, unknown>): {
  sourcePayloadState: MemoryEpisode['sourcePayloadState'];
  sourceTombstone?: MemoryEpisode['sourceTombstone'];
} {
  const redaction = str(payload.redactionState) ?? 'none';
  if (redaction === 'none') return { sourcePayloadState: 'present' };
  return {
    sourcePayloadState: 'redacted',
    sourceTombstone: {
      originalEventHash: row.content_hash ?? 'sha256:unknown',
      derivationTransform: `episode extracted from ${redaction} transcript event ${row.event_id}`,
      digest: null,
    },
  };
}

function baseEpisode(
  view: EventPayloadView,
  nowIso: string,
  fields: Pick<MemoryEpisode, 'episodeId' | 'tier' | 'summary'> & Partial<MemoryEpisode>,
): MemoryEpisode {
  const { row, payload } = view;
  const validFrom = row.occurred_at ?? nowIso;
  const episode: MemoryEpisode = {
    schema: MEMORY_EPISODE_SCHEMA,
    agentNodeId: row.agent_node_id,
    sessionId: row.session_id,
    runId: row.run_id,
    validFrom,
    validUntil: null,
    ingestedAt: nowIso,
    supersedes: [],
    supersededBy: null,
    extractedBy: { kind: 'daemon', agentNodeId: null },
    citations: [
      {
        kind: 'transcript-event',
        transcriptEventId: row.event_id,
        ...(row.session_id ? { sessionId: row.session_id } : {}),
      },
    ],
    ...sourceState(row, payload),
    ...fields,
  };
  return episode;
}

/** compaction_packet → one recall episode per cited factual claim + per decision. */
const extractCompactionPacket: ExtractionRule = (view, nowIso) => {
  const episodes: MemoryEpisode[] = [];
  const { row, payloadJson } = view;
  const claims = Array.isArray(payloadJson.factualClaims) ? payloadJson.factualClaims : [];
  for (const [i, raw] of claims.entries()) {
    const claim = raw as Record<string, unknown>;
    const text = str(claim.text);
    if (!text) continue;
    const claimCitations = (Array.isArray(claim.citations) ? claim.citations : []) as Citation[];
    episodes.push(
      baseEpisode(view, nowIso, {
        episodeId: deriveEpisodeId('compaction-claim', row.event_id, String(i)),
        tier: 'recall',
        summary: text,
        importance: 7,
        confidence: typeof claim.confidence === 'number' ? claim.confidence : 0.8,
        forgettingPolicy: { kind: 'decay', halfLifeHours: 720 },
        // The claim's own citations are the truth (already minItems 1 per the
        // frozen packet schema); the packet event itself is appended as the
        // derivation anchor.
        citations: [
          ...claimCitations,
          { kind: 'transcript-event', transcriptEventId: row.event_id, ...(row.session_id ? { sessionId: row.session_id } : {}) },
        ],
      }),
    );
  }
  const decisions = Array.isArray(payloadJson.decisions) ? payloadJson.decisions : [];
  for (const [i, raw] of decisions.entries()) {
    const decision = raw as Record<string, unknown>;
    const text = str(decision.text);
    if (!text) continue;
    const rationale = str(decision.rationale);
    episodes.push(
      baseEpisode(view, nowIso, {
        episodeId: deriveEpisodeId('compaction-decision', row.event_id, String(i)),
        tier: 'recall',
        summary: rationale ? `${text} — rationale: ${rationale}` : text,
        importance: 6,
        forgettingPolicy: { kind: 'decay', halfLifeHours: 720 },
      }),
    );
  }
  return episodes;
};

/** file_write / file_diff → graph facts: agent worked-on file (ch04 graph memory). */
const extractFileWork: ExtractionRule = (view, nowIso) => {
  const { row, payloadJson } = view;
  if (!row.agent_node_id) return [];
  const paths = [
    ...strArray(payloadJson.filesTouched),
    ...(str(payloadJson.path) ? [str(payloadJson.path) as string] : []),
  ];
  const unique = [...new Set(paths)];
  if (unique.length === 0) return [];
  const validFrom = row.occurred_at ?? nowIso;
  return [
    baseEpisode(view, nowIso, {
      episodeId: deriveEpisodeId('file-work', row.event_id),
      tier: 'graph',
      summary: `Agent ${row.agent_node_id} worked on ${unique.join(', ')}`,
      importance: 4,
      forgettingPolicy: { kind: 'decay', halfLifeHours: 168 },
      scope: { paths: unique },
      facts: unique.map((p) => ({
        subject: row.agent_node_id as string,
        predicate: 'worked-on',
        object: p,
        validFrom,
        validUntil: null,
      })),
      citations: [
        { kind: 'transcript-event', transcriptEventId: row.event_id, ...(row.session_id ? { sessionId: row.session_id } : {}) },
        ...unique.map((p): Citation => ({ kind: 'file', fileRef: p })),
      ],
    }),
  ];
};

/** commit_created / pr_opened → graph facts joining agents to git artifacts. */
const extractGitArtifact: ExtractionRule = (view, nowIso) => {
  const { row, payloadJson } = view;
  if (!row.agent_node_id) return [];
  const predicate = row.kind === 'pr_opened' ? 'opened-pr' : 'created-commit';
  const object = str(payloadJson.prRef) ?? str(payloadJson.sha) ?? str(payloadJson.ref);
  if (!object) return [];
  const message = str(payloadJson.message) ?? str(payloadJson.title);
  const validFrom = row.occurred_at ?? nowIso;
  return [
    baseEpisode(view, nowIso, {
      episodeId: deriveEpisodeId('git-artifact', row.event_id),
      tier: 'graph',
      summary: message
        ? `Agent ${row.agent_node_id} ${predicate.replace('-', ' ')} ${object}: ${message}`
        : `Agent ${row.agent_node_id} ${predicate.replace('-', ' ')} ${object}`,
      importance: 5,
      forgettingPolicy: { kind: 'decay', halfLifeHours: 720 },
      facts: [
        { subject: row.agent_node_id, predicate, object, validFrom, validUntil: null },
      ],
    }),
  ];
};

/**
 * shell_command / tool_result FAILURES only. Successful exits are skipped —
 * failures are the salient episodes; recording every success is the graph
 * explosion failure mode.
 */
const extractCommandFailure: ExtractionRule = (view, nowIso) => {
  const { row, payloadJson } = view;
  const exitCode = payloadJson.exitCode;
  if (typeof exitCode !== 'number' || exitCode === 0) return [];
  const command = str(payloadJson.command) ?? str(payloadJson.toolCallId) ?? row.kind ?? 'command';
  return [
    baseEpisode(view, nowIso, {
      episodeId: deriveEpisodeId('command-failure', row.event_id),
      tier: 'recall',
      summary: `Command failed (exit ${exitCode}): ${command}`,
      importance: 6,
      confidence: 1,
      forgettingPolicy: { kind: 'decay', halfLifeHours: 168 },
    }),
  ];
};

/** session_end → run outcome summary, when the adapter reported one. */
const extractSessionOutcome: ExtractionRule = (view, nowIso) => {
  const { row, payloadJson } = view;
  const outcome = str(payloadJson.outcome) ?? str(payloadJson.summary);
  if (!outcome) return [];
  return [
    baseEpisode(view, nowIso, {
      episodeId: deriveEpisodeId('session-outcome', row.event_id),
      tier: 'recall',
      summary: outcome,
      importance: 7,
      forgettingPolicy: { kind: 'decay', halfLifeHours: 720 },
    }),
  ];
};

/** Exact-match dispatch on the structured event kind. Unknown kinds skip. */
const EXTRACTION_RULES: Record<string, ExtractionRule> = {
  compaction_packet: extractCompactionPacket,
  file_write: extractFileWork,
  file_diff: extractFileWork,
  commit_created: extractGitArtifact,
  pr_opened: extractGitArtifact,
  shell_command: extractCommandFailure,
  tool_result: extractCommandFailure,
  session_end: extractSessionOutcome,
};

// ─────────────────────────────────────────────────────────────────────────────
// Extraction — persist episodes with supersession closure
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractOptions {
  sessionId: string;
  /** Injection point for tests / bi-temporal determinism. Defaults to wall clock. */
  now?: () => Date;
}

export interface ExtractResult {
  /** Episodes newly persisted by this call (already schema-validated). */
  extracted: MemoryEpisode[];
  /** Episode ids that already existed (idempotent re-extraction no-ops). */
  skippedExisting: string[];
  /** Episode ids whose validUntil was closed by contradiction during this pass. */
  superseded: string[];
  /** Ledger head at extraction time (projection watermark). */
  throughLedgerSeq: number;
}

interface EpisodeRowMinimal {
  episode_id: string;
  valid_until: string | null;
  payload_json: string;
}

export interface PersistResult {
  /** False when the episodeId already existed (idempotent no-op). */
  inserted: boolean;
  /** Episode ids whose validUntil this insert closed by contradiction. */
  superseded: string[];
}

/**
 * Persist ONE episode through the full contract gate: frozen-schema
 * validation, runtime citation cross-fields, idempotent insert, and
 * contradiction-driven supersession closure for single-valued graph facts
 * (ADR-0097 §3: "closing their validUntil is the runtime effect").
 *
 * This is also the write path for Longshoreman/LLM-extracted episodes that
 * do not come from the deterministic rules below — everything goes through
 * the same gate.
 */
export function persistEpisode(
  db: DatabaseInstance,
  episode: MemoryEpisode,
  source?: { sourceEventId?: string; sourceLedgerSeq?: number },
): PersistResult {
  ensureMemoryEpisodeSchema(db);

  const txn = db.transaction((): PersistResult => {
    const exists = db
      .prepare('SELECT episode_id FROM harbor_memory_episodes WHERE episode_id = ?')
      .get(episode.episodeId);
    if (exists) return { inserted: false, superseded: [] };

    // Supersession closure BEFORE persisting the new episode, so
    // `supersedes` reflects what this fact actually invalidated. Only
    // single-valued predicates contradict; multi-valued facts accumulate.
    const superseded: string[] = [];
    for (const fact of episode.facts ?? []) {
      if (!isSingleValued(fact)) continue;
      const contradicted = db
        .prepare(
          `SELECT DISTINCT e.episode_id, e.valid_until, e.payload_json
             FROM harbor_memory_facts f
             JOIN harbor_memory_episodes e ON e.episode_id = f.episode_id
            WHERE f.subject = ? AND f.predicate = ? AND f.object <> ?
              AND f.valid_until IS NULL AND e.valid_until IS NULL`,
        )
        .all(fact.subject, fact.predicate, fact.object) as EpisodeRowMinimal[];
      for (const prior of contradicted) {
        const priorPayload = JSON.parse(prior.payload_json) as MemoryEpisode;
        priorPayload.validUntil = episode.validFrom;
        priorPayload.supersededBy = episode.episodeId;
        if (Array.isArray(priorPayload.facts)) {
          for (const pf of priorPayload.facts) {
            if (pf.subject === fact.subject && pf.predicate === fact.predicate && (pf.validUntil ?? null) === null) {
              pf.validUntil = episode.validFrom;
            }
          }
        }
        // The mutated prior payload passes back through the same contract
        // gate as a fresh insert — supersession closure must never leave a
        // schema-invalid blob in the derived store.
        assertAgainstSchema('memory-episode', priorPayload);
        assertCitationCrossFields(priorPayload.citations, `${prior.episode_id} (supersession closure)`);
        db.prepare(
          'UPDATE harbor_memory_episodes SET valid_until = ?, superseded_by = ?, payload_json = ? WHERE episode_id = ?',
        ).run(episode.validFrom, episode.episodeId, JSON.stringify(priorPayload), prior.episode_id);
        db.prepare(
          `UPDATE harbor_memory_facts SET valid_until = ?
            WHERE episode_id = ? AND subject = ? AND predicate = ? AND valid_until IS NULL`,
        ).run(episode.validFrom, prior.episode_id, fact.subject, fact.predicate);
        superseded.push(prior.episode_id);
      }
    }
    if (superseded.length > 0) {
      episode.supersedes = [...new Set([...(episode.supersedes ?? []), ...superseded])];
    }

    // Contract gates: frozen schema shape + runtime citation cross-fields.
    assertAgainstSchema('memory-episode', episode);
    assertCitationCrossFields(episode.citations, episode.episodeId);

    db.prepare(
      `INSERT INTO harbor_memory_episodes (
         episode_id, tier, agent_node_id, session_id, run_id, summary,
         valid_from, valid_until, ingested_at, superseded_by, importance,
         source_event_id, source_ledger_seq, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      episode.episodeId,
      episode.tier,
      episode.agentNodeId ?? null,
      episode.sessionId ?? null,
      episode.runId ?? null,
      episode.summary,
      episode.validFrom,
      episode.validUntil,
      episode.ingestedAt,
      episode.supersededBy ?? null,
      episode.importance ?? null,
      source?.sourceEventId ?? null,
      source?.sourceLedgerSeq ?? null,
      JSON.stringify(episode),
    );
    for (const fact of episode.facts ?? []) {
      db.prepare(
        `INSERT INTO harbor_memory_facts (
           episode_id, subject, predicate, object, confidence, valid_from, valid_until
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        episode.episodeId,
        fact.subject,
        fact.predicate,
        fact.object,
        fact.confidence ?? null,
        fact.validFrom ?? episode.validFrom,
        fact.validUntil ?? null,
      );
    }
    return { inserted: true, superseded };
  });

  return txn();
}

/**
 * Extract MemoryEpisode records from a session's transcript (completed or
 * compacted runs; binder ch07 M6 "episodic memory extraction"). Deterministic
 * and idempotent: episode ids derive from (rule, sourceEventId), so replaying
 * the same session extracts nothing new. Unknown event kinds are skipped
 * (tolerant reader); every episode cites its source transcript event.
 */
export function extractEpisodesFromSession(db: DatabaseInstance, opts: ExtractOptions): ExtractResult {
  ensureMemoryEpisodeSchema(db);
  const nowIso = (opts.now?.() ?? new Date()).toISOString();
  const extracted: MemoryEpisode[] = [];
  const skippedExisting: string[] = [];
  const supersededIds = new Set<string>();

  const PAGE = 5_000;
  let afterSeq = 0;
  const views: EventPayloadView[] = [];
  for (;;) {
    const rows = readEvents(db, {
      streamType: 'transcript-event',
      sessionId: opts.sessionId,
      afterSeq,
      limit: PAGE,
    });
    for (const row of rows) {
      if (!row.kind || !(row.kind in EXTRACTION_RULES)) continue; // tolerant reader
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const payloadJson = (payload.payloadJson ?? {}) as Record<string, unknown>;
      views.push({ row, payload, payloadJson });
    }
    if (rows.length < PAGE) break;
    afterSeq = rows[rows.length - 1].ledger_seq;
  }

  const txn = db.transaction(() => {
    for (const view of views) {
      const rule = EXTRACTION_RULES[view.row.kind as string];
      for (const episode of rule(view, nowIso)) {
        const result = persistEpisode(db, episode, {
          sourceEventId: view.row.event_id,
          sourceLedgerSeq: view.row.ledger_seq,
        });
        if (!result.inserted) {
          skippedExisting.push(episode.episodeId);
          continue;
        }
        for (const id of result.superseded) supersededIds.add(id);
        extracted.push(episode);
      }
    }

    // Advance the projection watermark to the ledger head at extraction time.
    const head = ledgerHeadSeq(db);
    db.prepare(
      `INSERT INTO harbor_memory_meta (key, value) VALUES ('extraction_head_seq', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(head));
    return head;
  });

  const throughLedgerSeq = txn() as number;
  return { extracted, skippedExisting, superseded: [...supersededIds], throughLedgerSeq };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task-conditioned recall — TranscriptSearchQuery in, TranscriptSearchResult out
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Documented token heuristic: ~4 characters per token. Used only to meter
 * snippet weight against budget.maxContextTokens; the cap is enforced on this
 * estimate, and the same estimate is echoed in the result so the audit is
 * apples-to-apples.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Embedder signature (shared-embedder directive, ADR-0061): a type alias for
 * semantic-resolver.ts's LocalEmbedder — the actual async contract
 * createLocalEmbedder implements — not a parallel redefinition. This used to
 * be its own interface with a sync `embed`, which drifted from the real
 * shared embedder and forced callers through an adapter (R3 fix); aliasing
 * means the two contracts can never diverge again.
 */
export type Embedder = LocalEmbedder;

export interface RecallOptions {
  /** Required for mode hybrid/semantic. Its absence is an ERROR, never a silent lexical fallback. */
  embedder?: Embedder;
  /**
   * World-time (validity) audit point: serve facts VALID at this instant.
   * Defaults to now — the stale-memory-pollution guard.
   */
  asOf?: string;
  /**
   * System-time audit point (the second bi-temporal axis): only serve
   * episodes the system had INGESTED by this instant — "what did we believe
   * on date D". Defaults to unbounded (everything known now).
   */
  believedAt?: string;
  now?: () => Date;
}

interface CandidateRow {
  episode_id: string;
  summary: string;
  valid_from: string;
  ingested_at: string;
  importance: number | null;
  payload_json: string;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_./-]+/).filter((t) => t.length > 1);
}

/** TF-IDF cosine over the candidate set — the deterministic lexical leg. */
function lexicalScores(queryText: string, candidates: CandidateRow[]): Map<string, number> {
  const queryTokens = tokenize(queryText);
  const scores = new Map<string, number>();
  if (queryTokens.length === 0 || candidates.length === 0) return scores;

  const docTokens = new Map<string, string[]>();
  const df = new Map<string, number>();
  for (const c of candidates) {
    const episode = JSON.parse(c.payload_json) as MemoryEpisode;
    const factText = (episode.facts ?? [])
      .map((f) => `${f.subject} ${f.predicate} ${f.object}`)
      .join(' ');
    const tokens = tokenize(`${c.summary} ${factText}`);
    docTokens.set(c.episode_id, tokens);
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = candidates.length;
  const idf = (t: string) => Math.log(1 + n / (1 + (df.get(t) ?? 0)));

  const queryVec = new Map<string, number>();
  for (const t of queryTokens) queryVec.set(t, (queryVec.get(t) ?? 0) + idf(t));
  const queryNorm = Math.sqrt([...queryVec.values()].reduce((s, v) => s + v * v, 0));

  for (const c of candidates) {
    const tokens = docTokens.get(c.episode_id) ?? [];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let dot = 0;
    let docNormSq = 0;
    for (const [t, count] of tf) {
      const w = count * idf(t);
      docNormSq += w * w;
      const qw = queryVec.get(t);
      if (qw) dot += qw * w;
    }
    const norm = queryNorm * Math.sqrt(docNormSq);
    scores.set(c.episode_id, norm > 0 ? dot / norm : 0);
  }
  return scores;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb);
  return norm > 0 ? dot / norm : 0;
}

/**
 * Reciprocal rank fusion (k=60), the ADR-0097 default hybrid posture.
 * Zero-score entries are excluded from each leg's ranking BEFORE fusion:
 * RRF scores by rank position, so without this filter a candidate that both
 * legs scored 0 would still earn a positive fused score and defeat the
 * downstream `rel > 0` honest-miss guard by padding results with noise.
 */
function rrfFuse(rankings: Array<Map<string, number>>): Map<string, number> {
  const K = 60;
  const fused = new Map<string, number>();
  for (const scores of rankings) {
    const ranked = [...scores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
    ranked.forEach(([id], idx) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (K + idx + 1));
    });
  }
  return fused;
}

export interface RecallQuery {
  schema: typeof SEARCH_QUERY_SCHEMA;
  queryId: string;
  issuedAt: string;
  issuedBy: { kind: string; agentNodeId?: string | null; sessionId?: string | null };
  queryText: string;
  mode: 'hybrid' | 'semantic' | 'lexical';
  scope?: {
    harborId?: string | null;
    projectId?: string | null;
    repoRef?: string | null;
    agentNodeIds?: string[];
    sessionIds?: string[];
    eventKinds?: string[];
    occurredAfter?: string | null;
    occurredBefore?: string | null;
  };
  sources: string[];
  budget: { maxResults: number; maxContextTokens?: number | null; maxLatencyMs?: number | null };
  retrievalHints?: { fusion?: 'rrf' | null; rerank?: boolean; recencyWeight?: number };
  visibilityCeiling?: string | null;
  [k: string]: unknown;
}

export interface RecallHit {
  rank: number;
  score: number;
  source: 'memory-episodes';
  snippet: string | null;
  agentNodeId: string | null;
  sessionId: string | null;
  runId: string | null;
  occurredAt: string | null;
  citations: Citation[];
  [k: string]: unknown;
}

export interface RecallResult {
  schema: typeof SEARCH_RESULT_SCHEMA;
  queryId: string;
  completedAt: string;
  engine: { mode: 'hybrid' | 'semantic' | 'lexical'; embeddingModel: string | null; fusion: 'rrf' | null; reranked: boolean };
  budget: {
    configured: { maxResults: number; maxContextTokens?: number | null };
    used: { results: number; contextTokensEstimate: number };
    truncated: boolean;
  };
  hits: RecallHit[];
  projection: { stale: boolean; lastLedgerSeq: number | null; headSeq: number | null };
  [k: string]: unknown;
}

const SNIPPET_MAX_CHARS = 280;

/**
 * Task-conditioned recall over the episode store (ch04 retrieval policy;
 * ch07 M6 gate line 4: "memory retrieval never exceeds configured budget").
 *
 * The budget is an ENFORCED CAP, not a suggestion:
 *   - never more than budget.maxResults hits;
 *   - the summed token estimate of returned snippets never exceeds
 *     budget.maxContextTokens (when configured); a hit whose snippet does not
 *     fit keeps its citations (the truth) with snippet: null;
 *   - anything dropped for budget sets truncated: true.
 *
 * Mode discipline (ADR-0097 §4): hybrid is the default posture and needs an
 * embedder; a hybrid/semantic query without one THROWS — lexical is a
 * degraded mode a caller opts into by sending mode: "lexical".
 *
 * Validity discipline (ADR-0097 §3), both bi-temporal axes: episodes whose
 * validUntil has passed at `asOf` are never served as current facts (world
 * time). Pass opts.asOf for "what was true on date D" audits on that axis
 * alone. The system-time axis is separate and opt-in: pass opts.believedAt
 * to additionally exclude episodes ingested after that instant, answering
 * "what did we believe on date D" — asOf and believedAt are independent
 * parameters, not the same cut.
 */
export async function recallEpisodes(
  db: DatabaseInstance,
  query: RecallQuery,
  opts: RecallOptions = {},
): Promise<RecallResult> {
  ensureMemoryEpisodeSchema(db);
  assertAgainstSchema('transcript-search-query', query);
  if (!query.sources.includes('memory-episodes')) {
    throw new MemoryValidationError(
      'recallEpisodes serves the "memory-episodes" source only; the query.sources array does not include it',
    );
  }

  // Scope narrowing this v0 recall engine cannot honor — refusing beats
  // silently returning results broader than the caller requested (same
  // UnsupportedScopeError contract as transcript-search.ts's
  // searchTranscripts, ADR-0097 §2). harbor_memory_episodes/-facts carry no
  // harbor_id, project/repo, or event-kind columns, so these four scope
  // fields are structurally unfilterable here, not merely unimplemented.
  const scope = query.scope ?? {};
  if (scope.harborId) throw new UnsupportedScopeError('harborId');
  if (scope.projectId) throw new UnsupportedScopeError('projectId');
  if (scope.repoRef) throw new UnsupportedScopeError('repoRef');
  if (Array.isArray(scope.eventKinds) && scope.eventKinds.length > 0) {
    throw new UnsupportedScopeError('eventKinds');
  }

  if ((query.mode === 'hybrid' || query.mode === 'semantic') && !opts.embedder) {
    throw new RetrievalModeError(
      `query mode "${query.mode}" requires an embedder (shared-embedder directive). ` +
      'Pass opts.embedder, or explicitly opt into degraded lexical mode with mode: "lexical" — ' +
      'lexical is never a silent fallback (ADR-0097 §4).',
    );
  }

  const nowIso = (opts.now?.() ?? new Date()).toISOString();
  const asOf = opts.asOf ?? nowIso;

  // Candidate gathering: scope filters + the stale-memory-pollution guard.
  // NOTE: no `superseded_by IS NULL` filter — supersession always closes
  // valid_until, so the validity window below excludes superseded episodes at
  // current time while still serving them for past-asOf bi-temporal audits.
  const where: string[] = [
    '(valid_until IS NULL OR valid_until > ?)', // not expired/superseded at asOf
    'valid_from <= ?', // fact already held at asOf
  ];
  const params: unknown[] = [asOf, asOf];
  if (opts.believedAt) {
    where.push('ingested_at <= ?'); // system-time axis: known by believedAt
    params.push(opts.believedAt);
  }
  if (Array.isArray(scope.sessionIds) && scope.sessionIds.length > 0) {
    where.push(`session_id IN (${scope.sessionIds.map(() => '?').join(', ')})`);
    params.push(...scope.sessionIds);
  }
  if (Array.isArray(scope.agentNodeIds) && scope.agentNodeIds.length > 0) {
    where.push(`agent_node_id IN (${scope.agentNodeIds.map(() => '?').join(', ')})`);
    params.push(...scope.agentNodeIds);
  }
  if (str(scope.occurredAfter)) {
    where.push('valid_from >= ?');
    params.push(scope.occurredAfter);
  }
  if (str(scope.occurredBefore)) {
    where.push('valid_from <= ?');
    params.push(scope.occurredBefore);
  }
  const candidates = db
    .prepare(
      `SELECT episode_id, summary, valid_from, ingested_at, importance, payload_json
         FROM harbor_memory_episodes WHERE ${where.join(' AND ')}`,
    )
    .all(...params) as CandidateRow[];

  // Relevance legs.
  const lexical = lexicalScores(query.queryText, candidates);
  let relevance: Map<string, number>;
  let engineModel: string | null = null;
  let fusion: 'rrf' | null = null;
  if (query.mode === 'lexical') {
    relevance = lexical;
  } else {
    const embedder = opts.embedder as Embedder;
    engineModel = embedder.modelId;
    const vectors = await embedder.embed([query.queryText, ...candidates.map((c) => c.summary)]);
    const queryVec = vectors[0];
    const semantic = new Map<string, number>();
    candidates.forEach((c, i) => semantic.set(c.episode_id, cosine(queryVec, vectors[i + 1])));
    if (query.mode === 'semantic') {
      relevance = semantic;
    } else {
      fusion = 'rrf';
      relevance = rrfFuse([lexical, semantic]);
    }
  }

  // Blend relevance / recency / importance (always-on-agent-architecture +
  // episodic-memory-algorithms retrieval weights; recencyWeight hint may tune
  // the recency share but can never widen the budget).
  const recencyWeight = Math.min(Math.max(query.retrievalHints?.recencyWeight ?? 0.2, 0), 1);
  const importanceWeight = 0.2;
  const relevanceWeight = Math.max(1 - recencyWeight - importanceWeight, 0);
  const asOfMs = Date.parse(asOf);
  const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
  const maxRelevance = Math.max(...[...relevance.values()], 0) || 1;

  const scored = candidates
    .map((c) => {
      const rel = (relevance.get(c.episode_id) ?? 0) / maxRelevance;
      const ageMs = Math.max(asOfMs - Date.parse(c.valid_from), 0);
      const recency = Math.pow(0.5, ageMs / HALF_LIFE_MS);
      const importance = (c.importance ?? 5) / 10;
      const score = relevanceWeight * rel + recencyWeight * recency + importanceWeight * importance;
      return { candidate: c, score, rel };
    })
    .filter((s) => s.rel > 0) // an honest miss beats padding with noise
    .sort((a, b) => b.score - a.score || a.candidate.episode_id.localeCompare(b.candidate.episode_id));

  // ── Budget enforcement: the ch18 M6 gate, as a hard cap ──
  const maxResults = query.budget.maxResults;
  const maxContextTokens = query.budget.maxContextTokens ?? null;
  const hits: RecallHit[] = [];
  let tokensUsed = 0;
  let truncated = false;

  for (const { candidate, score } of scored) {
    if (hits.length >= maxResults) {
      truncated = true;
      break;
    }
    const episode = JSON.parse(candidate.payload_json) as MemoryEpisode;
    let snippet: string | null = candidate.summary.slice(0, SNIPPET_MAX_CHARS);
    let snippetTokens = estimateTokens(snippet);
    if (maxContextTokens !== null && tokensUsed + snippetTokens > maxContextTokens) {
      // The citation is the truth; the snippet is a convenience copy that
      // must never blow the caller's context window.
      snippet = null;
      snippetTokens = 0;
      truncated = true;
    }
    tokensUsed += snippetTokens;
    hits.push({
      rank: hits.length + 1,
      score: Number(score.toFixed(6)),
      source: 'memory-episodes',
      snippet,
      agentNodeId: episode.agentNodeId ?? null,
      sessionId: episode.sessionId ?? null,
      runId: episode.runId ?? null,
      occurredAt: episode.validFrom,
      citations: episode.citations,
      episodeId: episode.episodeId,
    });
  }

  // Projection freshness envelope (C-routes convention).
  const watermarkRow = db
    .prepare("SELECT value FROM harbor_memory_meta WHERE key = 'extraction_head_seq'")
    .get() as { value: string } | undefined;
  const lastLedgerSeq = watermarkRow ? Number(watermarkRow.value) : null;
  const headSeq = ledgerHeadSeq(db);

  const result: RecallResult = {
    schema: SEARCH_RESULT_SCHEMA,
    queryId: query.queryId,
    completedAt: nowIso,
    engine: { mode: query.mode, embeddingModel: engineModel, fusion, reranked: false },
    budget: {
      configured: { maxResults, maxContextTokens },
      used: { results: hits.length, contextTokensEstimate: tokensUsed },
      truncated,
    },
    hits,
    projection: {
      stale: lastLedgerSeq === null || headSeq > lastLedgerSeq,
      lastLedgerSeq,
      headSeq,
    },
  };

  // Contract gates before returning: the budget invariant and the frozen shape.
  if (result.hits.length > maxResults) {
    throw new MemoryValidationError('budget invariant violated: more hits than maxResults'); // unreachable guard
  }
  if (maxContextTokens !== null && tokensUsed > maxContextTokens) {
    throw new MemoryValidationError('budget invariant violated: token estimate exceeds maxContextTokens'); // unreachable guard
  }
  assertAgainstSchema('transcript-search-result', result);
  for (const hit of result.hits) assertCitationCrossFields(hit.citations, `hit#${hit.rank}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Load one persisted episode by id (schema-shaped payload), or null. */
export function getEpisode(db: DatabaseInstance, episodeId: string): MemoryEpisode | null {
  ensureMemoryEpisodeSchema(db);
  const row = db
    .prepare('SELECT payload_json FROM harbor_memory_episodes WHERE episode_id = ?')
    .get(episodeId) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as MemoryEpisode) : null;
}

/** Open graph facts for a subject as of an instant — "what is true about X". */
export function openFactsFor(
  db: DatabaseInstance,
  subject: string,
  asOf?: string,
): Array<GraphFact & { episodeId: string }> {
  ensureMemoryEpisodeSchema(db);
  const at = asOf ?? new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT episode_id, subject, predicate, object, confidence, valid_from, valid_until
         FROM harbor_memory_facts
        WHERE subject = ? AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)`,
    )
    .all(subject, at, at) as Array<{
      episode_id: string; subject: string; predicate: string; object: string;
      confidence: number | null; valid_from: string; valid_until: string | null;
    }>;
  return rows.map((r) => ({
    episodeId: r.episode_id,
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    ...(r.confidence !== null ? { confidence: r.confidence } : {}),
    validFrom: r.valid_from,
    validUntil: r.valid_until,
  }));
}
