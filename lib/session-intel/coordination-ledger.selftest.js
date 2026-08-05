'use strict';
// coordination-ledger.selftest.cjs — framework-free selftest for the WS-3
// coordination training ledger + suggestibility pipeline.
//
//   node lib/session-intel/coordination-ledger.selftest.cjs
//
// Covers (a) synthetic fixtures for every structural detector, (b) redaction at
// ingest incl. a PLANTED FAKE SECRET that must never reach the store, (c) the
// append-only / idempotent ledger, (d) the ranked suggestibility pipeline, and
// (e) a REAL slice: it mines this machine's live port-daddy history and proves
// entries are produced AND no secret token shape survives into any excerpt.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { redactExcerpt } = require('./redact.js');
const { normalizeSnapshot, loadFromSqlite } = require('./data-source.js');
const { mine } = require('./miner.js');
const { appendEntries, readLedger, assertRedacted } = require('./ledger.js');
const { rankSuggestions, summarizeHits } = require('./suggestions.js');

let pass = 0,
  fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('✗ ' + msg);
  }
}

// Secret token shapes that must NEVER appear in a stored excerpt. Structural
// scan (same grammars redact.js targets), not a prose keyword list.
const SECRET_SHAPES = [
  /\bsk-ant-[A-Za-z0-9_\-]{16,}/,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_\-]{20,}/,
  /\/Users\/(?!<user>)[^/\s"']+/,
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/,
];
function scanForSecrets(obj) {
  const hits = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      for (const re of SECRET_SHAPES) if (re.test(v)) hits.push(v.slice(0, 60));
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(obj);
  return hits;
}

const T = 1_700_000_000_000;

// ───────────────────────── 1. REDACTION (unit) ──────────────────────────────
{
  const raw =
    'deploy with ANTHROPIC_API_KEY=sk-ant-api03-DEADBEEFdeadbeef1234567890 and ' +
    'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 aws AKIAIOSFODNN7EXAMPLE ' +
    'ping ops@example.com from /Users/janedoe/coding/secret PASSWORD=hunter2hunter2';
  const r = redactExcerpt(raw);
  ok(r.redactionCount >= 5, 'redact: caught >=5 secrets, got ' + r.redactionCount);
  ok(!r.text.includes('sk-ant-api03-DEADBEEF'), 'redact: anthropic key gone');
  ok(!r.text.includes('ghp_ABCDEFGHIJKLMNOP'), 'redact: github token gone');
  ok(!r.text.includes('AKIAIOSFODNN7EXAMPLE'), 'redact: aws key id gone');
  ok(!r.text.includes('ops@example.com'), 'redact: email gone');
  ok(!r.text.includes('/Users/janedoe'), 'redact: home path gone');
  ok(!r.text.includes('hunter2hunter2'), 'redact: env PASSWORD value gone');
  ok(/^[0-9a-f]{64}$/.test(r.sha256), 'redact: sha256 of raw present');
  ok(scanForSecrets({ t: r.text }).length === 0, 'redact: scanner finds no secret shapes in output');
}

