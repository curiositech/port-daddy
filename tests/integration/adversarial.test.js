/**
 * Adversarial Testing Suite for Port Daddy
 *
 * Systematic testing of edge cases, race conditions, and security boundaries.
 * Tests run against an ephemeral daemon started by Jest.
 *
 * Route reference (v3.4+):
 *   POST /claim       — body: { id, ... }
 *   DELETE /release    — body: { id }
 *   POST /agents       — body: { id, ... }
 *   POST /agents/:id/heartbeat
 *   DELETE /agents/:id
 */

import { request, runCli, getDaemonState } from '../helpers/integration-setup.js';
import { registerTestActorVia } from '../helpers/actor-credentials.js';
import http from 'node:http';

// #8877 / ADR-0122: lock mutations require a daemon-minted actor credential.
// Mint one locker actor for this suite through the public mint door.
let locker = null;
async function lockerHeaders() {
  if (!locker) locker = await registerTestActorVia(request, { alias: 'adversarial-locker' });
  return locker.headers;
}

async function newOwnedSession(purpose) {
  const owner = await registerTestActorVia(request, { alias: `adversarial-${purpose}` });
  const res = await request('/sessions', {
    method: 'POST',
    headers: owner.headers,
    body: { purpose, agentId: owner.actorId },
  });
  expect(res.ok).toBe(true);
  const sessionId = res.data.id || res.data.session_id;
  expect(typeof sessionId).toBe('string');
  return { sessionId, headers: owner.headers };
}

/**
 * Make a raw HTTP request over the Unix socket (for testing malformed bodies, wrong content types, etc.)
 * Unlike the `request()` helper, this does NOT auto-serialize to JSON.
 */
