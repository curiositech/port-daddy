/**
 * lib/safe/secret-scanner.ts — A1, the secret-at-rest scanner (ADR-0088 Phase A).
 *
 * Structured key-FORMAT regex (the vendored gitleaks MIT corpus) + a Shannon
 * entropy FALLBACK that never fires as the sole verdict. NO keyword-NLP
 * classifier — detection is over fixed credential FORMATS, never free text.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE NO-RAW-SECRET RULE (a security feature — a leak here is a blocker)
 * ════════════════════════════════════════════════════════════════════════
 * Every finding carries `{ path, line, ruleId, last4, entropy, verified:null }`.
 * The matched value is NEVER returned, logged, or stored. `last4` is the last
 * four characters of the token — an identifier for triage, not a usable secret.
 *
 * Detection order:
 *   1. STRUCTURED FORMAT — a vendored regex matches → that IS the verdict
 *      (subject to the rule's optional per-rule entropy floor).
 *   2. ENTROPY FALLBACK — only on a known credential path, or beside a
 *      structured anchor on the same line; a high-entropy blob (base64 floor
 *      4.5, hex 3.0, length ≥ 20) is reported as `high-entropy-blob`. Entropy
 *      is never the sole signal on an unknown path with no anchor.
 *
 * Hiding-spot list is seeded from `defaultCrownJewels()` (lib/coast-guard.ts)
 * then extended per ADR-0088 (.env*, ~/.aws/credentials, gh hosts.yml, ~/.netrc,
 * ~/.npmrc, ~/.pip/pip.conf, ~/.docker/config.json, ~/.ssh/* PEM, shell history,
 * .mcp.json, ~/.cursor/mcp.json, Claude config).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultCrownJewels } from '../coast-guard.js';
import type {
  GitleaksRule,
  GitleaksRulePack,
  SecretFinding,
  ScanOptions,
  ScanResult,
} from './types.js';
// Static import so Bun's `--compile` bundles the JSON into the binary.
// readFileSync + import.meta.url does NOT work in Bun compiled executables
// because import.meta.url resolves to the bundle-time source path, which
// doesn't exist on the target machine.
import BUNDLED_RULE_PACK from './rules/gitleaks-rules.json' with { type: 'json' };

// ── Rule corpus load ────────────────────────────────────────────────────────

let _rulePack: GitleaksRulePack | null = null;
let _compiled: { rule: GitleaksRule; re: RegExp }[] | null = null;

/** Load + cache the vendored gitleaks rule pack. */
export function loadRulePack(): GitleaksRulePack {
  if (_rulePack) return _rulePack;
  _rulePack = BUNDLED_RULE_PACK as unknown as GitleaksRulePack;
  return _rulePack;
}

function compiledRules(): { rule: GitleaksRule; re: RegExp }[] {
  if (_compiled) return _compiled;
  _compiled = loadRulePack().rules.map((rule) => ({
    rule,
    // Global so we can find every match on a line; case-sensitive (these formats
    // are case-significant) and tolerant of being embedded in `KEY="…"`.
    re: new RegExp(rule.regex, 'g'),
  }));
  return _compiled;
}

// ── Shannon entropy ─────────────────────────────────────────────────────────

/** Shannon entropy H = -Σ p(c)·log₂ p(c) in bits/char. Pure. */
export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  const n = s.length;
  for (const count of freq.values()) {
    const p = count / n;
    h -= p * Math.log2(p);
  }
  return h;
}

const ENTROPY_BASE64_FLOOR = 4.5;
const ENTROPY_HEX_FLOOR = 3.0;
const ENTROPY_MIN_LEN = 20;

const BASE64_TOKEN = /[A-Za-z0-9+/]{20,}={0,2}/g;
const HEX_TOKEN = /\b[0-9a-fA-F]{20,}\b/g;
const URLSAFE_B64_TOKEN = /[A-Za-z0-9_-]{20,}/g;

/** last4 of a token — an identifier, never the value. Sub-4 tokens are masked. */
function last4(token: string): string {
  if (token.length <= 4) return '*'.repeat(token.length);
  return token.slice(-4);
}

// ── The hiding-spot list ────────────────────────────────────────────────────