// ───────────────────── 2. SYNTHETIC FIXTURE (all detectors) ─────────────────
function fixture() {
  const S = (id, from, to, status, extra = {}) => ({
    id,
    purpose: id,
    agentId: 'agent-' + id,
    status,
    identityProject: 'port-daddy',
    createdAt: from,
    updatedAt: to,
    completedAt: status === 'completed' ? to : null,
    ...extra,
  });
  const C = (sid, file, at, rel, sl, el) => ({
    sessionId: sid,
    filePath: file,
    startLine: sl ?? null,
    endLine: el ?? null,
    symbolPath: null,
    claimedAt: at,
    releasedAt: rel ?? null,
  });
  const N = (id, sid, type, at, content) => ({ id, sessionId: sid, type, createdAt: at, content });

  const sessions = [
    S('s_conf_a', T, T + 100, 'completed'),
    S('s_conf_b', T + 50, T + 200, 'completed'),
    S('s_hand_a', T, T + 100, 'completed'),
    S('s_hand_b', T + 120, T + 300, 'completed'),
    S('s_cont', T + 320, T + 500, 'completed'),
    S('s_aband', T, T + 100, 'abandoned'),
    S('s_pick', T + 200, T + 300, 'completed'),
    S('s_dup_a', T, T + 100, 'completed'),
    S('s_dup_b', T + 150, T + 250, 'completed'),
    S('s_hyg_hit', T, T + 150, 'completed'),
    S('s_hyg_miss', T, T + 150, 'completed'),
    // absolute-PATH leak scenario: two sessions conflict on an absolute home path
    S('s_abs_a', T, T + 100, 'completed'),
    S('s_abs_b', T + 50, T + 200, 'completed'),
  ];
  const ABS = '/Users/erich/secret/leaked/thing.ts';
  const claims = [
    // conflict: region overlap 1-10 vs 5-15, time overlap [T+50,T+100]
    C('s_conf_a', 'conf.ts', T, null, 1, 10),
    C('s_conf_b', 'conf.ts', T + 50, T + 200, 5, 15),
    // handoff pickup: s_hand_a holds hand.ts, s_hand_b claims after handoff note
    C('s_hand_a', 'hand.ts', T, T + 100),
    C('s_hand_b', 'hand.ts', T + 120, T + 300),
    // linked successor: continuation receipt/note precedes real successor work
    C('s_cont', 'continued.ts', T + 360, T + 500),
    // abandoned with open (unreleased) claim later re-picked-up
    C('s_aband', 'ab.ts', T, null),
    C('s_pick', 'ab.ts', T + 200, T + 300),
    // duplicate: sequential, 50ms gap, no handoff bridging
    C('s_dup_a', 'dup.ts', T, T + 100),
    C('s_dup_b', 'dup.ts', T + 150, T + 250),
    // hygiene
    C('s_hyg_hit', 'hy1.ts', T + 50, T + 150),
    C('s_hyg_miss', 'hy2.ts', T + 50, T + 150),
    // absolute-path conflict: region + time overlap → conflict entry embeds ABS
    C('s_abs_a', ABS, T, null, 1, 10),
    C('s_abs_b', ABS, T + 50, T + 200, 5, 15),
  ];
  const notes = [
    // handoff note carrying a PLANTED FAKE SECRET (redaction-at-ingest target)
    N(
      1,
      's_hand_a',
      'handoff',
      T + 60,
      'Handing off hand.ts. Use ANTHROPIC_API_KEY=sk-ant-api03-PLANTEDsecret1234567890 ' +
        'and reach me at leak@evil.example from /Users/victimhome/creds'
    ),
    N(2, 's_hyg_hit', 'note', T + 10, 'Scope: hy1.ts. Assumptions: none. Validation: node test.'),
    N(3, 's_aband', 'note', T + 40, 'started ab.ts, WIP'),
    N(4, 's_cont', 'continuation', T + 340, 'Linked successor accepted; continuing from the immutable source session.'),
  ];
  return normalizeSnapshot({ sessions, claims, notes });
}

