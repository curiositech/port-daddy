// tests/unit/distress-allclear.test.ts
//
// ADR-0132 §4 phase 4 — the signed ALL-CLEAR. The distress register is
// writable by anyone; lifting a halt must not be. These tests pin the state
// machine: only a verified operator signature over `ALL-CLEAR|<halt-ts>|<ts>`
// that references the hoisted halt lifts it; everything else stays halted and
// lands in the ADR-0089 forensics journal.
//
// Pure fs + node:crypto. No daemon, no pd, no keychain, no network.

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyAllClear,
  allClearMessage,
  defaultDistressPaths,
  evaluateHaltState,
  formatRegistryLine,
  liftHalt,
  loadOperatorPrivateKey,
  loadOperatorPublicKey,
  parseRegistryLine,
  publicKeyFingerprint,
  readHaltState,
  resetViolationJournalDedupe,
  signAllClear,
  verifyAllClear,
  writeOperatorKeyFiles,
  type DistressPaths,
} from '../../lib/distress-allclear.js';
import { createJsonlForensicsArchive, type ForensicsEvent } from '../../lib/forensics-archive.js';

// Scratch lives inside the repo (gitignored by the `**/.scratch/` rule), never /tmp.
const SCRATCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), '.scratch');

const HALT_TS = '2026-09-05T14:02:11Z';
const HALT_LINE = `${HALT_TS} operator:erich SECURITE HALT reason=spend-runaway ref=docs/incidents/2026-09-05-port-daddy-halt.md`;
const HALT2_TS = '2026-09-06T09:00:00Z';
const HALT2_LINE = `${HALT2_TS} operator:erich SECURITE HALT reason=drill`;

function keypair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('ed25519');
}

function fakeSink() {
  const events: ForensicsEvent[] = [];
  return { events, record: (e: ForensicsEvent) => { events.push(e); } };
}

describe('registry wire format', () => {
  test('parses the ADR examples exactly', () => {
    const halt = parseRegistryLine(HALT_LINE);
    expect(halt).toMatchObject({
      ts: HALT_TS, kind: 'operator', id: 'erich', cls: 'SECURITE', code: 'HALT',
      fields: { reason: 'spend-runaway', ref: 'docs/incidents/2026-09-05-port-daddy-halt.md' },
    });
    expect(parseRegistryLine('2026-09-05T14:02:40Z agent:claude-code:ranking-shadow SEEN ref=2026-09-05T14:02:11Z'))
      .toMatchObject({ kind: 'agent', id: 'claude-code:ranking-shadow', cls: 'control', code: 'SEEN' });
    expect(parseRegistryLine('2026-09-05T14:03:00Z daemon:prod MAYDAY SPLIT-BRAIN pids=812,9944 port=9886'))
      .toMatchObject({ cls: 'MAYDAY', code: 'SPLIT-BRAIN', fields: { pids: '812,9944', port: '9886' } });
    expect(parseRegistryLine('2026-09-05T14:03:00Z daemon:prod PAN PAN UNREACHABLE peer=relay -- retrying every 30s'))
      .toMatchObject({ cls: 'PAN PAN', code: 'UNREACHABLE', fields: { peer: 'relay' }, text: 'retrying every 30s' });
  });

  test('rejects what does not fit the format instead of guessing', () => {
    expect(parseRegistryLine('')).toBeNull();
    expect(parseRegistryLine('# comment')).toBeNull();
    expect(parseRegistryLine('not-a-timestamp operator:erich SECURITE HALT')).toBeNull();
    expect(parseRegistryLine(`${HALT_TS} erich SECURITE HALT`)).toBeNull();          // no kind:id
    expect(parseRegistryLine(`${HALT_TS} operator:erich WHATEVER HALT`)).toBeNull();  // unknown class
    expect(parseRegistryLine(`${HALT_TS} operator:erich SECURITE HALT bare-word`)).toBeNull();
  });

  test('format → parse round-trips, and refuses whitespace in fields', () => {
    const line = formatRegistryLine({ ts: HALT_TS, kind: 'operator', id: 'erich', cls: 'SECURITE', code: 'HALT', fields: { reason: 'x' }, text: 'free text' });
    expect(line).toBe(`${HALT_TS} operator:erich SECURITE HALT reason=x -- free text`);
    expect(parseRegistryLine(line)?.raw).toBe(line);
    expect(() => formatRegistryLine({ ts: HALT_TS, kind: 'a', id: 'b', cls: 'ROUTINE', code: 'LISTENING', fields: { k: 'has space' } })).toThrow(/whitespace/);
  });
});

