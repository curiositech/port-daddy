/**
 * lib/safe/corral.ts — Phase B, `pd safe corral` (ADR-0088).
 *
 * Take the A1 secret findings (path + line + ruleId + last4) and, for each, pack
 * the plaintext secret OFF DISK into the existing Keychain/broker vault
 * (lib/secret-env.ts `corralSecret`), then rewrite the source occurrence to a
 * `pd-secret://KEY` reference so there is NO plaintext secret at rest.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE ORDER IS A SAFETY INVARIANT (each step gates the next)
 * ════════════════════════════════════════════════════════════════════════
 *  1. Re-read the source line; confirm it is a `KEY=value` assignment whose
 *     value's last4 matches the finding (TOCTOU + correct-target check).
 *  2. `corralSecret(KEY, value)` → the value lands in the encrypted vault.
 *  3. VERIFY THE RESOLVER ROUND-TRIPS: `resolveSecretRef('pd-secret://KEY')`
 *     must return the *exact* original value. If it does not, ABORT this item —
 *     we never strip a source of a secret we cannot inject back.
 *  4. Write a `.bak` of the original file under ~/.port-daddy/recovered.
 *  5. Only then rewrite the source line `KEY=value` → `KEY=pd-secret://KEY`.
 *
 * DRY-RUN IS THE DEFAULT. `plan…` mutates nothing; `apply…` is gated by the CLI
 * behind `--apply`.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE NO-RAW-SECRET RULE
 * ════════════════════════════════════════════════════════════════════════
 * No raw secret is returned, logged, or placed on any serializable plan/result
 * object. The value is read into a local, handed to the vault + the round-trip
 * check, and dropped. A {@link CorralPlanItem}/{@link CorralApplyResult} carries
 * only key/path/line/ruleId/last4 — exactly the A1 finding shape plus the key.
 *
 * NO keyword-NLP: targets come from the structured-format A1 scanner; the
 * assignment parse is a structured `KEY=value` grammar, never free-text.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

import {
  corralSecret,
  resolveSecretRef,
  isValidCorralKey,
  isSecretRef,
  PD_SECRET_SCHEME,
} from '../secret-env.js';
import type {
  SecretFinding,
  CorralPlan,
  CorralPlanItem,
  CorralApplyResult,
  CorralSkipReason,
} from './types.js';

/** Where `.bak` files of corralled sources are kept (never /tmp). */
export function corralBackupDir(home: string = homedir()): string {
  return join(home, '.port-daddy', 'recovered');
}

/**
 * Parse a single dotenv-style assignment line into `{ key, value }`, or null
 * when the line is not a `KEY=value` assignment. Structured grammar only:
 *
 *   - optional leading `export `
 *   - a key matching `[A-Za-z_][A-Za-z0-9_]*`
 *   - `=`
 *   - a value, optionally wrapped in matching single/double quotes
 *   - an optional trailing `# comment` (only when the value is unquoted)
 *
 * Comments (`#…`) and blank lines return null. The returned `value` is the
 * UNQUOTED secret (quotes stripped) — the exact bytes the consuming process sees.
 */
export function parseAssignment(
  rawLine: string,
): { key: string; value: string; quote: '' | '"' | "'" } | null {
  const line = rawLine.replace(/\r$/, '');
  const trimmed = line.trimStart();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null;
  const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
  if (!m) return null;
  const key = m[1];
  let rest = m[2];
  // Quoted value: take the quoted span exactly.
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const q = rest[0] as '"' | "'";
    const end = rest.indexOf(q, 1);
    if (end < 0) return null; // unterminated quote — refuse to guess
    return { key, value: rest.slice(1, end), quote: q };
  }
  // Unquoted: strip a trailing inline comment + surrounding whitespace.
  const hash = rest.indexOf(' #');
  if (hash >= 0) rest = rest.slice(0, hash);
  return { key, value: rest.trim(), quote: '' };
}

/** Recompute last4 the way the scanner does (last 4 chars; sub-4 masked). */
function last4Of(token: string): string {
  if (token.length <= 4) return '*'.repeat(token.length);
  return token.slice(-4);
}

/**
 * Choose the corral key for a finding. The dotenv KEY name is the natural choice
 * (`STRIPE_SECRET_KEY` → `pd-secret://STRIPE_SECRET_KEY`). When the same KEY is
 * already taken in `usedKeys` by a DIFFERENT value (two files, same var name),
 * disambiguate with a short path-derived suffix so neither value is clobbered.
 */
