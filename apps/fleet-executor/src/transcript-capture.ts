/**
 * pd-transcript.v1 — raw multi-turn session capture for fleet ships.
 *
 * PURPOSE: the curated `fleet_run_steps` transcript answers *what a ship
 * concluded*; nothing durable answered *why* — every `env.AI.run(...)` return
 * was parsed for a verdict and dropped. This module is the capture layer the
 * RFC (docs/FLEET-SESSION-TRANSCRIPTS.md) designs: it records each model
 * call's request messages and response as versioned JSONL turn envelopes,
 * buffered in memory per (run, ship, attempt) and flushed once — to an R2
 * object plus one D1 index row — when the ship completes or errors.
 *
 * DESIGN INVARIANTS (each one is load-bearing; see the RFC's format rules):
 *  - Capture NEVER fails a run. Every recording call is fail-open: an internal
 *    throw increments a dropped-turns counter and marks the transcript
 *    `incomplete` instead of propagating. The transcript is evidence, not a
 *    dependency.
 *  - The envelope is schema-first: mandatory `v`, a closed `kind` union, a
 *    monotonic `seq` per (run, ship, attempt), parts-array `content`, and
 *    EXPLICIT truncation markers — silent truncation reads as "complete" and
 *    poisons forensics.
 *  - System prompts are deduplicated by content hash (`sysRef`): a MAP fan-out
 *    sends the same multi-KB system prompt once per chunk; storing it once per
 *    object keeps a 7-chunk run from carrying 7 copies.
 *  - A scrub pass runs on every recorded text before it is buffered: GitHub
 *    token shapes, JWTs, and Authorization headers are masked. Prompts are
 *    built from repo content that is already PR-visible, so this is defense in
 *    depth, not the primary secrecy boundary.
 */

import { extractAiText } from './ai-response.js';
import { extractWorkersAiUsage } from './telemetry.js';
import { costUsdForModel } from './spend.js';

/** Wire-format major version. Readers reject unknown majors rather than guess. */
export const PD_TRANSCRIPT_VERSION = 1;

/**
 * Which stage of a ship's pipeline produced a turn. A closed set so the
 * viewers can render phase chips without guessing; additions are minor bumps.
 */
export type TranscriptPhase =
  | 'map'
  | 'reduce'
  | 'main'
  | 'repair'
  | 'steelman'
  | 'plan'
  | 'author'
  | 'gate'
  | 'purser'
  | 'xo'
  | 'ideation';

/** Closed turn-kind union — the discriminator every reader switches on. */
export type TranscriptTurnKind = 'system' | 'user' | 'assistant' | 'error';

/** MAP fan-out position, when the turn belongs to one chunk of several. */
export interface TranscriptChunk {
  index: number;
  count: number;
}

/** One pd-transcript.v1 envelope — one JSONL line. */
export interface TranscriptTurn {
  v: typeof PD_TRANSCRIPT_VERSION;
  runId: string;
  ship: string;
  attempt: number;
  seq: number;
  phase: TranscriptPhase;
  chunk: TranscriptChunk | null;
  kind: TranscriptTurnKind;
  model: string;
  /** Unix seconds when the turn was recorded. */
  ts: number;
  /** Model round-trip in ms — assistant/error turns only. */
  latencyMs: number | null;
  /** Workers AI usage block, when the response carried one. */
  usage: { prompt: number; completion: number } | null;
  /** Per-call cost at this call's model rate — assistant turns only. */
  costUsd: number | null;
  /** Parts array (text-only in v1) so richer parts can arrive additively. */
  content: Array<{ type: 'text'; text: string }>;
  /**
   * Content hash of a system prompt. The FIRST turn carrying a given hash
   * includes the full text; repeats carry the hash with empty content and
   * readers resolve it against the earlier turn.
   */
  sysRef: string | null;
  truncated: boolean;
}

/** Per-turn text ceiling — beyond this the text is cut with a marker. */
const MAX_TURN_TEXT_CHARS = 256 * 1024;
/** Whole-object budget — beyond this new turns keep metadata, drop bodies. */
const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;

/**
 * Mask credential-shaped substrings before anything is buffered.
 *
 * WHY these patterns: GitHub App installation tokens (`ghs_…`) are the one
 * secret that legitimately exists near this code path; PATs, JWT triples, and
 * `Authorization:` headers are the shapes a prompt-injection or template bug
 * would most plausibly leak. The scrub is deliberately shape-based (no
 * allowlists to rot) and idempotent.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, '[scrubbed:github-token]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[scrubbed:github-token]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
      '[scrubbed:jwt]',
    )
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|token|basic)\s+)[^\s"'`]+/gi, '$1[scrubbed]');
}

/**
 * Small synchronous content hash for system-prompt dedup (`sysRef`).
 *
 * MOTIVATION: this is an identity key inside ONE transcript object, not a
 * security primitive — collisions merely merge two prompts' dedup slots — so a
 * dependency-free FNV-1a over UTF-16 code units beats an async
 * `crypto.subtle` round-trip on a hot per-call path.
 */
