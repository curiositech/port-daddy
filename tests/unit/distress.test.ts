/**
 * lib/distress.ts — the Distress Register floor (ADR-0132 phase 0).
 *
 * - registry: every code maps to exactly one class, the class set is closed
 * - wire format: serialize → parse → serialize is the identity, parse rejects
 *   every malformed shape without throwing
 * - appends: machine-wide + repo-scoped locations, PD_HOME override, and the
 *   O_APPEND atomicity claim verified with 50 concurrent subprocesses
 * - sentinel: haltActive / readHalt / writeHalt, machine-wide authoritative
 *
 * No daemon is started anywhere in this file.
 */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { applyAllClear, defaultDistressPaths, signAllClear } from '../../lib/distress-allclear.js';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import {
  DISTRESS_CLASSES,
  DISTRESS_CODES,
  DISTRESS_CODE_LIST,
  DISTRESS_MAX_LINE_BYTES,
  appendDistress,
  classOfCode,
  describeHalt,
  distressHome,
  distressPaths,
  findRepoRoot,
  haltActive,
  haltPaths,
  lastWords,
  parseDistressFile,
  parseDistressLine,
  readDistress,
  readDistressDetailed,
  readHalt,
  serializeDistress,
  writeHalt,
  type DistressInput,
  type DistressRecord,
} from '../../lib/distress.js';

let scratch: string;
let home: string;
let repo: string;
const savedHome = process.env.PD_HOME;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pd-distress-'));
  home = join(scratch, 'home');
  repo = join(scratch, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  process.env.PD_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PD_HOME; else process.env.PD_HOME = savedHome;
  rmSync(scratch, { recursive: true, force: true });
});

// ─── Registry ────────────────────────────────────────────────────────────────

describe('registry', () => {
  test('the class set is exactly the four ADR classes plus control', () => {
    expect([...DISTRESS_CLASSES]).toEqual(['MAYDAY', 'PAN PAN', 'SECURITE', 'ROUTINE', 'control']);
  });

  test('the code table is the ADR-0132 §1 table, each code in exactly one class', () => {
    expect(DISTRESS_CODES).toEqual({
      HALT: 'SECURITE', 'ALL-CLEAR': 'SECURITE', DRILL: 'SECURITE',
      'SPLIT-BRAIN': 'MAYDAY', 'SPEND-RUNAWAY': 'MAYDAY', CORRUPT: 'MAYDAY', 'CANNOT-STOP': 'MAYDAY',
      UNREACHABLE: 'PAN PAN', 'HALF-ALIVE': 'PAN PAN', UNVERIFIED: 'PAN PAN',
      'TAKING-FLOOR': 'control', 'STANDING-DOWN': 'control', SEEN: 'control', COMPLIED: 'control',
      LISTENING: 'ROUTINE',
    });
    expect(DISTRESS_CODE_LIST).toHaveLength(15);
    for (const code of DISTRESS_CODE_LIST) expect(DISTRESS_CLASSES).toContain(classOfCode(code));
  });

  test('the shell twin carries the identical registry', () => {
    // bin/pd-distress must never drift from lib/distress.ts: read its case
    // table and check every registered code appears under the right class.
    const script = readFileSync(new URL('../../bin/pd-distress', import.meta.url), 'utf8');
    const table = /class_of_code\(\) \{([\s\S]*?)\n\}/.exec(script)?.[1] ?? '';
    for (const code of DISTRESS_CODE_LIST) {
      const row = table.split('\n').find((line) => line.split(')')[0].split('|').map((s) => s.trim()).includes(code));
      expect(row).toBeDefined();
      expect(row).toContain(`printf '${classOfCode(code)}'`);
    }
    const shellCodes = table.match(/^\s*([A-Z|-]+)\) printf/gm)?.flatMap((m) => m.trim().split(')')[0].split('|')) ?? [];
    expect(shellCodes.sort()).toEqual([...DISTRESS_CODE_LIST].sort());
  });
});

// ─── Wire format ─────────────────────────────────────────────────────────────

