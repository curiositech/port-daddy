/**
 * Event Envelope — typed, versioned, replay-detectable wire format.
 *
 * Applies the agent-interchange-format quality gates to PD's event/relay
 * messages, extending the existing `TubeEnvelope` (lib/tube.ts: `{ v, kind,
 * body, inReplyTo }`) rather than inventing a parallel format (no Tower of
 * Babel). Adds the fields a multi-machine relay needs and an existing tube
 * envelope lacks:
 *
 *   - `id`            — unique message id (dedup, correlation)
 *   - `conversationId`— threading across publishers
 *   - `ts`            — ISO-8601 timestamp
 *   - `publisher`     — origin identity, the key for per-publisher ordering
 *   - `seq`           — per-publisher MONOTONIC sequence
 *
 * The `seq` + `createReplayGuard()` is the OPERATIONAL closure of the replay
 * gap proven open in `apps/relay/formal/proverif/relay-e2e-secrecy/relay_e2e_secrecy.pv` (PR #250): a stateless
 * signed envelope let a malicious relay replay a valid message (injective
 * agreement failed). A per-publisher monotonic sequence lets the subscriber
 * reject stale/duplicate deliveries, which is the wire-format half of the
 * Merkle-chain obligation (I2) — sequence first, chain-head anchoring next.
 *
 * Pure + deterministic: callers supply `id` and `ts` (no Date.now/random here),
 * so the module round-trips identically in tests and is safe to reuse anywhere.
 */

export const EVENT_ENVELOPE_VERSION = 1 as const;

export interface EventEnvelope {
  /** Schema version — explicit, for drift detection across agents. */
  v: typeof EVENT_ENVELOPE_VERSION;
  /** Discriminated message kind (e.g. 'tube.msg', 'event', 'handoff'). */
  kind: string;
  /** Unique message id (dedup + correlation). */
  id: string;
  /** Origin identity; the key for per-publisher monotonic ordering. */
  publisher: string;
  /** Per-publisher monotonic sequence (replay/order). */
  seq: number;
  /** ISO-8601 timestamp. */
  ts: string;
  /** Opaque body (ciphertext or text — the relay never needs to read it). */
  body: string;
  /** Optional threading: the conversation this message belongs to. */
  conversationId?: string;
  /** Optional reply threading by message id. */
  inReplyTo?: string;
}

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Construct a validated envelope. Throws on any interchange-gate violation —
 * a malformed envelope must never reach the wire.
 */
export function makeEnvelope(fields: {
  kind: string;
  id: string;
  publisher: string;
  seq: number;
  ts: string;
  body: string;
  conversationId?: string;
  inReplyTo?: string;
}): EventEnvelope {
  if (!isNonEmptyString(fields.kind)) throw new Error('envelope.kind required');
  if (!isNonEmptyString(fields.id)) throw new Error('envelope.id required');
  if (!isNonEmptyString(fields.publisher)) throw new Error('envelope.publisher required');
  if (typeof fields.body !== 'string') throw new Error('envelope.body required (string)');
  if (typeof fields.seq !== 'number' || !Number.isInteger(fields.seq) || fields.seq < 0) {
    throw new Error('envelope.seq must be a non-negative integer');
  }
  if (!isNonEmptyString(fields.ts) || !ISO_8601.test(fields.ts)) {
    throw new Error('envelope.ts must be an ISO-8601 timestamp');
  }
  const env: EventEnvelope = {
    v: EVENT_ENVELOPE_VERSION,
    kind: fields.kind,
    id: fields.id,
    publisher: fields.publisher,
    seq: fields.seq,
    ts: fields.ts,
    body: fields.body,
  };
  if (fields.conversationId !== undefined) env.conversationId = fields.conversationId;
  if (fields.inReplyTo !== undefined) env.inReplyTo = fields.inReplyTo;
  return env;
}

/** Serialize to the wire (stable JSON). */
export function serializeEnvelope(env: EventEnvelope): string {
  return JSON.stringify(env);
}

export type ParseResult =
  | { ok: true; envelope: EventEnvelope }
  | { ok: false; error: string };