describe('sign / verify', () => {
  test('round-trip: a signed ALL-CLEAR verifies and binds to the halt it references', () => {
    const { privateKey, publicKey } = keypair();
    const { line, sig, ts } = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey, ts: '2026-09-07T12:00:00Z' });
    expect(line).toBe(`2026-09-07T12:00:00Z operator:erich SECURITE ALL-CLEAR ref=${HALT_TS} sig=${sig}`);
    expect(allClearMessage(HALT_TS, ts).toString()).toBe(`ALL-CLEAR|${HALT_TS}|${ts}`);
    const v = verifyAllClear(line, publicKey, HALT_TS);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.haltTs).toBe(HALT_TS);
    // Verification also accepts the raw 32-byte hex form listeners may pin.
    const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    expect(verifyAllClear(line, der.subarray(-32).toString('hex'), HALT_TS).ok).toBe(true);
  });

  test('unsigned: an ALL-CLEAR without sig= is rejected', () => {
    const { publicKey } = keypair();
    const v = verifyAllClear(`2026-09-07T12:00:00Z operator:erich SECURITE ALL-CLEAR ref=${HALT_TS}`, publicKey, HALT_TS);
    expect(v).toMatchObject({ ok: false, reason: 'unsigned' });
  });

  test('forged: signed by a key that is not the operator key', () => {
    const attacker = keypair();
    const operator = keypair();
    const { line } = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: attacker.privateKey });
    expect(verifyAllClear(line, operator.publicKey, HALT_TS)).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  test('tampered: changing ts, ref, or a signature byte invalidates the line', () => {
    const { privateKey, publicKey } = keypair();
    const { line, sig } = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey, ts: '2026-09-07T12:00:00Z' });
    expect(verifyAllClear(line.replace('2026-09-07T12:00:00Z', '2026-09-07T12:00:01Z'), publicKey).ok).toBe(false);
    expect(verifyAllClear(line.replace(`ref=${HALT_TS}`, `ref=${HALT2_TS}`), publicKey).ok).toBe(false);
    const flipped = Buffer.from(sig, 'base64');
    flipped[0] ^= 0x01;
    expect(verifyAllClear(line.replace(sig, flipped.toString('base64')), publicKey)).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(verifyAllClear(line.replace(sig, 'not-base64!!'), publicKey)).toMatchObject({ ok: false, reason: 'malformed-sig' });
  });

  test('wrong halt ref: a valid signature over a different halt does not lift this one', () => {
    const { privateKey, publicKey } = keypair();
    const { line } = signAllClear({ haltTs: HALT2_TS, operatorId: 'erich', privateKey });
    expect(verifyAllClear(line, publicKey).ok).toBe(true); // structurally valid…
    expect(verifyAllClear(line, publicKey, HALT_TS)).toMatchObject({ ok: false, reason: 'wrong-halt-ref' }); // …but not for THIS halt
  });

  test('only operator:<id> may issue; agents and non-all-clear lines are rejected', () => {
    const { privateKey, publicKey } = keypair();
    const { line } = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey });
    expect(verifyAllClear(line.replace('operator:erich', 'agent:erich'), publicKey)).toMatchObject({ ok: false, reason: 'not-operator' });
    expect(verifyAllClear(HALT_LINE, publicKey)).toMatchObject({ ok: false, reason: 'not-an-all-clear' });
    expect(verifyAllClear('garbage', publicKey)).toMatchObject({ ok: false, reason: 'not-a-registry-line' });
  });
});

