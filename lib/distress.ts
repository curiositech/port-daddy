/**
 * The Distress Register — Area A0, the floor (ADR-0132 phase 0).
 *
 * This module is the EPIRB: it must work when nothing else does. It therefore
 * depends on nothing but the Node standard library — no daemon, no socket, no
 * database, no git. The only `lib/` modules it touches are the two that share
 * that constraint: `lib/distress-allclear.ts` (the ADR-0132 §4 halt state
 * machine, phase 4) and `lib/forensics-archive.ts` (the ADR-0089 JSONL
 * journal). Both are `node:*`-only. Keep it that way.
 *
 * Two files carry the whole tier:
 *
 *   ~/.port-daddy/DISTRESS       machine-wide distress file (append-only)
 *   <repo>/.portdaddy/DISTRESS   repo-scoped distress file (append-only)
 *   ~/.port-daddy/HALT           the halt sentinel: its EXISTENCE is the signal
 *   <repo>/.portdaddy/HALT       repo-scoped sentinel (machine-wide is authoritative)
 *
 * `PD_HOME` overrides `~/.port-daddy` exactly as it does for the shell hooks in
 * `bin/` and for `shared/paths.ts`; it is read lazily on every call so a test
 * can point the register at a scratch directory.
 *
 * Wire format — one line per record, no multi-line records:
 *
 *     <iso8601-utc> <kind>:<id> <CLASS> <CODE> [k=v ...] [-- free text]
 *
 * `bin/pd-distress` writes the identical format from POSIX sh; the shell test
 * and the round-trip tests here pin the two implementations to each other.
 *
 * ── Atomicity of appends ────────────────────────────────────────────────────
 * `appendDistress()` opens the file with flag `'a'` (`O_APPEND`) and hands the
 * whole line to one `write(2)`. POSIX guarantees that with `O_APPEND` the seek
 * to end-of-file and the write are a single atomic step, so two concurrent
 * writers can never be assigned the same offset. Whether the *bytes* of two
 * writes can interleave is a property of the write size: a single `write(2)`
 * of at most one page on a local filesystem is delivered whole by every
 * kernel Port Daddy runs on (Linux ext4/xfs/btrfs, macOS APFS). Node's
 * `appendFileSync` issues exactly one `write(2)` for a buffer of this size and
 * only loops on a short write, which regular local files do not produce. The
 * register therefore enforces `DISTRESS_MAX_LINE_BYTES` (4096 bytes, one page,
 * newline included) and refuses longer lines rather than risk a torn record.
 * `tests/unit/distress.test.ts` verifies the claim empirically with fifty
 * concurrent subprocesses.
 *
 * ── Absence is not all-clear ────────────────────────────────────────────────
 * `haltActive()` / `readHalt()` are THE halt predicate for the guard, the
 * reaper, resurrection, the death handler, the custodian and the listening
 * watch. They answer "halted" when ANY of these holds, in this order:
 *
 *   1. the machine-wide sentinel exists (whatever its contents — `test -f`);
 *   2. the machine-wide register carries a `SECURITE HALT` with no verified
 *      `ALL-CLEAR` naming it (ADR-0132 §4): deleting the sentinel does not end
 *      a halt, and the deletion is journaled as `HALT_SENTINEL_MISSING`;
 *   3. the repo-scoped sentinel exists;
 *   4. the home directory cannot be read at all — fail closed.
 *
 * The register rule is `lib/distress-allclear.ts#readHaltState`; this module
 * delegates to it rather than forking a weaker predicate. Lifting a halt is
 * NOT provided here on purpose: only a signed `ALL-CLEAR` (`liftHalt` in that
 * module, operator TTY only) lifts one. A runaway agent must not be able to
 * end its own halt by calling a function or by deleting a file.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defaultDistressPaths, readHaltState, type HaltEvaluation } from './distress-allclear.js';
import { createJsonlForensicsArchive } from './forensics-archive.js';

// ─── Registry ────────────────────────────────────────────────────────────────

/** The four ADR-0132 classes plus the `control` pseudo-class for floor control. */
export const DISTRESS_CLASSES = ['MAYDAY', 'PAN PAN', 'SECURITE', 'ROUTINE', 'control'] as const;
export type DistressClass = (typeof DISTRESS_CLASSES)[number];

/**
 * The code table from ADR-0132 §1. Extend ONLY through the ADR's registry —
 * never ad hoc. Each code belongs to exactly one class.
 */
