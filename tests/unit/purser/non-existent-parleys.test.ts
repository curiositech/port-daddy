// tests/unit/purser/non-existent-parleys.test.ts
import {
  worker,
  ALICE_SESSION,
  req,
  makeParleyDb,
  makeParleyEnv,
  seedDock,
} from '../../helpers';

describe('Non‑existent parley 404 responses', () => {
  it('malformed and non-existent parley paths return identical 404 responses', async () => {
    // Arrange: create a fresh database and environment
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);

    // Act: request a malformed percent‑escape
    const malformed = await worker.fetch(
      req('/account/parleys/%ZZ/dock', { session: ALICE_SESSION }),
      env,
      {} as ExecutionContext,
    );
    // And a well‑formed but non‑existent parley
    const ghost = await worker.fetch(
      req('/account/parleys/alice/ghost', { session: ALICE_SESSION }),
      env,
      {} as ExecutionContext,
    );

    // Assert: both are 404
    expect(malformed.status).toBe(404);
    expect(ghost.status).toBe(404);

    // Assert: bodies are non‑empty, contain "Not found", and match byte‑for‑byte
    const malformedBody = await malformed.text();
    const ghostBody = await ghost.text();

    expect(malformedBody.length).toBeGreaterThan(200);
    expect(malformedBody).toContain('Not found');
    expect(malformedBody).toBe(ghostBody);

    // Assert: headers are identical
    const headerKeys = ['Cache-Control', 'X-Robots-Tag', 'Content-Security-Policy'];
    for (const key of headerKeys) {
      expect(malformed.headers.get(key)).toBe(ghost.headers.get(key));
    }
  });
});