const ADR_EXAMPLES = [
  '2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend-runaway ref=docs/incidents/2026-09-05-port-daddy-halt.md',
  '2026-09-05T14:03:00Z daemon:prod MAYDAY SPLIT-BRAIN pids=812,9944 port=9886',
  '2026-09-05T14:05:12Z operator:erich control TAKING-FLOOR target=daemon:prod',
  '2026-09-05T14:02:40Z agent:claude-code:ranking-shadow control SEEN ref=2026-09-05T14:02:11Z',
  '2026-09-05T14:02:41Z agent:claude-code:ranking-shadow control COMPLIED ref=2026-09-05T14:02:11Z',
  '2026-09-05T14:10:00Z daemon:dev PAN PAN UNREACHABLE peer=relay -- portdaddy.dev dead-lettering, retrying',
  '2026-09-05T14:11:00Z agent:codex:x ROUTINE LISTENING',
  '2026-09-05T14:12:00.250Z steward:expungement PAN PAN UNVERIFIED -- db read failed: SQLITE_BUSY',
];

describe('serialize / parse round trip', () => {
  test.each(ADR_EXAMPLES)('canonical line survives parse → serialize unchanged: %s', (line) => {
    const parsed = parseDistressLine(line);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDistress(parsed.record)).toBe(line);
    expect(parseDistressLine(serializeDistress(parsed.record))).toEqual(parsed);
  });

  test('parse yields the structured record the ADR example describes', () => {
    const parsed = parseDistressLine(ADR_EXAMPLES[0]);
    expect(parsed).toEqual({
      ok: true,
      record: {
        at: '2026-09-05T14:02:11Z', kind: 'operator', id: 'erich', cls: 'SECURITE', code: 'HALT',
        fields: { reason: 'spend-runaway', ref: 'docs/incidents/2026-09-05-port-daddy-halt.md' },
      },
    });
    const withText = parseDistressLine(ADR_EXAMPLES[5]);
    expect(withText.ok && withText.record.text).toBe('portdaddy.dev dead-lettering, retrying');
    expect(withText.ok && withText.record.fields).toEqual({ peer: 'relay' });
  });

  test('entity ids may contain colons; kind is the part before the first colon', () => {
    const parsed = parseDistressLine(ADR_EXAMPLES[3]);
    expect(parsed.ok && parsed.record.kind).toBe('agent');
    expect(parsed.ok && parsed.record.id).toBe('claude-code:ranking-shadow');
  });

  test('the ADR shorthand (control code without class token) parses and re-serializes canonically', () => {
    const parsed = parseDistressLine('2026-09-05T14:02:40Z agent:claude-code:ranking-shadow SEEN ref=2026-09-05T14:02:11Z');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.cls).toBe('control');
    expect(serializeDistress(parsed.record)).toBe(ADR_EXAMPLES[3]);
  });

  test('serialize → parse is the identity over a generated corpus', () => {
    const kinds = ['operator', 'agent', 'daemon', 'supervisor', 'shell', 'ci'];
    const ids = ['erich', 'prod', 'claude-code:ranking-shadow', 'w1@host', 'x'];
    let n = 0;
    for (const code of DISTRESS_CODE_LIST) {
      for (const kind of kinds) {
        const id = ids[n % ids.length];
        const input: DistressInput = {
          at: `2026-09-05T14:${String(n % 60).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')}Z`,
          kind, id, cls: classOfCode(code), code,
          fields: n % 3 === 0 ? {} : { ref: `r${n}`, n, ok: n % 2 === 0 },
          text: n % 4 === 0 ? `free text number ${n} -- with -- dashes` : undefined,
        };
        const line = serializeDistress(input);
        const parsed = parseDistressLine(line);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const expected: DistressRecord = {
          at: input.at!, kind, id, cls: input.cls, code,
          fields: Object.fromEntries(Object.entries(input.fields ?? {}).map(([k, v]) => [k, String(v)])),
        };
        if (input.text) expected.text = input.text;
        expect(parsed.record).toEqual(expected);
        expect(serializeDistress(parsed.record)).toBe(line);
        n += 1;
      }
    }
    expect(n).toBe(DISTRESS_CODE_LIST.length * kinds.length);
  });

  test('serializer defaults the timestamp to now, seconds precision, Z suffix', () => {
    const line = serializeDistress({ kind: 'agent', id: 'x', cls: 'ROUTINE', code: 'LISTENING' });
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z agent:x ROUTINE LISTENING$/);
  });
});

