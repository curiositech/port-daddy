// tests/unit/purser/fail-closed-http-route-scaffold.test.ts

import express from 'express';
import request from 'supertest';
import router from '../../../routes';

describe('Harbor Editor recovery routes must be fail‑closed', () => {
  // Build a minimal Express app that mounts the repository's router.
  const app = express();
  app.use(express.json());
  app.use('/', router);

  // The four recovery endpoints that the contract guarantees exist.
  const recoveryPaths = [
    '/editor/recovery/request',
    '/editor/recovery/prepare',
    '/editor/recovery/replay',
    '/editor/recovery/finalize',
  ] as const;

  // Helper to assert the 503 response shape.
  const assertFailClosed = (res: request.Response) => {
    expect(res.status).toBe(503);
    // The scaffold returns a JSON body with a `detail` field.
    if (res.body && typeof res.body === 'object') {
      expect(res.body.detail).toBe('editor-recovery-authority-unavailable');
    } else {
      // Fallback: the body might be plain text; ensure the token appears.
      expect(res.text).toContain('editor-recovery-authority-unavailable');
    }
  };

  // Verify that **any** POST payload is rejected.
  for (const path of recoveryPaths) {
    test(`POST ${path} → 503 Service Unavailable (fail‑closed)`, async () => {
      const res = await request(app).post(path).send({ arbitrary: 'payload' });
      assertFailClosed(res);
    });
  }

  // Verify that other HTTP verbs are also denied (the scaffold should reject everything).
  for (const path of recoveryPaths) {
    test(`GET ${path} → 503 Service Unavailable (fail‑closed)`, async () => {
      const res = await request(app).get(path);
      assertFailClosed(res);
    });
  }
});