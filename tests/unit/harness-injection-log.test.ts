/**
 * Harness-injection log — focused unit tests (ch.28 §28.5).
 *
 * Verifies the ONE shared appender emits a valid JSONL `context_injected` line
 * with correct fields, byte count, and sha256, and that it is fail-open (a bad
 * path never throws into the hook/injection call path).
 *
 * Hermetic: every write targets an injected temp path (rec.logPath), so no real
 * ~/.port-daddy write ever happens. The temp dir lives under ~/coding/tmp
 * (NEVER /tmp — macOS purges /tmp).
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  logInjection,
  detectRuntime,
  pdHome,
  harnessInjectionLogPath,
  type InjectionLogLine,
} from '../../lib/harness-injection-log.js';

let tmpDir: string;

beforeAll(() => {
  // ~/coding/tmp is disposable-but-durable (not swept like /tmp).
  const base = join(homedir(), 'coding', 'tmp');
  tmpDir = mkdtempSync(join(base, 'hil-test-'));
});

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function readLines(path: string): InjectionLogLine[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as InjectionLogLine);
}

describe('harness-injection-log', () => {
  test('appends a valid JSONL line with correct fields, bytes, and sha256', () => {
    const logPath = join(tmpDir, 'a.jsonl');
    const payload = 'STEERING BLOB — inject me\nwith unicode ⚓ and 日本語';
    const line = logInjection({
      source: 'sessionstart-pilot',
      runtime: 'claude',
      payload,
      sessionId: 'sess-123',
      agentId: 'actor-abc',
      turnHint: 'turn:7',
      logPath,
    });

    expect(line).not.toBeNull();
    const written = readLines(logPath);
    expect(written).toHaveLength(1);
    const rec = written[0];

    // Field shape + values.
    expect(rec.source).toBe('sessionstart-pilot');
    expect(rec.runtime).toBe('claude');
    expect(rec.sessionId).toBe('sess-123');
    expect(rec.agentId).toBe('actor-abc');
    expect(rec.turnHint).toBe('turn:7');
    expect(typeof rec.ts).toBe('string');
    expect(() => new Date(rec.ts).toISOString()).not.toThrow();

    // Byte count = UTF-8 length (multi-byte chars > char count).
    const expectedBytes = Buffer.byteLength(payload, 'utf8');
    expect(rec.bytes).toBe(expectedBytes);
    expect(rec.bytes).toBeGreaterThan(payload.length); // multibyte present

    // sha256 = hex hash of the payload; payload itself is NOT stored.
    const expectedSha = createHash('sha256').update(payload, 'utf8').digest('hex');
    expect(rec.sha256).toBe(expectedSha);
    expect(rec.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rec)).not.toContain('inject me'); // light: no payload
  });

  test('the returned line equals what was persisted', () => {
    const logPath = join(tmpDir, 'roundtrip.jsonl');
    const line = logInjection({ source: 'ink-cloud', payload: 'block', logPath });
    expect(line).not.toBeNull();
    expect(readLines(logPath)[0]).toEqual(line);
  });

  test('appends (does not overwrite) across multiple calls', () => {
    const logPath = join(tmpDir, 'multi.jsonl');
    logInjection({ source: 'matrix-envelope', payload: 'one', logPath });
    logInjection({ source: 'ink-cloud', payload: 'two', logPath });
    logInjection({ source: 'sessionstart-pilot', payload: 'three', logPath });
    const lines = readLines(logPath);
    expect(lines.map((l) => l.source)).toEqual([
      'matrix-envelope',
      'ink-cloud',
      'sessionstart-pilot',
    ]);
  });

  test('empty-string payload records a real line with 0 bytes and the empty-string hash', () => {
    const logPath = join(tmpDir, 'empty.jsonl');
    const line = logInjection({ source: 'other', payload: '', logPath });
    expect(line).not.toBeNull();
    expect(line!.bytes).toBe(0);
    // sha256("") is the well-known constant.
    expect(line!.sha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('omits optional discriminators when not supplied (compact lines)', () => {
    const logPath = join(tmpDir, 'compact.jsonl');
    logInjection({ source: 'ink-cloud', runtime: 'codex', payload: 'x', logPath });
    const rec = readLines(logPath)[0];
    expect(rec).not.toHaveProperty('sessionId');
    expect(rec).not.toHaveProperty('agentId');
    expect(rec).not.toHaveProperty('turnHint');
  });

  test('FAIL-OPEN: an unwritable path returns null and does NOT throw', () => {
    // A path whose parent is a file (not a dir) cannot be created/written.
    const fileNotDir = join(tmpDir, 'iamafile.jsonl');
    logInjection({ source: 'other', payload: 'seed', logPath: fileNotDir }); // makes it a file
    const badPath = join(fileNotDir, 'nested', 'cannot.jsonl'); // parent is a file
    let result: InjectionLogLine | null | undefined;
    expect(() => {
      result = logInjection({ source: 'other', payload: 'boom', logPath: badPath });
    }).not.toThrow();
    expect(result).toBeNull();
  });

  test('FAIL-OPEN: a non-string payload is coerced and still does not throw', () => {
    const logPath = join(tmpDir, 'coerce.jsonl');
    let result: InjectionLogLine | null | undefined;
    expect(() => {
      // @ts-expect-error — deliberately wrong type to prove hardening
      result = logInjection({ source: 'other', payload: { not: 'a string' }, logPath });
    }).not.toThrow();
    expect(result).not.toBeNull();
    expect(result!.bytes).toBeGreaterThan(0);
  });

  test('detectRuntime reads structured env signals, falling back to unknown', () => {
    expect(detectRuntime({ CLAUDECODE: '1' } as NodeJS.ProcessEnv)).toBe('claude');
    expect(detectRuntime({ CODEX_HOME: '/x' } as NodeJS.ProcessEnv)).toBe('codex');
    expect(detectRuntime({ GEMINI_CLI: '1' } as NodeJS.ProcessEnv)).toBe('gemini');
    expect(detectRuntime({ AGY: '1' } as NodeJS.ProcessEnv)).toBe('agy');
    expect(detectRuntime({ PD_RUNTIME: 'gemini' } as NodeJS.ProcessEnv)).toBe('gemini');
    expect(detectRuntime({} as NodeJS.ProcessEnv)).toBe('unknown');
  });

  test('path resolution honors PD_HOME and PD_HARNESS_INJECTION_LOG', () => {
    const prevHome = process.env.PD_HOME;
    const prevLog = process.env.PD_HARNESS_INJECTION_LOG;
    try {
      delete process.env.PD_HARNESS_INJECTION_LOG;
      process.env.PD_HOME = '/some/durable/root';
      expect(pdHome()).toBe('/some/durable/root');
      expect(harnessInjectionLogPath()).toBe('/some/durable/root/harness-injections.jsonl');

      process.env.PD_HARNESS_INJECTION_LOG = '/explicit/file.jsonl';
      expect(harnessInjectionLogPath()).toBe('/explicit/file.jsonl');
    } finally {
      if (prevHome === undefined) delete process.env.PD_HOME;
      else process.env.PD_HOME = prevHome;
      if (prevLog === undefined) delete process.env.PD_HARNESS_INJECTION_LOG;
      else process.env.PD_HARNESS_INJECTION_LOG = prevLog;
    }
  });
});
