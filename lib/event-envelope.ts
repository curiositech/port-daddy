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
 * gap proven open in `analyses/relay_e2e_secrecy.pv` (PR #250): a stateless
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