function corralKeyFor(
  assignmentKey: string,
  path: string,
  usedKeys: Set<string>,
): string {
  if (!usedKeys.has(assignmentKey) && isValidCorralKey(assignmentKey)) {
    return assignmentKey;
  }
  // Suffix from the file basename, upper-cased + sanitized to env-var shape.
  const base = basename(path)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  const candidate = `${assignmentKey}__${base || 'SRC'}`;
  return isValidCorralKey(candidate) ? candidate : assignmentKey;
}

export interface PlanOptions {
  home?: string;
  /** Injectable reader (tests). abs path → contents | null. */
  readFile?: (path: string) => string | null;
}

/**
 * Build the dry-run corral plan for a set of findings. Re-reads each source line
 * to classify it; mutates NOTHING. Findings whose source line is not a
 * `KEY=value` assignment (PEM bodies, JSON tokens, shell history) are listed as
 * `corralable: false` with a `not-keyed` reason — surfaced honestly, never
 * silently dropped or guessed at.
 */
export function planCorral(
  findings: SecretFinding[],
  opts: PlanOptions = {},
): CorralPlan {
  const home = opts.home ?? homedir();
  const read =
    opts.readFile ??
    ((p: string): string | null => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    });

  const items: CorralPlanItem[] = [];
  const usedKeys = new Set<string>();
  // Cache file contents so we read each source once.
  const fileCache = new Map<string, string | null>();
  const getFile = (p: string): string | null => {
    if (!fileCache.has(p)) fileCache.set(p, read(p));
    return fileCache.get(p) ?? null;
  };

  for (const f of findings) {
    const content = getFile(f.path);
    const mkSkip = (
      key: string,
      reason: CorralSkipReason,
    ): CorralPlanItem => ({
      path: f.path,
      line: f.line,
      key,
      ruleId: f.ruleId,
      last4: f.last4,
      ref: `${PD_SECRET_SCHEME}${key}`,
      corralable: false,
      skipReason: reason,
    });

    if (content == null) {
      items.push(mkSkip('', 'unreadable'));
      continue;
    }
    const lines = content.split('\n');
    const raw = lines[f.line - 1];
    if (raw === undefined) {
      items.push(mkSkip('', 'value-mismatch'));
      continue;
    }
    const assign = parseAssignment(raw);
    if (!assign) {
      items.push(mkSkip('', 'not-keyed'));
      continue;
    }
    if (isSecretRef(assign.value)) {
      items.push(mkSkip(assign.key, 'already-ref'));
      continue;
    }
    // TOCTOU / correct-target: the value at this line must still match the
    // finding's last4 (the scanner detected SOMETHING here; confirm it's this).
    if (last4Of(assign.value) !== f.last4) {
      items.push(mkSkip(assign.key, 'value-mismatch'));
      continue;
    }
    const key = corralKeyFor(assign.key, f.path, usedKeys);
    usedKeys.add(key);
    items.push({
      path: f.path,
      line: f.line,
      key,
      ruleId: f.ruleId,
      last4: f.last4,
      ref: `${PD_SECRET_SCHEME}${key}`,
      corralable: true,
    });
  }

  return { items, backupDir: corralBackupDir(home) };
}

export interface ApplyOptions {
  home?: string;
  /** Injectable reader (tests). */
  readFile?: (path: string) => string | null;
  /** Injectable writer (tests). */
  writeFile?: (path: string, content: string) => void;
  /** Injectable mkdir -p (tests). */
  mkdirp?: (dir: string) => void;
  /** Injectable existence probe (tests). */
  exists?: (path: string) => boolean;
  /** Injectable clock for deterministic .bak names (tests). */
  now?: () => Date;
}

/**
 * Apply ONE corralable plan item. The SAFETY ORDER is enforced here and any step
 * failing aborts the rewrite, leaving the source untouched:
 *
 *   re-read+re-verify value → vault save → resolver round-trip → .bak → rewrite.
 *
 * A non-corralable item (skipReason set) returns `applied: false` without touching
 * anything. Never throws — a failure is reported, not fatal.
 */
