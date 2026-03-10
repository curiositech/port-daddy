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

  describe('Dashboard Terminal Command Parity', () => {
    let html, dashboardCommands, cliOnlyCommands;

    const knownCliCommands = [
      'claim', 'release', 'find', 'ps', 'url', 'env',
      'pub', 'sub', 'wait', 'lock', 'unlock', 'locks',
      'up', 'down',
      'scan', 'projects',
      'agent', 'agents',
      'log', 'activity',
      'start', 'stop', 'restart', 'status',
      'install', 'uninstall', 'dev', 'ci-gate',
      'doctor', 'version', 'help'
    ];

    beforeAll(() => {
      html = readFileSync(join(import.meta.dirname, '../../public/index.html'), 'utf8');

      // Parse COMMANDS — supports both old object format and new array format
      const oldStart = html.indexOf('var COMMANDS = {');
      if (oldStart !== -1) {
        let depth = 0;
        let end = oldStart;
        for (let i = oldStart; i < html.length; i++) {
          if (html[i] === '{') depth++;
          if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        const block = html.slice(oldStart, end + 1);
        const keyMatches = block.match(/^\s+(\w+)\s*:/gm);
        dashboardCommands = keyMatches
          ? keyMatches.map(m => m.trim().replace(/:$/, ''))
          : [];
      } else {
        // New array format: var COMMANDS=[{cmd:'claim',...},...]
        const arrayStart = html.indexOf('var COMMANDS = [');
        if (arrayStart !== -1) {
          let depth = 0, end = arrayStart;
          for (let i = arrayStart; i < html.length; i++) {
            if (html[i] === '[') depth++;
            if (html[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
          }
          const block = html.slice(arrayStart, end + 1);
          const cmdMatches = block.match(/cmd\s*:\s*'([^']+)'/g);
          dashboardCommands = cmdMatches
            ? cmdMatches.map(m => m.replace(/cmd\s*:\s*'/, '').replace(/'$/, ''))
            : [];
        }
      }

      const cliOnlyMatch = html.match(/(?:const|var)\s+CLI_ONLY\s*=\s*\[([^\]]+)\]/);
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
      const exceptions = ['sub', 'wait', 'url', 'env', 'agent', 'version'];
      const missing = knownCliCommands.filter(cmd =>
        !covered.has(cmd) && !exceptions.includes(cmd)
      );
      expect(missing).toEqual([]);
    });

    test('CLI_ONLY and COMMANDS do not overlap', () => {
      const overlap = cliOnlyCommands.filter(cmd => dashboardCommands.includes(cmd));
      expect(overlap).toEqual([]);
    });

    test('CLI-only commands get a helpful message, not "Unknown command"', () => {
      // Verify dashboard HTML directly — no HTTP request needed (ephemeral daemon may be socket-only)
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

  describe('Bug Regression Tests', () => {
    // Bug #1: Channels CLI was showing "-" for all channel names
    // because it expected { name, messageCount, subscriberCount }
    // but API returns { channel, count, lastMessage }
    test('channels command shows actual channel names (not dashes)', () => {
      // First publish a message to create a channel
      const testChannel = `test-channel-bug1-${Date.now()}`;
      runCli(['pub', testChannel, '{"test": true}']);

      const result = runCli(['channels', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.channels).toBeDefined();
      const ourChannel = data.channels.find(c => c.channel === testChannel);
      expect(ourChannel).toBeDefined();
      expect(ourChannel.channel).toBe(testChannel);
      expect(ourChannel.count).toBe(1);

      // Also test non-JSON output doesn't show dashes for names
      const textResult = runCli(['channels']);
      expect(textResult.success).toBe(true);
      expect(textResult.stdout).toContain(testChannel);
      expect(textResult.stdout).not.toMatch(/^-\s+\d+/m); // No lines starting with "- " followed by numbers
    });

    // Bug #2: Session start was showing "undefined" for session ID
    // because CLI used data.sessionId but API returns data.id
    test('session start shows actual session ID (not undefined)', () => {
      const result = runCli(['session', 'start', 'Bug regression test']);
      expect(result.success).toBe(true);
      expect(result.stdout).not.toContain('undefined');
      expect(result.stdout).toMatch(/session-[a-f0-9-]+/);

      // Also test -q returns just the ID
      const quietResult = runCli(['session', 'start', 'Quiet test', '-q']);
      expect(quietResult.success).toBe(true);
      expect(quietResult.stdout).toMatch(/^session-[a-f0-9-]+$/);
      expect(quietResult.stdout).not.toBe('undefined');
    });

    // Bug #3: Sessions list was showing "undefinedundefinedNaNd"
    // because CLI expected { startedAt, fileCount, noteCount }
    // but API returns { createdAt, updatedAt, completedAt }
    test('sessions list shows proper values (not undefined/NaN)', () => {
      const result = runCli(['sessions', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.sessions).toBeDefined();
      for (const session of data.sessions) {
        expect(session.createdAt).toBeDefined();
        expect(typeof session.createdAt).toBe('number');
      }

      // Non-JSON output should not contain undefined or NaN
      const textResult = runCli(['sessions']);
      expect(textResult.success).toBe(true);
      expect(textResult.stdout).not.toContain('undefined');
      expect(textResult.stdout).not.toContain('NaN');
    });

    // Bug #7/8: "pd services" was accidentally claiming a service named "services"
    // instead of listing services
    test('"services" command lists services (does not claim)', () => {
      // Run "services" command
      const result = runCli(['services', '--json']);
      expect(result.success).toBe(true);

      // Should return a list, not a claim response
      const data = JSON.parse(result.stdout);
      expect(data.services).toBeDefined();
      expect(data.count).toBeDefined();

      // The bug was that "services" would claim a service named "services"
      // This is the key assertion - no service named "services" should exist
      expect(data.services.some(s => s.id === 'services')).toBe(false);
    });

    // Bug #14: Embedded wildcard in pattern not converted to SQL %
    // "pd release 'test-prefix*'" released 0 services because 'test-prefix*'
    // was passed to SQL LIKE as-is (should be 'test-prefix%')
    test('wildcard pattern releases services (not literal asterisk)', () => {
      // Create several services with a prefix
      const prefix = `bug14-test-${Date.now()}`;
      runCli(['claim', `${prefix}-a`, '-q']);
      runCli(['claim', `${prefix}-b`, '-q']);
      runCli(['claim', `${prefix}-c`, '-q']);

      // Verify they exist
      const findBefore = runCli(['find', '--json']);
      const beforeData = JSON.parse(findBefore.stdout);
      const beforeCount = beforeData.services.filter(s => s.id.startsWith(prefix)).length;
      expect(beforeCount).toBe(3);

      // Release with wildcard pattern
      const result = runCli(['release', `${prefix}*`, '--json']);
      expect(result.success).toBe(true);
      const data = JSON.parse(result.stdout);
      expect(data.released).toBe(3);

      // Verify they're gone
      const findAfter = runCli(['find', '--json']);
      const afterData = JSON.parse(findAfter.stdout);
      const afterCount = afterData.services.filter(s => s.id.startsWith(prefix)).length;
      expect(afterCount).toBe(0);
    });

    // Bug #15: session start --json ignored --json flag, output human-readable
    test('session start --json outputs JSON (not colored text)', () => {
      const result = runCli(['session', 'start', 'Bug 15 test', '--json']);
      expect(result.success).toBe(true);

      // Should be valid JSON
      let data;
      expect(() => { data = JSON.parse(result.stdout); }).not.toThrow();
      expect(data.success).toBe(true);
      expect(data.id).toMatch(/^session-[a-f0-9-]+$/);
      expect(data.purpose).toBe('Bug 15 test');

      // Should NOT contain ANSI escape codes
      expect(result.stdout).not.toMatch(/\x1b\[/);

      // Cleanup
      runCli(['session', 'rm', data.id]);
    });

    // Bug #11: Channels LAST ACTIVITY showed "20508d" because relativeTime()
    // was passed a timestamp instead of a duration (Date.now() - timestamp)
    test('channels LAST ACTIVITY shows reasonable relative time (not 20000+ days)', () => {
      // Create a channel by publishing a message
      const testChannel = `bug11-test-${Date.now()}`;
      runCli(['pub', testChannel, '{"test": true}']);

      const result = runCli(['channels']);
      expect(result.success).toBe(true);

      // Should NOT contain five-digit day counts like "20508d"
      expect(result.stdout).not.toMatch(/\d{5,}d/);

      // Our just-created channel should show recent time (seconds or minutes)
      expect(result.stdout).toContain(testChannel);
    });

    // Bug #12: sessions --all returned same results as sessions without --all
    // because list() defaulted to listActive when no status was passed
    test('sessions --all shows all statuses (not just active)', () => {
      // Create sessions with different statuses
      const activeId = runCli(['session', 'start', 'Bug 12 active test', '-q']).stdout.trim();
      const completedId = runCli(['session', 'start', 'Bug 12 completed test', '-q']).stdout.trim();
      runCli(['session', 'done', 'Done', '-q']); // completes most recent
      const abandonedId = runCli(['session', 'start', 'Bug 12 abandoned test', '-q']).stdout.trim();
      runCli(['session', 'abandon', 'Abandoned', '-q']);

      // Without --all: should only show active sessions
      const activeOnly = runCli(['sessions', '--json']);
      const activeData = JSON.parse(activeOnly.stdout);
      expect(activeData.sessions.every(s => s.status === 'active')).toBe(true);

      // With --all: should show all statuses
      const allSessions = runCli(['sessions', '--all', '--json']);
      const allData = JSON.parse(allSessions.stdout);
      const statuses = new Set(allData.sessions.map(s => s.status));
      expect(statuses.has('completed')).toBe(true);
      expect(statuses.has('abandoned')).toBe(true);

      // Cleanup
      runCli(['session', 'rm', activeId]);
      runCli(['session', 'rm', completedId]);
      runCli(['session', 'rm', abandonedId]);
    });
  });

  // =========================================================================
  // Flag Alternatives (v3.6)
  // =========================================================================
  describe('Flag Alternatives (v3.6)', () => {
    test('pd begin --purpose works as flag alternative to positional', () => {
      const result = runCli(['begin', '--purpose', 'Flag alternative test', '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toBeTruthy(); // agent ID in quiet mode

      // Cleanup
      const agentId = result.stdout.trim();
      runCli(['done', '--agent', agentId]);
    });

    test('pd begin -P works as short flag', () => {
      const result = runCli(['begin', '-P', 'Short flag test', '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toBeTruthy();

      const agentId = result.stdout.trim();
      runCli(['done', '--agent', agentId]);
    });

    test('pd begin --purpose --identity --type all work together', () => {
      const result = runCli([
        'begin',
        '--purpose', 'Multi-flag test',
        '--identity', 'test:cli:flags',
        '--type', 'cli',
        '--json',
      ]);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.purpose).toBe('Multi-flag test');
      expect(data.identity).toBe('test:cli:flags');

      // Cleanup
      runCli(['done', '--agent', data.agentId]);
    });

    test('pd done --note works as flag alternative', () => {
      const beginResult = runCli(['begin', '-P', 'Done flag test', '-q']);
      const agentId = beginResult.stdout.trim();

      const result = runCli(['done', '--note', 'Finished via flag', '--agent', agentId, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.finalNote).toBe(true);
    });

    test('pd done -n works as short flag for note', () => {
      const beginResult = runCli(['begin', '-P', 'Done short flag test', '-q']);
      const agentId = beginResult.stdout.trim();

      const result = runCli(['done', '-n', 'Short flag note', '--agent', agentId, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
    });

    test('pd done --status works as flag alternative', () => {
      const beginResult = runCli(['begin', '-P', 'Status flag test', '-q']);
      const agentId = beginResult.stdout.trim();

      const result = runCli(['done', '--status', 'abandoned', '--agent', agentId, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.sessionStatus).toBe('abandoned');
    });

    test('pd session start --purpose works as flag alternative', () => {
      const result = runCli(['session', 'start', '--purpose', 'Session flag test', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.purpose).toBe('Session flag test');

      // Cleanup
      runCli(['session', 'rm', data.id]);
    });

    test('pd note --content works as flag alternative', () => {
      // Start a session first
      const sessionResult = runCli(['session', 'start', 'Note flag test', '--json']);
      const sessionData = JSON.parse(sessionResult.stdout);

      const result = runCli(['note', '--content', 'Flag note content', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);

      // Cleanup
      runCli(['session', 'rm', sessionData.id]);
    });

    test('pd note -c works as short flag for content', () => {
      const sessionResult = runCli(['session', 'start', 'Short note test', '--json']);
      const sessionData = JSON.parse(sessionResult.stdout);

      const result = runCli(['note', '-c', 'Short flag content', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);

      runCli(['session', 'rm', sessionData.id]);
    });

    test('positional args still work (backward compat)', () => {
      // Positional purpose
      const result = runCli(['begin', 'Positional purpose', '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toBeTruthy();

      const agentId = result.stdout.trim();

      // Positional note on done
      const doneResult = runCli(['done', 'Positional note', '--agent', agentId, '--json']);
      expect(doneResult.success).toBe(true);

      const data = JSON.parse(doneResult.stdout);
      expect(data.success).toBe(true);
    });

    test('non-interactive mode shows usage when no args', () => {
      // Without TTY, CLI should show usage and fail (not hang waiting for input)
      // runCli spawns without a TTY, so canPrompt() returns false
      const result = runCli(['begin']);
      // Should fail with usage info, not hang waiting for input
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Usage');
    });
  });

  describe('Unknown Command Handling', () => {
    test('unknown command shows error', () => {
      const result = runCli(['boguscmd']);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Unknown command');
    });

    test('misspelled command suggests correction', () => {
      const result = runCli(['cliam']); // close to "claim"
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Did you mean');
    });

    test('semantic identity (with colon) still claims a port', () => {
      const id = `test:unknown-dispatch:${Date.now()}`;
      const result = runCli([id, '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toMatch(/^\d+$/);
      // Cleanup
      runCli(['release', id]);
    });

    test('bare word without colon does NOT claim a port', () => {
      const result = runCli(['notacommand']);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Unknown command');
    });
  });
});
