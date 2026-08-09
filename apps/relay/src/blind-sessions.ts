/**
 * BLIND SESSIONS substrate — sealed-charter skill escrow, first slice
 * (grand-plan DAG node blind-sessions; task label X5; plan §L2 blind room).
 *
 * A borrower invokes a lender's sealed skill without either side seeing the
 * other's material. The protocol, end to end:
 *
 *   1. PUBLISH   (lender, chained)   POST /v1/blind/skills
 *      The lender registers skill METADATA — harbor scope, title, and the
 *      output contract — as a signed, chained relay event under its own
 *      identity. The skill MATERIAL is never in this call: the relay stores
 *      no plaintext skill text, ever.
 *   2. MINT      (lender, chained)   POST /v1/blind/capabilities
 *      The lender mints the borrower an execute-only capability token
 *      (ADR-0101 HMAC style) with caveats {skill_id, harbor, max_runs, exp}.
 *      Only the skill's registered lender fingerprint may mint.
 *   3. RUN       (borrower, token)   POST /v1/blind/runs
 *      The borrower presents the token + an input. Every caveat is enforced
 *      here — expiry, harbor, revocation, and max_runs via an ATOMIC D1
 *      counter (the replay containment: the token itself is stateless, the
 *      ledger is the authority). A run row enters 'awaiting-key'.
 *   4. KEY       (executor, chained) POST /v1/blind/runs/:id/key
 *      The executor sandbox posts its PER-RUN ephemeral P-256 public key.
 *      The sender is pinned to the run: only this fingerprint may conclude.
 *   5. SEAL      (lender, chained)   POST /v1/blind/runs/:id/seal
 *      The lender seals the skill text to the run's ephemeral key (pd-seal/1,
 *      ECDH-P256 + HKDF-SHA256 + AES-256-GCM — apps/fleet-executor/src/
 *      blind-run.ts) and posts the ciphertext. The relay stores bytes it
 *      cannot open: no private key ever exists relay-side.
 *   6. CONCLUDE  (executor, chained) POST /v1/blind/runs/:id/conclude
 *      The executor returns either a contract-conforming output or an honest
 *      refusal, plus the signed per-run receipt {run_id, skill_id,
 *      verdict_hash, tokens_used, iat}. The relay RE-ENFORCES the output
 *      contract (the tripwire — a violation here means the named TCB
 *      misbehaved and the run is refused, nothing stored for the borrower)
 *      and verifies verdict_hash against its own canonical recomputation
 *      before storing one receipt row per side with the conclude event's
 *      chain coordinates — receipt parity by construction.
 *
 * TRUST BOUNDARIES (doctrine D8 — the /trust page carries the full table):
 *   - Skill material at rest / in transit through the relay: CRYPTO (sealed
 *     to a key whose private half never leaves the executor sandbox).
 *   - Capability integrity: CRYPTO (HMAC-SHA256). Capability AUTHORITY:
 *     POLICY — the relay can mint any token it likes; caveats bind the
 *     relay's enforcement, not the laws of mathematics.
 *   - Mutual blindness of lender and borrower: POLICY on a NAMED TCB — the
 *     executor sandbox. The borrower chooses inputs, so every run is a
 *     model-extraction oracle; the output contract raises the cost of
 *     exfiltration (field whitelist + type check + length cap), it does not
 *     make it impossible. Never sold as math.
 *   - Blind to Port Daddy: FALSE, and never claimed — borrower_input is
 *     relay-readable by design.
 *   - Egress lockdown: POLICY, and the stage kill switch — the executor
 *     refuses to run without the egress-locked attestation (fail-closed),
 *     and the relay-side `fleet:kill-blind` flag makes every route here
 *     refuse before any read or write.
 *
 * Machine-route verification DELEGATES to handlePublish (the one publish
 * implementation — identity, revocation, capability, hash chain, signature),
 * exactly as src/mediator-body.ts does and for the same reason: a second
 * verification path would drift, and this one mints RUNS.
 *
 * OUT OF SCOPE (L1/L2 proper, stated in the node spec): royalties,
 * sea-trials, arbitration, marketplace listings, and the ProVerif model of
 * the broker role.
 */

import type { Env } from './types.js';
import { hashHex, randomHex, timingSafeEqual } from './crypto.js';
import { handlePublish, operatorOnly } from './handlers.js';
import { getIdentity } from './db.js';

// ── Policy constants ─────────────────────────────────────────────────────────

/** Schema tag inside every blind chain event's ciphertext. */
export const BLIND_SCHEMA = 'blind/1';

/** Sealed-payload envelope version (produced lender-side, opened sandbox-side). */
export const BLIND_SEAL_VERSION = 'pd-seal/1';

/** Capability token prefix — `bcap.v1.<payload-b64url>.<hmac-hex>`. */
export const BLIND_CAP_PREFIX = 'bcap.v1.';

/** Lender read-token prefix — `blnd.v1.<hmac-hex>`. */
export const BLIND_LENDER_PREFIX = 'blnd.v1.';

/** KV kill flag (N6 machinery, same shape as fleet:paused / kill-mediator). */
export const KILL_BLIND_KEY = 'fleet:kill-blind';

/** Default + hard cap on a string field's length when the schema names none. */
export const BLIND_DEFAULT_MAX_STRING = 2000;
export const BLIND_MAX_STRING_CAP = 4000;

/** Most fields an output contract may declare (an output is a verdict, not a dump). */
export const BLIND_MAX_SCHEMA_FIELDS = 20;

/** Caps on borrower input / titles (relay-readable, so bounded like any intake). */
export const MAX_BORROWER_INPUT_CHARS = 8000;
export const MAX_SKILL_TITLE_CHARS = 200;

/** Capability bounds. */
export const BLIND_MAX_RUNS_CAP = 1000;
export const BLIND_CAP_MAX_TTL_SECONDS = 90 * 24 * 3600;

// ── Output contract (the redaction gate) ─────────────────────────────────────
//
// PARITY-PINNED twin of apps/fleet-executor/src/blind-run.ts
// enforceBlindOutputContract, locked by
// tests/fixtures/blind-output-contract-parity-vectors.json (asserted from BOTH
// vitest suites, on the run-page-token-parity model). Any change here must
// land with the fixture + the executor twin in the same PR.

export interface BlindFieldSpec {
  type: 'string' | 'number' | 'boolean';
  maxLength?: number;
}

export interface BlindOutputSchema {
  fields: Record<string, BlindFieldSpec>;
  required?: string[];
}

