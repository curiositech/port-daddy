'use strict';
// ledger.js — append-only JSONL store for coordination training entries.
//
// Append-only + idempotent: each entry carries a deterministic `key` (derived
// from the structured refs, not a clock). appendEntries() reads the keys already
// on disk and appends ONLY new lines — it never rewrites or clobbers existing
// history. Re-running the miner over the same data is a no-op. This is the
// property that makes the ledger safe as permanent training material.
//
// Because entries are permanent, every excerpt is redacted at ingest upstream
// (miner.js → redact.js) BEFORE reaching here. This module additionally refuses
// to persist an excerpt object that still carries a raw `content` field, as a
// belt-and-suspenders guard against an un-redacted excerpt slipping through.

const fs = require('fs');
const path = require('path');
const os = require('os');

function defaultLedgerPath() {
  return (
    process.env.PD_SESSION_INTEL_LEDGER ||
    path.join(os.homedir(), '.port-daddy', 'session-intel', 'coordination-ledger.jsonl')
  );
}

function readLedger(opts = {}) {
  const file = opts.path || defaultLedgerPath();
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip a corrupt line rather than throw — never lose the rest of the ledger */
    }
  }
  return out;
}

// Secret/PII shapes that must never be persisted. Structural grammars (the same
// families redact.js targets) — NOT a prose keyword list. The absolute-home-path
// shape is included so a leaked `/Users/<name>/…` claim path is caught even if a
// future excerpt source forgets to route through redaction.
const FORBIDDEN_SHAPES = [
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_\-]{16,}/],
  ['token', /\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{16,}/],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
  ['github_pat', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['aws_key_id', /\bAKIA[0-9A-Z]{16}\b/],
  ['google_key', /\bAIza[0-9A-Za-z_\-]{20,}/],
  ['jwt', /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{6,}/],
  ['email', /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/],
  ['home_path', /\/(?:Users|home)\/[^/\s"'`)]+/],
];
// Field NAMES that must never appear at all (raw note bodies live under `content`).
const FORBIDDEN_KEYS = new Set(['content']);

// Guard: positively scan EVERY string in the entry (not just `excerpt`, and not
// just one field name) for a forbidden key or a secret/PII shape. This is
// source-agnostic — a new excerpt shape or a derived observation string cannot
// bypass it. `sha256` values are exempt (content hashes, not secrets).
function assertRedacted(entry) {
  const bad = [];
  const scan = (node, trail) => {
    if (typeof node === 'string') {
      if (trail.endsWith('.sha256')) return;
      for (const [name, re] of FORBIDDEN_SHAPES) if (re.test(node)) bad.push(`${trail} ~ ${name}`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => scan(v, `${trail}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (FORBIDDEN_KEYS.has(k)) bad.push(`${trail}.${k} (forbidden raw field)`);
        else scan(v, `${trail}.${k}`);
      }
    }
  };
  scan(entry, 'entry');
  if (bad.length) {
    throw new Error(`ledger: refusing to persist un-redacted content: ${bad.slice(0, 6).join(', ')}`);
  }
}

// appendEntries(entries, opts) → { appended, skipped, total, path }
function appendEntries(entries, opts = {}) {
  const file = opts.path || defaultLedgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const existing = new Set(readLedger({ path: file }).map((e) => e.key));
  const lines = [];
  let appended = 0;
  let skipped = 0;
  const seenThisRun = new Set();
  for (const e of entries) {
    if (!e.key) throw new Error('ledger: entry missing deterministic key');
    if (existing.has(e.key) || seenThisRun.has(e.key)) {
      skipped++;
      continue;
    }
    assertRedacted(e);
    seenThisRun.add(e.key);
    lines.push(JSON.stringify({ ...e, ledgeredAt: opts.now || Date.now() }));
    appended++;
  }
  if (lines.length) fs.appendFileSync(file, lines.join('\n') + '\n');
  return { appended, skipped, total: existing.size + appended, path: file };
}

module.exports = { appendEntries, readLedger, defaultLedgerPath, assertRedacted };