export const DISTRESS_CODES = {
  HALT: 'SECURITE',
  'ALL-CLEAR': 'SECURITE',
  DRILL: 'SECURITE',
  'SPLIT-BRAIN': 'MAYDAY',
  'SPEND-RUNAWAY': 'MAYDAY',
  CORRUPT: 'MAYDAY',
  'CANNOT-STOP': 'MAYDAY',
  UNREACHABLE: 'PAN PAN',
  'HALF-ALIVE': 'PAN PAN',
  UNVERIFIED: 'PAN PAN',
  'TAKING-FLOOR': 'control',
  'STANDING-DOWN': 'control',
  SEEN: 'control',
  COMPLIED: 'control',
  LISTENING: 'ROUTINE',
} as const satisfies Record<string, DistressClass>;
export type DistressCode = keyof typeof DISTRESS_CODES;

/** Every registered code, in registry order. */
export const DISTRESS_CODE_LIST = Object.keys(DISTRESS_CODES) as DistressCode[];

/** Hard ceiling on one serialized line, newline included. See the header. */
export const DISTRESS_MAX_LINE_BYTES = 4096;

export const DISTRESS_FILE_NAME = 'DISTRESS';
export const HALT_FILE_NAME = 'HALT';
export const REPO_SCOPE_DIR = '.portdaddy';

export function isDistressClass(value: unknown): value is DistressClass {
  return typeof value === 'string' && (DISTRESS_CLASSES as readonly string[]).includes(value);
}

export function isDistressCode(value: unknown): value is DistressCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DISTRESS_CODES, value);
}

/** The class a registered code belongs to. */
export function classOfCode(code: DistressCode): DistressClass {
  return DISTRESS_CODES[code];
}

// ─── Records ─────────────────────────────────────────────────────────────────

export interface DistressRecord {
  /** ISO-8601 UTC instant, e.g. `2026-09-05T14:02:11Z`. */
  at: string;
  /** Entity kind: `operator`, `agent`, `daemon`, `supervisor`, `shell`, ... */
  kind: string;
  /** Entity id; may itself contain colons (`claude-code:ranking-shadow`). */
  id: string;
  cls: DistressClass;
  code: DistressCode;
  /** `k=v` fields, in wire order. Values never contain whitespace. */
  fields: Record<string, string>;
  /** Trailing, non-load-bearing free text (after ` -- `). */
  text?: string;
}

export interface DistressInput {
  kind: string;
  id: string;
  cls: DistressClass;
  code: DistressCode;
  fields?: Record<string, string | number | boolean>;
  text?: string;
  /** Defaults to now. Must be ISO-8601 UTC with a `Z` suffix. */
  at?: string;
}

export type ParseResult =
  | { ok: true; record: DistressRecord }
  | { ok: false; error: string; raw: string };

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const KIND_RE = /^[a-z][a-z0-9-]*$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const FIELD_TOKEN_RE = /^([A-Za-z][A-Za-z0-9_.-]*)=(\S*)$/;