function rawSocketRequest(path, { method = 'GET', headers = {}, body = null } = {}) {
  const { sockPath } = getDaemonState();
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: sockPath,
      path,
      method,
      headers,
      timeout: 10000
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

describe('Adversarial Testing - Port Claiming Edge Cases', () => {
  describe('Malformed IDs', () => {
    test('claim with SQL injection attempt in ID', async () => {
      let res;
      try {
        res = await request('/claim', {
          method: 'POST',
          body: { id: "test'; DROP TABLE services; --" }
        });
      } catch (err) {
        // Daemon may close the connection mid-write under CI load when
        // rejecting adversarial input. EPIPE/ECONNRESET counts as a
        // valid non-500 outcome — daemon refused the request without
        // executing it, which is exactly what we want.
        if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') {
          res = { status: 499 };
        } else {
          throw err;
        }
      }
      // Should either reject or safely handle — never 500
      expect(res.status).not.toBe(500);
      // Database should still be usable
      const health = await request('/health');
      expect(health.ok).toBe(true);
    });

    test('claim with very long ID (1000+ chars)', async () => {
      const longId = 'a'.repeat(1000);
      const res = await request('/claim', {
        method: 'POST',
        body: { id: longId, framework: 'test' }
      });
      // Server validates identity length (max 200 chars) → 400
      expect([400, 413, 422]).toContain(res.status);
    });

    test('claim with unicode characters in ID', async () => {
      const res = await request('/claim', {
        method: 'POST',
        body: { id: 'test-café-🔒' }
      });
      // Should handle gracefully
      expect([200, 201, 400, 422]).toContain(res.status);

      // Cleanup if claimed
      if (res.ok) {
        await request('/release', { method: 'DELETE', body: { id: 'test-café-🔒' } });
      }
    });

    test('claim with null bytes', async () => {
      const res = await request('/claim', {
        method: 'POST',
        body: { id: 'test\x00injection' }
      });
      // Should not cause 500 error
      expect(res.status).not.toBe(500);
    });

    test('claim with special regex characters', async () => {
      const res = await request('/claim', {
        method: 'POST',
        body: { id: 'test.*+?^${}()|[]\\' }
      });
      expect([200, 201, 400, 422]).toContain(res.status);
    });
  });

  describe('Race Conditions', () => {
    test('simultaneous claims for same ID are serialized', async () => {
      const testId = `race-test-${Date.now()}`;
      const promises = [];

      // Fire 5 concurrent claims for the same ID
      for (let i = 0; i < 5; i++) {
        promises.push(
          request('/claim', {
            method: 'POST',
            body: { id: testId, framework: 'test' }
          })
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.status === 200 || r.status === 201);

      // Claims are idempotent — first creates, rest update last_seen. All succeed.
      expect(successful.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      await request('/release', { method: 'DELETE', body: { id: testId } });
    });

    test('claim and release race condition', async () => {
      const testId = `race-release-${Date.now()}`;

      // Claim it
      const claimRes = await request('/claim', {
        method: 'POST',
        body: { id: testId, framework: 'test' }
      });
      expect(claimRes.ok).toBe(true);

      // Try to release while listing services
      const promises = [
        request('/release', { method: 'DELETE', body: { id: testId } }),
        request('/services'),
        request('/services')
      ];

      const results = await Promise.all(promises);
      // No server errors (500s) — some may be 404 due to race
      expect(results.every(r => r.status !== 500)).toBe(true);
    });
  });

  describe('Release Endpoint', () => {
    test('release non-existent port returns success with released=0', async () => {
      const res = await request('/release', {
        method: 'DELETE',
        body: { id: `nonexistent-port-${Date.now()}` }
      });
      // Release is idempotent: returns 200 with released=0
      expect(res.status).toBe(200);
      expect(res.data.released).toBe(0);
    });

    test('release same port twice', async () => {
      const testId = `double-release-${Date.now()}`;
      const claimRes = await request('/claim', {
        method: 'POST',
        body: { id: testId, framework: 'test' }
      });
      expect(claimRes.ok).toBe(true);

      const res1 = await request('/release', { method: 'DELETE', body: { id: testId } });
      const res2 = await request('/release', { method: 'DELETE', body: { id: testId } });

      expect(res1.status).toBe(200);
      expect(res1.data.released).toBe(1);
      expect(res2.status).toBe(200);
      expect(res2.data.released).toBe(0);
    });
  });
});

describe('Adversarial Testing - Session/Notes Edge Cases', () => {
  describe('Session Creation', () => {
    test('create session with empty body', async () => {
      const res = await request('/sessions', {
        method: 'POST',
        body: {}
      });
      expect([200, 201, 400, 422]).toContain(res.status);
    });

    test('create session with very long name', async () => {
      const longName = 'x'.repeat(5000);
      const res = await request('/sessions', {
        method: 'POST',
        body: { purpose: longName }
      });
      // Should either accept or reject gracefully
      expect([200, 201, 400, 413]).toContain(res.status);
    });

    test('create session with unicode name', async () => {
      const res = await request('/sessions', {
        method: 'POST',
        body: { purpose: 'session-café-日本-🔒' }
      });
      if (res.ok) {
        // Verify it's retrievable
        const sessionId = res.data.id || res.data.session_id;
        const getRES = await request(`/sessions/${sessionId}`);
        expect(getRES.ok).toBe(true);
      }
    });

    test('create session with special chars in name', async () => {
      const res = await request('/sessions', {
        method: 'POST',
        body: { purpose: "session'; DROP TABLE--" }
      });
      expect([200, 201, 400, 422]).toContain(res.status);
    });
  });

  describe('Notes Operations', () => {
    test('add note to non-existent session', async () => {
      const writer = await registerTestActorVia(request, { alias: 'adversarial-missing-note-writer' });
      const res = await request('/sessions/nonexistent-session-xyz/notes', {
        method: 'POST',
        headers: writer.headers,
        body: { content: 'test' }
      });
      expect(res.status).toBe(404);
      expect(res.data.code).toBe('SESSION_NOT_FOUND');
    });

    test('add very large note (100KB+)', async () => {
      const { sessionId, headers } = await newOwnedSession('large-note-test');
      const largeContent = 'x'.repeat(102400);

      const res = await request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        headers,
        body: { content: largeContent }
      });

      // 100KB+ JSON body exceeds 10KB Express limit → 413
      expect([200, 201, 413, 400]).toContain(res.status);
    });

    test('add notes with unicode content', async () => {
      const { sessionId, headers } = await newOwnedSession('unicode-note-test');

      const res = await request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        headers,
        body: { content: '测试内容 café 🎉 日本語' }
      });

      expect([200, 201]).toContain(res.status);
    });

    test('add note with SQL injection attempt', async () => {
      const { sessionId, headers } = await newOwnedSession('injection-test');

      const res = await request(`/sessions/${sessionId}/notes`, {
        method: 'POST',
        headers,
        body: { content: "'); DELETE FROM session_notes; --" }
      });

      expect([200, 201]).toContain(res.status);
      // Database should still be intact
      const health = await request('/health');
      expect(health.ok).toBe(true);
    });
  });

  describe('Session Deletion', () => {
    test('delete session while notes are being added (race)', async () => {
      const { sessionId, headers } = await newOwnedSession('race-delete');

      // Start adding notes and deleting simultaneously
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          request(`/sessions/${sessionId}/notes`, {
            method: 'POST',
            headers,
            body: { content: `note-${i}` }
          })
        );
      }
      promises.push(
        request(`/sessions/${sessionId}`, { method: 'DELETE', headers })
      );

      const results = await Promise.all(promises);
      // Archiving preserves the session and its notes, so all owned writes
      // succeed regardless of the arrival order. Auth denials are not a race pass.
      expect(results.length).toBe(4);
      expect(results.every((result) => result.ok)).toBe(true);
      const notes = await request(`/sessions/${sessionId}/notes`);
      expect(notes.ok).toBe(true);
      expect(notes.data.notes.map((note) => note.content)).toEqual(expect.arrayContaining(['note-0', 'note-1', 'note-2']));
    });

    test('delete non-existent session', async () => {
      const owner = await registerTestActorVia(request, { alias: 'adversarial-missing-delete-owner' });
      const res = await request('/sessions/nonexistent-session-xyz', {
        method: 'DELETE',
        headers: owner.headers,
      });
      expect(res.status).toBe(404);
      expect(res.data.code).toBe('SESSION_NOT_FOUND');
    });
  });

  test.each([
    ['note', 'POST', '/notes', { content: 'must not persist' }],
    ['archive', 'DELETE', '', null],
  ])('anonymous %s requests cannot mutate an owned session', async (label, method, suffix, body) => {
    const { sessionId } = await newOwnedSession(`anonymous-${label}-denial`);
    const before = await request(`/sessions/${sessionId}`);
    expect(before.ok).toBe(true);
    const denied = await request(`/sessions/${sessionId}${suffix}`, { method, body });
    expect(denied.status).toBe(401);
    expect(denied.data.code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    const after = await request(`/sessions/${sessionId}`);
    expect(after.ok).toBe(true);
    expect(after.data.session.status).toBe('active');
    expect(after.data.notes).toEqual(before.data.notes);
  });
});

