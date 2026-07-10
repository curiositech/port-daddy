#!/usr/bin/env node
'use strict';
// cli.js — proof surface for the WS-3 coordination training ledger.
//
// Usage:
//   node lib/session-intel/cli.js mine   [--db <path>] [--project <p>] [--limit N] [--ledger <path>] [--dry]
//   node lib/session-intel/cli.js report [--ledger <path>] [--top N]
//   node lib/session-intel/cli.js sources
//
// `mine`   pulls real records from a daemon SQLite store, mines hits/misses,
//          appends NEW entries to the append-only ledger, and prints a summary +
//          the ranked suggestion list.
// `report` prints the current ledger + ranked suggestions without mining.
// `sources` lists discoverable daemon stores and their row counts.
//
// WS-4 (LATER ROUND) — fine-tuning dataset export is intentionally NOT here.
// It belongs to WS-4 and must not be faked. TODO(WS-4): add `export` subcommand
// that turns ledger entries into a deduped, PII-swept instruction/response JSONL
// with a dataset card. Do not implement until WS-3 ledger volume clears the bar.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadFromSqlite } = require('./data-source.js');
const { mine } = require('./miner.js');
const { appendEntries, readLedger, defaultLedgerPath } = require('./ledger.js');
const { rankSuggestions, summarizeHits } = require('./suggestions.js');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else {
        out[k] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

// Discover candidate daemon stores under ~/.port-daddy, ranked by session count.
function discoverSources() {
  const root = path.join(os.homedir(), '.port-daddy');
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && (e.name.endsWith('.db') || e.name.endsWith('.sqlite'))) found.push(p);
    }
  };
  walk(root, 0);
  const scored = [];
  for (const db of found) {
    try {
      const recs = loadFromSqlite(db, {});
      if (recs.sessions.length || recs.notes.length)
        scored.push({ db, sessions: recs.sessions.length, notes: recs.notes.length, claims: recs.claims.length });
    } catch {
      /* not a coordination store */
    }
  }
  scored.sort((a, b) => b.sessions - a.sessions || b.notes - a.notes);
  return scored;
}

function pickDb(args) {
  if (args.db) return args.db;
  const sources = discoverSources();
  if (!sources.length) throw new Error('no daemon coordination store found under ~/.port-daddy — pass --db <path>');
  return sources[0].db;
}

function fmtSev(b) {
  return ['high', 'medium', 'low'].filter((s) => b[s]).map((s) => `${b[s]}${s[0]}`).join(' ');
}

function printReport(entries, top) {
  const hits = summarizeHits(entries);
  const misses = entries.filter((e) => e.verdict === 'miss');
  console.log('\n═══ COORDINATION TRAINING LEDGER ═══');
  console.log(`entries: ${entries.length}  |  misses: ${misses.length}  |  hits: ${hits.total}`);
  const byKind = {};
  for (const e of entries) byKind[`${e.kind}/${e.verdict}`] = (byKind[`${e.kind}/${e.verdict}`] || 0) + 1;
  console.log('by kind: ' + Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join('  '));

  const suggestions = rankSuggestions(entries, { limit: top });
  console.log(`\n═══ RANKED COORDINATION-IMPROVEMENT SUGGESTIONS (top ${suggestions.length}) ═══`);
  for (const s of suggestions) {
    console.log(`\n#${s.rank}  [score ${s.score}]  ${s.title}`);
    console.log(`     kind=${s.kind}  occurrences=${s.occurrences}  severity=[${fmtSev(s.severityBreakdown)}]  sessions=${s.affectedSessionCount}`);
    if (s.affectedFiles.length) console.log(`     files: ${s.affectedFiles.slice(0, 4).join(', ')}${s.affectedFiles.length > 4 ? ` (+${s.affectedFiles.length - 4})` : ''}`);
    console.log(`     → ${s.recommendation}`);
  }

  console.log('\n═══ SAMPLE LEDGER ENTRIES ═══');
  const sample = [...misses.slice(0, 2), ...entries.filter((e) => e.verdict === 'hit').slice(0, 1)];
  for (const e of sample) {
    console.log(`\n• [${e.verdict.toUpperCase()} · ${e.kind} · ${e.severity}] ${e.observation}`);
    console.log(`  suggestedChange: ${e.suggestedChange}`);
    console.log(`  excerpt: ${JSON.stringify(e.excerpt).slice(0, 220)}…`);
  }
  console.log('');
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const ledgerPath = args.ledger || defaultLedgerPath();

  if (cmd === 'sources') {
    for (const s of discoverSources()) console.log(`${s.sessions} sessions / ${s.notes} notes / ${s.claims} claims\t${s.db}`);
    return;
  }

  if (cmd === 'mine') {
    const db = pickDb(args);
    console.error(`[mine] source: ${db}`);
    const records = loadFromSqlite(db, {
      project: args.project || null,
      limitSessions: args.limit ? Number(args.limit) : null,
    });
    console.error(`[mine] loaded ${records.sessions.length} sessions, ${records.claims.length} claims, ${records.notes.length} notes`);
    const entries = mine(records);
    console.error(`[mine] mined ${entries.length} ledger entries`);
    if (!args.dry) {
      const res = appendEntries(entries, { path: ledgerPath });
      console.error(`[mine] ledger ${ledgerPath}: +${res.appended} new, ${res.skipped} already present, ${res.total} total`);
      printReport(readLedger({ path: ledgerPath }), args.top ? Number(args.top) : 12);
    } else {
      printReport(entries, args.top ? Number(args.top) : 12);
    }
    return;
  }

  if (cmd === 'report' || !cmd) {
    printReport(readLedger({ path: ledgerPath }), args.top ? Number(args.top) : 12);
    return;
  }

  console.error(`unknown command: ${cmd}. Use: mine | report | sources`);
  process.exit(2);
}

main();