/**
 * Strict parser/validator. Never throws — returns `{ ok: false, error }` for
 * any malformed input so a foreign or corrupt payload degrades gracefully.
 */
export function parseEnvelope(wire: unknown): ParseResult {
  let raw: unknown;
  if (typeof wire === 'string') {
    try {
      raw = JSON.parse(wire);
    } catch {
      return { ok: false, error: 'not valid JSON' };
    }
  } else {
    raw = wire;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'not an object' };
  }
  const o = raw as Record<string, unknown>;
  if (o.v !== EVENT_ENVELOPE_VERSION) {
    return { ok: false, error: `unsupported version: ${String(o.v)}` };
  }
  try {
    const env = makeEnvelope({
      kind: o.kind as string,
      id: o.id as string,
      publisher: o.publisher as string,
      seq: o.seq as number,
      ts: o.ts as string,
      body: o.body as string,
      conversationId: o.conversationId as string | undefined,
      inReplyTo: o.inReplyTo as string | undefined,
    });
    return { ok: true, envelope: env };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface ReplayVerdict {
  accepted: boolean;
  reason: 'ok' | 'replay' | 'stale';
}

/**
 * Per-publisher monotonic replay guard. Accepts an envelope iff its `seq` is
 * strictly greater than the highest `seq` already seen from that publisher.
 * A duplicate seq is a `replay`; a lower seq is `stale` (reordered or replayed
 * by the relay). This is the subscriber-side check that makes the relay's
 * replay attack (PR #250) ineffective.
 *
 * State is bounded by the number of distinct publishers (O(publishers)), per the
 * runtime-verification "bounded monitor state" rule.
 */
export function createReplayGuard() {
  const lastSeqByPublisher = new Map<string, number>();
  return {
    accept(env: EventEnvelope): ReplayVerdict {
      const prev = lastSeqByPublisher.get(env.publisher);
      if (prev === undefined || env.seq > prev) {
        lastSeqByPublisher.set(env.publisher, env.seq);
        return { accepted: true, reason: 'ok' };
      }
      return { accepted: false, reason: env.seq === prev ? 'replay' : 'stale' };
    },
    lastSeq(publisher: string): number | undefined {
      return lastSeqByPublisher.get(publisher);
    },
    forget(publisher: string): void {
      lastSeqByPublisher.delete(publisher);
    },
  };
}

// ─── Structured error contract ──────────────────────────────────────────────
//
// agent-interchange-formats: "retry behavior is encoded structurally, not only
// described in prose." A caller must NEVER read a message string to decide
// whether to retry — it reads `retryable` and the bounded retry policy.

/** Closed enum of error codes the retry contract is built on. */
export const AGENT_ERROR_CODES = [
  'RATE_LIMITED',   // transient; retry after a delay
  'TIMEOUT',        // transient
  'UNAVAILABLE',    // transient (dependency down)
  'CONFLICT',       // transient (optimistic-concurrency retry)
  'VALIDATION_ERROR', // permanent; the request is malformed
  'NOT_FOUND',      // permanent
  'UNAUTHORIZED',   // permanent (re-auth is a different flow)
  'INTERNAL',       // ambiguous; non-retryable unless caller opts in
] as const;

export type AgentErrorCode = typeof AGENT_ERROR_CODES[number] | string;

/** Codes that are retryable by default (transient failures). */
const RETRYABLE_BY_DEFAULT = new Set(['RATE_LIMITED', 'TIMEOUT', 'UNAVAILABLE', 'CONFLICT']);

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  /** Machine-grade: may this operation be retried? */
  retryable: boolean;
  /** Base delay before the first retry, ms. */
  retryAfterMs?: number;
  /** Hard cap on retry attempts. */
  maxRetries?: number;
  /** Optional typed detail payload (audit-safe; no secrets). */
  details?: Record<string, unknown>;
}

/**
 * Build a structured error. `retryable` is derived from the code unless given
 * explicitly. Unknown codes default to NON-retryable (fail closed) — an
 * unrecognized failure is not silently retried.
 */