/** Wall-clock instant in the register's timestamp shape (seconds precision). */
export function distressNow(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ─── Serializer ──────────────────────────────────────────────────────────────

/**
 * Serialize one record to its exact wire line (no trailing newline). Throws
 * on anything that could not be parsed back identically: unknown code,
 * class/code mismatch, whitespace in a field value, a newline in the text,
 * or a line longer than `DISTRESS_MAX_LINE_BYTES`.
 */
export function serializeDistress(input: DistressInput): string {
  const at = input.at ?? distressNow();
  if (!TIMESTAMP_RE.test(at)) throw new Error(`distress: timestamp must be ISO-8601 UTC with Z suffix, got ${JSON.stringify(at)}`);
  if (!KIND_RE.test(input.kind)) throw new Error(`distress: kind must match ${KIND_RE}, got ${JSON.stringify(input.kind)}`);
  if (!input.id || /\s/.test(input.id)) throw new Error(`distress: id must be non-empty and contain no whitespace, got ${JSON.stringify(input.id)}`);
  if (!isDistressClass(input.cls)) throw new Error(`distress: unknown class ${JSON.stringify(input.cls)}`);
  if (!isDistressCode(input.code)) throw new Error(`distress: unregistered code ${JSON.stringify(input.code)} — extend the registry through ADR-0132, never ad hoc`);
  const registered = classOfCode(input.code);
  if (registered !== input.cls) throw new Error(`distress: code ${input.code} belongs to class ${registered}, not ${input.cls}`);

  const parts = [at, `${input.kind}:${input.id}`, input.cls, input.code];
  for (const [key, rawValue] of Object.entries(input.fields ?? {})) {
    if (!FIELD_KEY_RE.test(key)) throw new Error(`distress: field key ${JSON.stringify(key)} must match ${FIELD_KEY_RE}`);
    const value = String(rawValue);
    if (/\s/.test(value)) throw new Error(`distress: field ${key} value must not contain whitespace; put prose after "--"`);
    parts.push(`${key}=${value}`);
  }
  if (input.text !== undefined) {
    const text = input.text.trim();
    if (text.length === 0) throw new Error('distress: free text must be non-empty when supplied');
    if (/[\r\n]/.test(text)) throw new Error('distress: free text must be a single line');
    parts.push('--', text);
  }
  const line = parts.join(' ');
  const bytes = Buffer.byteLength(line, 'utf8') + 1;
  if (bytes > DISTRESS_MAX_LINE_BYTES) {
    throw new Error(`distress: line is ${bytes} bytes; the atomic-append bound is ${DISTRESS_MAX_LINE_BYTES}`);
  }
  return line;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse one wire line. Never throws; malformed input comes back as
 * `{ ok: false }` so a reader can skip a torn or hand-edited line without
 * losing the rest of the file.
 *
 * Accepts the canonical `<CLASS> <CODE>` form for every class. For
 * `control`-class codes it also accepts the ADR's example shorthand where the
 * class token is omitted (`... agent:x SEEN ref=...`); re-serializing such a
 * record yields the canonical form.
 */
export function parseDistressLine(raw: string): ParseResult {
  const line = raw.replace(/\r?\n$/, '');
  const fail = (error: string): ParseResult => ({ ok: false, error, raw: line });
  if (line.trim().length === 0) return fail('empty line');
  if (line !== line.trim()) return fail('leading or trailing whitespace');

  const tokens = line.split(' ');
  if (tokens.some((t) => t.length === 0)) return fail('runs of spaces are not allowed');
  if (tokens.length < 3) return fail('expected at least <ts> <kind:id> <CODE>');

  const [at, entity] = tokens;
  if (!TIMESTAMP_RE.test(at)) return fail(`bad timestamp ${JSON.stringify(at)}`);
  const colon = entity.indexOf(':');
  if (colon <= 0 || colon === entity.length - 1) return fail(`bad entity ${JSON.stringify(entity)}; expected <kind>:<id>`);
  const kind = entity.slice(0, colon);
  const id = entity.slice(colon + 1);
  if (!KIND_RE.test(kind)) return fail(`bad entity kind ${JSON.stringify(kind)}`);

  let index = 2;
  let cls: DistressClass | null = null;
  if (tokens[index] === 'PAN' && tokens[index + 1] === 'PAN') {
    cls = 'PAN PAN';
    index += 2;
  } else if (isDistressClass(tokens[index])) {
    cls = tokens[index] as DistressClass;
    index += 1;
  }

  const codeToken = tokens[index];
  if (codeToken === undefined) return fail('missing code');
  if (!isDistressCode(codeToken)) return fail(`unregistered code ${JSON.stringify(codeToken)}`);
  const code = codeToken;
  index += 1;
  const registered = classOfCode(code);
  if (cls === null) {
    // ADR example shorthand: control codes may appear without the class token.
    if (registered !== 'control') return fail(`code ${code} requires its class token ${registered}`);
    cls = 'control';
  } else if (cls !== registered) {
    return fail(`code ${code} belongs to class ${registered}, not ${cls}`);
  }

  const fields: Record<string, string> = {};
  let text: string | undefined;
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') {
      const rest = tokens.slice(index + 1).join(' ');
      if (rest.length === 0) return fail('"--" must be followed by free text');
      text = rest;
      break;
    }
    const match = FIELD_TOKEN_RE.exec(token);
    if (!match) return fail(`bad field token ${JSON.stringify(token)}; expected k=v`);
    const [, key, value] = match;
    if (Object.prototype.hasOwnProperty.call(fields, key)) return fail(`duplicate field ${key}`);
    fields[key] = value;
  }

  const record: DistressRecord = { at, kind, id, cls, code, fields };
  if (text !== undefined) record.text = text;
  return { ok: true, record };
}