describe('serializer refuses what could not round-trip', () => {
  const base: DistressInput = { at: '2026-09-05T14:02:11Z', kind: 'agent', id: 'x', cls: 'ROUTINE', code: 'LISTENING' };
  test.each<[string, DistressInput]>([
    ['unregistered code', { ...base, code: 'BOGUS' as never }],
    ['class/code mismatch', { ...base, cls: 'MAYDAY', code: 'HALT' }],
    ['unknown class', { ...base, cls: 'URGENT' as never }],
    ['non-UTC timestamp', { ...base, at: '2026-09-05T14:02:11+02:00' }],
    ['uppercase kind', { ...base, kind: 'Agent' }],
    ['id with whitespace', { ...base, id: 'a b' }],
    ['field value with whitespace', { ...base, fields: { note: 'two words' } }],
    ['field key with =', { ...base, fields: { 'a=b': 'c' } }],
    ['multi-line text', { ...base, text: 'one\ntwo' }],
    ['empty text', { ...base, text: '   ' }],
    ['line over the atomic bound', { ...base, fields: { pad: 'x'.repeat(DISTRESS_MAX_LINE_BYTES) } }],
  ])('%s', (_label, input) => {
    expect(() => serializeDistress(input)).toThrow();
  });

  test('a line of exactly the bound (newline included) is accepted', () => {
    const prefix = serializeDistress({ ...base, fields: { pad: 'x' } });
    const room = DISTRESS_MAX_LINE_BYTES - 1 - Buffer.byteLength(prefix) + 1; // +1: replace the single x
    const line = serializeDistress({ ...base, fields: { pad: 'x'.repeat(room) } });
    expect(Buffer.byteLength(line) + 1).toBe(DISTRESS_MAX_LINE_BYTES);
  });
});

