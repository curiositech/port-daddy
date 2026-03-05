/**
 * Sugar Integration Tests
 *
 * Tests the compound sugar commands (begin, done, whoami) against an
 * ephemeral test daemon. Exercises the full lifecycle through HTTP API
 * including agent registration, session management, file claims, and cleanup.
 *
 * The ephemeral daemon is started automatically by Jest globalSetup.
 */

import { request, getDaemonState } from '../helpers/integration-setup.js';

// Track all agent IDs created during tests for cleanup
const createdAgents = [];
const createdSessions = [];

/**
 * Helper: POST /sugar/begin
 */
async function sugarBegin(body) {
  const res = await request('/sugar/begin', { method: 'POST', body });
  if (res.ok && res.data.agentId) createdAgents.push(res.data.agentId);
  if (res.ok && res.data.sessionId) createdSessions.push(res.data.sessionId);
  return res;
}

/**
 * Helper: POST /sugar/done
 */
async function sugarDone(body) {
  return request('/sugar/done', { method: 'POST', body });
}

/**
 * Helper: GET /sugar/whoami
 */
async function sugarWhoami(agentId) {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  return request(`/sugar/whoami${query}`);
}

/**
 * Cleanup helper: best-effort done + unregister for leaked agents
 */
async function cleanupAgent(agentId) {
  try {
    await sugarDone({ agentId });
  } catch {
    // Agent may already be cleaned up
  }
  try {
    await request(`/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
  } catch {
    // Ignore
  }
}

describe('Sugar Integration Tests', () => {
  test('ephemeral daemon is running', async () => {
    const state = getDaemonState();
    expect(state.sockPath).toBeDefined();

    const res = await request('/health');
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe('ok');
  });

  // ===========================================================================
  // 1. Happy path lifecycle
  // ===========================================================================
  describe('Happy path lifecycle', () => {
    let agentId;
    let sessionId;

    afterAll(async () => {
      if (agentId) await cleanupAgent(agentId);
    });

    test('begin creates agent + session atomically', async () => {
      const res = await sugarBegin({
        purpose: 'Integration test lifecycle',
        identity: 'test-project:api:lifecycle',
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.agentId).toBeTruthy();
      expect(res.data.sessionId).toBeTruthy();
      expect(res.data.agentRegistered).toBe(true);
      expect(res.data.sessionStarted).toBe(true);
      expect(res.data.identity).toBe('test-project:api:lifecycle');
      expect(res.data.purpose).toBe('Integration test lifecycle');

      agentId = res.data.agentId;
      sessionId = res.data.sessionId;
    });

    test('whoami shows active context', async () => {
      const res = await sugarWhoami(agentId);

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.active).toBe(true);
      expect(res.data.agentId).toBe(agentId);
      expect(res.data.sessionId).toBe(sessionId);
      expect(res.data.purpose).toBe('Integration test lifecycle');
      expect(res.data.identity).toBe('test-project:api:lifecycle');
    });

    test('can add a note to the session', async () => {
      const res = await request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        body: { content: 'Progress update from integration test' },
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });

    test('done ends session + unregisters agent', async () => {
      const res = await sugarDone({ agentId });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.agentUnregistered).toBe(true);
      expect(res.data.sessionId).toBe(sessionId);
      expect(res.data.sessionStatus).toBe('completed');
    });

    test('whoami shows inactive after done', async () => {
      const res = await sugarWhoami(agentId);

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.active).toBe(false);
    });
  });

  // ===========================================================================
  // 2. Begin with file claims
  // ===========================================================================
  describe('Begin with file claims', () => {
    let agentId;
    let sessionId;

    afterAll(async () => {
      if (agentId) await cleanupAgent(agentId);
    });

    test('begin claims files atomically', async () => {
      const res = await sugarBegin({
        purpose: 'File claims test',
        files: ['src/foo.ts', 'src/bar.ts'],
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.fileClaims).toBeDefined();
      expect(res.data.fileClaims).toEqual(
        expect.arrayContaining(['src/foo.ts', 'src/bar.ts'])
      );

      agentId = res.data.agentId;
      sessionId = res.data.sessionId;
    });

    test('session file claims are retrievable via session detail', async () => {
      const res = await request(`/sessions/${sessionId}`);

      expect(res.ok).toBe(true);
      // Session detail includes files array
      const files = res.data.files || [];
      const filePaths = Array.isArray(files)
        ? files.map(f => f.filePath || f.file_path || f.path)
        : [];

      expect(filePaths).toEqual(
        expect.arrayContaining(['src/foo.ts', 'src/bar.ts'])
      );
    });

    test('done cleans up session and agent', async () => {
      const res = await sugarDone({ agentId });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.agentUnregistered).toBe(true);
    });
  });

  // ===========================================================================
  // 3. Begin auto-generates agentId
  // ===========================================================================
  describe('Begin auto-generates agentId', () => {
    let agentId;

    afterAll(async () => {
      if (agentId) await cleanupAgent(agentId);
    });

    test('auto-generated agentId has expected format', async () => {
      const res = await sugarBegin({
        purpose: 'Auto-ID test',
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);

      agentId = res.data.agentId;
      expect(agentId).toBeDefined();
      expect(agentId).toMatch(/^agent-[a-f0-9]{8,}$/);
    });

    test('cleanup', async () => {
      const res = await sugarDone({ agentId });
      expect(res.ok).toBe(true);
    });
  });

  // ===========================================================================
  // 4. Done with final note
  // ===========================================================================
  describe('Done with final note', () => {
    let agentId;
    let sessionId;

    test('final note is saved during done', async () => {
      const beginRes = await sugarBegin({
        purpose: 'Final note test',
        agentId: `final-note-${Date.now()}`,
      });

      expect(beginRes.ok).toBe(true);
      agentId = beginRes.data.agentId;
      sessionId = beginRes.data.sessionId;

      const doneRes = await sugarDone({
        agentId,
        note: 'All done!',
      });

      expect(doneRes.ok).toBe(true);
      expect(doneRes.data.success).toBe(true);
      expect(doneRes.data.finalNote).toBe(true);

      // Verify the note was saved to the session
      const notesRes = await request(`/sessions/${sessionId}/notes`);
      expect(notesRes.ok).toBe(true);

      const notes = notesRes.data.notes || [];
      const handoffNotes = notes.filter(n => n.type === 'handoff');
      expect(handoffNotes.length).toBeGreaterThanOrEqual(1);
      expect(handoffNotes.some(n => n.content === 'All done!')).toBe(true);
    });
  });

  // ===========================================================================
  // 5. Done with abandoned status
  // ===========================================================================
  describe('Done with abandoned status', () => {
    test('session status is abandoned when specified', async () => {
      const beginRes = await sugarBegin({
        purpose: 'Abandon test',
        agentId: `abandon-${Date.now()}`,
      });

      expect(beginRes.ok).toBe(true);
      const { agentId, sessionId } = beginRes.data;

      const doneRes = await sugarDone({
        agentId,
        status: 'abandoned',
      });

      expect(doneRes.ok).toBe(true);
      expect(doneRes.data.success).toBe(true);
      expect(doneRes.data.sessionStatus).toBe('abandoned');

      // Verify session is actually abandoned
      const sessionRes = await request(`/sessions/${sessionId}`);
      expect(sessionRes.ok).toBe(true);
      expect(sessionRes.data.session.status).toBe('abandoned');
    });
  });

  // ===========================================================================
  // 6. Whoami with no active session
  // ===========================================================================
  describe('Whoami with no active session', () => {
    test('returns inactive with no agentId', async () => {
      const res = await sugarWhoami();

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.active).toBe(false);
      expect(res.data.hint).toBeTruthy();
    });

    test('returns inactive for non-existent agent', async () => {
      const res = await sugarWhoami('nonexistent-agent-xyz');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.active).toBe(false);
    });
  });

  // ===========================================================================
  // 7. Begin with duplicate agentId
  // ===========================================================================
  describe('Begin with duplicate agentId', () => {
    let agentId;

    afterAll(async () => {
      if (agentId) await cleanupAgent(agentId);
    });

    test('second begin with same agentId is handled gracefully', async () => {
      agentId = `dup-agent-${Date.now()}`;

      const first = await sugarBegin({
        purpose: 'First begin',
        agentId,
      });

      expect(first.ok).toBe(true);
      expect(first.data.success).toBe(true);

      // Second begin with same agent ID — may error or be idempotent
      const second = await sugarBegin({
        purpose: 'Second begin',
        agentId,
      });

      // Should not crash the server (either returns error or succeeds)
      expect(second.status).toBeDefined();

      // Verify the daemon is still healthy
      const health = await request('/health');
      expect(health.ok).toBe(true);
    });
  });

  // ===========================================================================
  // 8. Concurrent begin calls
  // ===========================================================================
  describe('Concurrent begin calls', () => {
    const concurrentAgents = [];

    afterAll(async () => {
      for (const id of concurrentAgents) {
        await cleanupAgent(id);
      }
    });

    test('two simultaneous begins both succeed with different IDs', async () => {
      const [res1, res2] = await Promise.all([
        sugarBegin({ purpose: 'Concurrent A' }),
        sugarBegin({ purpose: 'Concurrent B' }),
      ]);

      expect(res1.ok).toBe(true);
      expect(res1.data.success).toBe(true);
      expect(res2.ok).toBe(true);
      expect(res2.data.success).toBe(true);

      // Must have different agent IDs
      expect(res1.data.agentId).not.toBe(res2.data.agentId);

      // Must have different session IDs
      expect(res1.data.sessionId).not.toBe(res2.data.sessionId);

      concurrentAgents.push(res1.data.agentId, res2.data.agentId);
    });
  });

  // ===========================================================================
  // 9. Done without begin
  // ===========================================================================
  describe('Done without begin', () => {
    test('done with non-existent agent returns graceful error', async () => {
      const res = await sugarDone({
        agentId: `ghost-agent-${Date.now()}`,
      });

      // Should return 404 (NO_ACTIVE_SESSION) — not 500
      expect(res.status).not.toBe(500);
      expect(res.data.success).toBe(false);
      expect(res.data.error).toBeTruthy();
      expect(res.data.code).toBe('NO_ACTIVE_SESSION');
    });

    test('done with no body at all does not crash server', async () => {
      const res = await sugarDone({});

      // Without agentId, done falls back to finding the most recent active session.
      // If one exists (from other tests), it succeeds. If not, it returns failure.
      // Either way, it must not be a 500.
      expect(res.status).not.toBe(500);
      expect(typeof res.data.success).toBe('boolean');
    });
  });

  // ===========================================================================
  // 10. Salvage hint
  // ===========================================================================
  describe('Salvage hint', () => {
    test('begin response includes salvageHint field when applicable', async () => {
      const agentId = `salvage-hint-${Date.now()}`;

      const res = await sugarBegin({
        purpose: 'Salvage hint test',
        identity: 'test-project:api:salvage',
        agentId,
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);

      // salvageHint may or may not be present depending on whether dead
      // agents exist. We just verify the response shape is valid and
      // that the field is either absent or has the right shape.
      if (res.data.salvageHint) {
        expect(typeof res.data.salvageHint).toBe('string');
      }

      // Cleanup
      await sugarDone({ agentId });
    });
  });

  // ===========================================================================
  // Validation edge cases
  // ===========================================================================
  describe('Validation edge cases', () => {
    test('begin without purpose returns 400', async () => {
      const res = await sugarBegin({});

      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
      expect(res.data.error).toContain('purpose');
    });

    test('begin with empty string purpose returns 400', async () => {
      const res = await sugarBegin({ purpose: '' });

      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
    });

    test('begin with non-string purpose returns 400', async () => {
      const res = await sugarBegin({ purpose: 42 });

      expect(res.status).toBe(400);
      expect(res.data.success).toBe(false);
    });

    test('begin with invalid identity returns error', async () => {
      const res = await sugarBegin({
        purpose: 'Invalid identity test',
        identity: 'invalid identity with spaces',
      });

      // Route validation or sugar module should reject
      expect(res.data.success).toBe(false);
    });
  });

  // ===========================================================================
  // Whoami details
  // ===========================================================================
  describe('Whoami detail fields', () => {
    let agentId;
    let sessionId;

    afterAll(async () => {
      if (agentId) await cleanupAgent(agentId);
    });

    test('whoami returns file claims and note count', async () => {
      const beginRes = await sugarBegin({
        purpose: 'Whoami details test',
        agentId: `whoami-detail-${Date.now()}`,
        files: ['src/main.ts', 'src/utils.ts'],
      });

      expect(beginRes.ok).toBe(true);
      agentId = beginRes.data.agentId;
      sessionId = beginRes.data.sessionId;

      // Add a note
      await request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        body: { content: 'Working on it' },
      });

      const res = await sugarWhoami(agentId);

      expect(res.ok).toBe(true);
      expect(res.data.active).toBe(true);
      expect(res.data.files).toEqual(
        expect.arrayContaining(['src/main.ts', 'src/utils.ts'])
      );
      expect(res.data.noteCount).toBeGreaterThanOrEqual(1);
      expect(typeof res.data.duration).toBe('number');
      expect(res.data.duration).toBeGreaterThanOrEqual(0);
      expect(res.data.startedAt).toBeTruthy();
    });
  });

  // ===========================================================================
  // Notes count in done response
  // ===========================================================================
  describe('Notes count in done response', () => {
    test('done returns correct notes count', async () => {
      const beginRes = await sugarBegin({
        purpose: 'Notes count test',
        agentId: `notes-count-${Date.now()}`,
      });

      expect(beginRes.ok).toBe(true);
      const { agentId, sessionId } = beginRes.data;

      // Add two notes
      await request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        body: { content: 'Note 1' },
      });
      await request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        body: { content: 'Note 2' },
      });

      // Done with a final note
      const doneRes = await sugarDone({
        agentId,
        note: 'Final note',
      });

      expect(doneRes.ok).toBe(true);
      expect(doneRes.data.notesCount).toBe(3); // 2 manual + 1 handoff
    });
  });

  // ===========================================================================
  // Server health after all sugar operations
  // ===========================================================================
  describe('Post-test health', () => {
    test('daemon is still healthy after all sugar operations', async () => {
      const res = await request('/health');
      expect(res.ok).toBe(true);
      expect(res.data.status).toBe('ok');
    });
  });
});