export type ContractResult =
  | { ok: true; output: Record<string, string | number | boolean> }
  | { ok: false; reason: string };

/**
 * Validate an output-contract schema itself (enforced at skill publish —
 * a skill without a well-formed contract cannot exist; fail-closed).
 * @returns the typed schema or a string error.
 */
export function validateOutputSchema(v: unknown): BlindOutputSchema | string {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'output_schema must be an object';
  const s = v as { fields?: unknown; required?: unknown };
  if (typeof s.fields !== 'object' || s.fields === null || Array.isArray(s.fields)) {
    return 'output_schema.fields must be an object';
  }
  const names = Object.keys(s.fields as Record<string, unknown>);
  if (names.length === 0) return 'output_schema.fields must declare at least one field';
  if (names.length > BLIND_MAX_SCHEMA_FIELDS) return `output_schema is capped at ${BLIND_MAX_SCHEMA_FIELDS} fields`;
  const fields: Record<string, BlindFieldSpec> = {};
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) return `field name '${name}' is not a valid identifier`;
    const f = (s.fields as Record<string, unknown>)[name] as { type?: unknown; maxLength?: unknown };
    if (f?.type !== 'string' && f?.type !== 'number' && f?.type !== 'boolean') {
      return `field '${name}' type must be string|number|boolean`;
    }
    const spec: BlindFieldSpec = { type: f.type };
    if (f.maxLength !== undefined) {
      if (
        typeof f.maxLength !== 'number' ||
        !Number.isInteger(f.maxLength) ||
        f.maxLength < 1 ||
        f.maxLength > BLIND_MAX_STRING_CAP
      ) {
        return `field '${name}' maxLength must be an integer in [1, ${BLIND_MAX_STRING_CAP}]`;
      }
      spec.maxLength = f.maxLength;
    }
    fields[name] = spec;
  }
  let required: string[] | undefined;
  if (s.required !== undefined) {
    if (!Array.isArray(s.required)) return 'output_schema.required must be an array of field names';
    for (const r of s.required) {
      if (typeof r !== 'string' || !(r in fields)) return `required field '${String(r)}' is not declared in fields`;
    }
    required = s.required as string[];
  }
  return required !== undefined ? { fields, required } : { fields };
}

/**
 * Enforce the output contract — the redaction gate between the sandbox and
 * the borrower. REFUSES the whole output on any violation rather than
 * stripping: a partially-stripped output could still leak through presence
 * patterns, and fail-closed is the honest posture on an exfiltration channel.
 *
 * Containment story (D8, honestly): undeclared fields, nested values, wrong
 * types, and over-length strings are refused outright; what remains — skill
 * text smuggled INSIDE a declared string field under its length cap — is the
 * stated residual risk. The contract is cost-raising, not math.
 */
export function enforceBlindOutputContract(schema: BlindOutputSchema, candidate: unknown): ContractResult {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { ok: false, reason: 'output must be a JSON object' };
  }
  const c = candidate as Record<string, unknown>;
  for (const key of Object.keys(c)) {
    if (!(key in schema.fields)) return { ok: false, reason: `undeclared field '${key}'` };
  }
  for (const req of schema.required ?? []) {
    if (!(req in c)) return { ok: false, reason: `missing required field '${req}'` };
  }
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(c)) {
    // key ∈ schema.fields — the undeclared-field loop above already refused any other.
    const spec = schema.fields[key]!;
    if (typeof value !== spec.type) return { ok: false, reason: `field '${key}' must be ${spec.type}` };
    if (spec.type === 'string') {
      const cap = spec.maxLength ?? BLIND_DEFAULT_MAX_STRING;
      if ((value as string).length > cap) return { ok: false, reason: `field '${key}' exceeds maxLength ${cap}` };
    }
    if (spec.type === 'number' && !Number.isFinite(value as number)) {
      return { ok: false, reason: `field '${key}' must be a finite number` };
    }
    out[key] = value as string | number | boolean;
  }
  return { ok: true, output: out };
}

/**
 * Canonical JSON for verdict hashing: keys sorted, no whitespace, scalars
 * only (the contract guarantees a flat object). MUST stay byte-identical to
 * the executor twin — pinned by the parity fixture's verdictVectors.
 */
export function canonicalBlindJson(output: Record<string, string | number | boolean>): string {
  const keys = Object.keys(output).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(output[k])}`).join(',')}}`;
}

/** sha256 hex of the canonical output — the receipt's verdict_hash. */
export function blindVerdictHash(output: Record<string, string | number | boolean>): string {
  return hashHex(canonicalBlindJson(output));
}

/** verdict_hash of an honest refusal: hash of the `{refused: reason}` marker. */
export function blindRefusalHash(reason: string): string {
  return blindVerdictHash({ refused: reason });
}

// ── Capability tokens (ADR-0101 HMAC style) ──────────────────────────────────

export interface BlindCapPayload {
  v: 1;
  jti: string;
  skill_id: string;
  harbor: string;
  max_runs: number;
  exp: number;
}

