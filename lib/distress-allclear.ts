/**
 * lib/distress-allclear.ts — the signed ALL-CLEAR (ADR-0132 §4, phase 4).
 *
 * The Distress Register (`~/.port-daddy/DISTRESS`) is writable by any entity.
 * That is correct for raising distress and catastrophic for lifting a halt: a
 * runaway agent must not be able to end its own halt by appending a line. So
 * the `ALL-CLEAR` record carries an Ed25519 signature over
 *
 *     ALL-CLEAR|<halt-ts>|<ts>
 *
 * and a halt is lifted ONLY by a verified ALL-CLEAR whose `ref=` names the
 * timestamp of the halt it lifts. Everything else — an unsigned all-clear, a
 * signature by some other key, a valid signature replayed against a different
 * halt — leaves the halt in force and is written to the durable
 * security-forensics journal (ADR-0089) as a MAYDAY-class protocol violation.
 *
 * ── The state machine ────────────────────────────────────────────────────────
 *
 *   clear    : no `SECURITE HALT` on record and no sentinel. "No halt hoisted."
 *   hoisted  : a `SECURITE HALT` record exists (in the register, in the
 *              sentinel, or both) with no verified ALL-CLEAR referencing its ts.
 *   lifted   : a verified ALL-CLEAR with `ref=<halt-ts>` follows the halt.
 *
 *   hoisted --(unsigned ALL-CLEAR appended)-------------> hoisted  + violation
 *   hoisted --(ALL-CLEAR signed by a different key)------> hoisted  + violation
 *   hoisted --(valid sig, ref names a different halt)---> hoisted  + violation
 *   hoisted --(valid sig, ref names an already-lifted halt: replay)
 *                                                       -> hoisted  + violation
 *   hoisted --(valid sig, ref = this halt's ts)---------> lifted; the verifier
 *                                                          path removes the
 *                                                          sentinel.
 *
 * The sentinel's ABSENCE is never all-clear. It means "no halt hoisted" only
 * when the register agrees; a register that still carries an unlifted HALT
 * keeps the halt in force with the sentinel gone, and that mismatch is itself
 * journaled (`HALT_SENTINEL_MISSING`) — it is what a deleted sentinel looks
 * like.
 *
 * ── Key custody: why not the daemon's harbor key ─────────────────────────────
 *
 * ADR-0013/0014 mint harbor tokens with a daemon-held Ed25519 key
 * (`lib/harbor-tokens.ts`, keychain account `harbor-signing-private-v2`). That
 * key is loaded unattended by the daemon at boot and is readable by any process
 * running as the operator's user — which is every agent this halt exists to
 * stop. A halt that the halted thing can sign its way out of is not a halt. So
 * the ALL-CLEAR key is a SEPARATE operator key using the SAME primitives
 * (node:crypto Ed25519, exactly as harbor-tokens; no new dependency):
 *
 *   - private half: PKCS#8 PEM encrypted under a passphrase, at
 *     `~/.port-daddy/operator-allclear.key` (mode 0600). Decrypting it needs the
 *     passphrase, which lives only in the operator's head and is read only from
 *     a TTY by the operator CLI — never from an env var or a flag. A documented
 *     bypass is not a control (ADR-0119).
 *   - public half: SPKI PEM at `~/.port-daddy/operator-allclear.pub`. Every
 *     listener verifies with it. It is not secret.
 *
 * Honest boundary: the public-key file is same-user-writable, like every file
 * under `~/.port-daddy`. An adversary who can rewrite it can pin their own key.
 * The passphrase is the real boundary; the pinned public key's fingerprint is
 * printed by `status` so the operator can eyeball a swap. This is the
 * "correct failure direction" ADR-0132 accepts: key loss is a halt that needs
 * the A4 runbook, never a halt an agent can lift.
 *
 * ── Interface contract ───────────────────────────────────────────────────────
 *
 * Phase 0 owns `lib/distress.ts` (appendDistress / readDistress / haltActive /
 * readHalt) and `bin/pd-distress`. `lib/distress.ts#haltActive/readHalt`
 * delegate to `readHaltState` here, so this module must NOT import
 * lib/distress.ts back (it would be a cycle); the sentinel read and register
 * append below stay inline, in the exact ADR wire format, for that reason.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { PD_HOME } from '../shared/paths.js';
import {
  createJsonlForensicsArchive,
  type ForensicsEvent,
  type ForensicsSink,
} from './forensics-archive.js';

// ─── Registry wire format ────────────────────────────────────────────────────

/** ADR-0132 §1 classes. `control` lines carry their code where the class would be. */
export type DistressClass = 'MAYDAY' | 'PAN PAN' | 'SECURITE' | 'ROUTINE' | 'control';