export function sysPromptHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a:${(h >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

/** Chat-shaped request payload as the call sites already build it. */
interface CapturedRequest {
  messages?: Array<{ role?: string; content?: unknown }>;
}

/** Per-call metadata the wrapper stamps onto every recorded turn. */
export interface CaptureMeta {
  phase: TranscriptPhase;
  model: string;
  chunk?: TranscriptChunk;
}

/**
 * In-memory turn buffer for one (run, ship, attempt).
 *
 * DESIGN: the buffer is created where the ship starts (the orchestrator knows
 * runId + attempt), threaded down through the call helpers, and flushed
 * exactly once via {@link flushShipTranscript}. Buffering instead of streaming
 * keeps the R2 write to one PUT per ship and lets a crashed ship still flush
 * whatever it captured from its error path.
 */
export class ShipTranscript {
  readonly runId: string;
  readonly ship: string;
  readonly attempt: number;
  private readonly turns: TranscriptTurn[] = [];
  private readonly seenSystemHashes = new Set<string>();
  private seq = 0;
  private approxBytes = 0;
  private droppedTurns = 0;

  constructor(runId: string, ship: string, attempt: number) {
    this.runId = runId;
    this.ship = ship;
    this.attempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  }

  /** True when any recording failed or the byte budget forced body drops. */
  get incomplete(): boolean {
    return this.droppedTurns > 0;
  }

  /** Number of buffered turns (metadata for the index row and tests). */
  get turnCount(): number {
    return this.turns.length;
  }

  /**
   * Record the outbound request messages as system/user turns. System prompts
   * are hash-deduplicated per the format rules. Fail-open: any internal error
   * counts a dropped turn and returns.
   */
  recordRequest(meta: CaptureMeta, request: unknown): void {
    try {
      const messages = (request as CapturedRequest)?.messages;
      if (!Array.isArray(messages)) return;
      for (const message of messages) {
        const text = typeof message?.content === 'string' ? message.content : '';
        const role = message?.role === 'system' ? 'system' : 'user';
        if (role === 'system') {
          const hash = sysPromptHash(text);
          const repeat = this.seenSystemHashes.has(hash);
          this.seenSystemHashes.add(hash);
          this.push(meta, 'system', repeat ? '' : text, {
            sysRef: hash,
            forceEmpty: repeat,
          });
        } else {
          this.push(meta, 'user', text, {});
        }
      }
    } catch {
      this.droppedTurns += 1;
    }
  }

  /**
   * Record the model's reply as one assistant turn, with usage, per-call cost
   * at THIS call's model rate, and latency. Fail-open like every recorder.
   */
  recordResponse(meta: CaptureMeta, res: unknown, latencyMs: number): void {
    try {
      const { text } = extractAiText(res);
      const u = extractWorkersAiUsage(res);
      const usage =
        u.inputTokens != null || u.outputTokens != null
          ? { prompt: u.inputTokens ?? 0, completion: u.outputTokens ?? 0 }
          : null;
      const costUsd = usage
        ? costUsdForModel(meta.model, usage.prompt, usage.completion)
        : null;
      this.push(meta, 'assistant', text, { latencyMs, usage, costUsd });
    } catch {
      this.droppedTurns += 1;
    }
  }

  /** Record a thrown call as an error turn (the caller still rethrows). */
  recordError(meta: CaptureMeta, error: unknown, latencyMs: number): void {
    try {
      this.push(meta, 'error', String(error).slice(0, 4096), { latencyMs });
    } catch {
      this.droppedTurns += 1;
    }
  }

  private push(
    meta: CaptureMeta,
    kind: TranscriptTurnKind,
    rawText: string,
    extra: {
      sysRef?: string;
      forceEmpty?: boolean;
      latencyMs?: number;
      usage?: { prompt: number; completion: number } | null;
      costUsd?: number | null;
    },
  ): void {
    let text = scrubSecrets(rawText);
    let truncated = false;
    if (text.length > MAX_TURN_TEXT_CHARS) {
      text = text.slice(0, MAX_TURN_TEXT_CHARS);
      truncated = true;
    }
    if (this.approxBytes >= MAX_TRANSCRIPT_BYTES && text.length > 0) {
      // Budget exhausted: keep the turn's METADATA (seq/phase/usage stay
      // forensically useful) but drop the body, explicitly marked.
      text = '';
      truncated = true;
      this.droppedTurns += 1;
    }
    if (extra.forceEmpty) text = '';
    const turn: TranscriptTurn = {
      v: PD_TRANSCRIPT_VERSION,
      runId: this.runId,
      ship: this.ship,
      attempt: this.attempt,
      seq: this.seq++,
      phase: meta.phase,
      chunk: meta.chunk ?? null,
      kind,
      model: meta.model,
      ts: Math.floor(Date.now() / 1000),
      latencyMs: extra.latencyMs ?? null,
      usage: extra.usage ?? null,
      costUsd: extra.costUsd ?? null,
      content: text ? [{ type: 'text', text }] : [],
      sysRef: extra.sysRef ?? null,
      truncated,
    };
    this.turns.push(turn);
    this.approxBytes += text.length + 220;
  }

  /** Serialize the buffer as JSONL — one envelope per line, trailing newline. */
  serialize(): string {
    return this.turns.map(t => JSON.stringify(t)).join('\n') + (this.turns.length ? '\n' : '');
  }

  /** Aggregates for the D1 index row (models seen, token/cost sums). */
  summary(): {
    models: string[];
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  } {
    const models = new Set<string>();
    let promptTokens = 0;
    let completionTokens = 0;
    let costUsd = 0;
    for (const t of this.turns) {
      if (t.kind !== 'assistant') continue;
      models.add(t.model);
      promptTokens += t.usage?.prompt ?? 0;
      completionTokens += t.usage?.completion ?? 0;
      costUsd += t.costUsd ?? 0;
    }
    return {
      models: [...models],
      promptTokens,
      completionTokens,
      costUsd: Math.round(costUsd * 1e6) / 1e6,
    };
  }
}

/**
 * The capture chokepoint every conversational model call adopts: records the
 * request turns, times the call, records the response (or error, before
 * rethrowing so circuit/retry semantics are untouched), and returns the raw
 * result unchanged.
 *
 * WHY a wrapper instead of instrumenting `env.AI.run` itself: the call sites
 * already compose circuit-breaker + gateway layers around the binding; a
 * wrapper OUTSIDE that composition sees exactly one logical call per turn,
 * whatever retries happen inside. Passing `capture: null` (tests, gated-off
 * paths) degrades to a plain call — the tap must never be a dependency.
 * The capture-skew test (tests/transcript-capture-skew.test.ts) enforces that
 * every `env.AI.run(` call site either sits inside a `runCaptured(` thunk or
 * carries an explicit `transcript-capture: exempt` marker.
 */
export async function runCaptured<T>(
  capture: ShipTranscript | null | undefined,
  meta: CaptureMeta,
  request: unknown,
  call: () => Promise<T>,
): Promise<T> {
  capture?.recordRequest(meta, request);
  const started = Date.now();
  try {
    const res = await call();
    capture?.recordResponse(meta, res, Date.now() - started);
    return res;
  } catch (error) {
    capture?.recordError(meta, error, Date.now() - started);
    throw error;
  }
}

/** R2 key for one transcript object — the read path derives the same key. */
export function transcriptObjectKey(runId: string, ship: string, attempt: number): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9:_.-]/g, '_');
  return `v1/${safe(runId)}/${safe(ship)}.${attempt}.jsonl`;
}