describe('halt state machine (pure)', () => {
  const op = keypair();
  const validFor = (haltTs: string, ts = '2026-09-07T12:00:00Z') =>
    signAllClear({ haltTs, operatorId: 'erich', privateKey: op.privateKey, ts }).line;

  test('clear: no sentinel and no halt on record is "no halt hoisted"', () => {
    const ev = evaluateHaltState({ sentinelLine: null, registerLines: [], publicKey: op.publicKey });
    expect(ev.status.state).toBe('clear');
    expect(ev.violations).toEqual([]);
  });

  test('hoisted: a hand-written sentinel with no register entry is still a halt', () => {
    const ev = evaluateHaltState({ sentinelLine: HALT_LINE, registerLines: [], publicKey: op.publicKey });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.status.halt?.ts).toBe(HALT_TS);
  });

  test('hoisted → (unsigned all-clear appended) stays hoisted and records a violation', () => {
    const ev = evaluateHaltState({
      sentinelLine: HALT_LINE,
      registerLines: [HALT_LINE, `2026-09-07T12:00:00Z operator:erich SECURITE ALL-CLEAR ref=${HALT_TS}`],
      publicKey: op.publicKey,
    });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.violations).toEqual([expect.objectContaining({ rule: 'ALLCLEAR_UNSIGNED', reason: 'unsigned', haltTs: HALT_TS })]);
  });

  test('hoisted → (forged all-clear) stays hoisted, ALLCLEAR_FORGED', () => {
    const attacker = keypair();
    const forged = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: attacker.privateKey }).line;
    const ev = evaluateHaltState({ sentinelLine: HALT_LINE, registerLines: [HALT_LINE, forged], publicKey: op.publicKey });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.violations).toEqual([expect.objectContaining({ rule: 'ALLCLEAR_FORGED', reason: 'bad-signature' })]);
  });

  test('hoisted → (valid sig for a halt that never existed) stays hoisted, ALLCLEAR_WRONG_REF', () => {
    const ev = evaluateHaltState({ sentinelLine: HALT_LINE, registerLines: [HALT_LINE, validFor(HALT2_TS)], publicKey: op.publicKey });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.violations).toEqual([expect.objectContaining({ rule: 'ALLCLEAR_WRONG_REF', reason: 'wrong-halt-ref', ref: HALT2_TS })]);
  });

  test('replay: an all-clear that already lifted an earlier halt cannot lift the next one', () => {
    const lifted1 = validFor(HALT_TS, '2026-09-05T18:00:00Z');
    const ev = evaluateHaltState({
      sentinelLine: HALT2_LINE,
      registerLines: [HALT_LINE, lifted1, HALT2_LINE, lifted1],
      publicKey: op.publicKey,
    });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.status.halt?.ts).toBe(HALT2_TS);
    expect(ev.liftedHaltTs).toEqual([HALT_TS]);
    expect(ev.violations).toEqual([expect.objectContaining({ rule: 'ALLCLEAR_REPLAYED', ref: HALT_TS, haltTs: HALT2_TS })]);
  });

  test('hoisted → (valid sig, ref = this halt) is lifted', () => {
    const ev = evaluateHaltState({ sentinelLine: HALT_LINE, registerLines: [HALT_LINE, validFor(HALT_TS)], publicKey: op.publicKey });
    expect(ev.status.state).toBe('lifted');
    expect(ev.violations).toEqual([]);
    expect(ev.liftedHaltTs).toEqual([HALT_TS]);
  });

  test('a duplicate of the consumed valid line is a no-op, not a replay', () => {
    const ok = validFor(HALT_TS);
    const ev = evaluateHaltState({ sentinelLine: null, registerLines: [HALT_LINE, ok, ok], publicKey: op.publicKey });
    expect(ev.status.state).toBe('lifted');
    expect(ev.violations).toEqual([]);
  });

  test('a deleted sentinel does not lift a halt the register still carries', () => {
    const ev = evaluateHaltState({ sentinelLine: null, registerLines: [HALT_LINE], publicKey: op.publicKey });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.violations).toEqual([expect.objectContaining({ rule: 'HALT_SENTINEL_MISSING', haltTs: HALT_TS })]);
  });

  test('an all-clear with no halt on record is a violation, not a lift', () => {
    const ev = evaluateHaltState({ sentinelLine: null, registerLines: [validFor(HALT_TS)], publicKey: op.publicKey });
    expect(ev.status.state).toBe('clear');
    expect(ev.violations).toEqual([expect.objectContaining({ rule: 'ALLCLEAR_WITHOUT_HALT' })]);
  });

  test('with no operator public key pinned, nothing can lift the halt', () => {
    const ev = evaluateHaltState({ sentinelLine: HALT_LINE, registerLines: [HALT_LINE, validFor(HALT_TS)], publicKey: null });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.violations).toEqual([expect.objectContaining({ rule: 'ALLCLEAR_FORGED', reason: 'no-public-key' })]);
  });

  test('a fresh halt after a lift is hoisted again', () => {
    const ev = evaluateHaltState({ sentinelLine: HALT2_LINE, registerLines: [HALT_LINE, validFor(HALT_TS), HALT2_LINE], publicKey: op.publicKey });
    expect(ev.status.state).toBe('hoisted');
    expect(ev.status.halt?.ts).toBe(HALT2_TS);
  });
});