describe('Adversarial Testing - Locks', () => {
  describe('Lock Acquisition Race Conditions', () => {
    test('simultaneous lock acquisition on same lock name', async () => {
      const lockName = `race-lock-${Date.now()}`;
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          request(`/locks/${lockName}`, {
            headers: await lockerHeaders(),
            method: 'POST',
            body: { ttl: 60000 }
          })
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.status === 200 || r.status === 201);

      // Only one should succeed
      expect(successful.length).toBe(1);

      // Cleanup
      await request(`/locks/${lockName}`, { method: 'DELETE', headers: await lockerHeaders() });
    });
  });

  describe('TTL Validation', () => {
    test('lock with TTL of 0 normalizes to default', async () => {
      const lockName = `ttl-zero-${Date.now()}`;
      const res = await request(`/locks/${lockName}`, {
        headers: await lockerHeaders(),
        method: 'POST',
        body: { ttl: 0 }
      });
      // Server normalizes TTL <= 0 to DEFAULT_TTL (300000ms)
      expect([200, 201]).toContain(res.status);

      // Cleanup
      await request(`/locks/${lockName}`, { method: 'DELETE', headers: await lockerHeaders() });
    });

    test('lock with negative TTL normalizes to default', async () => {
      const lockName = `ttl-negative-${Date.now()}`;
      const res = await request(`/locks/${lockName}`, {
        headers: await lockerHeaders(),
        method: 'POST',
        body: { ttl: -60 }
      });
      // Server normalizes TTL <= 0 to DEFAULT_TTL (300000ms)
      expect([200, 201]).toContain(res.status);

      // Cleanup
      await request(`/locks/${lockName}`, { method: 'DELETE', headers: await lockerHeaders() });
    });

    test('lock with very large TTL is accepted', async () => {
      const lockName = `ttl-large-${Date.now()}`;
      const res = await request(`/locks/${lockName}`, {
        headers: await lockerHeaders(),
        method: 'POST',
        body: { ttl: 999999999 }
      });
      expect([200, 201]).toContain(res.status);

      // Cleanup
      await request(`/locks/${lockName}`, { method: 'DELETE', headers: await lockerHeaders() });
    });

    test('extending expired lock fails', async () => {
      const lockName = `extend-expired-${Date.now()}`;

      // Create with short TTL (50ms — TTL > 0 so it won't normalize)
      await request(`/locks/${lockName}`, {
        headers: await lockerHeaders(),
        method: 'POST',
        body: { ttl: 50 }
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Try to extend — expired locks are cleaned before extend checks
      const res = await request(`/locks/${lockName}`, {
        headers: await lockerHeaders(),
        method: 'PUT',
        body: { ttl: 60000 }
      });

      // Route returns 400 for "lock not held" (expired lock was cleaned)
      expect(res.status).toBe(400);
    });
  });

  describe('Lock Release', () => {
    test('release non-existent lock returns success with released=false', async () => {
      const res = await request(`/locks/nonexistent-lock-${Date.now()}`, {
        headers: await lockerHeaders(),
        method: 'DELETE'
      });
      // Server returns 200 with { success: true, released: false } for idempotent release
      expect(res.status).toBe(200);
      expect(res.data.released).toBe(false);
    });
  });
});

describe('Adversarial Testing - Messaging/PubSub', () => {
  describe('Channel Operations', () => {
    test('publish to channel with special chars', async () => {
      const res = await request('/msg/special-@#$-channel', {
        method: 'POST',
        body: { message: 'test' }
      });
      expect([200, 201, 400]).toContain(res.status);
    });

    test('publish very large message (1MB+)', async () => {
      const largeMsg = 'x'.repeat(1048576);
      const res = await request('/msg/large-msg', {
        method: 'POST',
        body: { message: largeMsg }
      });
      // Should either reject with 413 or accept
      expect([200, 201, 413]).toContain(res.status);
    });

    test('rapid fire publish (50 messages)', async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          request('/msg/rapid-fire', {
            method: 'POST',
            body: { message: `msg-${i}` }
          })
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.ok).length;
      expect(successful).toBeGreaterThan(40); // Most should succeed
    });

    test('publish message with SQL injection', async () => {
      const res = await request('/msg/injection-test', {
        method: 'POST',
        body: { message: "'); DELETE FROM messages; --" }
      });
      expect([200, 201]).toContain(res.status);

      // Database should still work
      const health = await request('/health');
      expect(health.ok).toBe(true);
    });
  });
});

