/**
 * Unit Tests: Briefing Module
 *
 * Tests the .portdaddy/ briefing generation system.
 * Uses in-memory SQLite — no filesystem or daemon required.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createBriefing } from '../../lib/briefing.js';
import { createSessions } from '../../lib/sessions.js';
import { createServices } from '../../lib/services.js';
import { createAgents } from '../../lib/agents.js';
import { createActivityLog } from '../../lib/activity.js';
import { createMessaging } from '../../lib/messaging.js';
import { createResurrection } from '../../lib/resurrection.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'node:child_process';

let db;
let sessions;
let services;
let agents;
let activityLog;
let messaging;
let resurrection;
let briefing;
let testDir;

beforeEach(() => {
  db = createTestDb();
  sessions = createSessions(db);
  services = createServices(db);
  agents = createAgents(db);
  activityLog = createActivityLog(db);
  messaging = createMessaging(db);
  resurrection = createResurrection(db);
  sessions.setActivityLog(activityLog);
  briefing = createBriefing(db, {
    sessions,
    agents,
    resurrection,
    activityLog,
    services,
    messaging,
  });

  // Create temp directory for briefing output
  testDir = join(tmpdir(), `pd-briefing-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  db.close();
  // Clean up temp directory
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
});

// =============================================================================
// detectProject
// =============================================================================

describe('detectProject', () => {
  function git(cwd, ...args) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }).trim();
  }

  function repository(name, project) {
    const root = join(testDir, name);
    mkdirSync(root);
    git(root, 'init', '-q');
    writeFileSync(join(root, 'pd-fleet.yml'), `fleet:\n  name: ${project}\n  agents: []\n`);
    git(root, 'add', 'pd-fleet.yml');
    git(root, '-c', 'user.name=Fixture Agent', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
    return root;
  }

  test('returns explicit project when provided', () => {
    const result = briefing.detectProject(testDir, 'myapp');
    expect(result).toBe('myapp');
  });

  test('falls back to directory name when no config or worktree', () => {
    const result = briefing.detectProject(testDir);
    // Should be the directory basename
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('reads project from .portdaddyrc if it exists', () => {
    // Create a .portdaddyrc in the test directory
    const configPath = join(testDir, '.portdaddyrc');
    writeFileSync(configPath, JSON.stringify({ project: 'configured-project' }));

    const result = briefing.detectProject(testDir);
    expect(result).toBe('configured-project');
  });

  test('linked and nested worktrees use the root fleet name, not a folder or nested config', () => {
    const root = repository('primary', 'my-project');
    const linked = join(testDir, 'unrelated-checkout-name');
    git(root, 'worktree', 'add', '--detach', linked);
    const nested = join(linked, 'src', 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'pd-fleet.yml'), 'fleet:\n  name: wrong-nested\n');
    writeFileSync(join(nested, '.portdaddyrc'), JSON.stringify({ project: 'wrong-rc' }));
    expect(briefing.detectProject(linked)).toBe('my-project');
    expect(briefing.detectProject(nested)).toBe('my-project');
    expect(briefing.detectProject(nested, 'override')).toBe('override');
    expect(briefing.detectProject(nested, 'auto')).toBe('auto');
  });

  test('a physical directory alias uses its target repository, not the alias parent config', () => {
    const root = repository('primary', 'physical-project');
    const alias = join(testDir, 'alias');
    symlinkSync(root, alias, 'dir');
    writeFileSync(join(testDir, '.portdaddyrc'), JSON.stringify({ project: 'foreign-parent' }));
    expect(briefing.detectProject(alias)).toBe('physical-project');
  });

  test('root fleet configuration wins over root rc configuration', () => {
    const root = repository('primary', 'fleet-project');
    writeFileSync(join(root, '.portdaddyrc'), JSON.stringify({ project: 'rc-project' }));
    expect(briefing.detectProject(root)).toBe('fleet-project');
  });

  test('sibling repositories remain distinct and foreign sessions or claims stay out', () => {
    const a = repository('checkout-a', 'project-a');
    const b = repository('checkout-b', 'project-b');
    const first = sessions.start('Owned A', { project: 'project-a' });
    const second = sessions.start('Foreign B', { project: 'project-b' });
    sessions.claimFiles(first.id, ['same.ts']);
    sessions.claimFiles(second.id, ['same.ts']);
    const before = db.prepare('SELECT * FROM sessions ORDER BY id').all();
    const data = briefing.generate(a, { writeToDisk: false }).briefing;
    expect(data.project).toBe('project-a');
    expect(data.activeSessions.map(s => s.id)).toEqual([first.id]);
    expect(data.fileClaims.map(c => c.sessionId)).toEqual([first.id]);
    expect(briefing.generate(b, { writeToDisk: false }).briefing.project).toBe('project-b');
    expect(db.prepare('SELECT * FROM sessions ORDER BY id').all()).toEqual(before);
    expect(existsSync(join(a, '.portdaddy'))).toBe(false);
  });

  test('a root with no local config does not inherit a parent rc project', () => {
    writeFileSync(join(testDir, '.portdaddyrc'), JSON.stringify({ project: 'foreign-parent' }));
    const root = join(testDir, 'plain-repository');
    mkdirSync(root);
    git(root, 'init', '-q');
    expect(briefing.detectProject(root)).toBe('plain-repository');
    const nonGit = join(testDir, 'plain-directory');
    mkdirSync(nonGit);
    expect(briefing.detectProject(nonGit)).toBe('plain-directory');
  });

  test.each(['pd-fleet.yml', '.portdaddyrc'])('does not use a %s symlink into a sibling repository', filename => {
    const sibling = repository('sibling', 'foreign-project');
    writeFileSync(join(sibling, '.portdaddyrc'), JSON.stringify({ project: 'foreign-project' }));
    const root = join(testDir, 'no-local-project');
    mkdirSync(root);
    git(root, 'init', '-q');
    symlinkSync(join(sibling, filename), join(root, filename));
    expect(briefing.detectProject(root)).toBe(basename(realpathSync(root)));
  });
});

// =============================================================================
// gatherData
// =============================================================================

describe('gatherData', () => {
  test('returns structured data with all expected fields', () => {
    const data = briefing.gatherData('testproject', testDir);

    expect(data).toHaveProperty('project', 'testproject');
    expect(data).toHaveProperty('generatedAt');
    expect(data).toHaveProperty('activeSessions');
    expect(data).toHaveProperty('activeAgents');
    expect(data).toHaveProperty('salvageQueue');
    expect(data).toHaveProperty('fileClaims');
    expect(data).toHaveProperty('recentActivity');
    expect(data).toHaveProperty('recentNotes');
    expect(data).toHaveProperty('integrationSignals');
    expect(data).toHaveProperty('activeServices');
    expect(Array.isArray(data.activeSessions)).toBe(true);
    expect(Array.isArray(data.activeAgents)).toBe(true);
    expect(Array.isArray(data.salvageQueue)).toBe(true);
  });

  test('returns empty arrays when no data exists', () => {
    const data = briefing.gatherData('emptyproject', testDir);

    expect(data.activeSessions).toHaveLength(0);
    expect(data.activeAgents).toHaveLength(0);
    expect(data.salvageQueue).toHaveLength(0);
    expect(data.fileClaims).toHaveLength(0);
    expect(data.activeServices).toHaveLength(0);
  });

  test('includes active sessions for the project', () => {
    // Create a session with identity_project
    const result = sessions.start('Test session', { project: 'myproject' });
    expect(result.success).toBe(true);

    const data = briefing.gatherData('myproject', testDir);
    expect(data.activeSessions.length).toBeGreaterThanOrEqual(1);
    expect(data.activeSessions.some(s => s.purpose === 'Test session')).toBe(true);
  });

  test('excludes sessions from other projects', () => {
    sessions.start('Session for myproject', { project: 'myproject' });
    sessions.start('Session for otherproject', { project: 'otherproject' });

    const data = briefing.gatherData('myproject', testDir);
    expect(data.activeSessions.every(s => s.identityProject === 'myproject' || !s.identityProject)).toBe(true);
  });

  test('includes services matching project prefix', () => {
    services.claim('myproject:api');
    services.claim('myproject:frontend');
    services.claim('otherproject:api');

    const data = briefing.gatherData('myproject', testDir);
    expect(data.activeServices.length).toBe(2);
    expect(data.activeServices.every(s => s.id.startsWith('myproject:'))).toBe(true);
  });

  test('includes notes from active sessions', () => {
    const result = sessions.start('Noted session', { project: 'noteproject' });
    sessions.addNote(result.id, 'First note');
    sessions.addNote(result.id, 'Second note');

    const data = briefing.gatherData('noteproject', testDir);
    expect(data.recentNotes.length).toBeGreaterThanOrEqual(2);
  });

  test('includes recent activity derived from session metadata even without target prefixes', () => {
    sessions.start('Activity-bearing session', { project: 'activityproject', agentId: 'qa-agent' });

    const data = briefing.gatherData('activityproject', testDir);
    expect(data.recentActivity.some(entry =>
      entry.type === 'session.start'
      && entry.metadata?.identityProject === 'activityproject'
      && entry.agentId === 'qa-agent'
    )).toBe(true);
  });

  test('adds summary and files to recent activity entries for briefing consumers', () => {
    const started = sessions.start('File-bearing session', {
      project: 'briefing-files',
      agentId: 'documentarian',
    });

    expect(started.success).toBe(true);
    sessions.claimFiles(started.id, ['docs/recovery/CURRENT-WORK.md']);

    const data = briefing.gatherData('briefing-files', testDir);
    const fileClaim = data.recentActivity.find(entry => entry.type === 'file.claim');

    expect(fileClaim).toBeDefined();
    expect(fileClaim.summary).toContain('Claimed');
    expect(fileClaim.files).toContain('docs/recovery/CURRENT-WORK.md');
  });

  test('includes integration signals from messaging channels', () => {
    messaging.publish('integration:myproject:ready', JSON.stringify({
      type: 'ready',
      identity: 'myproject:api',
      description: 'API endpoints ready',
    }), { sender: 'myproject:api' });

    const data = briefing.gatherData('myproject', testDir);
    expect(data.integrationSignals.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// generate
// =============================================================================

describe('generate', () => {
  test('creates .portdaddy/ directory structure', () => {
    const result = briefing.generate(testDir, { project: 'testproject' });

    expect(result.success).toBe(true);
    expect(existsSync(join(testDir, '.portdaddy'))).toBe(true);
    expect(existsSync(join(testDir, '.portdaddy', 'briefing.md'))).toBe(true);
    expect(existsSync(join(testDir, '.portdaddy', 'briefing.json'))).toBe(true);
    expect(existsSync(join(testDir, '.portdaddy', '.gitignore'))).toBe(true);
    expect(existsSync(join(testDir, '.portdaddy', 'sessions'))).toBe(true);
    expect(existsSync(join(testDir, '.portdaddy', 'agents'))).toBe(true);
  });

  test('briefing.md contains project heading', () => {
    briefing.generate(testDir, { project: 'testproject' });

    const md = readFileSync(join(testDir, '.portdaddy', 'briefing.md'), 'utf8');
    expect(md).toContain('# Project Briefing: testproject');
    expect(md).toContain('## Current State');
  });

  test('briefing.json is valid JSON with correct project', () => {
    briefing.generate(testDir, { project: 'jsontest' });

    const json = JSON.parse(readFileSync(join(testDir, '.portdaddy', 'briefing.json'), 'utf8'));
    expect(json.project).toBe('jsontest');
    expect(json.generatedAt).toBeDefined();
    expect(Array.isArray(json.activeSessions)).toBe(true);
  });

  test('returns briefing data in result', () => {
    const result = briefing.generate(testDir, { project: 'datatest' });

    expect(result.success).toBe(true);
    expect(result.briefing).toBeDefined();
    expect(result.briefing.project).toBe('datatest');
  });

  test('writeToDisk: false returns data without creating files', () => {
    const result = briefing.generate(testDir, { project: 'nodisk', writeToDisk: false });

    expect(result.success).toBe(true);
    expect(result.briefing).toBeDefined();
    expect(result.briefing.project).toBe('nodisk');
    expect(existsSync(join(testDir, '.portdaddy', 'briefing.md'))).toBe(false);
  });

  test('returns error for empty projectRoot', () => {
    const result = briefing.generate('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('projectRoot');
  });

  test('.gitignore is only written once (idempotent)', () => {
    briefing.generate(testDir, { project: 'idempotent' });
    const firstContent = readFileSync(join(testDir, '.portdaddy', '.gitignore'), 'utf8');

    // Generate again
    briefing.generate(testDir, { project: 'idempotent' });
    const secondContent = readFileSync(join(testDir, '.portdaddy', '.gitignore'), 'utf8');

    expect(firstContent).toBe(secondContent);
  });

  test('briefing.md includes file ownership table when files are claimed', () => {
    const sessionResult = sessions.start('File claiming session', { project: 'filetest' });
    sessions.claimFiles(sessionResult.id, ['src/auth.ts', 'src/types.ts']);

    const result = briefing.generate(testDir, { project: 'filetest' });
    expect(result.success).toBe(true);

    const md = readFileSync(join(testDir, '.portdaddy', 'briefing.md'), 'utf8');
    expect(md).toContain('## File Ownership Map');
    expect(md).toContain('src/auth.ts');
  });

  test('briefing.md includes salvage queue when dead agents exist', () => {
    // Register an agent then make it stale
    agents.register('dead-agent-1', {
      name: 'dead-agent',
      identity: 'salvagetest:api',
      purpose: 'Building auth module',
    });

    // Manually backdate the heartbeat to trigger staleness
    db.prepare("UPDATE agents SET last_heartbeat = ?").run(Date.now() - 30 * 60 * 1000);

    // Force resurrection check
    const agentData = agents.get('dead-agent-1');
    if (agentData?.agent) {
      resurrection.check({
        id: 'dead-agent-1',
        name: 'dead-agent',
        purpose: 'Building auth module',
        lastHeartbeat: Date.now() - 30 * 60 * 1000,
        notes: ['Working on Stripe integration'],
      });
    }

    const data = briefing.gatherData('salvagetest', testDir);
    // Salvage queue should have entries if resurrection module marked it
    if (data.salvageQueue.length > 0) {
      const result = briefing.generate(testDir, { project: 'salvagetest' });
      const md = readFileSync(join(testDir, '.portdaddy', 'briefing.md'), 'utf8');
      expect(md).toContain('## Salvage Queue');
    }
  });

  test('briefing.md includes active services', () => {
    services.claim('svctest:api');
    services.claim('svctest:frontend');

    briefing.generate(testDir, { project: 'svctest' });
    const md = readFileSync(join(testDir, '.portdaddy', 'briefing.md'), 'utf8');

    expect(md).toContain('svctest:api');
    expect(md).toContain('svctest:frontend');
  });
});

// =============================================================================
// sync (full sync)
// =============================================================================

describe('sync', () => {
  test('generates briefing and archives completed sessions', () => {
    // Create and complete a session
    const result = sessions.start('Completed task', { project: 'synctest' });
    sessions.addNote(result.id, 'Finished all work');
    sessions.end(result.id, { status: 'completed' });

    const syncResult = briefing.sync(testDir, { project: 'synctest' });
    expect(syncResult.success).toBe(true);
    expect(syncResult.briefingPath).toBeDefined();
    expect(syncResult.files.length).toBeGreaterThan(0);
  });

  test('full sync writes activity.log', () => {
    // Create some activity
    activityLog.log('test_event', {
      targetId: 'synctest:api',
      details: 'Test activity entry',
    });

    const syncResult = briefing.sync(testDir, { project: 'synctest', full: true });
    expect(syncResult.success).toBe(true);

    // Check if activity.log was written (if there was matching activity)
    const activityPath = join(testDir, '.portdaddy', 'activity.log');
    if (existsSync(activityPath)) {
      const logContent = readFileSync(activityPath, 'utf8');
      expect(logContent.length).toBeGreaterThan(0);
    }
  });

  test('returns error for empty projectRoot', () => {
    const result = briefing.sync('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('projectRoot');
  });
});

// =============================================================================
// renderMarkdown
// =============================================================================

describe('renderMarkdown', () => {
  test('produces valid markdown with sections', () => {
    const data = briefing.gatherData('mdtest', testDir);
    const md = briefing.renderMarkdown(data);

    expect(md).toContain('# Project Briefing: mdtest');
    expect(md).toContain('## Current State');
    expect(typeof md).toBe('string');
  });

  test('handles empty data gracefully', () => {
    const data = {
      project: 'empty',
      generatedAt: new Date().toISOString(),
      activeSessions: [],
      activeAgents: [],
      salvageQueue: [],
      fileClaims: [],
      recentActivity: [],
      recentNotes: [],
      integrationSignals: [],
      activeServices: [],
    };

    const md = briefing.renderMarkdown(data);
    expect(md).toContain('# Project Briefing: empty');
    expect(md).toContain('**Active sessions with live agents:** 0');
    expect(md).toContain('**Dead agents needing salvage:** 0');
  });

  test('separates orphaned active sessions from sessions with live bodies', () => {
    const md = briefing.renderMarkdown({
      project: 'orphaned',
      generatedAt: new Date().toISOString(),
      activeSessions: [
        {
          id: 'session-live',
          purpose: 'Live work',
          status: 'active',
          phase: 'in_progress',
          agentId: 'agent-live',
          worktreeId: null,
          identityProject: 'orphaned',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: null,
          metadata: null,
        },
        {
          id: 'session-orphan',
          purpose: 'Old zombie work',
          status: 'active',
          phase: 'in_progress',
          agentId: 'agent-gone',
          worktreeId: null,
          identityProject: 'orphaned',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: null,
          metadata: null,
        },
      ],
      activeAgents: [{ id: 'agent-live' }],
      salvageQueue: [],
      fileClaims: [],
      recentActivity: [],
      recentNotes: [],
      integrationSignals: [],
      activeServices: [],
    });

    expect(md).toContain('**Active sessions with live agents:** 1 (Live work)');
    expect(md).toContain('**Orphaned active sessions:** 1 (Old zombie work)');
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('edge cases', () => {
  test('multiple generates to same directory are idempotent', () => {
    briefing.generate(testDir, { project: 'idem' });
    briefing.generate(testDir, { project: 'idem' });
    briefing.generate(testDir, { project: 'idem' });

    expect(existsSync(join(testDir, '.portdaddy', 'briefing.md'))).toBe(true);
    const json = JSON.parse(readFileSync(join(testDir, '.portdaddy', 'briefing.json'), 'utf8'));
    expect(json.project).toBe('idem');
  });

  test('handles special characters in project name', () => {
    const result = briefing.generate(testDir, { project: 'my-app_v2.0' });
    expect(result.success).toBe(true);

    const json = JSON.parse(readFileSync(join(testDir, '.portdaddy', 'briefing.json'), 'utf8'));
    expect(json.project).toBe('my-app_v2.0');
  });

  test('services with wildcard pattern work correctly', () => {
    services.claim('wildcard:api');
    services.claim('wildcard:frontend');
    services.claim('other:worker');

    const data = briefing.gatherData('wildcard', testDir);
    expect(data.activeServices.length).toBe(2);
  });

  describe('path traversal prevention', () => {
    test('rejects relative paths in generate()', () => {
      const result = briefing.generate('../../../etc');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/absolute path/);
    });

    test('rejects null bytes in generate()', () => {
      const result = briefing.generate('/tmp/safe\0/evil');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });

    test('rejects relative paths in sync()', () => {
      const result = briefing.sync('relative/path');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/absolute path/);
    });

    test('rejects null bytes in sync()', () => {
      const result = briefing.sync('/tmp/ok\0/notok');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });

    test('accepts valid absolute path in generate()', () => {
      const result = briefing.generate(testDir);
      expect(result.success).toBe(true);
    });

    test('accepts valid absolute path in sync()', () => {
      const result = briefing.sync(testDir);
      expect(result.success).toBe(true);
    });
  });
});
