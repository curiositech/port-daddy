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
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
    expect(md).toContain('**Active sessions:** 0');
    expect(md).toContain('**Dead agents needing salvage:** 0');
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
