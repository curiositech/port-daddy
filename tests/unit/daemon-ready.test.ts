import { readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearDaemonReady,
  publishDaemonReady,
  readDaemonReadyPid,
} from '../../lib/daemon-ready.js';

const SANDBOX = join(process.cwd(), '.scratch', `daemon-ready-${process.pid}`);
const READY_FILE = join(SANDBOX, 'runtime', 'daemon.ready');

beforeEach(() => rmSync(SANDBOX, { recursive: true, force: true }));
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

describe('daemon readiness generation lease', () => {
  test('publishes an atomic private PID marker without temp residue', () => {
    publishDaemonReady(READY_FILE, 4242);

    expect(readDaemonReadyPid(READY_FILE)).toBe(4242);
    expect(readFileSync(READY_FILE, 'utf8')).toBe('4242\n');
    expect(statSync(READY_FILE).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(SANDBOX, 'runtime'))).toEqual(['daemon.ready']);
  });

  test('refuses a symlinked readiness lease instead of following it', () => {
    mkdirSync(join(SANDBOX, 'runtime'), { recursive: true });
    const target = join(SANDBOX, 'runtime', 'attacker-controlled');
    writeFileSync(target, '4242\n');
    symlinkSync(target, READY_FILE);

    expect(readDaemonReadyPid(READY_FILE)).toBeNull();
  });

  test('failed publication removes its private temporary file and publishes no lease', () => {
    mkdirSync(READY_FILE, { recursive: true });

    expect(() => publishDaemonReady(READY_FILE, 4242)).toThrow();
    expect(readDaemonReadyPid(READY_FILE)).toBeNull();
    expect(readdirSync(join(SANDBOX, 'runtime'))).toEqual(['daemon.ready']);
  });

  test.each(['', '0', '-1', '1.5', 'nope', '9007199254740992'])(
    'rejects malformed marker %j',
    (contents) => {
      mkdirSync(join(SANDBOX, 'runtime'), { recursive: true });
      writeFileSync(READY_FILE, contents);
      expect(readDaemonReadyPid(READY_FILE)).toBeNull();
    },
  );

  test('shutdown cleanup removes only its own generation', () => {
    publishDaemonReady(READY_FILE, 1001);

    expect(clearDaemonReady(READY_FILE, 1000)).toBe(false);
    expect(readDaemonReadyPid(READY_FILE)).toBe(1001);
    expect(readdirSync(join(SANDBOX, 'runtime'))).toEqual(['daemon.ready']);
    expect(clearDaemonReady(READY_FILE, 1001)).toBe(true);
    expect(readDaemonReadyPid(READY_FILE)).toBeNull();
  });

  test('startup cleanup removes stale or malformed readiness unconditionally', () => {
    publishDaemonReady(READY_FILE, 1001);
    expect(clearDaemonReady(READY_FILE)).toBe(true);

    mkdirSync(join(SANDBOX, 'runtime'), { recursive: true });
    writeFileSync(READY_FILE, 'partial');
    expect(clearDaemonReady(READY_FILE)).toBe(true);
    expect(clearDaemonReady(READY_FILE)).toBe(false);
  });

  test('refuses invalid publication PIDs', () => {
    expect(() => publishDaemonReady(READY_FILE, 0)).toThrow('Invalid daemon readiness PID');
    expect(() => publishDaemonReady(READY_FILE, Number.MAX_SAFE_INTEGER + 1)).toThrow('Invalid daemon readiness PID');
  });
});