export function applyCorralItem(
  item: CorralPlanItem,
  opts: ApplyOptions = {},
): CorralApplyResult {
  const fail = (error: string, roundTripVerified = false): CorralApplyResult => ({
    path: item.path,
    line: item.line,
    key: item.key,
    ruleId: item.ruleId,
    last4: item.last4,
    applied: false,
    roundTripVerified,
    error,
  });

  if (!item.corralable) {
    return fail(`not corralable: ${item.skipReason ?? 'unknown'}`);
  }

  const home = opts.home ?? homedir();
  const read =
    opts.readFile ??
    ((p: string): string | null => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    });
  const write =
    opts.writeFile ?? ((p: string, c: string) => writeFileSync(p, c, 'utf8'));
  const mkdirp = opts.mkdirp ?? ((d: string) => mkdirSync(d, { recursive: true }));
  const exists = opts.exists ?? ((p: string) => existsSync(p));
  const now = opts.now ?? (() => new Date());

  // ── 1. Re-read + re-verify (TOCTOU): the value must still be there ──
  const content = read(item.path);
  if (content == null) return fail('source unreadable at apply time');
  const lines = content.split('\n');
  const raw = lines[item.line - 1];
  if (raw === undefined) return fail('source line vanished at apply time');
  const assign = parseAssignment(raw);
  if (!assign) return fail('source line is no longer a KEY=value assignment');
  if (isSecretRef(assign.value)) return fail('source already a pd-secret:// ref');
  if (last4Of(assign.value) !== item.last4) {
    return fail('value changed under us (last4 mismatch) — refusing rewrite');
  }
  const value = assign.value;

  // ── 2. Vault save ──
  try {
    corralSecret(item.key, value);
  } catch (e) {
    return fail(`vault save failed: ${e instanceof Error ? e.message : 'error'}`);
  }

  // ── 3. Resolver round-trip — the CRITICAL gate before any source rewrite ──
  const resolved = resolveSecretRef(item.ref);
  const roundTripVerified = resolved === value;
  if (!roundTripVerified) {
    return fail(
      'resolver round-trip FAILED — vault did not return the original value; ' +
        'source left untouched (no plaintext lost)',
      false,
    );
  }

  // ── 4. .bak of the original file under ~/.port-daddy/recovered ──
  const backupDir = corralBackupDir(home);
  let backupPath: string;
  try {
    mkdirp(backupDir);
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const safeName = item.path.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '');
    backupPath = join(backupDir, `${safeName}.${stamp}.bak`);
    // Don't clobber an existing .bak from this same instant (suffix if needed).
    if (exists(backupPath)) backupPath = join(backupDir, `${safeName}.${stamp}.${item.key}.bak`);
    write(backupPath, content);
  } catch (e) {
    return fail(
      `.bak write failed: ${e instanceof Error ? e.message : 'error'} ` +
        '(source left untouched; value is safely in the vault)',
      true,
    );
  }

  // ── 5. Rewrite the source line: KEY=value → KEY=pd-secret://KEY ──
  // Preserve the leading whitespace + any `export ` prefix + the `KEY=` head.
  try {
    const newLine = rewriteAssignmentLine(raw, assign.key, item.ref, assign.quote);
    lines[item.line - 1] = newLine;
    write(item.path, lines.join('\n'));
  } catch (e) {
    return fail(
      `source rewrite failed: ${e instanceof Error ? e.message : 'error'} ` +
        '(value is in the vault + a .bak exists at ' + backupPath + ')',
      true,
    );
  }

  return {
    path: item.path,
    line: item.line,
    key: item.key,
    ruleId: item.ruleId,
    last4: item.last4,
    applied: true,
    backupPath,
    roundTripVerified: true,
  };
}

/**
 * Rewrite one assignment line's VALUE to `ref`, preserving the leading whitespace,
 * any `export ` prefix, the `KEY=` head, and the original quoting style. The ref
 * itself is never quoted (it has no shell-special chars).
 */
export function rewriteAssignmentLine(
  raw: string,
  key: string,
  ref: string,
  _quote: '' | '"' | "'",
): string {
  const lineEnd = raw.endsWith('\r') ? '\r' : '';
  const body = lineEnd ? raw.slice(0, -1) : raw;
  // Find `KEY=` (with optional leading whitespace + `export `) and replace the rest.
  const head = /^(\s*(?:export\s+)?)/.exec(body)?.[1] ?? '';
  const idx = body.indexOf(`${key}=`, head.length);
  if (idx < 0) {
    // Defensive: if we cannot locate the head, fall back to a whole-line rewrite.
    return `${head}${key}=${ref}${lineEnd}`;
  }
  return `${body.slice(0, idx)}${key}=${ref}${lineEnd}`;
}
