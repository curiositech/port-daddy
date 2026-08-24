/**
 * BLIND RUN — the executor-sandbox half of blind sessions
 * (grand-plan DAG node blind-sessions; task label X5; plan §L2 first slice).
 *
 * This module is the NAMED TCB of the blind room: the one place a lender's
 * skill text and a borrower's input coexist in plaintext. Everything here is
 * built to keep that plaintext from leaving through any channel except the
 * output-contract gate:
 *
 *   PER-RUN EPHEMERAL KEY  — {@link generateRunKeypair} mints a fresh
 *     NON-EXTRACTABLE P-256 ECDH keypair per run. The private half is a
 *     CryptoKey that cannot be exported even by this module's own code; it
 *     lives only in the isolate's memory and dies with the run.
 *   SEALING (pd-seal/1)    — {@link sealToRunKey} is the LENDER-side client
 *     half (the daemon/CLI will carry the same function; shipping it here
 *     keeps seal/unseal in one reviewed file with round-trip tests), and
 *     {@link unsealRunPayload} is the sandbox-side opener. ECDH(P-256) →
 *     HKDF-SHA256 (salt = run_id, info = 'pd-seal/1') → AES-256-GCM. The
 *     run_id in the KDF binds a sealed payload to ITS run: replaying it at
 *     another run's key fails the KDF, not just policy.
 *   EGRESS LOCKDOWN        — {@link executeBlindRun} REFUSES fail-closed
 *     unless the caller attests `egressLocked: true` (wired from the
 *     BLIND_EGRESS_LOCKED deploy var — the stage kill switch: unset it and
 *     every blind run refuses). The function's entire capability surface is
 *     the `ai` binding — it takes no fetch, no tokens, no URLs, and performs
 *     zero network calls of its own (the adversarial harness pins this with
 *     a global-fetch trap).
 *   OUTPUT CONTRACT        — {@link enforceBlindOutputContract} is the
 *     redaction gate, refuse-not-strip. PARITY-PINNED twin of
 *     apps/relay/src/blind-sessions.ts, locked by
 *     tests/fixtures/blind-output-contract-parity-vectors.json from BOTH
 *     vitest suites; the relay re-enforces the same gate as a tripwire.
 *   RECEIPTS               — {@link buildBlindReceipt} + the canonical
 *     verdict hash ({@link blindVerdictHash}) produce the signed receipt
 *     body {run_id, skill_id, verdict_hash, tokens_used, iat} that rides the
 *     executor's N2 chain to the relay's conclude route.
 *
 * WHAT IS NOT HERE (named deferral, stated in the shipping PR): the poll /
 * queue trigger that discovers pending runs and drives key→seal→conclude in
 * production. The protocol, crypto, and enforcement are complete and gated;
 * the wiring that schedules them is not, and pretending otherwise with a
 * half-tested cron would be worse than saying so.
 */

import { sha256 } from '@noble/hashes/sha256';
import { extractAiText } from './ai-response.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Sealed-envelope version tag — must match the relay's BLIND_SEAL_VERSION. */
export const BLIND_SEAL_VERSION = 'pd-seal/1';

/** Default + hard cap on a string field (parity with the relay twin). */
export const BLIND_DEFAULT_MAX_STRING = 2000;

/** Workers AI model used for blind runs when none is configured. */
export const DEFAULT_BLIND_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// ── Small helpers ────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * @returns an ArrayBuffer-backed view (not SharedArrayBuffer) so it satisfies
 * Web Crypto's strict `BufferSource` typing under @cloudflare/workers-types.
 */
function b64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = 4 - (padded.length % 4 || 4);
  const bin = atob(padded + '='.repeat(pad === 4 ? 0 : pad));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Output contract (parity twin — see the relay module for the doctrine) ────

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
 * Enforce the output contract — refuse-not-strip. MUST stay byte-identical in
 * behavior to apps/relay/src/blind-sessions.ts enforceBlindOutputContract
 * (both suites assert the shared parity fixture).
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

/** Canonical JSON — sorted keys, no whitespace. Parity twin; fixture-pinned. */
export function canonicalBlindJson(output: Record<string, string | number | boolean>): string {
  const keys = Object.keys(output).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(output[k])}`).join(',')}}`;
}

/** sha256 hex of the canonical output — the receipt's verdict_hash. */
export function blindVerdictHash(output: Record<string, string | number | boolean>): string {
  return toHex(sha256(new TextEncoder().encode(canonicalBlindJson(output))));
}

