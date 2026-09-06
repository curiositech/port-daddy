// Tests for the Distress Register status board. Run with:
//   node --test scripts/pd-status-board.test.mjs
//
// The board is the channel every real emergency depends on, so its decision
// logic is pinned here and the observer workflow runs this file BEFORE it
// posts anything. Fixtures are the shapes `gh` actually emits (recorded from
// `gh issue list --json`, `gh issue view --json body`, and
// `gh api .../comments --paginate --jq '.[]'`), fed through a fake runner so
// no test touches GitHub, the network, the daemon, or the operator's home.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODES, ISSUE_TITLE, LABEL, OBSERVER_IDENTITY,
  appendLocalDistress, classifyProbe, computeState, decideFloor, decideObserverPost,
  extractLines, findIssue, formatLine, haltActiveLocal, initBoard, isoNow, liveMaydays,
  main, observerKey, parseArgs, parseLine, parsePostArgs, readBoard, renderState, stateToJson,
} from './pd-status-board.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'pd-status-board.mjs');

// CLAUDE.md hard rule: never scratch to /tmp. Use ~/coding/tmp.
function scratchDir(prefix) {
  const base = join(homedir(), 'coding', 'tmp');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

const T0 = '2026-09-05T14:02:11Z';
const HALT = `${T0} operator:erich SECURITE HALT reason=spend-runaway ref=docs/incidents/2026-09-05-port-daddy-halt.md`;
const SEEN = '2026-09-05T14:02:40Z agent:claude-code:ranking-shadow SEEN ref=2026-09-05T14:02:11Z';
const COMPLIED = '2026-09-05T14:02:41Z agent:claude-code:ranking-shadow COMPLIED ref=2026-09-05T14:02:11Z';
const SPLIT = '2026-09-05T14:03:00Z daemon:prod MAYDAY SPLIT-BRAIN pids=812,9944 port=9886';
const FLOOR = '2026-09-05T14:05:12Z operator:erich TAKING-FLOOR target=daemon:prod';

// ── Wire format ───────────────────────────────────────────────────────────────

describe('wire format', () => {
  test('every ADR example line round-trips byte-for-byte', () => {
    for (const raw of [HALT, SEEN, COMPLIED, SPLIT, FLOOR]) {
      const p = parseLine(raw);
      assert.ok(p, `parses: ${raw}`);
      assert.equal(p.registered, true);
      assert.equal(formatLine(p), raw);
    }
  });

  test('PAN PAN is one class with a space in it', () => {
    const line = formatLine({ ts: T0, kind: 'daemon', id: 'prod', cls: 'PAN PAN', code: 'HALF-ALIVE', fields: { socket: 'ok', tcp: 'dead' } });
    assert.equal(line, `${T0} daemon:prod PAN PAN HALF-ALIVE socket=ok tcp=dead`);
    const p = parseLine(line);
    assert.equal(p.cls, 'PAN PAN');
    assert.equal(p.code, 'HALF-ALIVE');
    assert.deepEqual(p.fields, { socket: 'ok', tcp: 'dead' });
  });

  test('control codes carry no class word, and identities may contain colons', () => {
    const p = parseLine(FLOOR);
    assert.equal(p.cls, 'control');
    assert.equal(p.code, 'TAKING-FLOOR');
    assert.deepEqual(p.fields, { target: 'daemon:prod' });
    const q = parseLine(SEEN);
    assert.equal(q.kind, 'agent');
    assert.equal(q.id, 'claude-code:ranking-shadow');
    assert.equal(q.entity, 'agent:claude-code:ranking-shadow');
    // Explicit `control` class word is tolerated on read, never written.
    const r = parseLine(`${T0} agent:x control SEEN ref=${T0}`);
    assert.equal(r.cls, 'control');
    assert.equal(formatLine({ ...r, cls: 'control' }), `${T0} agent:x SEEN ref=${T0}`);
  });

  test('free text after -- is preserved, values may contain = and commas', () => {
    const line = formatLine({ ts: T0, kind: 'daemon', id: 'prod', code: 'CORRUPT', fields: { db: 'a=b,c' }, text: 'integrity check failed: page 12' });
    const p = parseLine(line);
    assert.equal(p.fields.db, 'a=b,c');
    assert.equal(p.text, 'integrity check failed: page 12');
    assert.equal(formatLine(p), line);
  });

  test('millisecond timestamps parse; isoNow() emits seconds precision', () => {
    assert.ok(parseLine('2026-09-05T14:02:11.123Z daemon:prod ROUTINE LISTENING'));
    assert.equal(isoNow(new Date('2026-09-05T14:02:11.999Z')), T0);
  });

  test('formatting refuses what the registry refuses', () => {
    assert.throws(() => formatLine({ ts: T0, kind: 'a', id: 'b', code: 'PANIC' }), /unregistered code/);
    assert.throws(() => formatLine({ ts: T0, kind: 'a', id: 'b', cls: 'ROUTINE', code: 'HALT' }), /belongs to class SECURITE/);
    assert.throws(() => formatLine({ ts: T0, kind: 'a', id: 'b', code: 'HALT', fields: { reason: 'two words' } }), /bad field value/);
    assert.throws(() => formatLine({ ts: T0, kind: 'a', id: 'b', code: 'HALT', text: 'line1\nline2' }), /single line/);
    assert.throws(() => formatLine({ ts: T0, kind: 'op erator', id: 'b', code: 'HALT' }), /bad kind/);
    assert.throws(() => formatLine({ ts: 'yesterday', kind: 'a', id: 'b', code: 'HALT' }), /bad timestamp/);
  });

  test('parsing is lenient about unknown codes but strict about shape', () => {
    const p = parseLine(`${T0} daemon:prod MAYDAY KRAKEN depth=9`);
    assert.ok(p);
    assert.equal(p.registered, false);
    assert.equal(parseLine('not a registry line at all'), null);
    assert.equal(parseLine(`${T0} noidentity MAYDAY CORRUPT`), null);
    assert.equal(parseLine(`${T0} daemon:prod MAYDAY`), null, 'class without code');
    assert.equal(parseLine(`${T0} daemon:prod MAYDAY CORRUPT stray-token`), null, 'non k=v before --');
    assert.equal(parseLine(`${T0} daemon:prod SHOUTING CORRUPT`), null, 'unknown class');
    assert.equal(parseLine(''), null);
    assert.equal(parseLine(null), null);
  });

  test('registry classes match the ADR table', () => {
    assert.equal(CODES.HALT, 'SECURITE');
    assert.equal(CODES['SPEND-RUNAWAY'], 'MAYDAY');
    assert.equal(CODES.UNREACHABLE, 'PAN PAN');
    assert.equal(CODES.LISTENING, 'ROUTINE');
    assert.equal(CODES['TAKING-FLOOR'], 'control');
  });

  test('extractLines pulls registry lines out of Markdown and ignores the rest', () => {
    const body = ['Some prose about the halt.', '', '```text', HALT, '```', '', `> ${SPLIT}`, 'trailing chatter 2026 not a line'].join('\n');
    const lines = extractLines(body);
    assert.deepEqual(lines.map((l) => l.code), ['HALT', 'SPLIT-BRAIN']);
  });
});

// ── State ─────────────────────────────────────────────────────────────────────

describe('board state', () => {
  const lines = (...raws) => raws.map(parseLine);

  test('halt is active after HALT and lifted only by an operator ALL-CLEAR', () => {
    let s = computeState(lines(HALT));
    assert.equal(s.halt.status, 'active');
    s = computeState(lines(HALT, '2026-09-05T15:00:00Z agent:rogue SECURITE ALL-CLEAR ref=2026-09-05T14:02:11Z'));
    assert.equal(s.halt.status, 'active', 'an agent cannot lift its own halt');
    assert.equal(s.violations.length, 1);
    assert.match(s.violations[0].reason, /non-operator/);
    s = computeState(lines(HALT, '2026-09-05T15:00:00Z operator:erich SECURITE ALL-CLEAR ref=2026-09-05T14:02:11Z'));
    assert.equal(s.halt.status, 'none');
    s = computeState(lines(HALT, '2026-09-05T15:00:00Z operator:erich SECURITE DRILL'));
    assert.equal(s.halt.status, 'drill');
  });

  test('a MAYDAY is live until the same entity posts a non-MAYDAY status line', () => {
    let s = computeState(lines(SPLIT));
    assert.deepEqual(liveMaydays(s), ['daemon:prod']);
    s = computeState(lines(SPLIT, '2026-09-05T14:10:00Z daemon:prod ROUTINE LISTENING'));
    assert.deepEqual(liveMaydays(s), []);
    s = computeState(lines(SPLIT, '2026-09-05T14:10:00Z daemon:dev MAYDAY CORRUPT', '2026-09-05T14:11:00Z daemon:prod PAN PAN UNVERIFIED'));
    assert.deepEqual(liveMaydays(s), ['daemon:dev']);
  });

  test('floor: first claimant holds, later claimants are contenders, STANDING-DOWN releases', () => {
    let s = computeState(lines(FLOOR, '2026-09-05T14:05:30Z agent:claude-code:late TAKING-FLOOR target=daemon:prod'));
    assert.equal(s.floors.get('daemon:prod')[0].entity, 'operator:erich');
    assert.equal(s.floors.get('daemon:prod')[1].entity, 'agent:claude-code:late');
    assert.deepEqual(decideFloor(s, 'daemon:prod', 'agent:claude-code:late'), { action: 'held', holder: s.floors.get('daemon:prod')[0] });
    assert.equal(decideFloor(s, 'daemon:prod', 'operator:erich').action, 'already');
    assert.equal(decideFloor(s, 'relay:prod', 'operator:erich').action, 'take');
    s = computeState(lines(FLOOR, '2026-09-05T14:05:30Z agent:claude-code:late TAKING-FLOOR target=daemon:prod', '2026-09-05T14:20:00Z operator:erich STANDING-DOWN target=daemon:prod'));
    assert.equal(s.floors.get('daemon:prod')[0].entity, 'agent:claude-code:late', 'the contender inherits the floor');
    s = computeState(lines(FLOOR, '2026-09-05T14:20:00Z operator:erich STANDING-DOWN target=daemon:prod'));
    assert.equal(s.floors.has('daemon:prod'), false);
    // A STANDING-DOWN from someone who never held it releases nothing.
    s = computeState(lines(FLOOR, '2026-09-05T14:20:00Z agent:other STANDING-DOWN target=daemon:prod'));
    assert.equal(s.floors.get('daemon:prod')[0].entity, 'operator:erich');
  });

  test('a duplicate TAKING-FLOOR by the holder does not double-register', () => {
    const s = computeState(lines(FLOOR, FLOOR.replace('14:05:12', '14:06:00')));
    assert.equal(s.floors.get('daemon:prod').length, 1);
  });

  test('render + json views carry the essentials', () => {
    const s = computeState(lines(HALT, SPLIT, FLOOR, `2026-09-05T14:30:00Z ${OBSERVER_IDENTITY} PAN PAN UNREACHABLE target=relay:prod relay=unreachable http=0 halt=active mayday=daemon:prod`));
    const text = renderState(s, { header: 'hdr', localHalt: true });
    assert.match(text, /^hdr\n/);
    assert.match(text, /A0 sentinel .*HOISTED/);
    assert.match(text, /Halt: ACTIVE/);
    assert.match(text, /MAYDAY \(1\):\n {2}.*SPLIT-BRAIN/);
    assert.match(text, /daemon:prod ← operator:erich/);
    assert.match(text, /Observer: .*UNREACHABLE/);
    assert.match(text, /Lines: 4/);
    const j = stateToJson(s);
    assert.equal(j.halt.status, 'active');
    assert.deepEqual(j.maydays, ['daemon:prod']);
    assert.equal(j.floors['daemon:prod'].holder, FLOOR);
    assert.equal(j.lastObserver.includes('UNREACHABLE'), true);
    assert.match(renderState(computeState([]), { localHalt: false }), /Halt: none\nMAYDAY: none\nFloor: free\nObserver: no line yet/);
  });
});

// ── Observer ──────────────────────────────────────────────────────────────────

describe('observer', () => {
  test('classifyProbe: ok / degraded / unreachable', () => {
    assert.deepEqual(classifyProbe({ http: 200, body: '{"status":"ok","version":"3.30.6"}' }), { state: 'ok', http: 200, version: '3.30.6' });
    assert.deepEqual(classifyProbe({ http: '200', body: '{"status":"ok"}' }), { state: 'ok', http: 200, version: null });
    assert.equal(classifyProbe({ http: 200, body: '{"status":"draining"}' }).state, 'degraded');
    assert.equal(classifyProbe({ http: 200, body: '<html>cloudflare error</html>' }).state, 'degraded');
    assert.equal(classifyProbe({ http: 503, body: '' }).state, 'degraded');
    assert.equal(classifyProbe({ http: '000', body: null }).state, 'unreachable');
    assert.equal(classifyProbe({ http: 0 }).state, 'unreachable');
    assert.equal(classifyProbe(null).state, 'unreachable');
    // A version with whitespace would break the one-line format; it is dropped, not mangled.
    assert.equal(classifyProbe({ http: 200, body: '{"status":"ok","version":"3 30"}' }).version, null);
  });

  const ok = { state: 'ok', http: 200, version: '3.30.6' };
  const down = { state: 'unreachable', http: 0, version: null };
  const at = '2026-09-05T15:00:00Z';

  test('first sighting posts; an identical state does not', () => {
    const empty = computeState([]);
    const first = decideObserverPost(empty, ok, at);
    assert.equal(first.post, true);
    assert.equal(first.line, `${at} ${OBSERVER_IDENTITY} ROUTINE LISTENING target=relay:prod relay=ok http=200 halt=none mayday=none version=3.30.6 -- relay answered /health; daemon is not probed from CI by design`);
    const again = decideObserverPost(computeState([parseLine(first.line)]), ok, '2026-09-05T15:15:00Z');
    assert.equal(again.post, false);
    assert.match(again.reason, /unchanged/);
  });

  test('relay flipping to unreachable posts PAN PAN UNREACHABLE, and back posts again', () => {
    const s1 = computeState([parseLine(decideObserverPost(computeState([]), ok, at).line)]);
    const d = decideObserverPost(s1, down, '2026-09-05T15:15:00Z');
    assert.equal(d.post, true);
    assert.match(d.line, /PAN PAN UNREACHABLE target=relay:prod relay=unreachable http=0 halt=none mayday=none/);
    const s2 = computeState([...[...s1.entities.values()], parseLine(d.line)]);
    const back = decideObserverPost(s2, ok, '2026-09-05T15:30:00Z');
    assert.equal(back.post, true);
    assert.match(back.reason, /relay=unreachable .* → relay=ok/);
  });

  test('a HALT or MAYDAY appearing on the board is echoed as a delta, even with the relay steady', () => {
    const prev = parseLine(decideObserverPost(computeState([]), ok, at).line);
    const withHalt = computeState([prev, parseLine(HALT)]);
    const d = decideObserverPost(withHalt, ok, '2026-09-05T15:15:00Z');
    assert.equal(d.post, true);
    assert.match(d.line, /halt=active mayday=none/);
    const withMayday = computeState([prev, parseLine(SPLIT)]);
    const m = decideObserverPost(withMayday, ok, '2026-09-05T15:15:00Z');
    assert.equal(m.post, true);
    assert.match(m.line, /mayday=daemon:prod/);
    // …and once echoed, steady state is quiet again.
    const echoed = computeState([prev, parseLine(SPLIT), parseLine(m.line)]);
    assert.equal(decideObserverPost(echoed, ok, '2026-09-05T15:30:00Z').post, false);
  });

  test('a relay version change alone is not distress and does not post', () => {
    const prev = parseLine(decideObserverPost(computeState([]), ok, at).line);
    const d = decideObserverPost(computeState([prev]), { ...ok, version: '3.31.0' }, '2026-09-05T15:15:00Z');
    assert.equal(d.post, false);
    assert.equal(observerKey(prev.fields), 'relay=ok halt=none mayday=none');
  });

  test('degraded relay posts HALF-ALIVE with the http code', () => {
    const d = decideObserverPost(computeState([]), { state: 'degraded', http: 503, version: null }, at);
    assert.match(d.line, /PAN PAN HALF-ALIVE target=relay:prod relay=degraded http=503/);
  });
});

// ── gh fixtures + CLI ─────────────────────────────────────────────────────────

/**
 * A fake `gh` backed by recorded output shapes. Mutations are recorded in
 * `calls`; comments posted via `issue comment` become visible to the next read,
 * so a test can drive a whole floor-contention scenario end to end.
 */
function fakeGh({ issues = [], labels = [], comments = [], body = '' } = {}) {
  const calls = [];
  let nextId = 5555085474; // a real comment id from the repo, for shape fidelity
  const gh = (args, opts = {}) => {
    calls.push({ args, input: opts.input, mutation: Boolean(opts.mutation) });
    const [a, b] = args;
    if (a === 'issue' && b === 'list') return JSON.stringify(issues);
    if (a === 'label' && b === 'list') return JSON.stringify(labels);
    if (a === 'label' && b === 'create') { labels.push({ name: args[2] }); return ''; }
    if (a === 'issue' && b === 'create') {
      issues.push({ number: 10101, title: ISSUE_TITLE, state: 'OPEN', url: 'https://github.com/o/r/issues/10101' });
      return 'https://github.com/o/r/issues/10101\n';
    }
    if (a === 'issue' && b === 'reopen') { const it = issues.find((i) => String(i.number) === args[2]); if (it) it.state = 'OPEN'; return ''; }
    if (a === 'issue' && b === 'pin') return '';
    if (a === 'issue' && b === 'edit') return '';
    if (a === 'issue' && b === 'view') return JSON.stringify({ body });
    if (a === 'issue' && b === 'comment') {
      comments.push({ id: nextId++, created_at: isoNow(), user: { login: 'erichowens' }, body: opts.input });
      return 'https://github.com/o/r/issues/10101#issuecomment-1\n';
    }
    if (a === 'api' && args[1].endsWith('/comments')) return comments.map((c) => JSON.stringify(c)).join('\n');
    if (a === 'repo' && b === 'view') return JSON.stringify({ nameWithOwner: 'o/r' });
    throw new Error(`fakeGh: unexpected ${args.join(' ')}`);
  };
  return { gh, calls, issues, labels, comments };
}

const recordedIssueList = [
  { number: 10101, title: ISSUE_TITLE, state: 'OPEN', url: 'https://github.com/curiositech/port-daddy/issues/10101', labels: [{ name: LABEL }], isPinned: true },
  { number: 9000, title: 'Port Daddy: status page redesign', state: 'OPEN', url: 'https://github.com/curiositech/port-daddy/issues/9000', labels: [], isPinned: false },
];

describe('gh plumbing', () => {
  test('findIssue matches the exact title and prefers an open one', () => {
    const { gh } = fakeGh({ issues: recordedIssueList });
    assert.equal(findIssue(gh, 'o/r').number, 10101);
    const closedOnly = fakeGh({ issues: [{ number: 7, title: ISSUE_TITLE, state: 'CLOSED' }, { number: 9, title: ISSUE_TITLE, state: 'CLOSED' }] });
    assert.equal(findIssue(closedOnly.gh, 'o/r').number, 9, 'newest closed, to be reopened');
    assert.equal(findIssue(fakeGh().gh, 'o/r'), null);
  });

  const mutations = (calls) => calls.filter((c) => c.mutation).map((c) => c.args.slice(0, 2).join(' '));

  test('initBoard creates once, then finds — a second run on a labelled, pinned board writes nothing', () => {
    const f = fakeGh();
    const first = initBoard(f.gh, 'o/r', { log: () => {} });
    assert.deepEqual({ number: first.number, created: first.created }, { number: 10101, created: true });
    assert.deepEqual(mutations(f.calls), ['label create', 'issue create', 'issue pin']);
    f.calls.length = 0;
    // The fake's created issue carries no label/pin metadata, so the second run repairs both…
    const second = initBoard(f.gh, 'o/r', { log: () => {} });
    assert.deepEqual({ number: second.number, created: second.created }, { number: 10101, created: false });
    assert.deepEqual(mutations(f.calls), ['issue edit', 'issue pin'], 'no create, no label create');
    // …and once the recorded shape says labelled + pinned, `read` costs zero writes.
    const steady = fakeGh({ issues: recordedIssueList, labels: [{ name: LABEL }] });
    initBoard(steady.gh, 'o/r', { log: () => {} });
    assert.deepEqual(mutations(steady.calls), []);
  });

  test('initBoard reopens a closed board instead of creating a twin', () => {
    const f = fakeGh({ issues: [{ number: 7, title: ISSUE_TITLE, state: 'CLOSED' }], labels: [{ name: LABEL }] });
    const r = initBoard(f.gh, 'o/r', { log: () => {} });
    assert.deepEqual({ number: r.number, reopened: r.reopened, created: r.created }, { number: 7, reopened: true, created: false });
  });

  test('a pin failure (three pins already) is logged, not fatal', () => {
    const f = fakeGh({ issues: [{ ...recordedIssueList[0], isPinned: false }], labels: [{ name: LABEL }] });
    const inner = f.gh;
    const gh = (args, opts) => { if (args[1] === 'pin') { const e = new Error('pin failed'); e.stderr = 'already 3 pinned'; throw e; } return inner(args, opts); };
    const logs = [];
    const r = initBoard(gh, 'o/r', { log: (s) => logs.push(s) });
    assert.equal(r.number, 10101);
    assert.match(logs.join('\n'), /could not pin #10101: already 3 pinned/);
  });

  test('readBoard reads body then comments in id order, through the fenced blocks', () => {
    const f = fakeGh({
      body: `intro\n\n\`\`\`text\n${HALT}\n\`\`\``,
      comments: [
        { id: 2, created_at: T0, user: { login: 'a' }, body: `\`\`\`text\n${SPLIT}\n\`\`\`\n` },
        { id: 1, created_at: T0, user: { login: 'b' }, body: `${SEEN}\nthanks` },
      ],
    });
    assert.deepEqual(readBoard(f.gh, 'o/r', 10101).map((l) => l.code), ['HALT', 'SEEN', 'SPLIT-BRAIN']);
  });
});

describe('CLI', () => {
  const run = async (argv, over = {}) => {
    const out = [];
    const err = [];
    const code = await main(argv, {
      stdout: (s) => out.push(s), stderr: (s) => err.push(s),
      env: { GITHUB_REPOSITORY: 'o/r' }, now: () => T0, repoRoot: null, ...over,
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  test('parseArgs / parsePostArgs', () => {
    assert.deepEqual(parseArgs(['post', '--dry-run', 'MAYDAY', '--as', 'daemon:prod', 'CORRUPT', '--', 'x', '--not-a-flag']),
      { flags: { 'dry-run': true, as: 'daemon:prod' }, positional: ['post', 'MAYDAY', 'CORRUPT', '--', 'x', '--not-a-flag'] });
    assert.deepEqual(parsePostArgs(['PAN', 'PAN', 'UNREACHABLE', 'peer=relay:prod', '--', 'no', 'answer']),
      { cls: 'PAN PAN', code: 'UNREACHABLE', fields: { peer: 'relay:prod' }, text: 'no answer' });
    assert.deepEqual(parsePostArgs(['TAKING-FLOOR', 'target=daemon:prod']), { cls: undefined, code: 'TAKING-FLOOR', fields: { target: 'daemon:prod' }, text: undefined });
    assert.deepEqual(parsePostArgs(['control', 'SEEN', `ref=${T0}`]).cls, undefined);
    assert.throws(() => parsePostArgs(['MAYDAY', 'KRAKEN']), /unregistered/);
    assert.throws(() => parsePostArgs(['MAYDAY', 'CORRUPT', 'loose']), /expected k=v/);
    assert.throws(() => parsePostArgs([]), /missing CODE/);
  });

  test('post appends a fenced registry line as a comment and mirrors it to the A0 files', async () => {
    const f = fakeGh({ issues: recordedIssueList, labels: [{ name: LABEL }] });
    const home = scratchDir('pd-status-board-home-');
    const repoRoot = scratchDir('pd-status-board-repo-');
    try {
      const r = await run(['post', '--as', 'operator:erich', 'SECURITE', 'HALT', 'reason=spend-runaway', '--', 'see', 'incident', 'doc'], { gh: f.gh, home, repoRoot });
      assert.equal(r.code, 0);
      const expected = `${T0} operator:erich SECURITE HALT reason=spend-runaway -- see incident doc`;
      assert.equal(r.out, expected);
      const post = f.calls.find((c) => c.args[1] === 'comment');
      assert.equal(post.input, `\`\`\`text\n${expected}\n\`\`\`\n`);
      assert.equal(post.args[2], '10101');
      assert.equal(readFileSync(join(home, '.port-daddy', 'DISTRESS'), 'utf8'), `${expected}\n`);
      assert.equal(readFileSync(join(repoRoot, '.portdaddy', 'DISTRESS'), 'utf8'), `${expected}\n`);
      // Second append lands on its own line (O_APPEND), never overwrites.
      appendLocalDistress(SPLIT, { home, repoRoot });
      assert.equal(readFileSync(join(home, '.port-daddy', 'DISTRESS'), 'utf8'), `${expected}\n${SPLIT}\n`);
      assert.equal(haltActiveLocal(home), false);
      writeFileSync(join(home, '.port-daddy', 'HALT'), `${HALT}\n`);
      assert.equal(haltActiveLocal(home), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('--dry-run mutates nothing: no comment, no local file, no issue', async () => {
    const f = fakeGh();
    const home = scratchDir('pd-status-board-dry-');
    try {
      const r = await run(['post', 'MAYDAY', 'SPEND-RUNAWAY', 'rate=high', '--dry-run', '--as', 'daemon:prod'], { gh: f.gh, home });
      assert.equal(r.code, 0);
      assert.equal(f.calls.some((c) => c.mutation), false);
      assert.equal(existsSync(join(home, '.port-daddy', 'DISTRESS')), false);
      assert.match(r.err, /would create it and post to it/);
      assert.match(r.err, /would post: .*MAYDAY SPEND-RUNAWAY rate=high/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('floor: first claimant takes it, the second gets exit 2 and the holder', async () => {
    const f = fakeGh({ issues: recordedIssueList, labels: [{ name: LABEL }] });
    const home = scratchDir('pd-status-board-floor-');
    try {
      const a = await run(['floor', 'daemon:prod', '--as', 'operator:erich', '--no-local'], { gh: f.gh, home });
      assert.equal(a.code, 0);
      assert.equal(a.out, `${T0} operator:erich TAKING-FLOOR target=daemon:prod`);
      const b = await run(['floor', 'daemon:prod', '--as', 'agent:claude-code:late', '--no-local'], { gh: f.gh, home, now: () => '2026-09-05T14:06:00Z' });
      assert.equal(b.code, 2);
      assert.match(b.out, /held by operator:erich since 2026-09-05T14:02:11Z — stand down/);
      assert.equal(f.calls.filter((c) => c.args[1] === 'comment').length, 1, 'the loser posts nothing');
      const again = await run(['floor', 'daemon:prod', '--as', 'operator:erich', '--no-local'], { gh: f.gh, home });
      assert.equal(again.code, 0);
      assert.match(again.out, /already hold the floor/);
      const rel = await run(['floor', 'daemon:prod', '--release', '--as', 'operator:erich', '--no-local'], { gh: f.gh, home, now: () => '2026-09-05T14:20:00Z' });
      assert.equal(rel.code, 0);
      assert.match(rel.out, /STANDING-DOWN target=daemon:prod/);
      const c = await run(['floor', 'daemon:prod', '--as', 'agent:claude-code:late', '--no-local'], { gh: f.gh, home, now: () => '2026-09-05T14:21:00Z' });
      assert.equal(c.code, 0, 'free again after STANDING-DOWN');
      assert.equal(existsSync(join(home, '.port-daddy', 'DISTRESS')), false, '--no-local honoured');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('read prints the state and the A0 sentinel; --json is machine-readable', async () => {
    const f = fakeGh({ issues: recordedIssueList, labels: [{ name: LABEL }], comments: [
      { id: 1, created_at: T0, user: { login: 'x' }, body: `\`\`\`text\n${HALT}\n\`\`\`` },
      { id: 2, created_at: T0, user: { login: 'x' }, body: `\`\`\`text\n${FLOOR}\n\`\`\`` },
    ] });
    const home = scratchDir('pd-status-board-read-');
    try {
      const r = await run(['read'], { gh: f.gh, home });
      assert.equal(r.code, 0);
      assert.match(r.out, /^Port Daddy: status — o\/r#10101\n/);
      assert.match(r.out, /A0 sentinel .*absent/);
      assert.match(r.out, /Halt: ACTIVE/);
      assert.match(r.out, /daemon:prod ← operator:erich/);
      const j = await run(['read', '--json'], { gh: f.gh, home });
      const parsed = JSON.parse(j.out);
      assert.equal(parsed.issue, 10101);
      assert.equal(parsed.halt.status, 'active');
      assert.equal(parsed.localHalt, false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('observe posts on first sight, stays quiet on the next identical probe, posts on flip', async () => {
    const f = fakeGh({ issues: recordedIssueList, labels: [{ name: LABEL }] });
    const dir = scratchDir('pd-status-board-observe-');
    try {
      const bodyFile = join(dir, 'health.json');
      writeFileSync(bodyFile, '{"status":"ok","version":"3.30.6"}');
      const one = await run(['observe', '--http', '200', '--body-file', bodyFile], { gh: f.gh, home: dir });
      assert.equal(one.code, 0);
      assert.match(one.out, /^posted \(no observer line on the board yet\): .*ROUTINE LISTENING target=relay:prod relay=ok http=200 halt=none mayday=none version=3.30.6/);
      const two = await run(['observe', '--http', '200', '--body-file', bodyFile], { gh: f.gh, home: dir, now: () => '2026-09-05T14:17:11Z' });
      assert.match(two.out, /^no post \(unchanged/);
      assert.equal(f.comments.length, 1);
      const three = await run(['observe', '--http', '000'], { gh: f.gh, home: dir, now: () => '2026-09-05T14:32:11Z' });
      assert.match(three.out, /^posted \(changed: relay=ok .* → relay=unreachable .*\): .*PAN PAN UNREACHABLE/);
      assert.equal(f.comments.length, 2);
      // --relay-url path uses fetch; a fake fetch that throws is "unreachable", and it is unchanged now.
      const four = await run(['observe', '--relay-url', 'https://relay.example/health'], {
        gh: f.gh, home: dir, now: () => '2026-09-05T14:47:11Z', fetch: async () => { throw new Error('ECONNREFUSED'); },
      });
      assert.match(four.out, /^no post \(unchanged \(relay=unreachable/);
      // GITHUB_STEP_SUMMARY gets a short report.
      const summary = join(dir, 'summary.md');
      const five = await run(['observe', '--http', '200', '--body-file', bodyFile], {
        gh: f.gh, home: dir, now: () => '2026-09-05T15:02:11Z', env: { GITHUB_REPOSITORY: 'o/r', GITHUB_STEP_SUMMARY: summary },
      });
      assert.match(five.out, /^posted/);
      assert.match(readFileSync(summary, 'utf8'), /### Distress observer/);
      // The observer never touches the A0 files: they are the machine's, not CI's.
      assert.equal(existsSync(join(dir, '.port-daddy')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('observe --dry-run against an empty repo creates nothing and reports what it would post', async () => {
    const f = fakeGh();
    const r = await run(['observe', '--http', '503', '--dry-run'], { gh: f.gh });
    assert.equal(r.code, 0);
    assert.equal(f.calls.some((c) => c.mutation), false);
    assert.match(r.out, /^\[dry-run\] would post .*PAN PAN HALF-ALIVE target=relay:prod relay=degraded http=503/);
  });

  test('usage and unknown commands', async () => {
    assert.equal((await run([])).code, 1);
    assert.equal((await run(['help'])).code, 0);
    const bad = await run(['explode'], { gh: fakeGh().gh });
    assert.equal(bad.code, 1);
    assert.match(bad.err, /unknown command: explode/);
  });

  test('the script runs as a subprocess with no deps and imports nothing from lib/', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(src, /from ['"]\.\.\/lib\//, 'must stay independent of the daemon');
    assert.doesNotMatch(src, /from ['"]\.\/lib\//);
    const out = execFileSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.match(out, /usage: pd-status-board/);
  });
});