const CONTROL_CODES = new Set(['TAKING-FLOOR', 'STANDING-DOWN', 'SEEN', 'COMPLIED']);

/** One parsed line of the register: `<ts> <kind>:<id> <CLASS> <CODE> [k=v ...] [-- text]`. */
export interface RegistryLine {
  ts: string;
  kind: string;
  id: string;
  cls: DistressClass;
  code: string;
  fields: Record<string, string>;
  text?: string;
  raw: string;
}

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Current time as the register's second-resolution ISO-8601 UTC form. */
export function registryTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Parse one register line. Returns null for blank lines and anything that
 * does not fit the wire format — a reader must never guess.
 *
 * @example
 * parseRegistryLine('2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend')
 * // → { ts, kind: 'operator', id: 'erich', cls: 'SECURITE', code: 'HALT', fields: { reason: 'spend' } }
 */
export function parseRegistryLine(line: string): RegistryLine | null {
  const raw = line.replace(/\r?\n$/, '');
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  let body = trimmed;
  let text: string | undefined;
  const sep = body.indexOf(' -- ');
  if (sep >= 0) {
    text = body.slice(sep + 4).trim();
    body = body.slice(0, sep);
  }

  const tokens = body.split(/\s+/);
  if (tokens.length < 3) return null;
  const [ts, who, ...rest] = tokens;
  if (!ISO_UTC_RE.test(ts)) return null;
  const colon = who.indexOf(':');
  if (colon <= 0 || colon === who.length - 1) return null;
  const kind = who.slice(0, colon);
  const id = who.slice(colon + 1);

  let cls: DistressClass;
  let code: string;
  let i = 0;
  const head = rest[i];
  if (head === 'PAN' && rest[i + 1] === 'PAN') {
    cls = 'PAN PAN';
    i += 2;
    code = rest[i++];
  } else if (head === 'MAYDAY' || head === 'SECURITE' || head === 'ROUTINE' || head === 'control') {
    cls = head;
    i += 1;
    code = rest[i++];
  } else if (head && CONTROL_CODES.has(head)) {
    cls = 'control';
    code = head;
    i += 1;
  } else {
    return null;
  }
  if (!code || code.includes('=')) return null;

  const fields: Record<string, string> = {};
  for (; i < rest.length; i++) {
    const tok = rest[i];
    const eq = tok.indexOf('=');
    if (eq <= 0) return null; // a bare word where a k=v belongs is a malformed line
    fields[tok.slice(0, eq)] = tok.slice(eq + 1);
  }

  return { ts, kind, id, cls, code, fields, ...(text !== undefined ? { text } : {}), raw: trimmed };
}

