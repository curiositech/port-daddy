#!/usr/bin/env node
/**
 * steward-digest-cli — proof surface for local mining + cloud-ingest upload
 * (lib/session-intel/steward-digest.mjs).
 *
 * This is the ONE consumer of session-intel's previously orphaned WS-2
 * (eureka-arc-detector) and WS-3 (coordination ledger) tools. Mining stays
 * local by necessity: it's the only thing with filesystem access to
 * ~/.claude/projects and the local daemon store. Judgment does NOT run here
 * or anywhere local — every finding is deep-redacted (lib/session-intel/
 * redact.js's structural grammars, same code the local ledger uses) and
 * POSTed to relay's authenticated ingest endpoint (POST /v1/session-intel/
 * ingest), which relay independently re-checks for secret shapes before
 * storing. A real cloud-native ship (fleet-executor, Workers AI) is the
 * thing that eventually reads these and decides skill/prompt/roadmap
 * worthiness — this CLI never authors anything itself.
 *
 * Usage:
 *   node tools/session-intel/steward-digest-cli.mjs [--db <path>] [--min-sessions N]
 *     [--relay-url <url>] [--no-upload] [--pretty]
 *
 * With no --db, auto-discovers the first daemon coordination store under
 * ~/.port-daddy. Always records exactly one LOCAL ledger entry for the cycle
 * (ALL QUIET included, kept as a local audit trail / offline fallback), then
 * uploads the same findings to relay unless --no-upload is passed. Upload
 * requires RELAY_OPERATOR_TOKEN in the environment (never hardcoded, never
 * logged) — reads it the same way any other Port Daddy → relay operator call
 * would; recommend `pd secret` / your keychain, not a plaintext dotfile.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDigest, recordDigestCycle, defaultDigestLedgerPath, uploadDigest } from '../../lib/session-intel/steward-digest.mjs';

const require = createRequire(import.meta.url);
const { loadFromSqlite } = require('../../lib/session-intel/data-source.js');

const DEFAULT_RELAY_URL = 'https://relay.portdaddy.dev';

function parseArgs(argv) {
  // PD_-prefixed, matching this repo's established convention (e.g.
  // PD_ACCOUNTS_RELAY_URL in cli/commands/account.ts, PD_CONSOLE_RELAY_URL in
  // core/pd-console, and PD_SESSION_INTEL_DIGEST_LEDGER right in this same
  // module) -- a bare RELAY_URL risks colliding with unrelated tooling.
  const out = { minSessions: 2, pretty: false, upload: true, relayUrl: process.env.PD_SESSION_INTEL_RELAY_URL || DEFAULT_RELAY_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') out.db = argv[++i];
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--min-sessions') out.minSessions = Number(argv[++i]);
    else if (a === '--pretty') out.pretty = true;
    else if (a === '--json') out.json = true;
    else if (a === '--relay-url') out.relayUrl = argv[++i];
    else if (a === '--no-upload') out.upload = false;
    else if (a === '--digest-ledger') out.digestLedger = argv[++i];
  }
  return out;
}

function discoverSources() {
  const root = path.join(os.homedir(), '.port-daddy');
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
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
      if (recs.sessions.length) scored.push({ db, sessions: recs.sessions.length });
    } catch { /* not a coordination store */ }
  }
  scored.sort((a, b) => b.sessions - a.sessions);
  return scored;
}

function printDigest(digest) {
  console.log(`\n═══ SESSION INTEL DIGEST — ${digest.date} ═══`);
  if (digest.allQuiet) {
    console.log('ALL QUIET — no recurring coordination misses or eureka arcs this cycle.');
    return;
  }
  console.log(`recurrence threshold: >= ${digest.minSessionsThreshold} distinct sessions`);

  if (digest.coordinationSuggestions.length) {
    console.log(`\n─── Coordination suggestions (${digest.coordinationSuggestions.length}) ───`);
    for (const s of digest.coordinationSuggestions) {
      console.log(`\n#${s.rank}  [score ${s.score}]  ${s.title}`);
      console.log(`     kind=${s.kind}  occurrences=${s.occurrences}  sessions=${s.affectedSessionCount}`);
      console.log(`     → ${s.recommendation}`);
    }
  }

  if (digest.recurringEurekaArcs.length) {
    console.log(`\n─── Recurring eureka arcs (${digest.recurringEurekaArcs.length}) ───`);
    for (const a of digest.recurringEurekaArcs) {
      console.log(`\n${a.tool} :: ${a.signature}`);
      console.log(`  seen across ${a.distinctSessionCount} distinct sessions: ${a.sessions.slice(0, 3).join(', ')}${a.sessions.length > 3 ? ` (+${a.sessions.length - 3})` : ''}`);
      const ex = a.examples[0];
      if (ex) {
        console.log(`  what changed between last failure and success: ${ex.whatChangedDelta && ex.whatChangedDelta.note}`);
        console.log(`  failing: ${ex.excerpt.failingInvocation}`);
        console.log(`  success: ${ex.excerpt.successInvocation}`);
      }
    }
  }

  if (digest.singleSessionArcCount) {
    console.log(`\n(${digest.singleSessionArcCount} additional single-session arc(s) held back — not yet recurring, per the single-expert-oracle guard. Not skill-worthy on their own.)`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let db = args.db;
  if (!db) {
    const sources = discoverSources();
    if (!sources.length) {
      console.error('no daemon coordination store found under ~/.port-daddy — pass --db <path>. Building eureka-only digest.');
    } else {
      db = sources[0].db;
    }
  }

  const digest = buildDigest({ db, project: args.project, minSessions: args.minSessions });
  const res = recordDigestCycle(digest, { digestLedgerPath: args.digestLedger || defaultDigestLedgerPath() });
  console.error(`[digest] local ledger entry: ${res.appended ? 'recorded' : 'already recorded for ' + digest.date} (${res.path})`);

  if (!args.upload) {
    console.error('[digest] --no-upload passed — local ledger only, nothing sent to relay.');
  } else if (digest.allQuiet) {
    console.error('[digest] ALL QUIET — nothing to upload this cycle.');
  } else {
    const uploadResult = await uploadDigest(digest, { relayUrl: args.relayUrl });
    if (uploadResult.skipped) {
      console.error(`[digest] upload skipped: ${uploadResult.reason}. Set RELAY_OPERATOR_TOKEN to enable cloud mining.`);
    } else if (!uploadResult.ok) {
      console.error(`[digest] upload FAILED (${uploadResult.status}): ${uploadResult.body?.error || 'unknown error'} [${uploadResult.body?.code || 'NO_CODE'}]`);
    } else {
      console.error(`[digest] uploaded: ${uploadResult.body.accepted ?? 0} finding(s) accepted${uploadResult.body.batchId ? ` (batch ${uploadResult.body.batchId})` : ''}`);
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(digest, null, args.pretty ? 2 : 0) + '\n');
  } else {
    printDigest(digest);
  }
}

main();