/**
 * Seed from `defaultCrownJewels()` then extend with the explicit ADR-0088
 * hiding-spot list. Returns absolute candidate file paths (existence filtered by
 * the caller). `.env*` globbing is handled separately (it needs directory scan).
 */
export function hidingSpotFiles(home: string, extraRoots: string[] = []): string[] {
  const spots = new Set<string>();
  // Seed: the crown-jewel dirs become file candidates for known secret files.
  const jewels = defaultCrownJewels(home);
  // Explicit secret FILES the scanner reads (dirs are walked for PEM separately).
  const explicit = [
    join(home, '.aws', 'credentials'),
    join(home, '.aws', 'config'),
    join(home, '.config', 'gh', 'hosts.yml'),
    join(home, '.netrc'),
    join(home, '.npmrc'),
    join(home, '.pip', 'pip.conf'),
    join(home, '.docker', 'config.json'),
    join(home, '.zsh_history'),
    join(home, '.bash_history'),
    join(home, '.mcp.json'),
    join(home, '.cursor', 'mcp.json'),
    join(home, '.config', 'gcloud', 'application_default_credentials.json'),
    join(home, '.claude.json'),
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', '.credentials.json'),
    join(home, '.port-daddy-env'),
  ];
  for (const f of explicit) spots.add(f);
  // PEM keys under ~/.ssh and ~/.gnupg (the directories from the jewel list).
  for (const dir of jewels.deniedDirs) {
    if (dir.endsWith('.ssh')) {
      for (const k of ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa']) {
        spots.add(join(dir, k));
      }
    }
  }
  // Dotenv files at HOME and each extra workdir root.
  const dotenvRoots = [home, ...extraRoots].filter(Boolean);
  for (const root of dotenvRoots) {
    for (const name of ['.env', '.env.local', '.env.production', '.env.development']) {
      spots.add(join(root, name));
    }
    spots.add(join(root, '.mcp.json'));
  }
  return [...spots];
}

/** Paths we treat as KNOWN credential paths — entropy may fire on these. */
function isKnownCredPath(path: string, home: string): boolean {
  const known = new Set(hidingSpotFiles(home));
  if (known.has(path)) return true;
  // Any dotenv file, anywhere; any file under ~/.ssh, ~/.aws, ~/.gnupg.
  const base = path.split('/').pop() ?? '';
  if (base === '.env' || base.startsWith('.env.')) return true;
  for (const seg of ['/.ssh/', '/.aws/', '/.gnupg/']) {
    if (path.includes(seg)) return true;
  }
  return false;
}

// ── docker config base64 decode (bounded) ───────────────────────────────────

/**
 * Decode `~/.docker/config.json` `auths.*.auth` base64 fields into synthetic
 * `user:pass` lines so the structured/entropy detectors can see them. Bounded:
 * only the `auth` fields, only valid JSON, decode depth 1 (no recursive decode —
 * blanket decoding inflates entropy false positives, per ADR-0088).
 *
 * Returns synthetic extra "lines" to scan, each tagged with the source line in
 * the original file so the finding's `line` stays meaningful.
 */
export function decodeDockerAuths(
  content: string,
): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  const auths = (parsed as Record<string, unknown>).auths;
  if (!auths || typeof auths !== 'object') return out;
  const lines = content.split('\n');
  for (const [, entry] of Object.entries(auths as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const auth = (entry as Record<string, unknown>).auth;
    if (typeof auth !== 'string' || auth.length === 0) continue;
    let decoded: string;
    try {
      decoded = Buffer.from(auth, 'base64').toString('utf8');
    } catch {
      continue;
    }
    // Bounded: only accept a printable user:pass shape; never re-decode.
    if (!/^[\x20-\x7e]+:[\x20-\x7e]+$/.test(decoded)) continue;
    // Find the source line the `auth` value sits on so `line` is meaningful.
    const idx = lines.findIndex((l) => l.includes(auth.slice(0, 24)));
    out.push({ line: idx >= 0 ? idx + 1 : 1, text: decoded });
  }
  return out;
}

// ── Per-content scan ────────────────────────────────────────────────────────

/**
 * Scan a single file's content for findings. Pure over `(path, content)`. Never
 * returns the raw value. `path` decides whether the entropy fallback may fire.
 */