/** Render a register line in the exact ADR wire format (no trailing newline). */
export function formatRegistryLine(rec: {
  ts: string;
  kind: string;
  id: string;
  cls: DistressClass;
  code: string;
  fields?: Record<string, string>;
  text?: string;
}): string {
  const parts = [rec.ts, `${rec.kind}:${rec.id}`];
  if (rec.cls !== 'control') parts.push(rec.cls);
  parts.push(rec.code);
  for (const [k, v] of Object.entries(rec.fields ?? {})) {
    if (/\s/.test(k) || /\s/.test(v)) {
      throw new Error(`register field ${k} must not contain whitespace`);
    }
    parts.push(`${k}=${v}`);
  }
  let out = parts.join(' ');
  if (rec.text) out += ` -- ${rec.text.replace(/\r?\n/g, ' ')}`;
  return out;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export interface DistressPaths {
  /** `~/.port-daddy/HALT` — existence is the hoisted flag; contents the HALT line. */
  haltFile: string;
  /** `~/.port-daddy/DISTRESS` — machine-wide append-only register. */
  distressFile: string;
  /** `<repo>/.portdaddy/DISTRESS` — repo-scoped register, when inside a repo. */
  repoDistressFile?: string;
  /** SPKI PEM of the operator's ALL-CLEAR public key. */
  publicKeyFile: string;
  /** Passphrase-encrypted PKCS#8 PEM of the operator's ALL-CLEAR private key. */
  privateKeyFile: string;
}

export const OPERATOR_ALLCLEAR_KEY_ID = 'operator-allclear-ed25519-v1';

/** Resolve the register/sentinel/key locations. `home` defaults to `PD_HOME`. */
export function defaultDistressPaths(opts: { home?: string; repoRoot?: string } = {}): DistressPaths {
  const home = opts.home ?? PD_HOME;
  return {
    haltFile: join(home, 'HALT'),
    distressFile: join(home, 'DISTRESS'),
    ...(opts.repoRoot ? { repoDistressFile: join(opts.repoRoot, '.portdaddy', 'DISTRESS') } : {}),
    publicKeyFile: join(home, 'operator-allclear.pub'),
    privateKeyFile: join(home, 'operator-allclear.key'),
  };
}

// ─── Inline register / sentinel access (interface contract) ──────────────────
// TODO(adr-0132-phase-0): replace with lib/distress.ts appendDistress/readHalt.

function appendLine(file: string, line: string): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`, { flag: 'a' });
}

function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0);
}

/** The sentinel's HALT line, or null when no sentinel is hoisted. */
function readSentinelLine(haltFile: string): string | null {
  if (!existsSync(haltFile)) return null;
  const first = readFileSync(haltFile, 'utf8').split('\n').find((l) => l.trim().length > 0);
  return first ?? '';
}

// ─── Keys ────────────────────────────────────────────────────────────────────

const PUBLIC_KEY_PEM_RE = /-----BEGIN PUBLIC KEY-----/;

/** Accept a KeyObject, an SPKI PEM string, or the raw 32-byte Ed25519 key as hex. */
export function toPublicKey(key: KeyObject | string): KeyObject {
  if (typeof key !== 'string') return key;
  if (PUBLIC_KEY_PEM_RE.test(key)) return createPublicKey(key);
  if (/^[0-9a-fA-F]{64}$/.test(key.trim())) {
    // RFC 8410 SPKI prefix for Ed25519 + the raw 32 bytes.
    const prefix = Buffer.from('302a300506032b6570032100', 'hex');
    const der = Buffer.concat([prefix, Buffer.from(key.trim(), 'hex')]);
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  }
  throw new Error('public key must be a KeyObject, an SPKI PEM, or 64 hex chars');
}

/** SHA-256 over the raw 32-byte public key, first 16 hex chars — for the operator's eyes. */
export function publicKeyFingerprint(key: KeyObject | string): string {
  const der = toPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer;
  return createHash('sha256').update(der.subarray(-32)).digest('hex').slice(0, 16);
}

/**
 * Generate the operator's ALL-CLEAR keypair. The private PEM is encrypted under
 * `passphrase` (AES-256-CBC, PKCS#8) — without the passphrase it is inert.
 */
export function generateOperatorKey(passphrase: string): { privatePem: string; publicPem: string } {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('ALL-CLEAR passphrase must be at least 8 characters');
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey
      .export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase })
      .toString(),
    publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

/** Write a fresh keypair to `paths`. Refuses to overwrite: rotation is an explicit operator act. */
export function writeOperatorKeyFiles(
  paths: DistressPaths,
  passphrase: string,
): { fingerprint: string } {
  if (existsSync(paths.privateKeyFile) || existsSync(paths.publicKeyFile)) {
    throw new Error(
      `refusing to overwrite existing ALL-CLEAR key material (${paths.privateKeyFile} / ${paths.publicKeyFile}); remove them deliberately to rotate`,
    );
  }
  const { privatePem, publicPem } = generateOperatorKey(passphrase);
  mkdirSync(dirname(paths.privateKeyFile), { recursive: true });
  writeFileSync(paths.privateKeyFile, privatePem, { mode: 0o600, flag: 'wx' });
  writeFileSync(paths.publicKeyFile, publicPem, { mode: 0o644, flag: 'wx' });
  return { fingerprint: publicKeyFingerprint(publicPem) };
}

/** The pinned operator public key, or null when none has been generated. */
export function loadOperatorPublicKey(paths: DistressPaths): KeyObject | null {
  if (!existsSync(paths.publicKeyFile)) return null;
  return toPublicKey(readFileSync(paths.publicKeyFile, 'utf8'));
}

/** Decrypt the operator private key. Throws on a wrong passphrase — never returns a guess. */
export function loadOperatorPrivateKey(paths: DistressPaths, passphrase: string): KeyObject {
  if (!existsSync(paths.privateKeyFile)) {
    throw new Error(`no ALL-CLEAR private key at ${paths.privateKeyFile}; run keygen first`);
  }
  const pem = readFileSync(paths.privateKeyFile, 'utf8');
  try {
    return createPrivateKey({ key: pem, format: 'pem', passphrase });
  } catch {
    throw new Error('ALL-CLEAR private key: wrong passphrase or corrupt key file');
  }
}

// ─── Sign ────────────────────────────────────────────────────────────────────

/** The exact bytes that are signed: `ALL-CLEAR|<halt-ts>|<ts>`. */
export function allClearMessage(haltTs: string, ts: string): Buffer {
  return Buffer.from(`ALL-CLEAR|${haltTs}|${ts}`, 'utf8');
}

export interface SignAllClearParams {
  /** Timestamp of the HALT record being lifted (its first token, verbatim). */
  haltTs: string;
  /** Operator id — becomes `operator:<id>` on the line. */
  operatorId: string;
  privateKey: KeyObject;
  /** Defaults to now, second resolution. */
  ts?: string;
}

/**
 * Produce a signed ALL-CLEAR register line:
 *   `<ts> operator:<id> SECURITE ALL-CLEAR ref=<halt-ts> sig=<base64>`
 */
export function signAllClear(p: SignAllClearParams): { line: string; sig: string; ts: string } {
  if (!ISO_UTC_RE.test(p.haltTs)) throw new Error(`haltTs is not a register timestamp: ${p.haltTs}`);
  const ts = p.ts ?? registryTimestamp();
  if (!ISO_UTC_RE.test(ts)) throw new Error(`ts is not a register timestamp: ${ts}`);
  if (!/^[A-Za-z0-9._@-]+$/.test(p.operatorId)) throw new Error(`operator id has forbidden characters: ${p.operatorId}`);
  const sig = cryptoSign(null, allClearMessage(p.haltTs, ts), p.privateKey).toString('base64');
  const line = formatRegistryLine({
    ts,
    kind: 'operator',
    id: p.operatorId,
    cls: 'SECURITE',
    code: 'ALL-CLEAR',
    fields: { ref: p.haltTs, sig },
  });
  return { line, sig, ts };
}

// ─── Verify ──────────────────────────────────────────────────────────────────

export type AllClearRejection =
  | 'not-a-registry-line'
  | 'not-an-all-clear'
  | 'not-operator'
  | 'missing-ref'
  | 'unsigned'
  | 'malformed-sig'
  | 'bad-signature'
  | 'wrong-halt-ref'
  | 'no-public-key';

export type AllClearVerdict =
  | { ok: true; record: RegistryLine; haltTs: string }
  | { ok: false; reason: AllClearRejection; record?: RegistryLine };

/**
 * Verify one ALL-CLEAR line against the operator's public key.
 *
 * Pass `expectedHaltTs` (the hoisted halt's timestamp) to also enforce that the
 * line lifts THIS halt; without it, a structurally valid signature over some
 * other halt still returns ok — callers deciding halt state must pass it.
 */
export function verifyAllClear(
  line: string,
  publicKey: KeyObject | string,
  expectedHaltTs?: string,
): AllClearVerdict {
  const record = parseRegistryLine(line);
  if (!record) return { ok: false, reason: 'not-a-registry-line' };
  if (record.cls !== 'SECURITE' || record.code !== 'ALL-CLEAR') return { ok: false, reason: 'not-an-all-clear', record };
  if (record.kind !== 'operator') return { ok: false, reason: 'not-operator', record };
  const ref = record.fields.ref;
  if (!ref || !ISO_UTC_RE.test(ref)) return { ok: false, reason: 'missing-ref', record };
  const sigB64 = record.fields.sig;
  if (!sigB64) return { ok: false, reason: 'unsigned', record };
  let sig: Buffer;
  try {
    sig = Buffer.from(sigB64, 'base64');
  } catch {
    return { ok: false, reason: 'malformed-sig', record };
  }
  if (sig.length !== 64 || sig.toString('base64') !== sigB64) return { ok: false, reason: 'malformed-sig', record };

  let valid = false;
  try {
    valid = cryptoVerify(null, allClearMessage(ref, record.ts), toPublicKey(publicKey), sig);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad-signature', record };
  if (expectedHaltTs !== undefined && ref !== expectedHaltTs) return { ok: false, reason: 'wrong-halt-ref', record };
  return { ok: true, record, haltTs: ref };
}

// ─── State machine ───────────────────────────────────────────────────────────

export type ViolationRule =
  | 'ALLCLEAR_UNSIGNED'
  | 'ALLCLEAR_FORGED'
  | 'ALLCLEAR_WRONG_REF'
  | 'ALLCLEAR_REPLAYED'
  | 'ALLCLEAR_WITHOUT_HALT'
  | 'HALT_SENTINEL_MISSING';

export interface HaltViolation {
  rule: ViolationRule;
  reason: AllClearRejection | 'sentinel-missing' | 'no-halt-hoisted';
  line: string;
  haltTs?: string;
  ref?: string;
}

export type HaltState =
  | { state: 'clear'; halt: null; allClear: null }
  | { state: 'hoisted'; halt: RegistryLine; allClear: null; sentinelPresent: boolean }
  | { state: 'lifted'; halt: RegistryLine; allClear: RegistryLine; sentinelPresent: boolean };

export interface HaltEvaluation {
  status: HaltState;
  violations: HaltViolation[];
  /** Timestamps of every halt on record that was lifted by a verified ALL-CLEAR. */
  liftedHaltTs: string[];
}

export interface EvaluateHaltStateInput {
  /** Contents of the sentinel's first line; null when the sentinel is absent. */
  sentinelLine: string | null;
  /** Machine-wide register, in file order. */
  registerLines: string[];
  /** Operator public key. When null, NO all-clear can verify — the halt stays in force. */
  publicKey: KeyObject | string | null;
}

type HaltRecord = RegistryLine & { cls: 'SECURITE'; code: 'HALT' };
type AllClearRecord = RegistryLine & { cls: 'SECURITE'; code: 'ALL-CLEAR' };

function isHalt(r: RegistryLine | null): r is HaltRecord {
  return !!r && r.cls === 'SECURITE' && r.code === 'HALT';
}

function isAllClear(r: RegistryLine | null): r is AllClearRecord {
  return !!r && r.cls === 'SECURITE' && r.code === 'ALL-CLEAR';
}

/**
 * Which journal rule a rejected ALL-CLEAR falls under. A valid signature whose
 * `ref` names a halt that was ALREADY lifted is a replay; one naming any other
 * halt is a wrong ref; no/garbled signature is unsigned; everything else —
 * including a signature by some other key — is forged.
 */
function classifyRejection(
  reason: AllClearRejection,
  ref: string | undefined,
  lifted: { has(ts: string): boolean } | readonly string[],
): ViolationRule {
  switch (reason) {
    case 'unsigned':
    case 'missing-ref':
    case 'malformed-sig':
    case 'not-operator':
      return 'ALLCLEAR_UNSIGNED';
    case 'wrong-halt-ref': {
      const was = ref !== undefined && ('has' in lifted ? lifted.has(ref) : lifted.includes(ref));
      return was ? 'ALLCLEAR_REPLAYED' : 'ALLCLEAR_WRONG_REF';
    }
    default:
      return 'ALLCLEAR_FORGED';
  }
}

/**
 * Pure evaluation of the halt state machine over the sentinel + register.
 * No I/O, no journaling — the fs wrappers below feed it and act on it.
 */
export function evaluateHaltState(input: EvaluateHaltStateInput): HaltEvaluation {
  const violations: HaltViolation[] = [];
  const lifted = new Set<string>();
  const sentinel = input.sentinelLine === null ? null : parseRegistryLine(input.sentinelLine);
  const sentinelPresent = input.sentinelLine !== null;

  let current: RegistryLine | null = null;
  let currentLifted: RegistryLine | null = null;
  // A sentinel written by hand (shell `printf > HALT`) may never have been
  // appended to the register; it is still a hoisted halt.
  const seed: RegistryLine[] = [];
  if (isHalt(sentinel) && !input.registerLines.some((l) => parseRegistryLine(l)?.raw === sentinel.raw)) {
    seed.push(sentinel);
  }

  const ordered: RegistryLine[] = [
    ...seed,
    ...input.registerLines.map((l) => parseRegistryLine(l)).filter((r): r is RegistryLine => r !== null),
  ];

  for (const rec of ordered) {
    if (isHalt(rec)) {
      current = rec;
      currentLifted = null;
      continue;
    }
    if (!isAllClear(rec)) continue;

    if (!current) {
      violations.push({ rule: 'ALLCLEAR_WITHOUT_HALT', reason: 'no-halt-hoisted', line: rec.raw, ref: rec.fields.ref });
      continue;
    }
    if (currentLifted && rec.raw === currentLifted.raw) continue; // harmless duplicate of the consumed line

    const verdict: AllClearVerdict = input.publicKey === null
      ? { ok: false, reason: 'no-public-key', record: rec }
      : verifyAllClear(rec.raw, input.publicKey, current.ts);

    if (verdict.ok) {
      currentLifted = rec;
      lifted.add(current.ts);
      continue;
    }

    const ref = rec.fields.ref;
    const rule = classifyRejection(verdict.reason, ref, lifted);
    violations.push({ rule, reason: verdict.reason, line: rec.raw, haltTs: current.ts, ref });
  }

  if (!current) {
    return { status: { state: 'clear', halt: null, allClear: null }, violations, liftedHaltTs: [...lifted] };
  }
  if (currentLifted) {
    return {
      status: { state: 'lifted', halt: current, allClear: currentLifted, sentinelPresent },
      violations,
      liftedHaltTs: [...lifted],
    };
  }
  if (!sentinelPresent) {
    violations.push({ rule: 'HALT_SENTINEL_MISSING', reason: 'sentinel-missing', line: current.raw, haltTs: current.ts });
  }
  return {
    status: { state: 'hoisted', halt: current, allClear: null, sentinelPresent },
    violations,
    liftedHaltTs: [...lifted],
  };
}

// ─── Forensics ───────────────────────────────────────────────────────────────

/** Map a halt violation to an ADR-0089 journal event. `metadata.feedbackSeverity` carries ADR-0132's "severity high". */
export function violationToForensicsEvent(v: HaltViolation, now: number = Date.now()): ForensicsEvent {
  const severity: ForensicsEvent['severity'] = v.rule === 'HALT_SENTINEL_MISSING' ? 'violation' : 'critical';
  return {
    timestamp: now,
    rule: v.rule,
    severity,
    details: `[distress-allclear] ${v.rule} (${v.reason}): ${v.line}`,
    agentId: null,
    metadata: {
      adr: '0132',
      distressClass: 'MAYDAY',
      feedbackSeverity: 'high',
      reason: v.reason,
      line: v.line,
      ...(v.haltTs ? { haltTs: v.haltTs } : {}),
      ...(v.ref ? { ref: v.ref } : {}),
    },
  };
}

// In-process dedupe so a listening watch that re-reads the register every
// interval journals each forged line once, not once per tick.
const journaled = new Set<string>();

function journalViolations(sink: ForensicsSink, violations: HaltViolation[], now: () => number): void {
  for (const v of violations) {
    const key = `${v.rule}|${v.line}`;
    if (journaled.has(key)) continue;
    journaled.add(key);
    sink.record(violationToForensicsEvent(v, now()));
    console.error(`[distress-allclear] MAYDAY-class violation ${v.rule}: ${v.line}`);
  }
}

/** Test seam: forget which violations this process has already journaled. */
export function resetViolationJournalDedupe(): void {
  journaled.clear();
}

// ─── fs wrappers: what readers and the operator call ─────────────────────────

export interface ReadHaltStateOptions {
  paths?: DistressPaths;
  /** Overrides the pinned public-key file. */
  publicKey?: KeyObject | string | null;
  /** Durable journal; defaults to the ADR-0089 archive. Pass `null` to skip journaling. */
  forensics?: ForensicsSink | null;
  now?: () => number;
  /**
   * When the halt is verified lifted, remove the sentinel (the verifier path
   * is the only thing that may). Default true.
   */
  removeSentinelOnLift?: boolean;
}

/**
 * Read the halt state from disk, journal any violations, and — if a verified
 * ALL-CLEAR has lifted the halt — remove the sentinel.
 */
export function readHaltState(opts: ReadHaltStateOptions = {}): HaltEvaluation {
  const paths = opts.paths ?? defaultDistressPaths();
  const publicKey = opts.publicKey !== undefined ? opts.publicKey : loadOperatorPublicKey(paths);
  const now = opts.now ?? Date.now;
  const evaluation = evaluateHaltState({
    sentinelLine: readSentinelLine(paths.haltFile),
    registerLines: readLines(paths.distressFile),
    publicKey,
  });

  const sink = opts.forensics === undefined ? createJsonlForensicsArchive({ now }) : opts.forensics;
  if (sink && evaluation.violations.length > 0) journalViolations(sink, evaluation.violations, now);

  if (evaluation.status.state === 'lifted' && evaluation.status.sentinelPresent && (opts.removeSentinelOnLift ?? true)) {
    try {
      unlinkSync(paths.haltFile);
      evaluation.status.sentinelPresent = false;
    } catch {
      /* already gone, or not ours to remove — the state is lifted regardless */
    }
  }
  return evaluation;
}

// The halt PREDICATE (`haltActive()` / `readHalt()`) lives in lib/distress.ts
// and delegates to `readHaltState` above. It is deliberately not duplicated
// here: two exports with the same name and different answers is how a deleted
// sentinel came to resume the ladder in the phase-0 review.

export interface ApplyAllClearOptions extends ReadHaltStateOptions {
  /** Repo root for the repo-scoped register copy; omit outside a repo. */
  repoRoot?: string;
}

export type ApplyAllClearResult =
  | { lifted: true; line: string; halt: RegistryLine }
  | { lifted: false; reason: AllClearRejection | 'no-halt-hoisted' | 'no-public-key'; violation?: HaltViolation };

/**
 * The operator's verifier path: verify `line` against the currently hoisted
 * halt; if valid, append it to the machine-wide register (and the repo copy
 * when given) and remove the sentinel. If invalid, journal the violation and
 * append NOTHING — the register is not a place for known-bad lines.
 */
export function applyAllClear(line: string, opts: ApplyAllClearOptions = {}): ApplyAllClearResult {
  const paths = opts.paths ?? defaultDistressPaths({ repoRoot: opts.repoRoot });
  const publicKey = opts.publicKey !== undefined ? opts.publicKey : loadOperatorPublicKey(paths);
  const now = opts.now ?? Date.now;
  const sink = opts.forensics === undefined ? createJsonlForensicsArchive({ now }) : opts.forensics;

  const before = readHaltState({ ...opts, paths, publicKey, forensics: sink, now });
  if (before.status.state !== 'hoisted') return { lifted: false, reason: 'no-halt-hoisted' };
  if (publicKey === null) return { lifted: false, reason: 'no-public-key' };

  const halt = before.status.halt;
  const verdict = verifyAllClear(line, publicKey, halt.ts);
  if (!verdict.ok) {
    const ref = verdict.record?.fields.ref;
    const rule = classifyRejection(verdict.reason, ref, before.liftedHaltTs);
    const violation: HaltViolation = { rule, reason: verdict.reason, line: line.trim(), haltTs: halt.ts, ref };
    if (sink) journalViolations(sink, [violation], now);
    return { lifted: false, reason: verdict.reason, violation };
  }

  appendLine(paths.distressFile, verdict.record.raw);
  if (paths.repoDistressFile) appendLine(paths.repoDistressFile, verdict.record.raw);
  const after = readHaltState({ ...opts, paths, publicKey, forensics: sink, now, removeSentinelOnLift: true });
  if (after.status.state !== 'lifted') {
    // Cannot happen if the append succeeded; surface it rather than claim a lift.
    return { lifted: false, reason: 'bad-signature' };
  }
  return { lifted: true, line: verdict.record.raw, halt };
}

/**
 * Sign and apply in one operator step. `passphrase` unlocks the private key;
 * it must come from a TTY prompt, never from the environment.
 */
export function liftHalt(params: {
  operatorId: string;
  passphrase: string;
  paths?: DistressPaths;
  repoRoot?: string;
  forensics?: ForensicsSink | null;
  now?: () => number;
  ts?: string;
}): ApplyAllClearResult & { line?: string } {
  const paths = params.paths ?? defaultDistressPaths({ repoRoot: params.repoRoot });
  const publicKey = loadOperatorPublicKey(paths);
  if (!publicKey) return { lifted: false, reason: 'no-public-key' };
  const state = readHaltState({ paths, publicKey, forensics: params.forensics, now: params.now });
  if (state.status.state !== 'hoisted') return { lifted: false, reason: 'no-halt-hoisted' };
  const privateKey = loadOperatorPrivateKey(paths, params.passphrase);
  const { line } = signAllClear({ haltTs: state.status.halt.ts, operatorId: params.operatorId, privateKey, ts: params.ts });
  return applyAllClear(line, { paths, publicKey, forensics: params.forensics, now: params.now, repoRoot: params.repoRoot });
}