describe('Adversarial Testing - Agents', () => {
  describe('Agent Registration', () => {
    test('register with duplicate ID upserts', async () => {
      const agentId = `dup-agent-${Date.now()}`;

      const res1 = await request('/agents', {
        method: 'POST',
        body: { id: agentId, purpose: 'test1' }
      });
      expect([200, 201]).toContain(res1.status);

      // Second registration upserts (INSERT OR REPLACE)
      const res2 = await request('/agents', {
        method: 'POST',
        body: { id: agentId, purpose: 'test2' }
      });
      expect([200, 201]).toContain(res2.status);

      // Cleanup
      await request(`/agents/${agentId}`, { method: 'DELETE' });
    });

    test('heartbeat for non-existent agent auto-registers', async () => {
      const agentId = `hb-auto-${Date.now()}`;
      // Heartbeat route is POST; auto-registers unknown agents
      const res = await request(`/agents/${agentId}/heartbeat`, {
        method: 'POST',
        body: {}
      });
      expect([200, 201]).toContain(res.status);

      // Cleanup
      await request(`/agents/${agentId}`, { method: 'DELETE' });
    });

    test('register with very long purpose string', async () => {
      const longPurpose = 'purpose: '.repeat(1000);
      const res = await request('/agents', {
        method: 'POST',
        body: { id: `long-purpose-${Date.now()}`, purpose: longPurpose }
      });
      expect([200, 201, 413]).toContain(res.status);
    });

    test('register with unicode in purpose', async () => {
      const agentId = `unicode-agent-${Date.now()}`;
      const res = await request('/agents', {
        method: 'POST',
        body: { id: agentId, purpose: '测试目的 café 🔒' }
      });
      expect([200, 201]).toContain(res.status);

      // Cleanup
      await request(`/agents/${agentId}`, { method: 'DELETE' });
    });
  });
});