/** Parse a whole file body; malformed lines are reported, not thrown. */
export function parseDistressFile(body: string): { records: DistressRecord[]; malformed: Array<{ line: number; raw: string; error: string }> } {
  const records: DistressRecord[] = [];
  const malformed: Array<{ line: number; raw: string; error: string }> = [];
  const lines = body.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  lines.forEach((raw, i) => {
    if (raw.trim().length === 0) return;
    const parsed = parseDistressLine(raw);
    if (parsed.ok) records.push(parsed.record);
    else malformed.push({ line: i + 1, raw: parsed.raw, error: parsed.error });
  });
  return { records, malformed };
}

// ─── Locations ───────────────────────────────────────────────────────────────

/** `$PD_HOME` or `~/.port-daddy`, resolved on every call. */
export function distressHome(): string {
  const override = process.env.PD_HOME?.trim();
  return override ? resolve(override) : join(homedir(), '.port-daddy');
}

/**
 * Walk up from `cwd` to the nearest directory containing `.git` (a directory
 * for a primary checkout, a file for a linked worktree). No git binary is
 * spawned: the floor must not depend on git being installed or healthy.
 */
export function findRepoRoot(cwd: string = process.cwd()): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface ScopeOptions {
  /** Directory to search for the enclosing repo. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Explicit repo root; `null` disables the repo-scoped location. */
  repoRoot?: string | null;
}

function resolveRepoRoot(options: ScopeOptions): string | null {
  if (options.repoRoot === null) return null;
  if (typeof options.repoRoot === 'string') return resolve(options.repoRoot);
  return findRepoRoot(options.cwd);
}

/** Machine-wide and (when inside a repo) repo-scoped distress file paths. */
export function distressPaths(options: ScopeOptions = {}): { machine: string; repo: string | null } {
  const repoRoot = resolveRepoRoot(options);
  return {
    machine: join(distressHome(), DISTRESS_FILE_NAME),
    repo: repoRoot ? join(repoRoot, REPO_SCOPE_DIR, DISTRESS_FILE_NAME) : null,
  };
}

/** Machine-wide (authoritative) and repo-scoped halt sentinel paths. */
export function haltPaths(options: ScopeOptions = {}): { machine: string; repo: string | null } {
  const repoRoot = resolveRepoRoot(options);
  return {
    machine: join(distressHome(), HALT_FILE_NAME),
    repo: repoRoot ? join(repoRoot, REPO_SCOPE_DIR, HALT_FILE_NAME) : null,
  };
}

// ─── Appending ───────────────────────────────────────────────────────────────

export interface AppendOptions extends ScopeOptions {
  /** Which files to append to. Default `'both'`: machine-wide, plus repo-scoped when inside a repo. */
  scope?: 'machine' | 'repo' | 'both';
}

export interface AppendResult {
  line: string;
  record: DistressRecord;
  /** Files the line was appended to, machine-wide first. */
  paths: string[];
}

function appendLineAtomically(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // One write(2) under O_APPEND; see the atomicity note in the header.
  appendFileSync(path, `${line}\n`, { flag: 'a', mode: 0o644 });
}

/**
 * Append one registry-format line to the distress file(s). The write is a
 * single `O_APPEND` `write(2)` per file, so concurrent writers never tear or
 * reorder each other's lines. Throws only when the record itself is invalid
 * or the filesystem refuses the write.
 */
export function appendDistress(input: DistressInput, options: AppendOptions = {}): AppendResult {
  const line = serializeDistress(input);
  const parsed = parseDistressLine(line);
  if (!parsed.ok) throw new Error(`distress: serializer produced an unparseable line: ${parsed.error}`);
  const scope = options.scope ?? 'both';
  const targets = distressPaths(options);
  const paths: string[] = [];
  if (scope !== 'repo') paths.push(targets.machine);
  if (scope !== 'machine' && targets.repo) paths.push(targets.repo);
  if (scope === 'repo' && !targets.repo) throw new Error('distress: scope "repo" requested outside a repository');
  for (const path of paths) appendLineAtomically(path, line);
  return { line, record: parsed.record, paths };
}

/**
 * Last words on stderr (ADR-0132 A0 rung 4): an entity that dies on purpose
 * or catches a fatal error prints one registry-format line before exiting.
 * Also appended to the distress file when `alsoAppend` is not `false`.
 */
