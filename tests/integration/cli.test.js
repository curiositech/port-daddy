/**
 * CLI Integration Tests
 *
 * These tests run the actual CLI against an ephemeral test daemon.
 * No pre-running daemon required — the daemon is started automatically
 * by Jest globalSetup and cleaned up by globalTeardown.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  clearTestCurrentContext,
  getDaemonState,
  request,
  runCli,
  runCliViaIpc,
  writeTestCurrentContext,
} from '../helpers/integration-setup.js';

async function requestWithRetry(path, options = {}, attempts = 3) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await request(path, options);
      if (response?.aborted === true && index < attempts - 1) {
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code !== 'EPIPE' && code !== 'ECONNRESET') throw error;
    }
  }
  throw lastError;
}

describe('CLI Integration Tests', () => {
  const repoRoot = join(import.meta.dirname, '../..');
  const defaultContextSlot = `ppid-${process.pid}`;

  afterEach(() => {
    clearTestCurrentContext(defaultContextSlot);
  });

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
      expect(result.stdout.trim()).toMatch(/^\d+$/);

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
    const ipcFilepathLock = `/tmp/test-lock-ipc-${Date.now()}.ts`;

    afterAll(() => {
      runCli(['unlock', testLock, '--force']);
      runCliViaIpc(['unlock', ipcFilepathLock, '--owner', 'ipc-owner-a', '--force']);
      runCliViaIpc(['unlock', ipcFilepathLock, '--owner', 'ipc-owner-b', '--force']);
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

    test('with-lock runs command and releases lock afterward', () => {
      const nestedLock = `${testLock}-with-lock`;
      const tempDir = mkdtempSync(join(tmpdir(), 'pd-with-lock-'));
      const scriptPath = join(tempDir, 'inside-lock.js');
      writeFileSync(scriptPath, 'process.stdout.write("inside-lock")');

      try {
        const result = runCli(['with-lock', nestedLock, 'node', scriptPath]);
        expect(result.success).toBe(true);
        expect(result.stdout).toContain('inside-lock');

        const reacquire = runCli(['lock', nestedLock]);
        expect(reacquire.success).toBe(true);

        runCli(['unlock', nestedLock]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('with-lock preserves args after bare -- for the child command', () => {
      const nestedLock = `${testLock}-with-lock-separator`;
      const tempDir = mkdtempSync(join(tmpdir(), 'pd-with-lock-separator-'));
      const scriptPath = join(tempDir, 'argv-inspector.js');
      writeFileSync(
        scriptPath,
        'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
      );

      try {
        const result = runCli([
          'with-lock',
          nestedLock,
          '--',
          'node',
          scriptPath,
          '--json',
          '--quiet',
        ]);
        expect(result.success).toBe(true);
        expect(JSON.parse(result.stdout)).toEqual(['--json', '--quiet']);

        const reacquire = runCli(['lock', nestedLock]);
        expect(reacquire.success).toBe(true);

        runCli(['unlock', nestedLock]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('IPC lock keeps filepath locks held across command invocations', () => {
      const first = runCliViaIpc(['lock', ipcFilepathLock, '--owner', 'ipc-owner-a', '--json']);
      expect(first.success).toBe(true);
      expect(JSON.parse(first.stdout)).toMatchObject({
        success: true,
        name: ipcFilepathLock,
        owner: 'ipc-owner-a'
      });

      const second = runCliViaIpc(['lock', ipcFilepathLock, '--owner', 'ipc-owner-b', '--json']);
      expect(second.success).toBe(false);
      expect(second.stderr).toContain('held by ipc-owner-a');

      const unlock = runCliViaIpc(['unlock', ipcFilepathLock, '--owner', 'ipc-owner-a', '--json']);
      expect(unlock.success).toBe(true);
      expect(JSON.parse(unlock.stdout)).toMatchObject({
        success: true,
        released: true
      });
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

  describe('Sugar Recovery Commands', () => {
    test('done succeeds over IPC when the session is active but the agent registry entry is gone', async () => {
      const slot = `stale-done-${Date.now()}`;
      const agentId = `stale-done-agent-${Date.now()}`;

      try {
        const begin = await requestWithRetry('/sugar/begin', {
          method: 'POST',
          body: {
            purpose: 'CLI stale-session recovery',
            agentId,
            lifecycle: 'durable',
          },
        });
        expect(begin.ok).toBe(true);

        const sessionId = begin.data.sessionId;
        expect(sessionId).toBeTruthy();

        writeTestCurrentContext({
          agentId,
          sessionId,
          purpose: 'CLI stale-session recovery',
          identity: 'port-daddy',
          contextSlot: slot,
        });

        const unregister = await requestWithRetry(`/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
        expect(unregister.ok).toBe(true);

        // pd-done origin rule (substrate fix 2026-05-20): bypass via the
        // documented escape hatch for this integration test, which has no
        // intent to push or open a PR.
        const result = runCliViaIpc(
          ['done', 'Recovered after agent registry loss', '--json',
           '--skip-origin-check', '--reason', 'cli ipc recovery integration test'],
          { env: { PORT_DADDY_CONTEXT_SLOT: slot } },
        );
        expect(result.success).toBe(true);

        const payload = JSON.parse(result.stdout);
        expect(payload).toMatchObject({
          success: true,
          agentId,
          sessionId,
          sessionStatus: 'completed',
        });

        const session = await requestWithRetry(`/sessions/${encodeURIComponent(sessionId)}`);
        expect(session.ok).toBe(true);
        expect(session.data.session.status).toBe('completed');
      } finally {
        clearTestCurrentContext(slot);
      }
    }, 30000);
  });

  describe('Ideas Command', () => {
    test('ideas list returns curated trove entries', () => {
      const result = runCli(['ideas', 'list', '--dir', repoRoot, '--limit', '100', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.entries.some((entry) => entry.slug === 'capability-discovery-dns-harbor')).toBe(true);
    });

    test('ideas search finds the ipc disconnect salvage family', () => {
      const result = runCli(['ideas', 'search', 'salvage disconnect', '--dir', repoRoot, '--include-raw', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results.some((entry) => entry.slug === 'ipc-disconnect-instant-salvage')).toBe(true);
    });

    test('ideas show returns a detailed entry', () => {
      const result = runCli(['ideas', 'show', 'tuple-driven-fleet', '--dir', repoRoot, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.entry.slug).toBe('tuple-driven-fleet');
      expect(data.entry.summary).toContain('fleet');
    });

    test('ideas search can find matching daemon notes', async () => {
      const phrase = `federated-note-${Date.now()}`;
      const noteRes = await requestWithRetry('/notes', {
        method: 'POST',
        body: {
          content: `Need ${phrase} in the operator memory surface`,
          agentId: `ideas-note-${Date.now()}`,
          type: 'note',
        },
      });
      expect(noteRes.ok).toBe(true);

      const result = runCli(['ideas', 'search', phrase, '--sources', 'notes', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results.some((entry) => entry.kind === 'note' && entry.summary.includes(phrase))).toBe(true);
    });

    test('ideas search can find matching tuples', async () => {
      const phrase = `federated-tuple-${Date.now()}`;
      const tupleRes = await requestWithRetry('/tuples', {
        method: 'POST',
        body: {
          fields: ['task', phrase, { source: 'ideas-search-test' }],
          harbor: 'ideas-test',
          writtenBy: 'integration-suite',
        },
      });
      expect(tupleRes.ok).toBe(true);

      const result = runCli(['ideas', 'search', phrase, '--sources', 'tuples', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results.some((entry) => entry.kind === 'tuple' && entry.summary.includes(phrase))).toBe(true);
    });

    test('ideas search can scan markdown-only directories without a trove file', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pd-ideas-markdown-it-'));
      try {
        writeFileSync(
          join(tempDir, 'scratch.md'),
          '# Scratch\n\nPhase 3 parity debt needs a random markdown search surface.\n',
        );

        const result = runCli([
          'ideas',
          'search',
          'parity debt',
          '--dir',
          tempDir,
          '--sources',
          'markdown',
          '--json',
        ]);
        expect(result.success).toBe(true);

        const data = JSON.parse(result.stdout);
        expect(Array.isArray(data.results)).toBe(true);
        expect(data.results.some((entry) => entry.kind === 'markdown' && entry.location === 'scratch.md')).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
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
      expect(result.stdout.trim()).toMatch(/^\d+$/);
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
      expect(result.stdout.trim()).toMatch(/^export PORT=\d+$/);
      // Cleanup
      runCli(['release', exportId]);
    });

    test('--export flag works with alias', () => {
      const exportId = `test-export-alias-${Date.now()}`;
      const result = runCli(['c', exportId, '--export']);
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toMatch(/^export PORT=\d+$/);
      runCli(['release', exportId]);
    });

    test('pipe-friendly: -q outputs only port number', () => {
      const quietId = `test-quiet-${Date.now()}`;
      const result = runCli(['claim', quietId, '-q']);
      expect(result.success).toBe(true);
      // Should be just the port number, nothing else
      expect(result.stdout.trim()).toMatch(/^\d+$/);
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
      const agentId = `bug2-agent-${Date.now()}`;
      const result = runCli(['session', 'start', 'Bug regression test', '--agent', agentId, '--lifecycle', 'durable']);
      expect(result.success).toBe(true);
      expect(result.stdout).not.toContain('undefined');
      expect(result.stdout).toMatch(/session-[a-z0-9-]+-[a-f0-9]{12}/);
      const firstSessionId = result.stdout.match(/session-[a-z0-9-]+-[a-f0-9]{12}/)?.[0];

      // Also test -q returns just the ID
      const quietResult = runCli(['session', 'start', 'Quiet test', '--agent', agentId, '--lifecycle', 'durable', '-q']);
      expect(quietResult.success).toBe(true);
      expect(quietResult.stdout).toMatch(/^session-[a-z0-9-]+-[a-f0-9]{12}$/);
      expect(quietResult.stdout).not.toBe('undefined');

      if (firstSessionId) {
        runCli(['session', 'rm', firstSessionId]);
      }
      runCli(['session', 'rm', quietResult.stdout.trim()]);
    });

    test('session start conflict output shows filePath from service contract', () => {
      const filePath = `src/conflict-${Date.now()}.ts`;
      const firstId = runCli([
        'session',
        'start',
        'Conflict holder',
        '--agent',
        `bug-conflict-holder-${Date.now()}`,
        '--lifecycle',
        'durable',
        '--files',
        filePath,
        '-q',
      ]).stdout.trim();

      const result = runCli([
        'session',
        'start',
        'Conflict challenger',
        '--agent',
        `bug-conflict-challenger-${Date.now()}`,
        '--lifecycle',
        'durable',
        '--files',
        filePath,
      ]);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain(filePath);
      expect(result.stderr).not.toContain('<unknown>');
      expect(result.stderr).not.toContain('undefined');

      runCli(['session', 'rm', firstId]);
    });

    test('session done reports releasedFiles count from actual response shape', () => {
      const agentId = `bug-done-agent-${Date.now()}`;
      const filePath = `src/released-${Date.now()}.ts`;
      const sessionId = runCli([
        'session',
        'start',
        'Release count test',
        '--agent',
        agentId,
        '--lifecycle',
        'durable',
        '--files',
        filePath,
        '-q',
      ]).stdout.trim();

      const result = runCli([
        'session',
        'done',
        'not-applicable: wrapped up',
        '--agent',
        agentId,
        '--skip-origin-check',
        '--reason',
        'integration test count verification',
      ]);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Files released: 1');

      runCli(['session', 'rm', sessionId]);
    });

    test('session files rm reports released count from actual response shape', () => {
      const agentId = `bug-files-rm-agent-${Date.now()}`;
      const filePath = `src/files-rm-${Date.now()}.ts`;
      const sessionId = runCli([
        'session',
        'start',
        'Files rm count test',
        '--agent',
        agentId,
        '--lifecycle',
        'durable',
        '--files',
        filePath,
        '-q',
      ]).stdout.trim();

      const result = runCli(['session', 'files', 'rm', filePath, '--agent', agentId]);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain(`Released 1 file(s) from session ${sessionId}`);

      runCli(['session', 'rm', sessionId]);
    });

    test('session files claim/release compatibility aliases work end-to-end', () => {
      const agentId = `compat-files-agent-${Date.now()}`;
      const fileA = `src/compat-a-${Date.now()}.ts`;
      const fileB = `src/compat-b-${Date.now()}.ts`;
      const sessionId = runCli([
        'session',
        'start',
        'Files alias compatibility test',
        '--agent',
        agentId,
        '--lifecycle',
        'durable',
        '-q',
      ]).stdout.trim();

      const claimResult = runCli(['session', 'files', 'claim', fileA, fileB, '--agent', agentId]);
      expect(claimResult.success).toBe(true);
      expect(claimResult.stdout).toContain(`Claimed 2 file(s) in session ${sessionId}`);

      const releaseResult = runCli(['session', 'files', 'release', fileA, '--agent', agentId]);
      expect(releaseResult.success).toBe(true);
      expect(releaseResult.stdout).toContain(`Released 1 file(s) from session ${sessionId}`);

      runCli(['session', 'rm', sessionId]);
    });

    test('session files can claim and release a symbol region with line fallback', () => {
      const agentId = `symbol-region-agent-${Date.now()}`;
      const tempDir = mkdtempSync(join(tmpdir(), 'pd-symbol-region-'));
      const filePath = join(tempDir, 'region-claim.ts');
      writeFileSync(filePath, [
        'export function target() {',
        '  return 1;',
        '}',
        '',
        'export function other() {',
        '  return 2;',
        '}',
      ].join('\n'));

      let sessionId;
      try {
        sessionId = runCli([
          'session',
          'start',
          'Symbol region claim test',
          '--agent',
          agentId,
          '--lifecycle',
          'durable',
          '-q',
        ]).stdout.trim();

        const claimResult = runCli([
          'session',
          'files',
          'add',
          filePath,
          '--symbol-path',
          'target',
          '--start-line',
          '1',
          '--end-line',
          '3',
          '--agent',
          agentId,
          '--json',
        ]);
        expect(claimResult.success).toBe(true);
        const claimData = JSON.parse(claimResult.stdout);
        expect(claimData.success).toBe(true);
        expect(claimData.claimed).toContain(filePath);

        const ownerResult = runCli(['who-owns', filePath, '--symbol-path', 'target', '--json']);
        expect(ownerResult.success).toBe(true);
        const ownerData = JSON.parse(ownerResult.stdout);
        expect(ownerData.claimed).toBe(true);
        expect(ownerData.owners.some(owner => owner.symbolPath === 'target')).toBe(true);

        const releaseResult = runCli([
          'session',
          'files',
          'rm',
          filePath,
          '--symbol-path',
          'target',
          '--start-line',
          '1',
          '--end-line',
          '3',
          '--agent',
          agentId,
        ]);
        expect(releaseResult.success).toBe(true);
        expect(releaseResult.stdout).toContain(`Released 1 file(s) from session ${sessionId}`);
      } finally {
        if (sessionId) runCli(['session', 'rm', sessionId]);
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    // Bug #3: Sessions list was showing "undefinedundefinedNaNd"
    // because CLI expected { startedAt, fileCount, noteCount }
    // but API returns { createdAt, updatedAt, completedAt }
    test('sessions list shows proper values (not undefined/NaN)', () => {
      const agentId = `bug3-agent-${Date.now()}`;
      const sessionId = runCli(['session', 'start', 'Bug 3 session test', '--agent', agentId, '--lifecycle', 'durable', '-q']).stdout.trim();
      const result = runCli(['sessions', '--agent', agentId, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.sessions).toBeDefined();
      for (const session of data.sessions) {
        expect(session.createdAt).toBeDefined();
        expect(typeof session.createdAt).toBe('number');
      }

      // Non-JSON output should not contain undefined or NaN
      const textResult = runCli(['sessions', '--agent', agentId]);
      expect(textResult.success).toBe(true);
      expect(textResult.stdout).not.toContain('undefined');
      expect(textResult.stdout).not.toContain('NaN');

      runCli(['session', 'rm', sessionId]);
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
      const agentId = `bug15-agent-${Date.now()}`;
      const result = runCli(['session', 'start', 'Bug 15 test', '--agent', agentId, '--lifecycle', 'durable', '--json']);
      expect(result.success).toBe(true);

      // Should be valid JSON
      let data;
      expect(() => { data = JSON.parse(result.stdout); }).not.toThrow();
      expect(data.success).toBe(true);
      expect(data.id).toMatch(/^session-bug-15-test-[a-f0-9]{12}$/);
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
    test('sessions --all shows all statuses (not just active)', async () => {
      const agentId = `bug12-agent-${Date.now()}`;

      // Create sessions with different statuses
      const activeRes = await requestWithRetry('/sessions', {
        method: 'POST',
        body: { purpose: 'Bug 12 active test', agentId },
      });
      expect(activeRes.ok).toBe(true);
      const activeId = activeRes.data.id;

      const completedRes = await requestWithRetry('/sessions', {
        method: 'POST',
        body: { purpose: 'Bug 12 completed test', agentId },
      });
      expect(completedRes.ok).toBe(true);
      const completedId = completedRes.data.id;

      const completeDoneRes = await requestWithRetry(`/sessions/${completedId}`, {
        method: 'PUT',
        body: { status: 'completed', note: 'Done' },
      });
      expect(completeDoneRes.ok).toBe(true);

      const abandonedRes = await requestWithRetry('/sessions', {
        method: 'POST',
        body: { purpose: 'Bug 12 abandoned test', agentId },
      });
      expect(abandonedRes.ok).toBe(true);
      const abandonedId = abandonedRes.data.id;

      const abandonDoneRes = await requestWithRetry(`/sessions/${abandonedId}`, {
        method: 'PUT',
        body: { status: 'abandoned' },
      });
      expect(abandonDoneRes.ok).toBe(true);

      // Without --all: should only show active sessions
      const activeOnly = runCli(['sessions', '--agent', agentId, '--json']);
      const activeData = JSON.parse(activeOnly.stdout);
      expect(activeData.sessions.every(s => s.status === 'active')).toBe(true);

      // With --all: should show all statuses
      const allSessions = runCli(['sessions', '--agent', agentId, '--all', '--json']);
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
      const result = runCli(['begin', '--purpose', 'Flag alternative test', '--lifecycle', 'durable', '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toBeTruthy(); // agent ID in quiet mode

      // Cleanup
      const agentId = result.stdout.trim();
      runCli(['done', '--agent', agentId]);
    });

    test('pd begin --files greedily claims every following path', () => {
      const slot = `variadic-files-${Date.now()}`;
      const files = [
        `coord/${slot}-a.ts`,
        `coord/${slot}-b.ts`,
        `coord/${slot}-c.ts`,
      ];
      try {
        const result = runCli([
          'begin',
          'Variadic file claim regression',
          '--identity', 'port-daddy:test:variadic-files',
          '--files', ...files,
          '--lifecycle', 'durable',
          '--sidequest', 'integration parser regression coverage',
          '--json',
        ], { env: { PORT_DADDY_CONTEXT_SLOT: slot, PD_RENT_EXEMPT: '' } });

        expect(result.success).toBe(true);
        const data = JSON.parse(result.stdout);
        expect(data.fileClaims).toEqual(expect.arrayContaining(files));
        expect(data.fileClaims).toHaveLength(files.length);

        const done = runCli([
          'done',
          'Result: variadic file parsing verified. not-applicable: integration test cleanup',
          '--session', data.sessionId,
          '--skip-origin-check', '--reason', 'variadic files integration test',
          '--json',
        ], { env: { PORT_DADDY_CONTEXT_SLOT: slot } });
        expect(done.success).toBe(true);
      } finally {
        clearTestCurrentContext(slot);
      }
    });

    test('pd begin --files without a path fails loudly', () => {
      const result = runCli([
        'begin',
        'Missing variadic file value',
        '--files',
        '--lifecycle', 'durable',
        '--sidequest', 'integration parser regression coverage',
      ]);

      expect(result.success).toBe(false);
      expect(result.stderr + result.stdout).toContain('--files requires at least one path');
    });

    test('pd begin -P works as short flag', () => {
      const result = runCli(['begin', '-P', 'Short flag test', '--lifecycle', 'durable', '-q']);
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
        '--lifecycle', 'durable',
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
      const beginResult = runCli(['begin', '-P', 'Done flag test', '--lifecycle', 'durable', '-q']);
      const agentId = beginResult.stdout.trim();

      // pd-done origin rule (substrate fix 2026-05-20): bypass for this
      // flag-shape test, which is about argument parsing, not the rule.
      const result = runCli(['done', '--note', 'Finished via flag', '--agent', agentId, '--json',
        '--skip-origin-check', '--reason', 'cli flag parsing test']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.finalNote).toBe(true);
    });

    test('pd done -n works as short flag for note', () => {
      const beginResult = runCli(['begin', '-P', 'Done short flag test', '--lifecycle', 'durable', '-q']);
      const agentId = beginResult.stdout.trim();

      // pd-done origin rule bypass — see comment in --note test above.
      const result = runCli(['done', '-n', 'Short flag note', '--agent', agentId, '--json',
        '--skip-origin-check', '--reason', 'cli flag parsing test']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
    });

    test('pd done --status works as flag alternative', () => {
      const beginResult = runCli(['begin', '-P', 'Status flag test', '--lifecycle', 'durable', '-q']);
      const agentId = beginResult.stdout.trim();

      const result = runCli(['done', '--status', 'abandoned', '--agent', agentId, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.sessionStatus).toBe('abandoned');
    });

    test('pd session start --purpose works as flag alternative', () => {
      const result = runCli(['session', 'start', '--purpose', 'Session flag test', '--lifecycle', 'durable', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.purpose).toBe('Session flag test');

      // Cleanup
      runCli(['session', 'rm', data.id]);
    });

    test('pd session start requires explicit lifecycle in non-interactive mode', () => {
      const result = runCli(['session', 'start', 'Missing lifecycle']);
      expect(result.success).toBe(false);
      const output = result.stderr + result.stdout;
      expect(output).toContain('--lifecycle');
      expect(output).toContain('durable');
      expect(output).toContain('ephemeral');
    });

    test('pd note --content works as flag alternative', () => {
      // Start a session first
      const sessionResult = runCli(['session', 'start', 'Note flag test', '--lifecycle', 'durable', '--json']);
      const sessionData = JSON.parse(sessionResult.stdout);

      const result = runCli(['note', '--content', 'Flag note content', '--session', sessionData.id, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);

      // Cleanup
      runCli(['session', 'rm', sessionData.id]);
    });

    test('pd note -c works as short flag for content', () => {
      const sessionResult = runCli(['session', 'start', 'Short note test', '--lifecycle', 'durable', '--json']);
      const sessionData = JSON.parse(sessionResult.stdout);

      const result = runCli(['note', '-c', 'Short flag content', '--session', sessionData.id, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);

      runCli(['session', 'rm', sessionData.id]);
    });

    test('pd n works as the top-level note alias advertised by completions', () => {
      const sessionResult = runCli(['session', 'start', 'Short alias note test', '--lifecycle', 'durable', '--json']);
      const sessionData = JSON.parse(sessionResult.stdout);

      const result = runCli(['n', '-c', 'Short alias content', '--session', sessionData.id, '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);

      runCli(['session', 'rm', sessionData.id]);
    });

    test('pd note falls back to active agent when stored session context is stale', () => {
      const identity = `port-daddy:test:stale-note-${process.pid}-${Date.now()}`;
      const beginResult = runCli([
        'begin',
        'Stale note fallback',
        '--identity',
        identity,
        '--lifecycle',
        'durable',
        '--json',
      ]);
      expect(beginResult.success).toBe(true);
      const beginData = JSON.parse(beginResult.stdout);

      writeTestCurrentContext({
        agentId: beginData.agentId,
        sessionId: 'session-stale-context',
        purpose: 'Stale note fallback',
        contextSlot: `ppid-${process.pid}`,
      });

      const result = runCli(['note', '--content', 'Recovered from stale context', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.sessionId).toBe(beginData.sessionId);

      runCli(['done', '--agent', beginData.agentId]);
    });

    test('integration context writes stay in the isolated test context dir', () => {
      const slot = `isolated-context-${Date.now()}`;
      const repoSlotPath = join(repoRoot, '.portdaddy', 'contexts', `${slot}.json`);

      writeTestCurrentContext({
        agentId: `isolated-agent-${Date.now()}`,
        sessionId: `isolated-session-${Date.now()}`,
        purpose: 'Isolation regression',
        contextSlot: slot,
      });

      const { contextDir } = getDaemonState();
      expect(existsSync(join(contextDir, 'contexts', `${slot}.json`))).toBe(true);
      expect(existsSync(repoSlotPath)).toBe(false);

      clearTestCurrentContext(slot);
    });

    test('pd whoami falls back to the stored session when the agent row is gone', async () => {
      const beginResult = runCli([
        'begin',
        'Stale whoami fallback',
        '--identity',
        'port-daddy:test:stale-whoami',
        '--lifecycle',
        'durable',
        '--json',
      ]);
      expect(beginResult.success).toBe(true);
      const beginData = JSON.parse(beginResult.stdout);

      const deleteRes = await requestWithRetry(`/agents/${encodeURIComponent(beginData.agentId)}`, { method: 'DELETE' });
      expect(deleteRes.ok).toBe(true);

      const result = runCli(['whoami', '--json']);
      expect(result.success).toBe(true);

      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.active).toBe(true);
      expect(data.agentId).toBe(beginData.agentId);
      expect(data.sessionId).toBe(beginData.sessionId);
      expect(data.purpose).toBe('Stale whoami fallback');
      expect(data.identity).toBe('port-daddy:test:stale-whoami');

      runCli(['done', '--session', beginData.sessionId]);
    });

    test('pd session takeover makes the successor the current noteable context', () => {
      const beginResult = runCli([
        'begin',
        'Takeover context continuity',
        '--identity',
        'port-daddy:test:takeover-context',
        '--lifecycle',
        'durable',
        '--json',
      ]);
      expect(beginResult.success).toBe(true);
      const beginData = JSON.parse(beginResult.stdout);

      const takeoverResult = runCli([
        'session',
        'takeover',
        beginData.sessionId,
        'same shell continues',
        '--json',
      ]);
      expect(takeoverResult.success).toBe(true);
      const takeoverData = JSON.parse(takeoverResult.stdout);
      expect(takeoverData.success).toBe(true);
      expect(takeoverData.predecessorId).toBe(beginData.sessionId);
      expect(takeoverData.successorId).toMatch(/^session-takeover-context-continuity-/);
      expect(takeoverData.session.agentId).toBe(beginData.agentId);

      const whoamiResult = runCli(['whoami', '--json']);
      expect(whoamiResult.success).toBe(true);
      const whoami = JSON.parse(whoamiResult.stdout);
      expect(whoami.active).toBe(true);
      expect(whoami.agentId).toBe(beginData.agentId);
      expect(whoami.sessionId).toBe(takeoverData.successorId);

      const noteResult = runCli(['note', '--content', 'successor note after takeover', '--json']);
      expect(noteResult.success).toBe(true);
      const noteData = JSON.parse(noteResult.stdout);
      expect(noteData.success).toBe(true);
      expect(noteData.sessionId).toBe(takeoverData.successorId);

      const doneResult = runCli([
        'done',
        'Result: takeover context regression complete - not-applicable: integration test cleanup',
        '--skip-origin-check',
        '--reason',
        'takeover context regression test',
        '--json',
      ]);
      expect(doneResult.success).toBe(true);
      const doneData = JSON.parse(doneResult.stdout);
      expect(doneData.success).toBe(true);
      expect(doneData.sessionId).toBe(takeoverData.successorId);
    });

    test('pd session files add uses stored session context across worktree drift', async () => {
      const beginResult = runCli([
        'begin',
        'Cross-worktree file claim fallback',
        '--identity',
        'port-daddy:test:cross-worktree-file-claim',
        '--lifecycle',
        'durable',
        '--json',
      ]);
      expect(beginResult.success).toBe(true);
      const beginData = JSON.parse(beginResult.stdout);

      const otherRepo = mkdtempSync(join(tmpdir(), 'pd-other-worktree-'));
      execFileSync('git', ['init'], { cwd: otherRepo, stdio: 'ignore' });

      try {
        const result = runCli(['session', 'files', 'add', 'README.md', '--json'], { cwd: otherRepo });
        expect(result.success).toBe(true);

        const data = JSON.parse(result.stdout);
        expect(data.success).toBe(true);
        expect(data.claimed).toEqual(['README.md']);

        const detailRes = await requestWithRetry(`/sessions/${beginData.sessionId}`);
        expect(detailRes.ok).toBe(true);
        const filePaths = (detailRes.data.files || []).map(file => file.filePath || file.file_path || file.path);
        expect(filePaths).toContain('README.md');
      } finally {
        runCli(['done', '--session', beginData.sessionId,
          '--skip-origin-check', '--reason', 'cross-repo cli test cleanup']);
        rmSync(otherRepo, { recursive: true, force: true });
      }
    });

    test('positional purpose works with explicit lifecycle', () => {
      // Positional purpose
      const result = runCli(['begin', 'Positional purpose', '--lifecycle', 'durable', '-q']);
      expect(result.success).toBe(true);
      expect(result.stdout).toBeTruthy();

      const agentId = result.stdout.trim();

      // Positional note on done — pd-done origin rule bypass for this
      // positional-args parsing test.
      const doneResult = runCli(['done', 'Positional note', '--agent', agentId, '--json',
        '--skip-origin-check', '--reason', 'cli positional-args test']);
      expect(doneResult.success).toBe(true);

      const data = JSON.parse(doneResult.stdout);
      expect(data.success).toBe(true);
    });

    test('pd begin requires explicit lifecycle in non-interactive mode', () => {
      const result = runCli(['begin', 'Missing lifecycle']);
      expect(result.success).toBe(false);
      const output = result.stderr + result.stdout;
      expect(output).toContain('--lifecycle');
      expect(output).toContain('durable');
      expect(output).toContain('ephemeral');
    });

    test('rent gate: pd begin without a roadmap link fails non-TTY with the 3-option message', () => {
      const result = runCli(
        ['begin', 'Rent gate test', '--lifecycle', 'durable'],
        { env: { PD_RENT_EXEMPT: '' } },
      );
      expect(result.success).toBe(false);
      const output = result.stderr + result.stdout;
      expect(output).toContain('--roadmap <slug>');
      expect(output).toContain('--roadmap-new');
      expect(output).toContain('--sidequest');
      expect(output).not.toContain('PD_RENT_EXEMPT');
    });

    test('rent gate: --sidequest reason passes and lands on the session record', () => {
      const result = runCli([
        'begin', 'Rent sidequest test', '--lifecycle', 'durable',
        '--sidequest', 'integration test opt-out reason', '--json',
      ], { env: { PD_RENT_EXEMPT: '' } });
      expect(result.success).toBe(true);
      const data = JSON.parse(result.stdout);
      expect(data.sidequestReason).toBe('integration test opt-out reason');
      runCli(['done', '--agent', data.agentId, '--status', 'abandoned']);
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

  describe('Inbox CLI Commands', () => {
    const receiverId = `rec-agent-${Date.now()}`;
    const senderId = `send-agent-${Date.now()}`;

    beforeAll(() => {
      runCli(['agent', 'register', '--agent', receiverId]);
      runCli(['agent', 'register', '--agent', senderId]);
    });

    afterAll(() => {
      runCli(['inbox', 'clear', '--agent', receiverId]);
    });

    test('send, list, and show message', () => {
      // 1. Send message
      const sendRes = runCli(['inbox', 'send', receiverId, 'Hello Port Daddy!', '--agent', senderId, '--json']);
      expect(sendRes.success).toBe(true);

      // 2. List inbox to get message ID
      const listRes = runCli(['inbox', 'list', '--agent', receiverId, '--json']);
      expect(listRes.success).toBe(true);
      const listData = JSON.parse(listRes.stdout);
      expect(listData.messages.length).toBeGreaterThan(0);
      const targetMessage = listData.messages.find(m => m.content === 'Hello Port Daddy!');
      expect(targetMessage).toBeDefined();
      const msgId = targetMessage.id;

      // 3. Show message using show subcommand
      const showRes = runCli(['inbox', 'show', String(msgId), '--agent', receiverId]);
      expect(showRes.success).toBe(true);
      expect(showRes.stdout).toContain('From:      ' + senderId);
      expect(showRes.stdout).toContain('Hello Port Daddy!');

      // 4. Show message using read subcommand alias
      const readRes = runCli(['inbox', 'read', String(msgId), '--agent', receiverId]);
      expect(readRes.success).toBe(true);
      expect(readRes.stdout).toContain('From:      ' + senderId);
      expect(readRes.stdout).toContain('Hello Port Daddy!');

      // 5. Show message with quiet option
      const quietRes = runCli(['inbox', 'show', String(msgId), '--agent', receiverId, '-q']);
      expect(quietRes.success).toBe(true);
      expect(quietRes.stdout.trim()).toBe('Hello Port Daddy!');

      // 6. Show message with json option
      const jsonRes = runCli(['inbox', 'show', String(msgId), '--agent', receiverId, '--json']);
      expect(jsonRes.success).toBe(true);
      const jsonData = JSON.parse(jsonRes.stdout);
      expect(jsonData.id).toBe(msgId);
      expect(jsonData.content).toBe('Hello Port Daddy!');

      // 7. Error when message is not found
      const notFoundRes = runCli(['inbox', 'show', '999999', '--agent', receiverId]);
      expect(notFoundRes.success).toBe(false);
      expect(notFoundRes.stderr).toContain('not found');
    });
  });

  describe('Unknown Command Handling', () => {
    test('unknown command shows error', () => {
      const result = runCli(['boguscmd']);
      expect(result.success).toBe(false);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/Unknown command|unknown command/i);
    });

    test('misspelled command suggests correction', () => {
      const result = runCli(['cliam']); // close to "claim"
      expect(result.success).toBe(false);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/Did you mean|did you mean/i);
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
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/Unknown command|unknown command/i);
    });
  });
});