export function scanContent(
  path: string,
  content: string,
  home: string,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>(); // dedup key: ruleId|line|last4
  const isDocker = path.includes('.docker') && path.endsWith('config.json');

  // Build the list of (lineNo, text) units to scan: real lines + decoded docker.
  const units: { line: number; text: string }[] = content
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }));
  if (isDocker) {
    units.push(...decodeDockerAuths(content));
  }

  for (const { line, text } of units) {
    let lineHadStructured = false;

    // 1. STRUCTURED FORMAT — the verdict.
    for (const { rule, re } of compiledRules()) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const token =
          rule.secretGroup && m[rule.secretGroup] ? m[rule.secretGroup] : m[0];
        const ent = shannonEntropy(token);
        // Per-rule entropy floor suppresses low-entropy format collisions.
        if (rule.entropy && rule.entropy > 0 && ent < rule.entropy) {
          continue;
        }
        lineHadStructured = true;
        const key = `${rule.id}|${line}|${last4(token)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          path,
          line,
          ruleId: rule.id,
          last4: last4(token),
          entropy: round(ent),
          method: 'structured-format',
          verified: null,
        });
        if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
      }
    }

    // 2. ENTROPY FALLBACK — only on a known cred path OR beside a structured
    //    anchor on this same line. Never the sole verdict on an unknown path.
    const entropyAllowed = isKnownCredPath(path, home) || lineHadStructured;
    if (entropyAllowed) {
      for (const f of entropyTokens(text)) {
        const key = `high-entropy-blob|${line}|${f.last4}`;
        if (seen.has(key)) continue;
        // Skip if this exact token was already reported by a structured rule.
        if (
          findings.some(
            (x) => x.line === line && x.last4 === f.last4 && x.method === 'structured-format',
          )
        ) {
          continue;
        }
        seen.add(key);
        findings.push({
          path,
          line,
          ruleId: 'high-entropy-blob',
          last4: f.last4,
          entropy: round(f.entropy),
          method: 'entropy-fallback',
          verified: null,
        });
      }
    }
  }
  return findings;
}

/** Extract high-entropy tokens from a line that clear the base64/hex floors. */
function entropyTokens(text: string): { last4: string; entropy: number }[] {
  const out: { last4: string; entropy: number }[] = [];
  const seen = new Set<string>();
  const push = (token: string, floor: number) => {
    if (token.length < ENTROPY_MIN_LEN) return;
    const ent = shannonEntropy(token);
    if (ent < floor) return;
    const l4 = last4(token);
    if (seen.has(l4)) return;
    seen.add(l4);
    out.push({ last4: l4, entropy: ent });
  };
  // Hex first (tighter), then base64-ish, then url-safe b64. Dedup by last4.
  for (const re of [HEX_TOKEN, BASE64_TOKEN, URLSAFE_B64_TOKEN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const token = m[0];
      const floor = re === HEX_TOKEN ? ENTROPY_HEX_FLOOR : ENTROPY_BASE64_FLOOR;
      push(token, floor);
    }
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Full host scan ──────────────────────────────────────────────────────────

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB read cap per file

/**
 * Scan the host's hiding spots for secrets at rest. Read-only. Injectable
 * `readFile`/`exists` for tests; defaults to real fs. Files over the byte cap
 * are read up to the cap (never silently skipped).
 */
export function scanHost(opts: ScanOptions = {}): ScanResult {
  const home = opts.home ?? process.env.HOME ?? '';
  const exists = opts.exists ?? ((p: string) => existsSync(p));
  const readFile =
    opts.readFile ??
    ((p: string): string | null => {
      try {
        const cap = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
        const size = statSync(p).size;
        if (size <= cap) return readFileSync(p, 'utf8');
        const fd = readFileSync(p);
        return fd.subarray(0, cap).toString('utf8');
      } catch {
        return null;
      }
    });

  const findings: SecretFinding[] = [];
  const scannedPaths: string[] = [];
  for (const path of hidingSpotFiles(home, opts.extraRoots)) {
    if (!exists(path)) continue;
    const content = readFile(path);
    if (content == null) continue;
    scannedPaths.push(path);
    findings.push(...scanContent(path, content, home));
  }
  return { findings, scannedPaths };
}

/** Test-only: reset the cached rule pack (e.g. after monkeypatching). */
export function _resetRulePackForTests(): void {
  _rulePack = null;
  _compiled = null;
}