describe('on disk: sentinel, register, journal, and the verifier path', () => {
  let home: string;
  let repo: string;
  let paths: DistressPaths;
  const op = keypair();

  beforeEach(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    home = mkdtempSync(join(SCRATCH_ROOT, 'home-'));
    repo = mkdtempSync(join(SCRATCH_ROOT, 'repo-'));
    paths = defaultDistressPaths({ home, repoRoot: repo });
    resetViolationJournalDedupe();
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  function hoist(line = HALT_LINE) {
    writeFileSync(paths.haltFile, `${line}\n`);
    writeFileSync(paths.distressFile, `${line}\n`, { flag: 'a' });
  }

  test('defaultDistressPaths follows the ADR locations', () => {
    expect(paths.haltFile).toBe(join(home, 'HALT'));
    expect(paths.distressFile).toBe(join(home, 'DISTRESS'));
    expect(paths.repoDistressFile).toBe(join(repo, '.portdaddy', 'DISTRESS'));
  });

  test('absence of the sentinel with an empty register is "no halt hoisted", with no violation', () => {
    const sink = fakeSink();
    const ev = readHaltState({ paths, publicKey: op.publicKey, forensics: sink });
    expect(ev.status).toEqual({ state: 'clear', halt: null, allClear: null });
    expect(sink.events).toEqual([]);
  });

  test('hoisted: readHaltState reports the HALT record with the sentinel present', () => {
    hoist();
    const ev = readHaltState({ paths, publicKey: op.publicKey, forensics: null });
    expect(ev.status).toMatchObject({ state: 'hoisted', sentinelPresent: true });
    expect(ev.status.halt?.ts).toBe(HALT_TS);
  });

  test('deleting the sentinel does not end the halt; the deletion is journaled', () => {
    hoist();
    rmSync(paths.haltFile);
    const sink = fakeSink();
    const ev = readHaltState({ paths, publicKey: op.publicKey, forensics: sink });
    expect(ev.status).toMatchObject({ state: 'hoisted', sentinelPresent: false });
    expect(sink.events).toEqual([expect.objectContaining({ rule: 'HALT_SENTINEL_MISSING', severity: 'violation' })]);
  });

  test('every rejected all-clear reaches the durable journal with severity high, once', () => {
    hoist();
    const attacker = keypair();
    const unsigned = `2026-09-07T12:00:00Z operator:erich SECURITE ALL-CLEAR ref=${HALT_TS}`;
    const forged = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: attacker.privateKey, ts: '2026-09-07T12:00:01Z' }).line;
    const wrongRef = signAllClear({ haltTs: HALT2_TS, operatorId: 'erich', privateKey: op.privateKey, ts: '2026-09-07T12:00:02Z' }).line;
    writeFileSync(paths.distressFile, `${unsigned}\n${forged}\n${wrongRef}\n`, { flag: 'a' });

    const sink = fakeSink();
    const now = () => Date.parse('2026-09-07T12:01:00Z');
    expect(readHaltState({ paths, publicKey: op.publicKey, forensics: sink, now }).status.state).toBe('hoisted');
    expect(sink.events.map((e) => e.rule)).toEqual(['ALLCLEAR_UNSIGNED', 'ALLCLEAR_FORGED', 'ALLCLEAR_WRONG_REF']);
    for (const e of sink.events) {
      expect(e.severity).toBe('critical');
      expect(e.metadata).toMatchObject({ adr: '0132', distressClass: 'MAYDAY', feedbackSeverity: 'high', haltTs: HALT_TS });
      expect(e.timestamp).toBe(now());
    }
    // A listening watch re-reading the register does not re-journal the same lines.
    expect(readHaltState({ paths, publicKey: op.publicKey, forensics: sink, now }).status.state).toBe('hoisted');
    expect(sink.events).toHaveLength(3);
    // The sentinel is still there: nothing but a verified all-clear removes it.
    expect(existsSync(paths.haltFile)).toBe(true);
  });

  test('the default journal is the ADR-0089 JSONL archive', () => {
    hoist();
    const forensicsDir = join(home, 'forensics');
    const attacker = keypair();
    const forged = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: attacker.privateKey }).line;
    writeFileSync(paths.distressFile, `${forged}\n`, { flag: 'a' });
    const now = () => Date.parse('2026-09-07T12:00:00Z');
    const sink = createJsonlForensicsArchive({ dir: forensicsDir, now });
    readHaltState({ paths, publicKey: op.publicKey, forensics: sink, now });
    const files = readdirSync(forensicsDir);
    expect(files).toEqual(['forensics-2026-09-07.jsonl']);
    const rec = JSON.parse(readFileSync(join(forensicsDir, files[0]), 'utf8').trim());
    expect(rec).toMatchObject({ rule: 'ALLCLEAR_FORGED', severity: 'critical', metadata: { feedbackSeverity: 'high' } });
  });

  test('applyAllClear: a forged line is journaled and NOT appended; a valid one lifts and removes the sentinel', () => {
    hoist();
    const sink = fakeSink();
    const attacker = keypair();
    const forged = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: attacker.privateKey }).line;
    const r1 = applyAllClear(forged, { paths, publicKey: op.publicKey, forensics: sink });
    expect(r1).toMatchObject({ lifted: false, reason: 'bad-signature', violation: { rule: 'ALLCLEAR_FORGED' } });
    expect(readFileSync(paths.distressFile, 'utf8')).toBe(`${HALT_LINE}\n`);
    expect(existsSync(paths.haltFile)).toBe(true);
    expect(sink.events.map((e) => e.rule)).toEqual(['ALLCLEAR_FORGED']);

    const valid = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: op.privateKey }).line;
    const r2 = applyAllClear(valid, { paths, publicKey: op.publicKey, forensics: sink });
    expect(r2).toMatchObject({ lifted: true, line: valid });
    expect(existsSync(paths.haltFile)).toBe(false);
    expect(readFileSync(paths.distressFile, 'utf8')).toBe(`${HALT_LINE}\n${valid}\n`);
    expect(readFileSync(paths.repoDistressFile!, 'utf8')).toBe(`${valid}\n`);
    expect(readHaltState({ paths, publicKey: op.publicKey, forensics: sink }).status.state).toBe('lifted');
    expect(sink.events).toHaveLength(1);
  });

  test('applyAllClear: replaying the line that lifted halt 1 against halt 2 is journaled as ALLCLEAR_REPLAYED', () => {
    hoist(HALT_LINE);
    const sink = fakeSink();
    const lifted1 = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: op.privateKey, ts: '2026-09-05T18:00:00Z' }).line;
    expect(applyAllClear(lifted1, { paths, publicKey: op.publicKey, forensics: sink }).lifted).toBe(true);
    hoist(HALT2_LINE);
    const replay = applyAllClear(lifted1, { paths, publicKey: op.publicKey, forensics: sink });
    expect(replay).toMatchObject({ lifted: false, reason: 'wrong-halt-ref', violation: { rule: 'ALLCLEAR_REPLAYED', ref: HALT_TS, haltTs: HALT2_TS } });
    expect(existsSync(paths.haltFile)).toBe(true);
    expect(sink.events.map((e) => e.rule)).toEqual(['ALLCLEAR_REPLAYED']);
  });

  test('applyAllClear with nothing hoisted does nothing', () => {
    expect(applyAllClear('anything', { paths, publicKey: op.publicKey, forensics: null })).toEqual({ lifted: false, reason: 'no-halt-hoisted' });
  });

  test('readers whose sentinel-removal is disabled still see lifted', () => {
    hoist();
    const valid = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: op.privateKey }).line;
    writeFileSync(paths.distressFile, `${valid}\n`, { flag: 'a' });
    const ev = readHaltState({ paths, publicKey: op.publicKey, forensics: null, removeSentinelOnLift: false });
    expect(ev.status.state).toBe('lifted');
    expect(existsSync(paths.haltFile)).toBe(true);
    // …and the verifier path removes it.
    readHaltState({ paths, publicKey: op.publicKey, forensics: null });
    expect(existsSync(paths.haltFile)).toBe(false);
  });
});