{
  const recs = fixture();
  const entries = mine(recs);
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const has = (pred) => entries.some(pred);

  ok(entries.length >= 8, 'mine: produced entries for all detectors (' + entries.length + ')');

  const conf = entries.find((e) => e.kind === 'claim-conflict' && e.refs.file === 'conf.ts');
  ok(conf && conf.verdict === 'miss', 'conflict: detected on conf.ts as miss');
  ok(conf && conf.severity === 'high', 'conflict: region overlap → high severity');
  ok(conf && conf.signals.regionOverlap === true, 'conflict: regionOverlap signal true');

  const hand = entries.find((e) => e.kind === 'handoff');
  ok(hand && hand.verdict === 'hit', 'handoff: detected as hit');
  ok(hand && hand.refs.sessions.includes('s_hand_a') && hand.refs.sessions.includes('s_hand_b'), 'handoff: links both sessions');
  const continuation = entries.find((e) => e.kind === 'handoff' && e.refs.sessions.includes('s_cont'));
  ok(continuation && continuation.verdict === 'hit', 'continuation: linked successor work detected as hit');
  ok(continuation && /real successor claims/.test(continuation.observation), 'continuation: observation names successor claims');

  const ab = byKey.get('abandoned:s_aband');
  ok(ab && ab.verdict === 'miss', 'abandoned: detected as miss');
  ok(ab && ab.severity === 'high', 'abandoned: open claim + re-pickup → high');
  ok(ab && ab.signals.rePickedUp === true, 'abandoned: rePickedUp signal true');

  const dup = entries.find((e) => e.kind === 'duplicate-work' && e.refs.file === 'dup.ts');
  ok(dup && dup.verdict === 'miss', 'duplicate-work: detected on dup.ts');
  // hand.ts should NOT be duplicate-work (handoff note bridges it)
  ok(!has((e) => e.kind === 'duplicate-work' && e.refs.file === 'hand.ts'), 'duplicate-work: suppressed when handoff bridges');

  const hygHit = byKey.get('hygiene:s_hyg_hit');
  ok(hygHit && hygHit.verdict === 'hit', 'hygiene: scope-note-before-claim → hit');
  const hygMiss = byKey.get('hygiene:s_hyg_miss');
  ok(hygMiss && hygMiss.verdict === 'miss', 'hygiene: no scope note → miss');

  // REDACTION AT INGEST: the planted secret must not survive anywhere in entries.
  const leaks = scanForSecrets(entries);
  ok(leaks.length === 0, 'ingest-redaction: no planted secret shape in any mined entry (leaks: ' + JSON.stringify(leaks) + ')');
  ok(!JSON.stringify(entries).includes('sk-ant-api03-PLANTED'), 'ingest-redaction: planted anthropic key absent from serialized entries');
  ok(!JSON.stringify(entries).includes('leak@evil.example'), 'ingest-redaction: planted email absent');
  ok(!JSON.stringify(entries).includes('/Users/victimhome'), 'ingest-redaction: planted home path absent');
  ok(hand && hand.excerpt.handoffNote.redactionCount >= 2, 'ingest-redaction: handoff note excerpt recorded redactions');

  // PATH-FIELD redaction at ingest: an absolute /Users/... claim path must be
  // collapsed to ~ everywhere — structured refs, derived strings, key, excerpt.
  const absConflict = entries.find((e) => e.kind === 'claim-conflict' && /thing\.ts/.test(e.key));
  ok(absConflict, 'path-redaction: absolute-path conflict entry exists');
  const serialized = JSON.stringify(entries);
  ok(!serialized.includes('/Users/erich'), 'path-redaction: NO absolute /Users/erich path anywhere in mined entries');
  ok(absConflict && absConflict.refs.file === '~/secret/leaked/thing.ts', 'path-redaction: refs.file collapsed to ~ (tail preserved)');
  ok(absConflict && absConflict.signals.file === '~/secret/leaked/thing.ts', 'path-redaction: signals.file collapsed to ~');
  ok(absConflict && !/\/Users\//.test(absConflict.observation) && !/\/Users\//.test(absConflict.suggestedChange), 'path-redaction: derived observation/suggestedChange scrubbed');
  ok(absConflict && absConflict.excerpt.filePath === '~/secret/leaked/thing.ts', 'path-redaction: excerpt.filePath collapsed');
  ok(scanForSecrets(entries).length === 0, 'path-redaction: secret/PII scanner clean over all entries incl. absolute-path scenario');

  // ───────────────── 3. LEDGER: append-only + idempotent ─────────────────
  const dir = path.join(os.homedir(), 'coding', 'tmp', 'session-intel-selftest');
  fs.rmSync(dir, { recursive: true, force: true });
  const ledgerPath = path.join(dir, 'ledger.jsonl');

  const r1 = appendEntries(entries, { path: ledgerPath, now: 1 });
  ok(r1.appended === entries.length && r1.skipped === 0, 'ledger: first append writes all entries');
  const r2 = appendEntries(entries, { path: ledgerPath, now: 2 });
  ok(r2.appended === 0 && r2.skipped === entries.length, 'ledger: re-append is a no-op (idempotent, append-only)');
  const onDisk = readLedger({ path: ledgerPath });
  ok(onDisk.length === entries.length, 'ledger: line count stable after re-append (no clobber)');
  ok(!fs.readFileSync(ledgerPath, 'utf8').includes('"content"'), 'ledger: no raw note `content` field persisted');
  ok(scanForSecrets(onDisk).length === 0, 'ledger: no secret shape on disk');

  // assertRedacted is source-agnostic: it rejects a raw `content` field AND a
  // secret/PII shape in ANY field, not just under `excerpt` — so a new excerpt
  // shape or a derived string can't bypass it.
  const throwsOn = (obj) => {
    try {
      assertRedacted(obj);
      return false;
    } catch {
      return true;
    }
  };
  ok(throwsOn({ excerpt: { note: { content: 'sk-ant-api03-RAW1234567890xyz' } } }), 'ledger: assertRedacted throws on raw `content` field (any depth)');
  ok(throwsOn({ observation: 'contact leak@evil.example', excerpt: {} }), 'ledger: assertRedacted catches a secret in a NON-excerpt field (observation)');
  ok(throwsOn({ excerpt: { openClaims: ['/Users/victim/secret/a.ts'] } }), 'ledger: assertRedacted catches an absolute home path in an array');
  ok(throwsOn({ suggestedChange: 'use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }), 'ledger: assertRedacted catches a github token in a derived string');
  ok(!throwsOn({ observation: 'clean text', excerpt: { note: { text: 'redacted', sha256: 'a'.repeat(64) } } }), 'ledger: assertRedacted passes a fully-redacted entry (sha256 exempt)');

  // ───────────────── 4. SUGGESTIBILITY PIPELINE ─────────────────
  const sugg = rankSuggestions(entries);
  ok(sugg.length >= 1, 'suggestions: produced ranked items');
  ok(sugg.every((s, i) => s.rank === i + 1), 'suggestions: ranks are 1..n in order');
  for (let i = 1; i < sugg.length; i++) ok(sugg[i - 1].score >= sugg[i].score, 'suggestions: sorted by score desc @' + i);
  ok(sugg.every((s) => s.recommendation && s.title), 'suggestions: every item has a title + recommendation');
  const hitSummary = summarizeHits(entries);
  ok(hitSummary.total >= 1 && hitSummary.byKind.handoff >= 1, 'suggestions: hit summary counts handoff');
}

// ───────────────────── 5. REAL SLICE (this machine) ─────────────────────────
{
  const candidates = [
    process.env.PD_SESSION_INTEL_DB,
    path.join(os.homedir(), '.port-daddy', 'instances', 'cloud-fleet-verify', 'port-daddy.db'),
    path.join(os.homedir(), '.port-daddy', 'instances', 'galaxy', 'port-daddy.db'),
    path.join(os.homedir(), '.port-daddy', 'port-registry.db'),
  ].filter(Boolean);
  const db = candidates.find((p) => fs.existsSync(p));
  if (!db) {
    console.log('ℹ real-slice: no local port-daddy store found — skipping (synthetic coverage stands).');
  } else {
    let recs;
    try {
      recs = loadFromSqlite(db, {});
    } catch (e) {
      console.log('ℹ real-slice: could not open ' + db + ' (' + e.message + ') — skipping.');
      recs = null;
    }
    if (recs && recs.sessions.length) {
      const entries = mine(recs);
      console.log(`real-slice: ${db.replace(os.homedir(), '~')} → ${recs.sessions.length} sessions, ${recs.claims.length} claims, ${recs.notes.length} notes → ${entries.length} ledger entries`);
      ok(entries.length > 0, 'real-slice: mined >0 entries from real fleet history');
      ok(entries.some((e) => e.verdict === 'miss'), 'real-slice: found real misses');
      ok(entries.every((e) => ['hit', 'miss'].includes(e.verdict)), 'real-slice: every entry has a legal verdict');
      ok(entries.every((e) => typeof e.key === 'string' && e.key.length > 0), 'real-slice: every entry has a deterministic key');
      // THE proof the coordinator asked for: no secret survives redaction on REAL data.
      const leaks = scanForSecrets(entries);
      ok(leaks.length === 0, 'real-slice: NO secret/PII shape in any real excerpt (leaks: ' + JSON.stringify(leaks.slice(0, 3)) + ')');
      const s = rankSuggestions(entries, { limit: 5 });
      ok(s.length > 0 && s[0].score >= (s[s.length - 1] ? s[s.length - 1].score : 0), 'real-slice: ranked suggestions produced from real data');
    } else {
      console.log('ℹ real-slice: store had no sessions — skipping.');
    }
  }
}

console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