/** verdict_hash of an honest refusal: hash of the `{refused: reason}` marker. */
export function blindRefusalHash(reason: string): string {
  return blindVerdictHash({ refused: reason });
}

// ── Per-run ephemeral key + pd-seal/1 ────────────────────────────────────────

export interface RunKeypair {
  /** b64url of the raw (uncompressed, 65-byte) P-256 public point — what the executor posts to the relay. */
  publicKeyB64: string;
  /** NON-EXTRACTABLE private half. Never serialized; dies with the isolate. */
  privateKey: CryptoKey;
}

export interface SealedPayload {
  v: typeof BLIND_SEAL_VERSION;
  /** Sender-ephemeral public point (b64url raw P-256). */
  epk: string;
  /** AES-GCM IV (b64url, 12 bytes). */
  iv: string;
  /** Ciphertext + tag (b64url). */
  ct: string;
}

/**
 * Mint the run's ephemeral ECDH keypair. `extractable: false` on the private
 * key is load-bearing: even a compromised code path in this isolate cannot
 * export the key material — it can only USE the key, and only until the
 * isolate dies.
 */
export async function generateRunKeypair(): Promise<RunKeypair> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKeyB64: b64urlEncode(raw), privateKey: pair.privateKey };
}

/** ECDH → HKDF-SHA256(salt=run_id, info='pd-seal/1') → AES-256-GCM key. */
async function deriveSealKey(privateKey: CryptoKey, peerRawB64: string, runId: string): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey(
    'raw',
    b64urlDecode(peerRawB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const enc = new TextEncoder();
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(runId), info: enc.encode(BLIND_SEAL_VERSION) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * LENDER-side sealing: encrypt skill text to a run's ephemeral public key.
 * The sender mints its own ephemeral pair (classic sealed box), so the
 * ciphertext is decryptable ONLY with the run's non-extractable private key.
 * Binding the run_id into the KDF salt means a sealed payload cannot be
 * replayed onto a different run even by the relay.
 */
export async function sealToRunKey(runPubB64: string, plaintext: string, runId: string): Promise<SealedPayload> {
  const eph = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const key = await deriveSealKey(eph.privateKey, runPubB64, runId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const epkRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  return { v: BLIND_SEAL_VERSION, epk: b64urlEncode(epkRaw), iv: b64urlEncode(iv), ct: b64urlEncode(ct) };
}

/**
 * SANDBOX-side unsealing with the run's private key. Any tamper — flipped
 * ciphertext byte, wrong run_id, wrong key — fails the AES-GCM tag (or the
 * KDF) and returns null; it never partially decrypts.
 */
export async function unsealRunPayload(privateKey: CryptoKey, sealed: SealedPayload, runId: string): Promise<string | null> {
  if (sealed.v !== BLIND_SEAL_VERSION) return null;
  try {
    const key = await deriveSealKey(privateKey, sealed.epk, runId);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(sealed.iv) },
      key,
      b64urlDecode(sealed.ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ── Receipts ─────────────────────────────────────────────────────────────────

export interface BlindReceiptBody {
  run_id: string;
  skill_id: string;
  verdict_hash: string;
  tokens_used: number;
  iat: number;
}

/** Assemble the per-run receipt body both sides will receive. */
export function buildBlindReceipt(args: {
  runId: string;
  skillId: string;
  verdictHash: string;
  tokensUsed: number;
  iat: number;
}): BlindReceiptBody {
  return {
    run_id: args.runId,
    skill_id: args.skillId,
    verdict_hash: args.verdictHash,
    tokens_used: args.tokensUsed,
    iat: args.iat,
  };
}

// ── Execution ────────────────────────────────────────────────────────────────

/** Minimal structural slice of the Workers AI binding this module may touch. */
export interface BlindAi {
  run(model: string, options: Record<string, unknown>): Promise<unknown>;
}

export interface BlindRunParams {
  /** The ONLY capability handed to a blind run. No fetch, no tokens, no URLs. */
  ai: BlindAi;
  model?: string;
  runId: string;
  skillId: string;
  /** Unsealed skill text — exists in plaintext ONLY inside this call. */
  skillText: string;
  borrowerInput: string;
  outputSchema: BlindOutputSchema;
  /**
   * The egress-lockdown attestation, wired from BLIND_EGRESS_LOCKED === 'true'
   * at the call site. This is the STAGE KILL SWITCH: anything but literal
   * `true` refuses the run before one token is spent.
   */
  egressLocked: boolean;
  /** Clock injection for tests. Defaults to Date.now(). */
  nowSeconds?: number;
}

export interface BlindRunOutcome {
  /** True only when the model actually ran. */
  executed: boolean;
  /** Contract-conforming output, or null (refused / not executed). */
  output: Record<string, string | number | boolean> | null;
  /** Honest refusal reason whenever output is null. */
  refusal: string | null;
  /** Receipt body for the conclude event, or null when nothing executed. */
  receipt: BlindReceiptBody | null;
}

/** Estimate tokens when the model's envelope reports no usage (~4 chars/token). */
function estimateTokens(...texts: string[]): number {
  return Math.max(1, Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4));
}

/** Read real usage out of a Workers AI response when the envelope carries it. */
function readUsage(res: unknown): number | null {
  if (res === null || typeof res !== 'object') return null;
  const u = (res as { usage?: { total_tokens?: unknown } }).usage;
  if (u && typeof u.total_tokens === 'number' && Number.isFinite(u.total_tokens) && u.total_tokens > 0) {
    return Math.floor(u.total_tokens);
  }
  return null;
}

/**
 * Pull the first JSON object out of model text (models often wrap JSON in
 * prose or fences). Conservative: first '{' to last '}' or nothing.
 */
export function extractJsonCandidate(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Execute one blind run inside the sandbox TCB. Never throws.
 *
 * Contract, in refusal order:
 *   1. `egressLocked !== true` ⇒ refused with EXECUTED: FALSE and zero model
 *      spend — the kill switch works before anything else.
 *   2. The model runs with the skill text as system prompt and the borrower
 *      input as the user turn, instructed to answer ONLY with JSON matching
 *      the contract's fields.
 *   3. The output contract is enforced IN the sandbox (first line of the
 *      redaction gate; the relay is the tripwire twin). A violation, or
 *      un-parseable model output, becomes an HONEST refusal — the run still
 *      concluded, tokens were still spent, the receipt's verdict_hash covers
 *      the refusal marker.
 *
 * tokens_used honesty: real `usage.total_tokens` when the envelope reports
 * it; otherwise a stated ~4-chars/token estimate (never zero, never faked
 * as exact).
 */
export async function executeBlindRun(params: BlindRunParams): Promise<BlindRunOutcome> {
  if (params.egressLocked !== true) {
    return {
      executed: false,
      output: null,
      refusal: 'egress lockdown attestation absent — blind runs are disabled (stage kill switch)',
      receipt: null,
    };
  }

  const iat = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const model = params.model && params.model.startsWith('@cf/') ? params.model : DEFAULT_BLIND_MODEL;
  const fieldList = Object.entries(params.outputSchema.fields)
    .map(([name, spec]) => `"${name}" (${spec.type}${spec.type === 'string' ? `, max ${spec.maxLength ?? BLIND_DEFAULT_MAX_STRING} chars` : ''})`)
    .join(', ');

  let res: unknown;
  try {
    res = await params.ai.run(model, {
      messages: [
        {
          role: 'system',
          content:
            `${params.skillText}\n\n` +
            `RESPONSE CONTRACT: answer ONLY with a single flat JSON object with exactly these fields: ${fieldList}. ` +
            `No prose, no markdown fences, no other keys.`,
        },
        { role: 'user', content: params.borrowerInput },
      ],
    });
  } catch (e) {
    const reason = `model call failed: ${String(e).slice(0, 200)}`;
    return {
      executed: false,
      output: null,
      refusal: reason,
      receipt: null,
    };
  }

  const { text } = extractAiText(res);
  const tokensUsed = readUsage(res) ?? estimateTokens(params.skillText, params.borrowerInput, text);

  const candidate = extractJsonCandidate(text);
  const enforced =
    candidate === null
      ? ({ ok: false, reason: 'model output was not a JSON object' } as const)
      : enforceBlindOutputContract(params.outputSchema, candidate);

  if (!enforced.ok) {
    // Cap matches the relay's conclude-route refusal cap (300 chars) so the
    // hash both sides compute covers the SAME string.
    const reason = `output-contract-violation: ${enforced.reason}`.slice(0, 300);
    return {
      executed: true,
      output: null,
      refusal: reason,
      receipt: buildBlindReceipt({
        runId: params.runId,
        skillId: params.skillId,
        verdictHash: blindRefusalHash(reason),
        tokensUsed,
        iat,
      }),
    };
  }

  return {
    executed: true,
    output: enforced.output,
    refusal: null,
    receipt: buildBlindReceipt({
      runId: params.runId,
      skillId: params.skillId,
      verdictHash: blindVerdictHash(enforced.output),
      tokensUsed,
      iat,
    }),
  };
}