/** The two bindings the flush needs; both optional so absence is fail-open. */
export interface TranscriptFlushEnv {
  TRANSCRIPTS?: R2Bucket;
  DB?: D1Database;
}

/**
 * Write the buffered transcript once: the JSONL object to R2, then one
 * `fleet_run_transcripts` index row to D1. Best-effort at every layer — a
 * missing binding, a pre-migration database, or an R2 outage logs and returns;
 * it NEVER changes the run. The index row is only written after the object PUT
 * succeeds, so an index row always points at real bytes.
 */
export async function flushShipTranscript(
  env: TranscriptFlushEnv,
  capture: ShipTranscript | null | undefined,
): Promise<void> {
  if (!capture || capture.turnCount === 0) return;
  if (!env.TRANSCRIPTS) return; // no bucket bound ⇒ capture is dark, by design
  const key = transcriptObjectKey(capture.runId, capture.ship, capture.attempt);
  let body: string;
  try {
    body = capture.serialize();
  } catch (err) {
    console.error(`[fleet-executor] transcript serialize failed ${key}: ${String(err)}`);
    return;
  }
  try {
    await env.TRANSCRIPTS.put(key, body, {
      httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' },
    });
  } catch (err) {
    console.error(`[fleet-executor] transcript R2 put failed ${key}: ${String(err)}`);
    return;
  }
  if (!env.DB) return;
  const s = capture.summary();
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO fleet_run_transcripts
         (run_id, ship, attempt, r2_key, turns, bytes, models_csv,
          prompt_tokens, completion_tokens, cost_usd, incomplete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        capture.runId,
        capture.ship,
        capture.attempt,
        key,
        capture.turnCount,
        body.length,
        s.models.join(','),
        s.promptTokens,
        s.completionTokens,
        s.costUsd,
        capture.incomplete ? 1 : 0,
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch (err) {
    // Pre-migration D1 (missing table) or transient failure: the object is
    // still in R2 under a deterministic key; the index is a convenience.
    console.error(
      `[fleet-executor] fleet_run_transcripts insert failed ${key}: ${String(err)}`,
    );
  }
}