describe('operator key custody', () => {
  let home: string;
  let paths: DistressPaths;
  beforeEach(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    home = mkdtempSync(join(SCRATCH_ROOT, 'keys-'));
    paths = defaultDistressPaths({ home });
    resetViolationJournalDedupe();
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  test('keygen writes a 0600 passphrase-encrypted private key and a public key; refuses to overwrite', () => {
    const { fingerprint } = writeOperatorKeyFiles(paths, 'correct horse battery');
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(statSync(paths.privateKeyFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths.privateKeyFile, 'utf8')).toMatch(/BEGIN ENCRYPTED PRIVATE KEY/);
    expect(publicKeyFingerprint(loadOperatorPublicKey(paths)!)).toBe(fingerprint);
    expect(() => writeOperatorKeyFiles(paths, 'correct horse battery')).toThrow(/refusing to overwrite/);
    expect(() => writeOperatorKeyFiles(defaultDistressPaths({ home: join(home, 'x') }), 'short')).toThrow(/at least 8/);
  });

  test('the private key is inert without the passphrase', () => {
    writeOperatorKeyFiles(paths, 'correct horse battery');
    expect(() => loadOperatorPrivateKey(paths, 'wrong')).toThrow(/wrong passphrase/);
    const key = loadOperatorPrivateKey(paths, 'correct horse battery');
    const { line } = signAllClear({ haltTs: HALT_TS, operatorId: 'erich', privateKey: key });
    expect(verifyAllClear(line, loadOperatorPublicKey(paths)!, HALT_TS).ok).toBe(true);
  });

  test('liftHalt end-to-end: sign with the unlocked key, append, remove the sentinel', () => {
    writeOperatorKeyFiles(paths, 'correct horse battery');
    writeFileSync(paths.haltFile, `${HALT_LINE}\n`);
    writeFileSync(paths.distressFile, `${HALT_LINE}\n`);
    expect(() => liftHalt({ operatorId: 'erich', passphrase: 'nope-nope', paths, forensics: null })).toThrow(/wrong passphrase/);
    expect(existsSync(paths.haltFile)).toBe(true);
    const r = liftHalt({ operatorId: 'erich', passphrase: 'correct horse battery', paths, forensics: null, ts: '2026-09-07T12:00:00Z' });
    expect(r.lifted).toBe(true);
    expect(existsSync(paths.haltFile)).toBe(false);
    expect(readHaltState({ paths, forensics: null }).status.state).toBe('lifted');
    const lines = readFileSync(paths.distressFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(parseRegistryLine(lines[1])).toMatchObject({ kind: 'operator', id: 'erich', code: 'ALL-CLEAR', fields: { ref: HALT_TS } });
  });

  test('liftHalt refuses without a pinned public key or without a hoisted halt', () => {
    expect(liftHalt({ operatorId: 'erich', passphrase: 'correct horse battery', paths, forensics: null })).toEqual({ lifted: false, reason: 'no-public-key' });
    writeOperatorKeyFiles(paths, 'correct horse battery');
    expect(liftHalt({ operatorId: 'erich', passphrase: 'correct horse battery', paths, forensics: null })).toEqual({ lifted: false, reason: 'no-halt-hoisted' });
  });
});