describe('parser never throws and names the defect', () => {
  test.each([
    ['', 'empty line'],
    ['   ', 'empty line'],
    [' 2026-09-05T14:02:11Z agent:x ROUTINE LISTENING', 'leading or trailing whitespace'],
    ['2026-09-05T14:02:11Z agent:x  ROUTINE LISTENING', 'runs of spaces'],
    ['2026-09-05 14:02:11 agent:x ROUTINE LISTENING', 'bad timestamp'],
    ['2026-09-05T14:02:11Z agentx ROUTINE LISTENING', 'bad entity'],
    ['2026-09-05T14:02:11Z :x ROUTINE LISTENING', 'bad entity'],
    ['2026-09-05T14:02:11Z agent: ROUTINE LISTENING', 'bad entity'],
    ['2026-09-05T14:02:11Z Agent:x ROUTINE LISTENING', 'bad entity kind'],
    ['2026-09-05T14:02:11Z agent:x ROUTINE', 'missing code'],
    ['2026-09-05T14:02:11Z agent:x ROUTINE BOGUS', 'unregistered code'],
    ['2026-09-05T14:02:11Z agent:x MAYDAY HALT', 'belongs to class SECURITE'],
    ['2026-09-05T14:02:11Z agent:x HALT', 'requires its class token'],
    ['2026-09-05T14:02:11Z agent:x PAN HALF-ALIVE', 'unregistered code'],
    ['2026-09-05T14:02:11Z agent:x ROUTINE LISTENING notafield', 'bad field token'],
    ['2026-09-05T14:02:11Z agent:x ROUTINE LISTENING a=1 a=2', 'duplicate field'],
    ['2026-09-05T14:02:11Z agent:x ROUTINE LISTENING --', '"--" must be followed'],
  ])('%j → %s', (raw, error) => {
    const parsed = parseDistressLine(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(error);
  });

  test('a trailing newline is tolerated on a single line', () => {
    expect(parseDistressLine(`${ADR_EXAMPLES[6]}\n`).ok).toBe(true);
  });

  test('parseDistressFile keeps good lines and reports torn ones by line number', () => {
    const body = `${ADR_EXAMPLES[0]}\n2026-09-05T14:0\n\n${ADR_EXAMPLES[1]}\n`;
    const { records, malformed } = parseDistressFile(body);
    expect(records.map((r) => r.code)).toEqual(['HALT', 'SPLIT-BRAIN']);
    expect(malformed).toEqual([{ line: 2, raw: '2026-09-05T14:0', error: expect.stringContaining('expected at least') }]);
  });
});

// ─── Locations ───────────────────────────────────────────────────────────────

describe('locations', () => {
  test('PD_HOME overrides ~/.port-daddy and is read on every call', () => {
    expect(distressHome()).toBe(home);
    process.env.PD_HOME = join(scratch, 'other');
    expect(distressHome()).toBe(join(scratch, 'other'));
    expect(distressPaths({ repoRoot: null }).machine).toBe(join(scratch, 'other', 'DISTRESS'));
  });

  test('findRepoRoot walks up to a .git directory or a .git file (linked worktree)', () => {
    expect(findRepoRoot(join(repo, 'src', 'deep'))).toBe(repo);
    const worktree = join(scratch, 'wt');
    mkdirSync(join(worktree, 'a', 'b'), { recursive: true });
    writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere\n');
    expect(findRepoRoot(join(worktree, 'a', 'b'))).toBe(worktree);
    expect(findRepoRoot(scratch)).toBeNull();
  });

  test('paths pair the machine-wide file with a repo-scoped one only inside a repo', () => {
    expect(distressPaths({ cwd: join(repo, 'src') })).toEqual({
      machine: join(home, 'DISTRESS'), repo: join(repo, '.portdaddy', 'DISTRESS'),
    });
    expect(distressPaths({ cwd: scratch })).toEqual({ machine: join(home, 'DISTRESS'), repo: null });
    expect(haltPaths({ cwd: repo })).toEqual({ machine: join(home, 'HALT'), repo: join(repo, '.portdaddy', 'HALT') });
  });
});

// ─── Appending and reading ───────────────────────────────────────────────────

describe('appendDistress / readDistress', () => {
  test('appends one exact line to both files inside a repo and creates the directories', () => {
    const result = appendDistress(
      { kind: 'daemon', id: 'prod', cls: 'MAYDAY', code: 'SPLIT-BRAIN', fields: { pids: '812,9944', port: 9886 }, at: '2026-09-05T14:03:00Z' },
      { cwd: join(repo, 'src', 'deep') },
    );
    expect(result.line).toBe(ADR_EXAMPLES[1]);
    expect(result.paths).toEqual([join(home, 'DISTRESS'), join(repo, '.portdaddy', 'DISTRESS')]);
    for (const path of result.paths) expect(readFileSync(path, 'utf8')).toBe(`${ADR_EXAMPLES[1]}\n`);
    expect(readDistress({ cwd: repo })).toEqual([result.record]);
    expect(readDistress({ cwd: repo, scope: 'repo' })).toEqual([result.record]);
  });

  test('outside a repo only the machine-wide file is written; scope "repo" is refused', () => {
    const result = appendDistress({ kind: 'agent', id: 'x', cls: 'ROUTINE', code: 'LISTENING' }, { cwd: scratch });
    expect(result.paths).toEqual([join(home, 'DISTRESS')]);
    expect(() => appendDistress({ kind: 'agent', id: 'x', cls: 'ROUTINE', code: 'LISTENING' }, { cwd: scratch, scope: 'repo' })).toThrow(/outside a repository/);
    expect(readDistress({ cwd: scratch, scope: 'repo' })).toEqual([]);
  });

  test('scope "machine" inside a repo leaves the repo file alone', () => {
    appendDistress({ kind: 'agent', id: 'x', cls: 'ROUTINE', code: 'LISTENING' }, { cwd: repo, scope: 'machine' });
    expect(existsSync(join(repo, '.portdaddy', 'DISTRESS'))).toBe(false);
  });

  test('an invalid record is refused before any file is touched', () => {
    expect(() => appendDistress({ kind: 'agent', id: 'x', cls: 'MAYDAY', code: 'HALT' }, { cwd: repo })).toThrow(/belongs to class/);
    expect(existsSync(join(home, 'DISTRESS'))).toBe(false);
  });

  test('reads are append-ordered and skip torn lines without losing the rest', () => {
    appendDistress({ kind: 'agent', id: 'a', cls: 'ROUTINE', code: 'LISTENING', at: '2026-09-05T14:00:01Z' }, { cwd: scratch });
    writeFileSync(join(home, 'DISTRESS'), 'torn line\n', { flag: 'a' });
    appendDistress({ kind: 'agent', id: 'b', cls: 'ROUTINE', code: 'LISTENING', at: '2026-09-05T14:00:02Z' }, { cwd: scratch });
    const detailed = readDistressDetailed({ cwd: scratch });
    expect(detailed.records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(detailed.malformed).toEqual([{ line: 2, raw: 'torn line', error: expect.any(String) }]);
    expect(readDistress({ cwd: scratch })).toHaveLength(2);
  });

  test('lastWords prints the line to stderr and also appends it', () => {
    const chunks: string[] = [];
    const line = lastWords(
      { kind: 'daemon', id: 'dev', cls: 'MAYDAY', code: 'CANNOT-STOP', text: 'SIGTERM ignored by child', at: '2026-09-05T15:00:00Z' },
      { cwd: scratch, stderr: { write: (c: string) => chunks.push(c) } },
    );
    expect(chunks).toEqual([`${line}\n`]);
    expect(readDistress({ cwd: scratch })[0]).toMatchObject({ code: 'CANNOT-STOP', text: 'SIGTERM ignored by child' });
  });
});

// ─── Concurrency ─────────────────────────────────────────────────────────────

describe('O_APPEND atomicity', () => {
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve('tsx/esm');
  const moduleUrl = new URL('../../lib/distress.ts', import.meta.url).href;

  test('50 concurrent subprocesses × 20 appends each land 1000 intact, non-interleaved lines', async () => {
    const writers = 50;
    const perWriter = 20;
    // Pad every line so a torn write would be obvious and so the write is a
    // realistic size (~250 bytes), well under the 4096-byte bound.
    const pad = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(4);
    const program = `
      import { appendDistress } from ${JSON.stringify(moduleUrl)};
      const w = process.argv[1];
      for (let j = 0; j < ${perWriter}; j++) {
        appendDistress({ kind: 'agent', id: 'w' + w, cls: 'ROUTINE', code: 'LISTENING', fields: { seq: j, pad: ${JSON.stringify(pad)} } }, { cwd: ${JSON.stringify(scratch)} });
      }
    `;
    const children = Array.from({ length: writers }, (_, w) => {
      const child = spawn(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e', program, String(w)], {
        env: { ...process.env, PD_HOME: home },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (c) => { stderr += c; });
      return once(child, 'close').then(([code]) => ({ code, stderr }));
    });
    const results = await Promise.all(children);
    for (const r of results) expect(r).toMatchObject({ code: 0 });

    const body = readFileSync(join(home, 'DISTRESS'), 'utf8');
    const lines = body.split('\n');
    expect(lines.pop()).toBe(''); // file ends with exactly one newline
    expect(lines).toHaveLength(writers * perWriter);
    const shape = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z agent:w\\d{1,2} ROUTINE LISTENING seq=\\d{1,2} pad=${pad}$`);
    const seen = new Set<string>();
    for (const line of lines) {
      expect(line).toMatch(shape);
      const parsed = parseDistressLine(line);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) seen.add(`${parsed.record.id}:${parsed.record.fields.seq}`);
    }
    expect(seen.size).toBe(writers * perWriter);
    // Within one writer, its lines appear in program order (append order is
    // real time, and a writer's own writes are sequential).
    for (let w = 0; w < writers; w++) {
      const seqs = lines.filter((l) => l.includes(` agent:w${w} `)).map((l) => Number(/seq=(\d+)/.exec(l)![1]));
      expect(seqs).toEqual(Array.from({ length: perWriter }, (_, j) => j));
    }
  }, 120_000);
});

// ─── The halt sentinel ───────────────────────────────────────────────────────

describe('halt sentinel', () => {
  test('absent sentinel: haltActive false, readHalt null — and that is not an all-clear', () => {
    expect(haltActive({ cwd: repo })).toBe(false);
    expect(readHalt({ cwd: repo })).toBeNull();
  });

  test('writeHalt hoists the machine-wide flag with the SECURITE HALT line and appends it to the register', () => {
    const result = writeHalt({
      operator: 'erich', reason: 'spend-runaway', ref: 'docs/incidents/2026-09-05-port-daddy-halt.md',
      at: '2026-09-05T14:02:11Z', cwd: repo,
    });
    expect(result.line).toBe(ADR_EXAMPLES[0]);
    expect(result.paths).toEqual([join(home, 'HALT')]);
    expect(readFileSync(join(home, 'HALT'), 'utf8')).toBe(`${ADR_EXAMPLES[0]}\n`);
    expect(haltActive({ cwd: repo })).toBe(true);
    expect(haltActive({ cwd: scratch })).toBe(true);
    const halt = readHalt({ cwd: repo });
    expect(halt).toEqual({
      path: join(home, 'HALT'), scope: 'machine', source: 'sentinel', raw: ADR_EXAMPLES[0], at: '2026-09-05T14:02:11Z',
      record: expect.objectContaining({ kind: 'operator', id: 'erich', code: 'HALT' }),
    });
    expect(describeHalt(halt!)).toBe('Port Daddy is halted by operator:erich (SECURITE HALT 2026-09-05T14:02:11Z)');
    // The same line is on the register (machine-wide only: writeHalt defaults to scope machine).
    expect(readDistress({ cwd: repo }).map((r) => r.code)).toEqual(['HALT']);
    expect(existsSync(join(repo, '.portdaddy', 'DISTRESS'))).toBe(false);
  });

  test('writeHalt scope both also hoists the repo-scoped flag, and refuses repo scope outside a repo', () => {
    const result = writeHalt({ operator: 'erich', scope: 'both', cwd: join(repo, 'src'), at: '2026-09-05T14:02:11Z' });
    expect(result.paths).toEqual([join(home, 'HALT'), join(repo, '.portdaddy', 'HALT')]);
    expect(readDistress({ cwd: repo, scope: 'repo' })).toHaveLength(1);
    expect(() => writeHalt({ operator: 'erich', scope: 'repo', cwd: scratch })).toThrow(/outside a repository/);
    expect(() => writeHalt({ operator: 'e rich' })).toThrow(/operator id/);
  });

  test('the machine-wide sentinel is authoritative over a repo-scoped one; either alone halts', () => {
    mkdirSync(join(repo, '.portdaddy'), { recursive: true });
    writeFileSync(join(repo, '.portdaddy', 'HALT'), '2026-09-05T13:00:00Z operator:erich SECURITE HALT reason=repo-only\n');
    expect(haltActive({ cwd: repo })).toBe(true);
    expect(haltActive({ cwd: scratch })).toBe(false);
    expect(readHalt({ cwd: repo })).toMatchObject({ scope: 'repo', at: '2026-09-05T13:00:00Z' });

    writeHalt({ operator: 'erich', at: '2026-09-05T14:02:11Z', cwd: repo });
    expect(readHalt({ cwd: repo })).toMatchObject({ scope: 'machine', at: '2026-09-05T14:02:11Z' });
  });

  test('an empty or hand-written sentinel still halts; the instant falls back to the file mtime', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'HALT'), '');
    expect(haltActive()).toBe(true);
    const halt = readHalt({ cwd: scratch });
    expect(halt).toMatchObject({ scope: 'machine', raw: '', record: null });
    expect(halt!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(describeHalt(halt!)).toMatch(/^Port Daddy is halted by operator \(SECURITE HALT /);

    writeFileSync(join(home, 'HALT'), 'stopped by hand, see the runbook\n');
    expect(readHalt({ cwd: scratch })).toMatchObject({ record: null, raw: 'stopped by hand, see the runbook' });
  });

  test('a sentinel whose first line is some other record is halted but carries no HALT record', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'HALT'), `${ADR_EXAMPLES[1]}\n`);
    expect(readHalt({ cwd: scratch })).toMatchObject({ record: null, raw: ADR_EXAMPLES[1] });
  });

  // ─── ADR-0132 §4: absence is not all-clear ─────────────────────────────────

  test('deleting the sentinel does not lift a halt the register still carries; the deletion is journaled', () => {
    writeHalt({ operator: 'erich', at: '2026-09-05T14:02:11Z', cwd: repo });
    rmSync(join(home, 'HALT'));
    expect(existsSync(join(home, 'HALT'))).toBe(false);

    expect(haltActive({ cwd: repo })).toBe(true);
    expect(haltActive({ cwd: scratch })).toBe(true);
    const halt = readHalt({ cwd: scratch });
    expect(halt).toMatchObject({
      path: join(home, 'DISTRESS'), scope: 'machine', source: 'register', at: '2026-09-05T14:02:11Z',
      record: expect.objectContaining({ kind: 'operator', id: 'erich', code: 'HALT' }),
    });
    expect(describeHalt(halt!)).toBe('Port Daddy is halted by operator:erich (SECURITE HALT 2026-09-05T14:02:11Z)');
    // HALT_SENTINEL_MISSING lands in the register's own forensics dir under PD_HOME, never the operator's real home.
    const forensics = join(home, 'forensics');
    expect(existsSync(forensics)).toBe(true);
    const journal = readdirSync(forensics).map((f) => readFileSync(join(forensics, f), 'utf8')).join('');
    expect(journal).toMatch(/HALT_SENTINEL_MISSING/);
  });

  test('an unsigned or non-operator ALL-CLEAR leaves the halt in force; a verified operator ALL-CLEAR lifts it and removes a stale sentinel', () => {
    writeHalt({ operator: 'erich', at: '2026-09-05T14:02:11Z', cwd: repo });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    writeFileSync(join(home, 'operator-allclear.pub'), publicKey.export({ format: 'pem', type: 'spki' }).toString());

    appendFileSync(join(home, 'DISTRESS'), '2026-09-05T15:00:00Z agent:rogue SECURITE ALL-CLEAR ref=2026-09-05T14:02:11Z\n');
    expect(haltActive({ cwd: repo })).toBe(true);
    appendFileSync(join(home, 'DISTRESS'), '2026-09-05T15:00:01Z operator:erich SECURITE ALL-CLEAR ref=2026-09-05T14:02:11Z\n');
    expect(haltActive({ cwd: repo })).toBe(true);
    const forged = signAllClear({ haltTs: '2026-09-05T14:02:11Z', operatorId: 'erich', privateKey: generateKeyPairSync('ed25519').privateKey, ts: '2026-09-05T15:00:02Z' });
    appendFileSync(join(home, 'DISTRESS'), `${forged.line}\n`);
    expect(haltActive({ cwd: repo })).toBe(true);
    expect(existsSync(join(home, 'HALT'))).toBe(true);

    const signed = signAllClear({ haltTs: '2026-09-05T14:02:11Z', operatorId: 'erich', privateKey, ts: '2026-09-05T16:00:00Z' });
    // The operator's verifier path appends the line AND removes the sentinel; the
    // predicate itself is a read and never unlinks anything.
    const applied = applyAllClear(signed.line, { paths: defaultDistressPaths({ home }), publicKey, forensics: null });
    expect(applied.lifted).toBe(true);
    expect(existsSync(join(home, 'HALT'))).toBe(false);
    expect(haltActive({ cwd: repo })).toBe(false);
    expect(readHalt({ cwd: repo })).toBeNull();
    // A sentinel hoisted again by hand after the lift is a new halt, and the
    // predicate leaves it exactly where the operator put it.
    writeFileSync(join(home, 'HALT'), '');
    expect(readHalt({ cwd: repo })).toMatchObject({ source: 'sentinel', record: null });
    expect(haltActive({ cwd: repo })).toBe(true);
    expect(existsSync(join(home, 'HALT'))).toBe(true);
  });

  test('an unreadable register fails closed: "I cannot tell" is halted, never all-clear', () => {
    mkdirSync(join(home, 'DISTRESS'), { recursive: true }); // EISDIR on read
    expect(haltActive({ cwd: repo })).toBe(true);
    expect(readHalt({ cwd: repo })).toMatchObject({ source: 'unreadable', scope: 'machine', record: null });
  });

  test('there is deliberately no way to lower the halt from this module', async () => {
    const mod = await import('../../lib/distress.js');
    expect(Object.keys(mod).filter((k) => /clear|lower|lift|remove/i.test(k))).toEqual([]);
  });
});