export function lastWords(input: DistressInput, options: AppendOptions & { alsoAppend?: boolean; stderr?: { write(chunk: string): unknown } } = {}): string {
  const line = serializeDistress(input);
  (options.stderr ?? process.stderr).write(`${line}\n`);
  if (options.alsoAppend !== false) {
    try {
      appendDistress(input, options);
    } catch {
      // The console line already went out; a failed file write must not mask the death.
    }
  }
  return line;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface ReadOptions extends ScopeOptions {
  /** Which file to read. Default `'machine'`. */
  scope?: 'machine' | 'repo';
}

export interface ReadDetailed {
  path: string | null;
  records: DistressRecord[];
  malformed: Array<{ line: number; raw: string; error: string }>;
}

/** Read one distress file in full, reporting malformed lines separately. */
export function readDistressDetailed(options: ReadOptions = {}): ReadDetailed {
  const targets = distressPaths(options);
  const path = (options.scope ?? 'machine') === 'repo' ? targets.repo : targets.machine;
  if (!path || !existsSync(path)) return { path, records: [], malformed: [] };
  const body = readFileSync(path, 'utf8');
  return { path, ...parseDistressFile(body) };
}

/** Every well-formed record in the selected distress file, in append order. */
export function readDistress(options: ReadOptions = {}): DistressRecord[] {
  return readDistressDetailed(options).records;
}

// ─── The halt sentinel ───────────────────────────────────────────────────────

export interface HaltRecord {
  /**
   * File that answered. For `source: 'sentinel'` the sentinel itself; for
   * `source: 'register'` the machine-wide distress file that still carries
   * the unlifted `SECURITE HALT`; for `source: 'unreadable'` the sentinel path
   * that could not be checked.
   */
  path: string;
  scope: 'machine' | 'repo';
  /**
   * Where the halt was found. `sentinel`: the HALT file exists (existence is
   * the signal; contents optional). `register`: the sentinel is gone but the
   * register carries a `SECURITE HALT` with no verified `ALL-CLEAR` —
   * ADR-0132 §4, absence is not all-clear. `unreadable`: the home could not
   * be read, so the predicate failed closed.
   */
  source: 'sentinel' | 'register' | 'unreadable';
  /** Raw sentinel contents (trimmed), or the register's HALT line. */
  raw: string;
  /** The parsed `SECURITE HALT` line, when the contents are well-formed. */
  record: DistressRecord | null;
  /** Best-effort instant of the halt: the record's timestamp, else the file's mtime. */
  at: string;
}

/**
 * Run the ADR-0132 §4 state machine over the machine-wide sentinel and
 * register under `distressHome()`. `PD_HOME` is honoured per call (the
 * phase-4 module resolves it once at import, so the paths are passed in).
 * Violations — a deleted sentinel, a forged all-clear — are journaled under
 * `<home>/forensics/`. This is a READ: it never unlinks the sentinel. Only
 * the operator's verifier path (`applyAllClear` / `liftHalt`) removes it, so
 * a sentinel that exists is halted even when the register says lifted — a
 * flag hoisted by hand after a lift is a new halt, not a stale file for the
 * reaper to tidy away.
 */
function evaluateHaltRegister(): HaltEvaluation {
  const home = distressHome();
  return readHaltState({
    paths: defaultDistressPaths({ home }),
    forensics: createJsonlForensicsArchive({ dir: join(home, 'forensics') }),
    removeSentinelOnLift: false,
  });
}

function readSentinel(path: string, scope: 'machine' | 'repo'): HaltRecord | null {
  if (!existsSync(path)) return null;
  let raw = '';
  let mtime = new Date();
  try {
    raw = readFileSync(path, 'utf8').trim();
    mtime = statSync(path).mtime;
  } catch {
    // Existence is the signal; unreadable contents still mean "halted".
  }
  const firstLine = raw.split('\n')[0] ?? '';
  const parsed = firstLine ? parseDistressLine(firstLine) : null;
  const record = parsed && parsed.ok && parsed.record.code === 'HALT' ? parsed.record : null;
  return { path, scope, source: 'sentinel', raw, record, at: record?.at ?? distressNow(mtime) };
}

function unreadableHalt(path: string): HaltRecord {
  return { path, scope: 'machine', source: 'unreadable', raw: '', record: null, at: distressNow() };
}

/**
 * Read the halt in force. Machine-wide sentinel first (authoritative), then
 * the machine-wide register (an unlifted `SECURITE HALT` keeps the halt in
 * force after the sentinel is deleted), then the repo-scoped sentinel.
 * Returns `null` only when none of them says "halted". Never throws: a home
 * that cannot be read answers with a `source: 'unreadable'` record, because
 * "I cannot tell" must not become "carry on".
 */
export function readHalt(options: ScopeOptions = {}): HaltRecord | null {
  let paths: { machine: string; repo: string | null };
  try {
    paths = haltPaths(options);
  } catch {
    return unreadableHalt(join(distressHome(), HALT_FILE_NAME));
  }
  try {
    const evaluation = evaluateHaltRegister();
    const machine = readSentinel(paths.machine, 'machine');
    if (machine) return machine;
    if (evaluation.status.state === 'hoisted') {
      const halt = evaluation.status.halt;
      const parsed = parseDistressLine(halt.raw);
      const record = parsed.ok && parsed.record.code === 'HALT' ? parsed.record : null;
      return {
        path: join(distressHome(), DISTRESS_FILE_NAME),
        scope: 'machine',
        source: 'register',
        raw: halt.raw,
        record,
        at: record?.at ?? halt.ts,
      };
    }
    if (paths.repo) return readSentinel(paths.repo, 'repo');
    return null;
  } catch {
    return unreadableHalt(paths.machine);
  }
}

/**
 * Is a halt in force? The one predicate every organ consults (see the module
 * header): sentinel present, OR an unlifted `SECURITE HALT` in the register,
 * OR the repo-scoped sentinel, OR an unreadable home (fail closed). Never
 * throws.
 */
export function haltActive(options: ScopeOptions = {}): boolean {
  try {
    return readHalt(options) !== null;
  } catch {
    return true;
  }
}

export interface WriteHaltInput {
  /** Operator id, e.g. `erich`. The sentinel is written as `operator:<id>`. */
  operator: string;
  reason?: string;
  /** Pointer to the incident record, e.g. `docs/incidents/2026-09-05-port-daddy-halt.md`. */
  ref?: string;
  fields?: Record<string, string | number | boolean>;
  text?: string;
  at?: string;
  /** Default `'machine'` — the authoritative sentinel. `'both'` also hoists the repo-scoped flag. */
  scope?: 'machine' | 'repo' | 'both';
  cwd?: string;
  repoRoot?: string | null;
}

/**
 * Hoist the halt: write the `SECURITE HALT` line as the sentinel's contents
 * and append the same line to the distress file(s).
 *
 * OPERATOR PATH ONLY. Nothing that runs unattended may call this; a halt is an
 * operator decision (ADR-0132 §3). There is deliberately no matching
 * `clearHalt()` — see the header.
 */
export function writeHalt(input: WriteHaltInput): { record: DistressRecord; line: string; paths: string[] } {
  if (!input.operator || /\s/.test(input.operator)) throw new Error('distress: writeHalt requires an operator id without whitespace');
  const fields: Record<string, string | number | boolean> = { ...(input.fields ?? {}) };
  if (input.reason !== undefined) fields.reason = input.reason;
  if (input.ref !== undefined) fields.ref = input.ref;
  const record: DistressInput = {
    kind: 'operator', id: input.operator, cls: 'SECURITE', code: 'HALT', fields, text: input.text, at: input.at,
  };
  const line = serializeDistress(record);
  const scope = input.scope ?? 'machine';
  const targets = haltPaths(input);
  const paths: string[] = [];
  if (scope !== 'repo') paths.push(targets.machine);
  if (scope !== 'machine') {
    if (!targets.repo) throw new Error('distress: repo-scoped halt requested outside a repository');
    paths.push(targets.repo);
  }
  for (const path of paths) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${line}\n`, { mode: 0o644 });
  }
  // Pin the timestamp so the sentinel and the distress file carry the same instant.
  const appended = appendDistress({ ...record, at: line.split(' ')[0] }, { scope, cwd: input.cwd, repoRoot: input.repoRoot });
  return { record: appended.record, line, paths };
}

/**
 * One calm line for an entity taking its legible `off` path during a halt.
 * Shared by the Coordination Guard, the reaper and resurrection so the
 * operator sees the same sentence everywhere.
 */
export function describeHalt(halt: HaltRecord): string {
  const who = halt.record ? `${halt.record.kind}:${halt.record.id}` : 'operator';
  return `Port Daddy is halted by ${who} (SECURITE HALT ${halt.at})`;
}
