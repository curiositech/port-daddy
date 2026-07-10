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

// Guard: no stored excerpt may carry a raw un-redacted `content` field. Any
// nested excerpt with note evidence must have gone through redactExcerpt (which
// produces { text, sha256 } and strips `content`).
function assertRedacted(entry) {
  const bad = [];
  const scan = (obj, trail) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'content') bad.push(trail + '.content');
      else if (v && typeof v === 'object') scan(v, trail + '.' + k);
    }
  };
  scan(entry.excerpt, 'excerpt');
  if (bad.length) {
    throw new Error(`ledger: refusing to persist un-redacted excerpt field(s): ${bad.join(', ')}`);
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