export function makeError(fields: {
  code: AgentErrorCode;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
  maxRetries?: number;
  details?: Record<string, unknown>;
}): AgentError {
  if (!isNonEmptyString(fields.code)) throw new Error('error.code required');
  if (typeof fields.message !== 'string') throw new Error('error.message required (string)');
  const retryable =
    typeof fields.retryable === 'boolean'
      ? fields.retryable
      : RETRYABLE_BY_DEFAULT.has(fields.code);
  const e: AgentError = { code: fields.code, message: fields.message, retryable };
  if (fields.retryAfterMs !== undefined) e.retryAfterMs = fields.retryAfterMs;
  if (fields.maxRetries !== undefined) e.maxRetries = fields.maxRetries;
  if (fields.details !== undefined) e.details = fields.details;
  return e;
}

export function isRetryable(e: AgentError): boolean {
  return e.retryable === true;
}

/**
 * Exponential backoff for retry `attempt` (1-based): base × 2^(attempt-1).
 * Returns null when the error is non-retryable or attempts are exhausted
 * (attempt > maxRetries) — the caller stops without prose-reading.
 */
export function nextRetryDelayMs(e: AgentError, attempt: number): number | null {
  if (!e.retryable) return null;
  const max = e.maxRetries ?? 0;
  if (attempt < 1 || attempt > max) return null;
  const base = e.retryAfterMs ?? 1000;
  return base * 2 ** (attempt - 1);
}

// ─── Streaming contract ─────────────────────────────────────────────────────
//
// agent-interchange-formats: "streaming contracts specify ordering and
// completion semantics." Every event carries a per-stream monotonic seq and a
// terminal marker; reassembly is order-independent, gap-detecting, and
// replay-idempotent.

export interface StreamEvent {
  streamId: string;
  seq: number;
  chunk: string;
  /** true on the final event of the stream. */
  done: boolean;
}

export interface StreamResult {
  text: string;
  complete: boolean;
  error: string | null;
}

export function makeStreamEvent(fields: {
  streamId: string;
  seq: number;
  chunk: string;
  done?: boolean;
}): StreamEvent {
  if (!isNonEmptyString(fields.streamId)) throw new Error('streamEvent.streamId required');
  if (typeof fields.seq !== 'number' || !Number.isInteger(fields.seq) || fields.seq < 0) {
    throw new Error('streamEvent.seq must be a non-negative integer');
  }
  if (typeof fields.chunk !== 'string') throw new Error('streamEvent.chunk must be a string');
  return { streamId: fields.streamId, seq: fields.seq, chunk: fields.chunk, done: fields.done === true };
}

/**
 * Reassemble stream events deterministically:
 *   - all events must share one streamId (no cross-stream mixing);
 *   - ordered by seq (out-of-order input is fine);
 *   - duplicate seq is idempotent (relay replay can't double a chunk);
 *   - a missing seq is reported as a gap, not silently concatenated;
 *   - `complete` iff a `done` event is present AND the sequence is gap-free
 *     from 0 through the terminal seq.
 */
export function assembleStream(events: StreamEvent[]): StreamResult {
  if (events.length === 0) return { text: '', complete: false, error: null };
  const streamId = events[0].streamId;
  if (events.some((e) => e.streamId !== streamId)) {
    return { text: '', complete: false, error: `mixed streamId in event set (expected ${streamId})` };
  }
  // Dedup by seq (idempotent); last write wins for a given seq.
  const bySeq = new Map<number, StreamEvent>();
  for (const e of events) bySeq.get(e.seq) ?? bySeq.set(e.seq, e);
  const seqs = [...bySeq.keys()].sort((a, b) => a - b);
  const doneEvent = events.find((e) => e.done);
  // Gap check: contiguous 0..max present.
  const max = seqs[seqs.length - 1];
  const missing: number[] = [];
  for (let i = 0; i <= max; i++) if (!bySeq.has(i)) missing.push(i);
  const text = seqs.map((s) => bySeq.get(s)!.chunk).join('');
  if (missing.length > 0) {
    return { text, complete: false, error: `gap: missing seq ${missing.join(',')}` };
  }
  return { text, complete: doneEvent !== undefined, error: null };
}
