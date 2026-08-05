/**
 * Framework-free selftest for the Steward eureka/coordination digest.
 *   node lib/session-intel/steward-digest.selftest.mjs
 *
 * Covers the ONE piece of real logic this module adds on top of the existing
 * WS-2/WS-3 tools: the single-expert-oracle recurrence guard (an eureka arc
 * seen in only one session must never surface as digest-worthy), plus the
 * mandatory-ledger contract (one entry per cycle, ALL QUIET included,
 * idempotent re-run). No file I/O — all fixtures are in-memory transcript
 * text, same pattern as eureka-arc-detector.selftest.mjs. Exits 1 on any
 * failure.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildDigest, recordDigestCycle, collectEurekaArcs, isoDate, deepRedact, toIngestFindings, uploadDigest } from './steward-digest.mjs';
import { readLedger } from './ledger.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('✗ ' + msg); } }

function assistantToolUse(id, name, input) {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
}
function userToolResult(id, isError, text) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text }] } });
}

function arcFixture(cmd) {
  return [
    assistantToolUse('a1', 'Bash', { command: cmd }),
    userToolResult('a1', true, 'fail 1'),
    assistantToolUse('a2', 'Bash', { command: cmd }),
    userToolResult('a2', true, 'fail 2'),
    assistantToolUse('a3', 'Bash', { command: cmd }),
    userToolResult('a3', false, 'ok'),
  ].join('\n');
}

// Throwaway append-only stores for this one process run, deleted at the very
// end of this file. Deliberately NOT under an OS temp dir (house policy) —
// scoped under session-intel's own real state tree instead, which also means
// this works identically on a fresh CI runner (home dir always resolves).
const selftestStateDir = path.join(os.homedir(), '.port-daddy', 'session-intel');
fs.mkdirSync(selftestStateDir, { recursive: true });
const isolatedLedgerPath = path.join(selftestStateDir, `selftest-ledger-${process.pid}-${Date.now()}.jsonl`);
const isolatedDigestLedgerPath = path.join(selftestStateDir, `selftest-digest-${process.pid}-${Date.now()}.jsonl`);

// === 1) Same (tool, signature) arc across TWO distinct sessions → recurring =
{
  const sources = [
    { sessionId: 'session-a', text: arcFixture('npm run build:widget') },
    { sessionId: 'session-b', text: arcFixture('npm run build:widget') },
  ];
  const { recurring, singleSession } = collectEurekaArcs({ sources, minSessions: 2 });
  ok(recurring.length === 1, 'two-session recurrence: exactly one recurring group');
  ok(recurring[0] && recurring[0].distinctSessionCount === 2, 'two-session recurrence: distinctSessionCount === 2');
  ok(singleSession.length === 0, 'two-session recurrence: nothing held back as single-session');
}

// === 2) Same arc, but only ONE session → held back, not recurring ==========
{
  const sources = [{ sessionId: 'session-solo', text: arcFixture('npm run build:widget') }];
  const { recurring, singleSession } = collectEurekaArcs({ sources, minSessions: 2 });
  ok(recurring.length === 0, 'single-session arc: NOT surfaced as recurring — this is the core guard');
  ok(singleSession.length === 1, 'single-session arc: held back and counted');
}

// === 3) Two DIFFERENT commands, one session each → neither recurs ==========
{
  const sources = [
    { sessionId: 'session-x', text: arcFixture('make lint') },
    { sessionId: 'session-y', text: arcFixture('make typecheck') },
  ];
  const { recurring, singleSession } = collectEurekaArcs({ sources, minSessions: 2 });
  ok(recurring.length === 0, 'distinct commands: neither recurs even though 2 sessions ran arcs');
  ok(singleSession.length === 2, 'distinct commands: both held back as their own single-session group');
}

// === 4) buildDigest with no db → eureka-only digest, no coordination calls =
{
  const sources = [
    { sessionId: 's1', text: arcFixture('cargo test --release') },
    { sessionId: 's2', text: arcFixture('cargo test --release') },
  ];
  const digest = buildDigest({ transcriptSources: sources, minSessions: 2, ledgerPath: isolatedLedgerPath });
  ok(digest.coordinationSuggestions.length === 0, 'no-db digest: no coordination suggestions attempted');
  ok(digest.coordinationSource === null, 'no-db digest: coordinationSource left null, not a fake empty object');
  ok(digest.recurringEurekaArcs.length === 1, 'no-db digest: recurring arc still detected');
  ok(digest.allQuiet === false, 'no-db digest: allQuiet is false when a recurring arc exists');
  ok(typeof digest.date === 'string' && digest.date === isoDate(Date.now()), 'no-db digest: date is real ISO-day');
}

// === 5) Empty input → ALL QUIET, and it is a valid ledger entry ============
{
  const day1 = Date.parse('2026-01-01T00:00:00Z');
  const digest = buildDigest({ transcriptSources: [], minSessions: 2, ledgerPath: isolatedLedgerPath, now: day1 });
  ok(digest.allQuiet === true, 'empty digest: allQuiet true');
  ok(digest.date === isoDate(day1), 'empty digest: date reflects the passed `now`, not wall-clock');
  const res = recordDigestCycle(digest, { digestLedgerPath: isolatedDigestLedgerPath, now: day1 });
  ok(res.appended === 1, 'all-quiet cycle: still writes exactly one ledger entry (proof of life)');
  const entries = readLedger({ path: isolatedDigestLedgerPath });
  ok(entries.length === 1 && entries[0].verdict === 'all-quiet', 'all-quiet cycle: entry verdict is all-quiet');
}

// === 6) Idempotent re-run on the same day → no duplicate entry =============
{
  const sameDayLater = Date.parse('2026-01-01T12:00:00Z');
  const digest = buildDigest({ transcriptSources: [], minSessions: 2, ledgerPath: isolatedLedgerPath, now: sameDayLater });
  const res = recordDigestCycle(digest, { digestLedgerPath: isolatedDigestLedgerPath, now: sameDayLater });
  ok(res.appended === 0 && res.skipped === 1, 'idempotent re-run same day: 0 appended, 1 skipped (same date key)');
  const entries = readLedger({ path: isolatedDigestLedgerPath });
  ok(entries.length === 1, 'idempotent re-run same day: ledger still has exactly one entry');
}

// === 7) A different day → a new entry, prior one untouched =================
{
  const day2 = Date.parse('2026-01-02T00:00:00Z');
  const digest = buildDigest({ transcriptSources: [], minSessions: 2, ledgerPath: isolatedLedgerPath, now: day2 });
  const res = recordDigestCycle(digest, { digestLedgerPath: isolatedDigestLedgerPath, now: day2 });
  ok(res.appended === 1, 'new day: appends a fresh entry');
  const entries = readLedger({ path: isolatedDigestLedgerPath });
  ok(entries.length === 2, 'new day: ledger now has two entries, never rewrote the first');
}

// === 8) deepRedact scrubs a secret nested inside an eureka arc example =====
{
  const dirty = {
    tool: 'Bash',
    examples: [
      { excerpt: { failingInvocation: 'curl -H "Authorization: Bearer sk-ant-abc123def456ghi789jkl" https://api.example.com' } },
      { note: 'ran from /Users/erichowens/coding/port-daddy, contact erich@example.com' },
    ],
  };
  const clean = deepRedact(dirty);
  const flat = JSON.stringify(clean);
  ok(!flat.includes('sk-ant-abc123def456ghi789jkl'), 'deepRedact: strips a nested anthropic key');
  ok(!flat.includes('erich@example.com'), 'deepRedact: strips a nested email');
  ok(!flat.includes('/Users/erichowens'), 'deepRedact: collapses a nested absolute home path');
  ok(clean.tool === 'Bash', 'deepRedact: leaves clean strings untouched');
}

// === 9) toIngestFindings shapes both finding kinds correctly ===============
{
  const sources = [
    { sessionId: 'sa', text: arcFixture('pytest -x') },
    { sessionId: 'sb', text: arcFixture('pytest -x') },
  ];
  const digest = buildDigest({ transcriptSources: sources, minSessions: 2, ledgerPath: isolatedLedgerPath, now: Date.parse('2026-01-03T00:00:00Z') });
  const findings = toIngestFindings(digest);
  ok(findings.length === 1, 'toIngestFindings: one recurring arc → one finding');
  const f = findings[0];
  ok(f.kind === 'recurring-eureka-arc', 'toIngestFindings: kind is recurring-eureka-arc');
  ok(f.sessionCount === 2, 'toIngestFindings: sessionCount matches distinctSessionCount');
  ok(f.title.includes('Bash') && f.title.includes('pytest -x'), 'toIngestFindings: title carries tool + signature');
  ok(typeof f.payload === 'object' && f.payload !== null, 'toIngestFindings: payload is a redacted object, not raw');
}

// === 10) uploadDigest skips cleanly with no token, never throws ============
{
  const digest = buildDigest({ transcriptSources: [], minSessions: 2, ledgerPath: isolatedLedgerPath, now: Date.parse('2026-01-04T00:00:00Z') });
  digest.allQuiet = false; // force the upload path even though findings are empty, to exercise skip logic
  const savedToken = process.env.RELAY_OPERATOR_TOKEN;
  delete process.env.RELAY_OPERATOR_TOKEN;
  let threw = false;
  let result;
  try {
    result = await uploadDigest(digest, {});
  } catch {
    threw = true;
  }
  if (savedToken !== undefined) process.env.RELAY_OPERATOR_TOKEN = savedToken;
  ok(!threw, 'uploadDigest: never throws when the token is missing');
  ok(result && result.skipped === true, 'uploadDigest: reports skipped:true with no token');
}

// === 11) uploadDigest POSTs the expected shape when a token IS present =====
{
  const sources = [
    { sessionId: 'sc', text: arcFixture('go test ./...') },
    { sessionId: 'sd', text: arcFixture('go test ./...') },
  ];
  const digest = buildDigest({ transcriptSources: sources, minSessions: 2, ledgerPath: isolatedLedgerPath, now: Date.parse('2026-01-05T00:00:00Z') });
  let capturedUrl, capturedInit;
  const fakeFetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return { ok: true, json: async () => ({ code: 'OK', accepted: 1, batchId: 'sib_test' }) };
  };
  const result = await uploadDigest(digest, { token: 'fake-token-for-test', fetch: fakeFetch, relayUrl: 'https://relay.example.test' });
  ok(capturedUrl === 'https://relay.example.test/v1/session-intel/ingest', 'uploadDigest: posts to the correct ingest URL');
  ok(capturedInit.headers.Authorization === 'Bearer fake-token-for-test', 'uploadDigest: sends the bearer token');
  const sentBody = JSON.parse(capturedInit.body);
  ok(sentBody.digestDate === digest.date, 'uploadDigest: body carries the digest date');
  ok(Array.isArray(sentBody.findings) && sentBody.findings.length === 1, 'uploadDigest: body carries the shaped findings');
  ok(result.ok === true && result.body.accepted === 1, 'uploadDigest: returns the parsed response body');
}

// cleanup — these were this run's own throwaway isolated stores.
for (const p of [isolatedLedgerPath, isolatedDigestLedgerPath]) {
  try { fs.unlinkSync(p); } catch { /* fine if never created */ }
}

console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
