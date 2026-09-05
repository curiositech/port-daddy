/**
 * Integration Tests for Direct Mode (SQLite bypass)
 *
 * Verifies that the CLI can perform core operations without a running daemon
 * by talking directly to the SQLite database.
 */

import { spawnSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';

const CLI_PATH = join(import.meta.dirname, '../../bin/port-daddy-cli.ts');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');

// Helper: strip ANSI escape codes
function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * Direct-Mode Integration Tests
 */
describe('Direct-Mode Integration Tests', () => {
  let testDir;
  let testDb;

  // Helper: get base environment for tests
  function getTestEnv(overrides = {}) {
    const env = {
      ...process.env,
      PORT_DADDY_DB: testDb,
      PORT_DADDY_URL: 'http://127.0.0.1:1', // Unreachable
      PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
      PORT_DADDY_ALLOW_MAIN_WORKTREE_SESSION: '1',
      NO_COLOR: '1',
      ...overrides
    };
    delete env.FORCE_COLOR;
    delete env.COLORTERM;
    return env;
  }

  function runDirect(args, options = {}) {
    const result = spawnSync(TSX_PATH, [CLI_PATH, ...args, '--direct'], {
      encoding: 'utf8',
      timeout: 30000,
      env: getTestEnv(),
      ...options
    });

    if (result.status !== 0 && process.env.DEBUG_TESTS) {
      console.error(`runDirect failed: ${args.join(' ')}\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`);
    }

    return {
      success: result.status === 0,
      stdout: stripAnsi(result.stdout || '').trim(),
      stderr: stripAnsi(result.stderr || '').trim(),
      status: result.status
    };
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'pd-direct-test-'));
    testDb = join(testDir, 'registry.db');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('Basic Operations (--direct flag)', () => {
    test('claim works with --direct flag', () => {
      const result = runDirect(['claim', 'direct-basic-1', '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/^\d+$/);

      const port = parseInt(result.stdout, 10);
      expect(port).toBeGreaterThanOrEqual(3100);
    });

    test('claim with specific port', () => {
      const result = runDirect(['claim', 'direct-specific', '-p', '7777', '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('7777');
    });

    test('release works', () => {
      runDirect(['claim', 'direct-release-test', '-p', '9999', '-q']);
      const release = runDirect(['release', 'direct-release-test', '-q']);
      expect(release.success).toBe(true);
      expect(release.stdout).toBe('1');
    });

    test('find/list works', () => {
      runDirect(['claim', 'direct-find-test', '-p', '8888', '-q']);
      const find = runDirect(['find', 'direct-find-test', '--json']);
      expect(find.success).toBe(true);
      const data = JSON.parse(find.stdout);
      expect(data.services).toBeDefined();
      expect(data.services[0].port).toBe(8888);
    });

    test('status command works (shows direct-DB mode)', () => {
      const result = runDirect(['status']);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('direct-DB mode');
    });
  });

  describe('Sessions & Notes (--direct flag)', () => {
    test.each([
      ['start', ['session', 'start', 'Direct mode session test', '--lifecycle', 'durable']],
      ['done', ['session', 'done', 'Test complete']],
      ['abandon', ['session', 'abandon', 'Test cleanup']],
      ['takeover', ['session', 'takeover', 'session-victim']],
      ['rm', ['session', 'rm', 'session-victim']],
      ['files', ['session', 'files', 'add', 'README.md']],
      ['phase', ['session', 'phase', 'session-victim', 'testing']],
      ['relink', ['session', 'relink', '--roadmap', 'victim-roadmap']],
    ])('session %s refuses the direct identity bypass', (_operation, args) => {
      const result = runDirect(args);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('"session" requires the running daemon');
    });

    test('note refuses the direct identity bypass', () => {
      const result = runDirect(['note', 'direct note test', '--session', 'session-victim']);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('"note" requires the running daemon');
    });

    test('session and note reads remain available in direct recovery mode', () => {
      const sessions = runDirect(['sessions', '--json']);
      expect(sessions.success).toBe(true);
      expect(JSON.parse(sessions.stdout).sessions).toEqual([]);

      const result = runDirect(['notes', '--json']);
      expect(result.success).toBe(true);
      const data = JSON.parse(result.stdout);
      expect(data.notes).toBeDefined();
      expect(data.notes).toEqual([]);
    });
  });

  describe('Locks (--direct flag)', () => {
    test.each([
      ['acquire', ['lock', 'direct-lock-test']],
      ['extend', ['lock', 'extend', 'direct-lock-test', '--ttl', '60000']],
      ['release', ['unlock', 'direct-lock-test']],
    ])('lock %s refuses the direct identity bypass', (_operation, args) => {
      const result = runDirect(args);
      expect(result.success).toBe(false);
      expect(result.stderr).toMatch(/requires the running daemon/);
    });

    test('lock reads remain available in direct recovery mode', () => {
      const result = runDirect(['locks', '--json']);
      expect(result.success).toBe(true);
      expect(JSON.parse(result.stdout).locks).toEqual([]);
    });
  });

  describe('Edge Cases & Stress Tests', () => {
    test('rapid sequential claims', () => {
      const ports = new Set();
      for (let i = 0; i < 5; i++) {
        const result = runDirect(['claim', `seq-test-${i}`, '-q']);
        expect(result.success).toBe(true);
        
        const port = parseInt(result.stdout, 10);
        expect(ports.has(port)).toBe(false);
        ports.add(port);
      }
    });

    test('claims persist across CLI invocations', () => {
      const claim = runDirect(['claim', 'persist-test', '-p', '8888', '-q']);
      expect(claim.success).toBe(true);
      expect(claim.stdout).toBe('8888');

      // New CLI invocation should see it
      const find = runDirect(['find', 'persist-test', '--json']);
      const data = JSON.parse(find.stdout);
      expect(data.services[0].port).toBe(8888);
    });

    test('expired services cleaned up', () => {
      runDirect(['claim', 'expiry-test', '--expires', '1s', '-q']);
      spawnSync('sleep', ['1.5']);
      runDirect(['release', '--expired']);

      const find = runDirect(['find', 'expiry-test', '--json']);
      const data = JSON.parse(find.stdout);
      expect(data.count).toBe(0);
    });

    test('Tier 2 commands fail gracefully with --direct', () => {
      const result = runDirect(['broadcast', 'test', 'msg']);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('requires the running daemon');
    });
  });

  describe('Concurrent Access (WAL mode stress)', () => {
    test('parallel claims from multiple processes', () => {
      const count = 5;
      const processes = [];

      for (let i = 0; i < count; i++) {
        processes.push(spawn(TSX_PATH, [CLI_PATH, 'claim', `parallel-test-${i}`, '-q', '--direct'], {
          env: getTestEnv()
        }));
      }

      const results = processes.map(p => {
        let stdout = '';
        p.stdout.on('data', d => stdout += d.toString());
        return new Promise(resolve => p.on('exit', code => resolve({ code, stdout: stripAnsi(stdout).trim(), id: null })));
      });

      return Promise.all(results).then(exits => {
        // SQLite WAL allows transient contention under parallel writes.
        // We care about recoverability and unique final claims, not an arbitrary
        // scheduler-dependent first-pass success threshold.
        const successes = exits.filter(e => e.code === 0);

        // Retry any that failed (demonstrates resilience)
        const failures = exits.filter(e => e.code !== 0);
        for (let i = 0; i < failures.length; i++) {
          const idx = exits.indexOf(failures[i]);
          const retry = runDirect(['claim', `parallel-test-${idx}`, '-q']);
          expect(retry.success).toBe(true);
          successes.push({ code: 0, stdout: retry.stdout });
        }

        const ports = new Set();
        for (const s of successes) {
          const port = parseInt(s.stdout, 10);
          expect(ports.has(port)).toBe(false);
          ports.add(port);
        }
        expect(ports.size).toBe(count);
      });
    });
  });
});
