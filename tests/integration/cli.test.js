/**
 * CLI Integration Tests
 *
 * These tests run the actual CLI against an ephemeral test daemon.
 * No pre-running daemon required — the daemon is started automatically
 * by Jest globalSetup and cleaned up by globalTeardown.
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { request, runCli, getDaemonState } from '../helpers/integration-setup.js';

describe('CLI Integration Tests', () => {
  test('ephemeral daemon is running', async () => {
    const state = getDaemonState();
    expect(state.sockPath).toBeDefined();

    const res = await request('/health');
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe('ok');
  });

  describe('Stale Daemon Detection', () => {
    test('daemon exposes code hash in /version', async () => {
      const res = await request('/version');
      expect(res.ok).toBe(true);
      expect(res.data.codeHash).toBeDefined();
      expect(res.data.codeHash).toMatch(/^[a-f0-9]{12}$/);
      expect(res.data.startedAt).toBeDefined();
    });

    test('CLI status command works', () => {
      const result = runCli(['status']);
      expect(result.success).toBe(true);
    });
  });

  describe('Service Commands', () => {
    const testId = `test-cli-${Date.now()}`;

    afterAll(() => {
      runCli(['release', testId]);
    });

    test('claim returns a port', () => {
      const result = runCli(['claim', testId, '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/^\d+$/);

      const port = parseInt(result.stdout, 10);
      expect(port).toBeGreaterThanOrEqual(3100);
      expect(port).toBeLessThanOrEqual(9999);
    });

    test('find shows claimed service', () => {
      const result = runCli(['find', testId, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.count).toBeGreaterThan(0);
      expect(data.services.some(s => s.id === testId)).toBe(true);
    });

    test('release removes service', () => {
      const result = runCli(['release', testId]);
      expect(result.success).toBe(true);

      const findResult = runCli(['find', testId, '--json']);
      const data = JSON.parse(findResult.stdout);
      expect(data.services.some(s => s.id === testId)).toBe(false);
    });
  });

  describe('Lock Commands', () => {
    const testLock = `test-lock-${Date.now()}`;

    afterAll(() => {
      runCli(['unlock', testLock, '--force']);
    });

    test('lock acquires successfully', () => {
      const result = runCli(['lock', testLock]);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Acquired lock');
    });

    test('second lock fails with conflict', () => {
      const result = runCli(['lock', testLock]);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('held by');
    });

    test('locks shows active lock', () => {
      const result = runCli(['locks', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.locks.some(l => l.name === testLock)).toBe(true);
    });

    test('unlock releases lock', () => {
      const result = runCli(['unlock', testLock]);
      expect(result.success).toBe(true);

      // Verify we can acquire again
      const lockResult = runCli(['lock', testLock]);
      expect(lockResult.success).toBe(true);

      // Cleanup
      runCli(['unlock', testLock]);
    });
  });

  describe('Detect Command', () => {
    test('detect runs without error', () => {
      const result = runCli(['detect']);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Detected');
    });

    test('detect --json returns valid JSON', () => {
      const result = runCli(['detect', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.suggestedIdentity).toBeDefined();
    });
  });

  describe('Pub/Sub Commands', () => {
    const testChannel = `test-channel-${Date.now()}`;

    test('pub publishes message', () => {
      const result = runCli(['pub', testChannel, '{"test":true}']);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Published');
    });
  });

  describe('Scan Command', () => {
    test('scan runs against project directory', () => {
      const result = runCli(['scan', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.serviceCount).toBeGreaterThan(0);
      expect(data.project).toBeDefined();
      expect(data.guidance).toBeDefined();
    });

    test('scan --dry-run does not save config', () => {
      const result = runCli(['scan', '--dry-run', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.dryRun).toBe(true);
    });
  });

  describe('Projects Command', () => {
    test('projects lists registered projects', () => {
      const result = runCli(['projects', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.projects)).toBe(true);
    });
  });

  describe('Deprecation Notices', () => {
    test('detect shows deprecation notice on stderr', () => {
      const result = runCli(['detect']);
      expect(result.success).toBe(true);
      expect(result.stderr).toContain('deprecated');
      expect(result.stderr).toContain('scan');
    });

    test('init shows deprecation notice on stderr', () => {
      const result = runCli(['init', '--dry-run']);
      expect(result.success).toBe(true);
      expect(result.stderr).toContain('deprecated');
      expect(result.stderr).toContain('scan');
    });
  });

  describe('Dashboard Terminal Command Parity', () => {
    let html, dashboardCommands, cliOnlyCommands;

    const knownCliCommands = [
      'claim', 'release', 'find', 'ps', 'url', 'env',
      'pub', 'sub', 'wait', 'lock', 'unlock', 'locks',
      'up', 'down',
      'scan', 'projects',
      'detect', 'init',
      'agent', 'agents',
      'log', 'activity',
      'start', 'stop', 'restart', 'status',
      'install', 'uninstall', 'dev', 'ci-gate',
      'doctor', 'version', 'help'
    ];

    beforeAll(() => {
      html = readFileSync(join(import.meta.dirname, '../../public/index.html'), 'utf8');

      const commandsStart = html.indexOf('var COMMANDS = {');
      if (commandsStart !== -1) {
        let depth = 0;
        let end = commandsStart;
        for (let i = commandsStart; i < html.length; i++) {
          if (html[i] === '{') depth++;
          if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        const block = html.slice(commandsStart, end + 1);
        const keyMatches = block.match(/^\s+(\w+)\s*:/gm);
        dashboardCommands = keyMatches
          ? keyMatches.map(m => m.trim().replace(/:$/, ''))
          : [];
      }

      const cliOnlyMatch = html.match(/var CLI_ONLY\s*=\s*\[([^\]]+)\]/);
      cliOnlyCommands = cliOnlyMatch
        ? cliOnlyMatch[1].match(/'(\w[\w-]*)'/g).map(m => m.replace(/'/g, ''))
        : [];
    });

    test('dashboard COMMANDS object is not empty', () => {
      expect(dashboardCommands.length).toBeGreaterThan(5);
    });

    test('dashboard CLI_ONLY array is not empty', () => {
      expect(cliOnlyCommands.length).toBeGreaterThan(3);
    });

    test('every known CLI command is either in COMMANDS or CLI_ONLY', () => {
      const covered = new Set([...dashboardCommands, ...cliOnlyCommands]);
      const exceptions = ['sub', 'wait', 'url', 'env', 'agent', 'version', 'init'];
      const missing = knownCliCommands.filter(cmd =>
        !covered.has(cmd) && !exceptions.includes(cmd)
      );
      expect(missing).toEqual([]);
    });

    test('CLI_ONLY and COMMANDS do not overlap', () => {
      const overlap = cliOnlyCommands.filter(cmd => dashboardCommands.includes(cmd));
      expect(overlap).toEqual([]);
    });

    test('CLI-only commands get a helpful message, not "Unknown command"', async () => {
      const res = await request('/');
      expect(res.ok).toBe(true);
      expect(html).toContain('is a CLI-only command');
      expect(html).toContain('Run it in your terminal');
    });
  });

  describe('CLI Syntactic Sugar', () => {
    const aliasId = `test-alias-${Date.now()}`;

    afterAll(() => {
      runCli(['release', aliasId]);
    });

    test('single-letter alias "c" works for claim', () => {
      const result = runCli(['c', aliasId, '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/^\d+$/);
    });

    test('single-letter alias "f" works for find', () => {
      const result = runCli(['f', aliasId, '--json']);
      expect(result.success).toBe(true);
      const data = JSON.parse(result.stdout);
      expect(data.services.some(s => s.id === aliasId)).toBe(true);
    });

    test('single-letter alias "r" works for release', () => {
      // Claim first, then release with alias
      const claimId = `alias-release-${Date.now()}`;
      runCli(['claim', claimId, '-q']);
      const result = runCli(['r', claimId]);
      expect(result.success).toBe(true);
    });

    test('single-letter alias "l" works for list', () => {
      const result = runCli(['l', '--json']);
      expect(result.success).toBe(true);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty('count');
      expect(data).toHaveProperty('services');
    });

    test('single-letter alias "s" works for scan', () => {
      const result = runCli(['s', '--dry-run', '--json']);
      expect(result.success).toBe(true);
    });

    test('single-letter alias "p" works for projects', () => {
      const result = runCli(['p', '--json']);
      expect(result.success).toBe(true);
    });

    test('--export flag prints export statement', () => {
      const exportId = `test-export-${Date.now()}`;
      const result = runCli(['claim', exportId, '--export']);
      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/^export PORT=\d+$/);
      // Cleanup
      runCli(['release', exportId]);
    });

    test('--export flag works with alias', () => {
      const exportId = `test-export-alias-${Date.now()}`;
      const result = runCli(['c', exportId, '--export']);
      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/^export PORT=\d+$/);
      runCli(['release', exportId]);
    });

    test('pipe-friendly: -q outputs only port number', () => {
      const quietId = `test-quiet-${Date.now()}`;
      const result = runCli(['claim', quietId, '-q']);
      expect(result.success).toBe(true);
      // Should be just the port number, nothing else
      expect(result.stdout).toMatch(/^\d+$/);
      expect(result.stderr).toBe('');
      runCli(['release', quietId]);
    });
  });
});