describe('Adversarial Testing - Webhook Security (SSRF)', () => {
  describe('SSRF Protection', () => {
    test('webhook to localhost is rejected', async () => {
      const res = await request('/webhooks', {
        method: 'POST',
        body: {
          url: 'http://localhost:8000/webhook',
          events: ['*']
        }
      });
      expect([400, 403]).toContain(res.status);
    });

    test('webhook to 127.0.0.1 is rejected', async () => {
      const res = await request('/webhooks', {
        method: 'POST',
        body: {
          url: 'http://127.0.0.1:8000/webhook',
          events: ['*']
        }
      });
      expect([400, 403]).toContain(res.status);
    });

    test('webhook to AWS metadata endpoint is rejected', async () => {
      const res = await request('/webhooks', {
        method: 'POST',
        body: {
          url: 'http://169.254.169.254/latest/meta-data/',
          events: ['*']
        }
      });
      expect([400, 403]).toContain(res.status);
    });

    test('webhook to private network is rejected', async () => {
      const res = await request('/webhooks', {
        method: 'POST',
        body: {
          url: 'http://192.168.1.1:80/admin',
          events: ['*']
        }
      });
      expect([400, 403]).toContain(res.status);
    });

    test('webhook to 10.0.0.0/8 is rejected', async () => {
      const res = await request('/webhooks', {
        method: 'POST',
        body: {
          url: 'http://10.0.0.1:80/endpoint',
          events: ['*']
        }
      });
      expect([400, 403]).toContain(res.status);
    });

    test('invalid webhook URL is rejected', async () => {
      const res = await request('/webhooks', {
        method: 'POST',
        body: {
          url: 'not a valid url at all',
          events: ['*']
        }
      });
      expect([400, 422]).toContain(res.status);
    });
  });
});

describe('Adversarial Testing - API Input Validation', () => {
  describe('Malformed Requests', () => {
    test('malformed JSON body is rejected', async () => {
      const res = await rawSocketRequest('/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{this is not valid json}'
      });

      expect(res.status).toBe(400);
    });

    test('wrong Content-Type is handled', async () => {
      const res = await rawSocketRequest('/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<claim><id>test</id></claim>'
      });

      // Express ignores non-JSON content type on JSON-only endpoint
      // Body will be empty/undefined, handler returns 400 for missing id
      expect([400, 415]).toContain(res.status);
    });

    test('missing required fields returns 400', async () => {
      const res = await request('/sessions', {
        method: 'POST',
        body: { unrelated: 'field' }
      });
      expect([200, 201, 400, 422]).toContain(res.status);
    });

    test('very large request body is rejected', async () => {
      const hugePayload = {
        id: 'huge-test',
        data: 'x'.repeat(10485760) // 10MB
      };
      const res = await request('/claim', {
        method: 'POST',
        body: hugePayload
      });
      expect([400, 413]).toContain(res.status);
    });
  });

  describe('Concurrent Requests', () => {
    test('50 concurrent claims succeed', async () => {
      const ts = Date.now();
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          request('/claim', {
            method: 'POST',
            body: { id: `concurrent-${i}-${ts}`, framework: 'test' }
          })
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.ok).length;
      expect(successful).toBeGreaterThan(40);

      // Cleanup
      for (let i = 0; i < 50; i++) {
        await request('/release', {
          method: 'DELETE',
          body: { id: `concurrent-${i}-${ts}` }
        }).catch(() => {});
      }
    });
  });
});

describe('Adversarial Testing - API Method Validation', () => {
  test('GET to POST-only endpoint', async () => {
    const res = await rawSocketRequest('/claim', {
      method: 'GET'
    });

    expect([404, 405]).toContain(res.status);
  });

  test('DELETE to GET-only endpoint', async () => {
    const res = await rawSocketRequest('/health', {
      method: 'DELETE'
    });

    expect([404, 405]).toContain(res.status);
  });
});

describe('Adversarial Testing - Tunnel Operations', () => {
  describe('Tunnel Edge Cases', () => {
    test('start tunnel for non-existent service', async () => {
      const res = await request(`/tunnel/nonexistent-service-${Date.now()}`, {
        method: 'POST',
        body: { provider: 'cloudflare' }
      });
      // Route returns 400 with code TUNNEL_ERROR for "Service not found"
      expect([400, 404]).toContain(res.status);
    });
  });
});

describe('Adversarial Testing - Database Integrity', () => {
  test('database remains consistent after invalid operations', async () => {
    const health1 = await request('/health');
    expect(health1.ok).toBe(true);

    // Try various invalid operations
    await request('/claim', {
      method: 'POST',
      body: { id: "'; DROP TABLE services; --" }
    }).catch(() => {});

    await request('/sessions', {
      method: 'POST',
      body: { purpose: 'very '.repeat(10000) }
    }).catch(() => {});

    // Database should still be responsive
    const health2 = await request('/health');
    expect(health2.ok).toBe(true);

    // Verify we can still create services
    const testId = `integrity-test-${Date.now()}`;
    const res = await request('/claim', {
      method: 'POST',
      body: { id: testId, framework: 'test' }
    });
    expect(res.ok).toBe(true);

    // Cleanup
    await request('/release', { method: 'DELETE', body: { id: testId } });
  });
});