function b64urlEncodeString(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecodeToString(input: string): string | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = 4 - (padded.length % 4 || 4);
    const bin = atob(padded + '='.repeat(pad === 4 ? 0 : pad));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mint a borrower capability token. The signed portion is the literal string
 * `bcap.v1.<payload-b64url>` so a swapped prefix or payload invalidates the
 * MAC; the caveats also live in blind_capabilities because the DB — not the
 * token — is the authority for runs_used and revocation.
 */
export async function mintBlindCapability(secret: string, payload: BlindCapPayload): Promise<string> {
  const body = `${BLIND_CAP_PREFIX}${b64urlEncodeString(JSON.stringify(payload))}`;
  return `${body}.${await hmacHex(secret, body)}`;
}

/**
 * Verify a presented capability token's INTEGRITY and parse its caveats.
 * Deliberately does NOT consult the ledger — callers do stateful caveat
 * enforcement (expiry against now, harbor against the skill row, max_runs
 * via the atomic spend) so each refusal has one owner and one honest code.
 */
export async function verifyBlindCapability(secret: string, presented: string): Promise<BlindCapPayload | null> {
  if (!presented.startsWith(BLIND_CAP_PREFIX)) return null;
  const lastDot = presented.lastIndexOf('.');
  if (lastDot <= BLIND_CAP_PREFIX.length) return null;
  const body = presented.slice(0, lastDot);
  const mac = presented.slice(lastDot + 1);
  if (!/^[0-9a-f]{64}$/.test(mac)) return null;
  if (!timingSafeEqual(mac, await hmacHex(secret, body))) return null;
  const decoded = b64urlDecodeToString(body.slice(BLIND_CAP_PREFIX.length));
  if (decoded === null) return null;
  try {
    const p = JSON.parse(decoded) as BlindCapPayload;
    if (
      p.v !== 1 ||
      typeof p.jti !== 'string' ||
      typeof p.skill_id !== 'string' ||
      typeof p.harbor !== 'string' ||
      typeof p.max_runs !== 'number' ||
      typeof p.exp !== 'number'
    ) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/** Lender read token: `blnd.v1.<hex(HMAC(secret, 'lender|'+skill_id))>`. */
export async function mintLenderToken(secret: string, skillId: string): Promise<string> {
  return `${BLIND_LENDER_PREFIX}${await hmacHex(secret, `lender|${skillId}`)}`;
}

export async function verifyLenderToken(secret: string, skillId: string, presented: string): Promise<boolean> {
  if (!presented.startsWith(BLIND_LENDER_PREFIX)) return false;
  const mac = presented.slice(BLIND_LENDER_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(mac)) return false;
  return timingSafeEqual(mac, await hmacHex(secret, `lender|${skillId}`));
}

// ── D1 rows + access (self-contained: no db.ts churn) ────────────────────────

export interface BlindSkillRow {
  skill_id: string;
  harbor: string;
  lender_fingerprint: string;
  title: string;
  output_schema_json: string;
  created_at: number;
  revoked: number;
}

export interface BlindCapabilityRow {
  jti: string;
  skill_id: string;
  harbor: string;
  max_runs: number;
  runs_used: number;
  exp: number;
  created_at: number;
  revoked: number;
}

export type BlindRunStatus = 'awaiting-key' | 'key-ready' | 'sealed' | 'concluded' | 'refused';

export interface BlindRunRow {
  run_id: string;
  skill_id: string;
  jti: string;
  harbor: string;
  borrower_input: string;
  status: BlindRunStatus;
  refusal_reason: string | null;
  executor_fingerprint: string | null;
  run_pubkey: string | null;
  sealed_payload_json: string | null;
  output_json: string | null;
  verdict_hash: string | null;
  tokens_used: number | null;
  created_at: number;
  concluded_at: number | null;
}

export interface BlindReceiptRow {
  run_id: string;
  side: 'lender' | 'borrower';
  body_json: string;
  chain_channel: string;
  chain_seq: number;
  chain_hash: string;
  created_at: number;
}

async function getBlindSkill(db: D1Database, skillId: string): Promise<BlindSkillRow | null> {
  return db
    .prepare(
      'SELECT skill_id, harbor, lender_fingerprint, title, output_schema_json, created_at, revoked FROM blind_skills WHERE skill_id = ?',
    )
    .bind(skillId)
    .first<BlindSkillRow>();
}

async function insertBlindSkill(db: D1Database, row: BlindSkillRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO blind_skills (skill_id, harbor, lender_fingerprint, title, output_schema_json, created_at, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)',
    )
    .bind(row.skill_id, row.harbor, row.lender_fingerprint, row.title, row.output_schema_json, row.created_at)
    .run();
}

async function getBlindCapability(db: D1Database, jti: string): Promise<BlindCapabilityRow | null> {
  return db
    .prepare(
      'SELECT jti, skill_id, harbor, max_runs, runs_used, exp, created_at, revoked FROM blind_capabilities WHERE jti = ?',
    )
    .bind(jti)
    .first<BlindCapabilityRow>();
}

async function insertBlindCapability(db: D1Database, row: BlindCapabilityRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO blind_capabilities (jti, skill_id, harbor, max_runs, runs_used, exp, created_at, revoked) VALUES (?, ?, ?, ?, 0, ?, ?, 0)',
    )
    .bind(row.jti, row.skill_id, row.harbor, row.max_runs, row.exp, row.created_at)
    .run();
}

/**
 * Spend ONE run unit — the replay containment. Atomic conditional UPDATE:
 * a replayed token races here and exactly max_runs winners ever exist.
 * @returns true when a unit was spent.
 */
async function spendBlindRunUnit(db: D1Database, jti: string): Promise<boolean> {
  const res = await db
    .prepare('UPDATE blind_capabilities SET runs_used = runs_used + 1 WHERE jti = ? AND revoked = 0 AND runs_used < max_runs')
    .bind(jti)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

async function getBlindRun(db: D1Database, runId: string): Promise<BlindRunRow | null> {
  return db
    .prepare(
      'SELECT run_id, skill_id, jti, harbor, borrower_input, status, refusal_reason, executor_fingerprint, run_pubkey, sealed_payload_json, output_json, verdict_hash, tokens_used, created_at, concluded_at FROM blind_runs WHERE run_id = ?',
    )
    .bind(runId)
    .first<BlindRunRow>();
}

async function insertBlindRun(db: D1Database, row: BlindRunRow): Promise<void> {
  await db
    .prepare(
      "INSERT INTO blind_runs (run_id, skill_id, jti, harbor, borrower_input, status, created_at) VALUES (?, ?, ?, ?, ?, 'awaiting-key', ?)",
    )
    .bind(row.run_id, row.skill_id, row.jti, row.harbor, row.borrower_input, row.created_at)
    .run();
}

/** CAS 'awaiting-key' → 'key-ready', pinning the executor. @returns won. */
async function setBlindRunKey(db: D1Database, runId: string, pubkey: string, executorFp: string): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE blind_runs SET status = 'key-ready', run_pubkey = ?, executor_fingerprint = ? WHERE run_id = ? AND status = 'awaiting-key'",
    )
    .bind(pubkey, executorFp, runId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** CAS 'key-ready' → 'sealed'. @returns won. */
async function setBlindRunSealed(db: D1Database, runId: string, sealedJson: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE blind_runs SET status = 'sealed', sealed_payload_json = ? WHERE run_id = ? AND status = 'key-ready'")
    .bind(sealedJson, runId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * CAS 'sealed' → 'concluded' with the borrower-visible result. An honest
 * executor refusal is still a CONCLUDED run (tokens were spent, receipts
 * exist) — output_json stays null and refusal_reason says why. @returns won.
 */
async function setBlindRunConcluded(
  db: D1Database,
  args: { runId: string; outputJson: string | null; refusalReason: string | null; verdictHash: string; tokensUsed: number; at: number },
): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE blind_runs SET status = 'concluded', output_json = ?, refusal_reason = ?, verdict_hash = ?, tokens_used = ?, concluded_at = ? WHERE run_id = ? AND status = 'sealed'",
    )
    .bind(args.outputJson, args.refusalReason, args.verdictHash, args.tokensUsed, args.at, args.runId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Fail-closed terminal: any state → 'refused' with an honest reason. */
async function setBlindRunRefused(db: D1Database, runId: string, reason: string, at: number): Promise<void> {
  await db
    .prepare(
      "UPDATE blind_runs SET status = 'refused', refusal_reason = ?, concluded_at = ? WHERE run_id = ? AND status != 'concluded'",
    )
    .bind(reason.slice(0, 300), at, runId)
    .run();
}

async function listBlindRunsBySkillStatus(db: D1Database, skillId: string, status: BlindRunStatus): Promise<BlindRunRow[]> {
  const res = await db
    .prepare(
      'SELECT run_id, skill_id, jti, harbor, borrower_input, status, refusal_reason, executor_fingerprint, run_pubkey, sealed_payload_json, output_json, verdict_hash, tokens_used, created_at, concluded_at FROM blind_runs WHERE skill_id = ? AND status = ? ORDER BY created_at ASC',
    )
    .bind(skillId, status)
    .all<BlindRunRow>();
  return res.results;
}

async function insertBlindReceipt(db: D1Database, row: BlindReceiptRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO blind_receipts (run_id, side, body_json, chain_channel, chain_seq, chain_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(row.run_id, row.side, row.body_json, row.chain_channel, row.chain_seq, row.chain_hash, row.created_at)
    .run();
}

async function getBlindReceipt(db: D1Database, runId: string, side: 'lender' | 'borrower'): Promise<BlindReceiptRow | null> {
  return db
    .prepare(
      'SELECT run_id, side, body_json, chain_channel, chain_seq, chain_hash, created_at FROM blind_receipts WHERE run_id = ? AND side = ?',
    )
    .bind(runId, side)
    .first<BlindReceiptRow>();
}

// ── Kill flag ────────────────────────────────────────────────────────────────

export async function getBlindKilled(kv: KVNamespace): Promise<boolean> {
  try {
    const v = await kv.get(KILL_BLIND_KEY);
    if (v === null) return false;
    if (v === 'true') return true;
    if (v === 'false') return false;
    try {
      return (JSON.parse(v) as { killed?: boolean }).killed === true;
    } catch {
      return false;
    }
  } catch {
    // KV outage: blind sessions are a market substrate, not a safety gate —
    // fail-open on the READ (D12) while every write path stays CAS-guarded.
    return false;
  }
}

export async function setBlindKilled(kv: KVNamespace, killed: boolean): Promise<{ killed: boolean }> {
  await kv.put(KILL_BLIND_KEY, JSON.stringify({ killed, at: Math.floor(Date.now() / 1000) }));
  return { killed };
}

/** POST /v1/fleet/blind — operator kill toggle (same shape as /v1/fleet/mediator). */
export async function handleBlindToggle(request: Request, env: Env): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;
  let body: { killed?: unknown };
  try {
    body = (await request.json()) as { killed?: unknown };
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be JSON: { killed: boolean }');
  }
  if (typeof body.killed !== 'boolean') return err(400, 'BAD_REQUEST', 'killed must be a boolean');
  const state = await setBlindKilled(env.KV, body.killed);
  return json(200, { code: 'OK', error: null, ...state });
}

// ── Shared route plumbing ────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const err = (status: number, code: string, error: string) => json(status, { code, error });

/**
 * The fail-closed configuration gate: every blind route requires
 * BLIND_CAP_SECRET (≥32 chars). Absent/short ⇒ 503 — capability minting with
 * a weak or missing secret would be theater, so nothing runs at all.
 */
function requireSecret(env: Env): string | Response {
  const s = env.BLIND_CAP_SECRET;
  if (typeof s !== 'string' || s.length < 32) {
    return err(503, 'BLIND_UNCONFIGURED', 'BLIND_CAP_SECRET is not set (>=32 chars required) — blind sessions are disabled');
  }
  return s;
}

interface ChainedRequest {
  card?: string;
  event?: {
    sender?: string;
    channel?: string;
    seq?: number;
    this_hash?: string;
    ciphertext?: string;
  };
}

/** Parse a chained request and decode its ciphertext body (blind/1 dialect). */
async function readChained(request: Request): Promise<{ rawBody: string; parsed: ChainedRequest; body: unknown } | Response> {
  let rawBody: string;
  let parsed: ChainedRequest;
  try {
    rawBody = await request.text();
    parsed = JSON.parse(rawBody) as ChainedRequest;
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be JSON: { card, event }');
  }
  const ciphertext = parsed.event?.ciphertext;
  if (typeof ciphertext !== 'string' || ciphertext === '') {
    return err(400, 'MISSING_EVENT', 'event with ciphertext required');
  }
  const decoded = b64urlDecodeToString(ciphertext);
  let body: unknown;
  try {
    body = decoded === null ? null : JSON.parse(decoded);
  } catch {
    body = null;
  }
  return { rawBody, parsed, body };
}

/**
 * Delegate a chained envelope to the ONE publish implementation (identity,
 * revocation, capability, hash chain, signature) — the mediator-body idiom.
 */
async function delegateToPublish(env: Env, rawBody: string): Promise<Response> {
  const req = new Request('http://relay.internal/v1/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
  return handlePublish(req, env);
}

// ── POST /v1/blind/skills (lender, chained) ──────────────────────────────────

export interface BlindPublishSkillBody {
  schema: typeof BLIND_SCHEMA;
  type: 'publish-skill';
  harbor: string;
  title: string;
  output_schema: BlindOutputSchema;
}

/** Validate a decoded publish-skill body. @returns typed body or string error. */
export function validatePublishSkillBody(v: unknown): BlindPublishSkillBody | string {
  if (typeof v !== 'object' || v === null) return 'ciphertext must decode to a blind/1 JSON body';
  const b = v as Record<string, unknown>;
  if (b.schema !== BLIND_SCHEMA) return `schema must be '${BLIND_SCHEMA}'`;
  if (b.type !== 'publish-skill') return "type must be 'publish-skill'";
  if (typeof b.harbor !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(b.harbor)) return "harbor must be 'namespace/name'";
  if (typeof b.title !== 'string' || b.title.trim() === '' || b.title.length > MAX_SKILL_TITLE_CHARS) {
    return `title required (max ${MAX_SKILL_TITLE_CHARS} chars)`;
  }
  const schema = validateOutputSchema(b.output_schema);
  if (typeof schema === 'string') return schema;
  return { schema: BLIND_SCHEMA, type: 'publish-skill', harbor: b.harbor, title: b.title.trim(), output_schema: schema };
}

/**
 * POST /v1/blind/skills — sealed-skill registration.
 *
 * Gate order (mediator-body discipline — cheap refusals before chain writes):
 * kill flag → secret → body shape → publish (chain) → materialize. The
 * lender's fingerprint is the verified envelope SENDER — publish enforced
 * sender === card.sub, so a skill row can only ever name a key that actually
 * signed for it.
 */
export async function handleBlindSkillPublish(request: Request, env: Env): Promise<Response> {
  if (await getBlindKilled(env.KV)) return err(409, 'BLIND_KILLED', 'the kill-blind flag is set — blind sessions are inert');
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const read = await readChained(request);
  if (read instanceof Response) return read;
  const body = validatePublishSkillBody(read.body);
  if (typeof body === 'string') return err(400, 'BAD_PUBLISH', body);

  const published = await delegateToPublish(env, read.rawBody);
  if (published.status !== 200) return published;
  const sender = read.parsed.event?.sender as string;

  const now = Math.floor(Date.now() / 1000);
  const skillId = `bsk_${randomHex(12)}`;
  await insertBlindSkill(env.DB, {
    skill_id: skillId,
    harbor: body.harbor,
    lender_fingerprint: sender,
    title: body.title,
    output_schema_json: JSON.stringify(body.output_schema),
    created_at: now,
    revoked: 0,
  });

  // The lender's read token is returned ONCE, here — it never touches D1.
  const lenderToken = await mintLenderToken(secret, skillId);
  return json(201, { code: 'OK', error: null, skill_id: skillId, lender_token: lenderToken });
}

// ── POST /v1/blind/capabilities (lender, chained) ────────────────────────────

export interface BlindMintCapabilityBody {
  schema: typeof BLIND_SCHEMA;
  type: 'mint-capability';
  skill_id: string;
  max_runs: number;
  exp: number;
}

/** Validate a decoded mint-capability body. */
export function validateMintCapabilityBody(v: unknown): BlindMintCapabilityBody | string {
  if (typeof v !== 'object' || v === null) return 'ciphertext must decode to a blind/1 JSON body';
  const b = v as Record<string, unknown>;
  if (b.schema !== BLIND_SCHEMA) return `schema must be '${BLIND_SCHEMA}'`;
  if (b.type !== 'mint-capability') return "type must be 'mint-capability'";
  if (typeof b.skill_id !== 'string' || !/^bsk_[0-9a-f]{24}$/.test(b.skill_id)) return 'skill_id must be a bsk_ id';
  if (typeof b.max_runs !== 'number' || !Number.isInteger(b.max_runs) || b.max_runs < 1 || b.max_runs > BLIND_MAX_RUNS_CAP) {
    return `max_runs must be an integer in [1, ${BLIND_MAX_RUNS_CAP}]`;
  }
  if (typeof b.exp !== 'number' || !Number.isInteger(b.exp) || b.exp <= 0) return 'exp (unix seconds) required';
  return { schema: BLIND_SCHEMA, type: 'mint-capability', skill_id: b.skill_id, max_runs: b.max_runs, exp: b.exp };
}

/**
 * POST /v1/blind/capabilities — the lender mints a borrower an execute-only
 * capability. ONLY the skill's registered lender fingerprint may mint (sender
 * pinning BEFORE the chain write), exp is bounded, and the harbor caveat is
 * copied from the skill row — a lender cannot mint a capability that names a
 * harbor its skill does not live in.
 */
export async function handleBlindCapabilityMint(request: Request, env: Env): Promise<Response> {
  if (await getBlindKilled(env.KV)) return err(409, 'BLIND_KILLED', 'the kill-blind flag is set — blind sessions are inert');
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const read = await readChained(request);
  if (read instanceof Response) return read;
  const body = validateMintCapabilityBody(read.body);
  if (typeof body === 'string') return err(400, 'BAD_MINT', body);

  const skill = await getBlindSkill(env.DB, body.skill_id);
  if (!skill || skill.revoked !== 0) return err(404, 'NO_SUCH_SKILL', 'no such (unrevoked) skill');
  if (read.parsed.event?.sender !== skill.lender_fingerprint) {
    return err(403, 'NOT_YOUR_SKILL', "only the skill's registered lender may mint capabilities");
  }
  const now = Math.floor(Date.now() / 1000);
  if (body.exp <= now) return err(400, 'BAD_MINT', 'exp is already in the past');
  if (body.exp > now + BLIND_CAP_MAX_TTL_SECONDS) {
    return err(400, 'BAD_MINT', `exp is capped at ${BLIND_CAP_MAX_TTL_SECONDS} seconds from now`);
  }

  const published = await delegateToPublish(env, read.rawBody);
  if (published.status !== 200) return published;

  const jti = `bj_${randomHex(12)}`;
  const payload: BlindCapPayload = {
    v: 1,
    jti,
    skill_id: skill.skill_id,
    harbor: skill.harbor,
    max_runs: body.max_runs,
    exp: body.exp,
  };
  await insertBlindCapability(env.DB, {
    jti,
    skill_id: skill.skill_id,
    harbor: skill.harbor,
    max_runs: body.max_runs,
    runs_used: 0,
    exp: body.exp,
    created_at: now,
    revoked: 0,
  });
  const token = await mintBlindCapability(secret, payload);
  return json(201, { code: 'OK', error: null, token, jti, skill_id: skill.skill_id, max_runs: body.max_runs, exp: body.exp });
}

// ── POST /v1/blind/runs (borrower, capability token) ─────────────────────────

/**
 * POST /v1/blind/runs — { token, input }. The borrower's ONLY credential is
 * the capability; there is no session and no identity requirement — that is
 * what execute-only means. Caveat enforcement order (each refusal owns one
 * honest code):
 *
 *   integrity (HMAC) → ledger row exists → EXPIRED → skill exists/unrevoked →
 *   WRONG_HARBOR (token caveat vs skill row) → REVOKED / MAX_RUNS_EXCEEDED
 *   (atomic spend — the replay containment).
 */
export async function handleBlindRunCreate(request: Request, env: Env): Promise<Response> {
  if (await getBlindKilled(env.KV)) return err(409, 'BLIND_KILLED', 'the kill-blind flag is set — blind sessions are inert');
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  let body: { token?: unknown; input?: unknown };
  try {
    body = (await request.json()) as { token?: unknown; input?: unknown };
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be JSON: { token, input }');
  }
  if (typeof body.token !== 'string' || body.token === '') return err(401, 'BAD_CAPABILITY', 'capability token required');
  if (typeof body.input !== 'string' || body.input.trim() === '' || body.input.length > MAX_BORROWER_INPUT_CHARS) {
    return err(400, 'BAD_INPUT', `input required (max ${MAX_BORROWER_INPUT_CHARS} chars)`);
  }

  const payload = await verifyBlindCapability(secret, body.token);
  if (!payload) return err(401, 'BAD_CAPABILITY', 'capability token failed verification');

  const cap = await getBlindCapability(env.DB, payload.jti);
  if (!cap) return err(401, 'BAD_CAPABILITY', 'capability is not in the ledger');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now || cap.exp <= now) return err(403, 'EXPIRED', 'capability has expired');

  const skill = await getBlindSkill(env.DB, payload.skill_id);
  if (!skill || skill.revoked !== 0 || cap.skill_id !== skill.skill_id) {
    return err(404, 'NO_SUCH_SKILL', 'no such (unrevoked) skill for this capability');
  }
  if (payload.harbor !== skill.harbor || cap.harbor !== skill.harbor) {
    return err(403, 'WRONG_HARBOR', "capability's harbor caveat does not match the skill's harbor");
  }

  if (!(await spendBlindRunUnit(env.DB, payload.jti))) {
    const fresh = await getBlindCapability(env.DB, payload.jti);
    if (fresh?.revoked !== 0) return err(403, 'REVOKED', 'capability has been revoked');
    return err(403, 'MAX_RUNS_EXCEEDED', `capability's max_runs (${cap.max_runs}) is exhausted`);
  }

  const runId = `brun_${randomHex(12)}`;
  await insertBlindRun(env.DB, {
    run_id: runId,
    skill_id: skill.skill_id,
    jti: payload.jti,
    harbor: skill.harbor,
    borrower_input: body.input,
    status: 'awaiting-key',
    refusal_reason: null,
    executor_fingerprint: null,
    run_pubkey: null,
    sealed_payload_json: null,
    output_json: null,
    verdict_hash: null,
    tokens_used: null,
    created_at: now,
    concluded_at: null,
  });
  return json(201, { code: 'OK', error: null, run_id: runId, status: 'awaiting-key' });
}

// ── POST /v1/blind/runs/:id/key (executor, chained) ──────────────────────────

export interface BlindRunKeyBody {
  schema: typeof BLIND_SCHEMA;
  type: 'run-key';
  run_id: string;
  /** b64url of the raw (uncompressed, 65-byte) P-256 public point. */
  run_pubkey: string;
}

export function validateRunKeyBody(v: unknown): BlindRunKeyBody | string {
  if (typeof v !== 'object' || v === null) return 'ciphertext must decode to a blind/1 JSON body';
  const b = v as Record<string, unknown>;
  if (b.schema !== BLIND_SCHEMA) return `schema must be '${BLIND_SCHEMA}'`;
  if (b.type !== 'run-key') return "type must be 'run-key'";
  if (typeof b.run_id !== 'string' || !/^brun_[0-9a-f]{24}$/.test(b.run_id)) return 'run_id must be a brun_ id';
  if (typeof b.run_pubkey !== 'string' || !/^[A-Za-z0-9_-]{80,120}$/.test(b.run_pubkey)) {
    return 'run_pubkey must be the b64url raw P-256 public point';
  }
  return { schema: BLIND_SCHEMA, type: 'run-key', run_id: b.run_id, run_pubkey: b.run_pubkey };
}

/**
 * POST /v1/blind/runs/:id/key — the executor sandbox announces its PER-RUN
 * ephemeral public key. The sender must be an operator-provisioned identity
 * (the executor class — checked against the identity registry BEFORE the
 * chain write), and the write is CAS on 'awaiting-key', which PINS this
 * fingerprint as the only sender allowed to conclude the run.
 */
export async function handleBlindRunKey(request: Request, env: Env, runId: string): Promise<Response> {
  if (await getBlindKilled(env.KV)) return err(409, 'BLIND_KILLED', 'the kill-blind flag is set — blind sessions are inert');
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const read = await readChained(request);
  if (read instanceof Response) return read;
  const body = validateRunKeyBody(read.body);
  if (typeof body === 'string') return err(400, 'BAD_RUN_KEY', body);
  if (body.run_id !== runId) return err(400, 'BAD_RUN_KEY', 'run_id in body must match the route');

  const run = await getBlindRun(env.DB, runId);
  if (!run) return err(404, 'NO_SUCH_RUN', 'no such run');
  if (run.status !== 'awaiting-key') return err(409, 'BAD_STATE', `run is ${run.status} — key is write-once`);

  const sender = read.parsed.event?.sender;
  const identity = typeof sender === 'string' ? await getIdentity(env.DB, sender) : null;
  if (!identity || identity.revoked || identity.proof_method !== 'operator-provisioned') {
    return err(403, 'NOT_AN_EXECUTOR', 'only an operator-provisioned executor identity may post a run key');
  }

  const published = await delegateToPublish(env, read.rawBody);
  if (published.status !== 200) return published;

  if (!(await setBlindRunKey(env.DB, runId, body.run_pubkey, sender as string))) {
    return err(409, 'BAD_STATE', 'a concurrent key-post won — key is write-once');
  }
  return json(200, { code: 'OK', error: null, run_id: runId, status: 'key-ready' });
}

// ── POST /v1/blind/runs/:id/seal (lender, chained) ───────────────────────────

export interface BlindSealBody {
  schema: typeof BLIND_SCHEMA;
  type: 'seal';
  run_id: string;
  sealed: { v: typeof BLIND_SEAL_VERSION; epk: string; iv: string; ct: string };
}

export function validateSealBody(v: unknown): BlindSealBody | string {
  if (typeof v !== 'object' || v === null) return 'ciphertext must decode to a blind/1 JSON body';
  const b = v as Record<string, unknown>;
  if (b.schema !== BLIND_SCHEMA) return `schema must be '${BLIND_SCHEMA}'`;
  if (b.type !== 'seal') return "type must be 'seal'";
  if (typeof b.run_id !== 'string' || !/^brun_[0-9a-f]{24}$/.test(b.run_id)) return 'run_id must be a brun_ id';
  const s = b.sealed as { v?: unknown; epk?: unknown; iv?: unknown; ct?: unknown } | undefined;
  if (
    typeof s !== 'object' || s === null ||
    s.v !== BLIND_SEAL_VERSION ||
    typeof s.epk !== 'string' || s.epk === '' ||
    typeof s.iv !== 'string' || s.iv === '' ||
    typeof s.ct !== 'string' || s.ct === '' || s.ct.length > 300_000
  ) {
    return `sealed must be { v: '${BLIND_SEAL_VERSION}', epk, iv, ct } (ct capped at 300000 b64url chars)`;
  }
  return {
    schema: BLIND_SCHEMA,
    type: 'seal',
    run_id: b.run_id,
    sealed: { v: BLIND_SEAL_VERSION, epk: s.epk, iv: s.iv, ct: s.ct },
  };
}

/**
 * POST /v1/blind/runs/:id/seal — the lender posts the skill ciphertext sealed
 * to the run's ephemeral key. Sender pinning: only the SKILL's registered
 * lender fingerprint may seal (before the chain write). CAS on 'key-ready'.
 * The relay stores the envelope verbatim — there is nothing here it could
 * decrypt with.
 */
export async function handleBlindRunSeal(request: Request, env: Env, runId: string): Promise<Response> {
  if (await getBlindKilled(env.KV)) return err(409, 'BLIND_KILLED', 'the kill-blind flag is set — blind sessions are inert');
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const read = await readChained(request);
  if (read instanceof Response) return read;
  const body = validateSealBody(read.body);
  if (typeof body === 'string') return err(400, 'BAD_SEAL', body);
  if (body.run_id !== runId) return err(400, 'BAD_SEAL', 'run_id in body must match the route');

  const run = await getBlindRun(env.DB, runId);
  if (!run) return err(404, 'NO_SUCH_RUN', 'no such run');
  if (run.status !== 'key-ready') return err(409, 'BAD_STATE', `run is ${run.status} — seal requires key-ready`);

  const skill = await getBlindSkill(env.DB, run.skill_id);
  if (!skill) return err(404, 'NO_SUCH_SKILL', 'the run’s skill no longer exists');
  if (read.parsed.event?.sender !== skill.lender_fingerprint) {
    return err(403, 'NOT_YOUR_SKILL', "only the skill's registered lender may seal for a run");
  }

  const published = await delegateToPublish(env, read.rawBody);
  if (published.status !== 200) return published;

  if (!(await setBlindRunSealed(env.DB, runId, JSON.stringify(body.sealed)))) {
    return err(409, 'BAD_STATE', 'a concurrent seal won — seal is write-once');
  }
  return json(200, { code: 'OK', error: null, run_id: runId, status: 'sealed' });
}

// ── POST /v1/blind/runs/:id/conclude (executor, chained) ─────────────────────

export interface BlindReceiptBody {
  run_id: string;
  skill_id: string;
  verdict_hash: string;
  tokens_used: number;
  iat: number;
}

export interface BlindConcludeBody {
  schema: typeof BLIND_SCHEMA;
  type: 'conclude';
  run_id: string;
  /** Exactly one of output / refusal. */
  output?: unknown;
  refusal?: string;
  receipt: BlindReceiptBody;
}

export function validateConcludeBody(v: unknown): BlindConcludeBody | string {
  if (typeof v !== 'object' || v === null) return 'ciphertext must decode to a blind/1 JSON body';
  const b = v as Record<string, unknown>;
  if (b.schema !== BLIND_SCHEMA) return `schema must be '${BLIND_SCHEMA}'`;
  if (b.type !== 'conclude') return "type must be 'conclude'";
  if (typeof b.run_id !== 'string' || !/^brun_[0-9a-f]{24}$/.test(b.run_id)) return 'run_id must be a brun_ id';
  const hasOutput = b.output !== undefined;
  const hasRefusal = typeof b.refusal === 'string' && b.refusal !== '';
  if (hasOutput === hasRefusal) return 'exactly one of output / refusal is required';
  const r = b.receipt as Record<string, unknown> | undefined;
  if (
    typeof r !== 'object' || r === null ||
    typeof r.run_id !== 'string' ||
    typeof r.skill_id !== 'string' ||
    typeof r.verdict_hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.verdict_hash) ||
    typeof r.tokens_used !== 'number' || !Number.isInteger(r.tokens_used) || r.tokens_used < 0 ||
    typeof r.iat !== 'number' || !Number.isInteger(r.iat) || r.iat <= 0
  ) {
    return 'receipt must be { run_id, skill_id, verdict_hash (64 hex), tokens_used >= 0, iat }';
  }
  const out: BlindConcludeBody = {
    schema: BLIND_SCHEMA,
    type: 'conclude',
    run_id: b.run_id,
    receipt: {
      run_id: r.run_id,
      skill_id: r.skill_id,
      verdict_hash: r.verdict_hash,
      tokens_used: r.tokens_used,
      iat: r.iat,
    },
  };
  if (hasOutput) out.output = b.output;
  if (hasRefusal) out.refusal = (b.refusal as string).slice(0, 300);
  return out;
}

/**
 * POST /v1/blind/runs/:id/conclude — the executor's result + receipt.
 *
 * The relay is the TRIPWIRE, not a bystander:
 *   - sender must be the run's PINNED executor fingerprint (from key-post);
 *   - on an output: the output contract is RE-ENFORCED here. A violation
 *     means the named TCB let something through — the conclude is refused,
 *     the run goes to 'refused', and NOTHING is stored for the borrower.
 *     This is the sandbox-escape canary for the exfiltrate-via-outputs class.
 *   - verdict_hash is recomputed from the canonical output (or the refusal
 *     marker) and must equal the receipt's — a receipt that doesn't describe
 *     THIS result is refused wholesale;
 *   - receipt fields must name THIS run and ITS skill.
 * On success one receipt row per side is stored with the conclude event's
 * chain coordinates — the parity the harness asserts.
 */
export async function handleBlindRunConclude(request: Request, env: Env, runId: string): Promise<Response> {
  if (await getBlindKilled(env.KV)) return err(409, 'BLIND_KILLED', 'the kill-blind flag is set — blind sessions are inert');
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const read = await readChained(request);
  if (read instanceof Response) return read;
  const body = validateConcludeBody(read.body);
  if (typeof body === 'string') return err(400, 'BAD_CONCLUDE', body);
  if (body.run_id !== runId) return err(400, 'BAD_CONCLUDE', 'run_id in body must match the route');

  const run = await getBlindRun(env.DB, runId);
  if (!run) return err(404, 'NO_SUCH_RUN', 'no such run');
  if (run.status !== 'sealed') return err(409, 'BAD_STATE', `run is ${run.status} — conclude requires sealed`);
  if (!run.executor_fingerprint || read.parsed.event?.sender !== run.executor_fingerprint) {
    return err(403, 'NOT_YOUR_RUN', 'only the run’s pinned executor may conclude it');
  }
  if (body.receipt.run_id !== run.run_id || body.receipt.skill_id !== run.skill_id) {
    return err(422, 'RECEIPT_MISMATCH', 'receipt must name this run and its skill');
  }

  const skill = await getBlindSkill(env.DB, run.skill_id);
  if (!skill) return err(404, 'NO_SUCH_SKILL', 'the run’s skill no longer exists');

  const now = Math.floor(Date.now() / 1000);

  // Resolve the borrower-visible result and the verdict hash the receipt
  // MUST carry, before anything is written.
  let outputJson: string | null = null;
  let expectedVerdict: string;
  if (body.refusal !== undefined) {
    expectedVerdict = blindRefusalHash(body.refusal);
  } else {
    const schema = JSON.parse(skill.output_schema_json) as BlindOutputSchema;
    const enforced = enforceBlindOutputContract(schema, body.output);
    if (!enforced.ok) {
      // TRIPWIRE: the sandbox passed something the contract refuses. The run
      // dies fail-closed; the borrower gets nothing; the reason is recorded.
      await setBlindRunRefused(env.DB, runId, `output-contract-violation at relay: ${enforced.reason}`, now);
      return err(422, 'OUTPUT_CONTRACT_VIOLATION', `output refused: ${enforced.reason}`);
    }
    outputJson = canonicalBlindJson(enforced.output);
    expectedVerdict = blindVerdictHash(enforced.output);
  }
  if (body.receipt.verdict_hash !== expectedVerdict) {
    await setBlindRunRefused(env.DB, runId, 'receipt verdict_hash does not describe this result', now);
    return err(422, 'RECEIPT_MISMATCH', 'receipt verdict_hash does not match the relay’s canonical recomputation');
  }

  // The result + receipt enter the chain through the one publish gate.
  const published = await delegateToPublish(env, read.rawBody);
  if (published.status !== 200) return published;
  const pub = (await published.json()) as { seq: number; this_hash: string };
  const channel = (read.parsed.event as { channel: string }).channel;

  if (
    !(await setBlindRunConcluded(env.DB, {
      runId,
      outputJson,
      refusalReason: body.refusal ?? null,
      verdictHash: expectedVerdict,
      tokensUsed: body.receipt.tokens_used,
      at: now,
    }))
  ) {
    return err(409, 'BAD_STATE', 'a concurrent conclude won — conclude is write-once');
  }

  const receiptJson = JSON.stringify(body.receipt);
  for (const side of ['lender', 'borrower'] as const) {
    await insertBlindReceipt(env.DB, {
      run_id: runId,
      side,
      body_json: receiptJson,
      chain_channel: channel,
      chain_seq: pub.seq,
      chain_hash: pub.this_hash,
      created_at: now,
    });
  }

  return json(200, {
    code: 'OK',
    error: null,
    run_id: runId,
    status: 'concluded',
    verdict_hash: expectedVerdict,
    receipt_chain: { channel, seq: pub.seq, hash: pub.this_hash },
  });
}

// ── GET /v1/blind/runs/:id (borrower, capability token) ──────────────────────

/**
 * GET /v1/blind/runs/:id?t=<capability token> — the borrower's read. The same
 * capability that created the run reads it (jti pinning); reads never spend a
 * run unit. What the borrower can NEVER see: the sealed payload (the lender's
 * material) — it is simply not in the response shape.
 */
export async function handleBlindRunFetch(request: Request, env: Env, runId: string): Promise<Response> {
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const presented = new URL(request.url).searchParams.get('t') ?? '';
  const payload = presented === '' ? null : await verifyBlindCapability(secret, presented);
  if (!payload) return err(401, 'BAD_CAPABILITY', 'capability token failed verification');

  const run = await getBlindRun(env.DB, runId);
  // Same refusal whether the run exists or not: no existence oracle.
  if (!run || run.jti !== payload.jti) return err(404, 'NO_SUCH_RUN', 'no such run for this capability');

  const receipt = run.status === 'concluded' ? await getBlindReceipt(env.DB, runId, 'borrower') : null;
  return json(200, {
    code: 'OK',
    error: null,
    run_id: run.run_id,
    skill_id: run.skill_id,
    status: run.status,
    refusal_reason: run.refusal_reason,
    output: run.output_json !== null ? JSON.parse(run.output_json) : null,
    receipt: receipt
      ? { body: JSON.parse(receipt.body_json), chain: { channel: receipt.chain_channel, seq: receipt.chain_seq, hash: receipt.chain_hash } }
      : null,
  });
}

// ── GET /v1/blind/skills/:id/runs (lender, lender token) ─────────────────────

/**
 * GET /v1/blind/skills/:id/runs?t=<lender token> — the lender's worklist +
 * receipt feed: key-ready runs (run_id + the run pubkey to seal to) and
 * concluded runs (the lender-side receipt). What the lender can NEVER see:
 * the borrower's input — it is simply not in the response shape. That
 * asymmetry is the blindness policy made structural on the read path.
 */
export async function handleBlindSkillRuns(request: Request, env: Env, skillId: string): Promise<Response> {
  const secret = requireSecret(env);
  if (secret instanceof Response) return secret;

  const presented = new URL(request.url).searchParams.get('t') ?? '';
  if (!(await verifyLenderToken(secret, skillId, presented))) {
    return err(401, 'BAD_CAPABILITY', 'lender token failed verification');
  }
  const skill = await getBlindSkill(env.DB, skillId);
  if (!skill) return err(404, 'NO_SUCH_SKILL', 'no such skill');

  const pending = await listBlindRunsBySkillStatus(env.DB, skillId, 'key-ready');
  const concluded = await listBlindRunsBySkillStatus(env.DB, skillId, 'concluded');
  const receipts: Array<{ run_id: string; body: unknown; chain: { channel: string; seq: number; hash: string } }> = [];
  for (const run of concluded) {
    const r = await getBlindReceipt(env.DB, run.run_id, 'lender');
    if (r) {
      receipts.push({
        run_id: run.run_id,
        body: JSON.parse(r.body_json),
        chain: { channel: r.chain_channel, seq: r.chain_seq, hash: r.chain_hash },
      });
    }
  }
  return json(200, {
    code: 'OK',
    error: null,
    skill_id: skillId,
    pending: pending.map((r) => ({ run_id: r.run_id, run_pubkey: r.run_pubkey })),
    receipts,
  });
}
