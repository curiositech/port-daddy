/**
 * Purser contract for #6048, obligation 6 — every bridge operation is
 * best-effort: a broken database must never let an exception escape
 * registerNode / appendTranscriptEvent / runProbeAndRecord, matching the
 * repo's existing "an audit write failure never aborts the run" posture.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). Defects in the authored
 * draft, each fixed while keeping the adversarial intent:
 *
 *   1. UNDISCOVERABLE + NAME CLASH. tests/purser/test-error-handling.js
 *      matched no jest testMatch pattern — and the draft OVERWROTE a
 *      pre-existing, unrelated whitepaper-suite file of the same name that
 *      was already on this branch. The clobbered original is restored at its
 *      old path; this repair lives here under a name that says what it tests.
 *   2. WRONG MODULE SYSTEM + DEPTH. CommonJS `require('../lib/...')` in a
 *      `"type": "module"` repo, one `../` short of the repo root.
 *   3. FANTASY FIXTURE. `require('./test-utils')` imported a shared `db` the
 *      draft then never even used — every assertion here is against a
 *      deliberately broken db.
 *   4. VACUOUS ASYNC ASSERTION. `expect(() => bridge.runProbeAndRecord(...))
 *      .not.toThrow()` proves nothing about an async method: an `async`
 *      function NEVER throws synchronously — the failure mode is a rejected
 *      promise, which that draft assertion would have declared a pass.
 *      Repaired to await the promise and require it to resolve.
 *
 * The broken-db shape is strengthened too: `prepare()` itself throws (the
 * PR's own contract test uses the same shape), so the very first ledger touch
 * explodes — the strictest honest version of "a broken db".
 */
import { describe, it, expect } from '@jest/globals';
import { createSpawnerHarborBridge } from '../../../lib/agent-harbor/spawner-bridge.js';

describe('purser #6048 — best-effort error handling', () => {
  it('never lets a broken db throw out of any public bridge method', async () => {
    const badDb = {
      prepare: () => {
        throw new Error('DB error');
      },
    };
    const bridge = createSpawnerHarborBridge(badDb);

    expect(() => bridge.registerNode('purser-agent-123', 'id', Date.now())).not.toThrow();
    expect(() => bridge.appendTranscriptEvent('purser-agent-123', 'spawn-start', Date.now())).not.toThrow();

    // The async method must RESOLVE (fire-and-forget contract: never
    // rejects), not merely avoid a synchronous throw.
    await expect(bridge.runProbeAndRecord('purser-agent-123')).resolves.toBeUndefined();
  });
});
