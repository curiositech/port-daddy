/**
 * Regression test for the 313 GB write storm: a permanently-failing embedder (missing ONNX dylib)
 * must NOT be re-loaded on every fleet-agent tick, and must NOT log a full error per tick.
 *
 * Before the fix, `getEmbedder()` cached a rejected promise forever and `resolveAlias`'s catch logged
 * `semantic_resolution_failed` + wrote a DB row on all 7,182 fleet-agent observations. This test
 * simulates 40 ticks against a resolver wired with the gated loader + governed logging and asserts
 * the load stops after the breaker opens and the log collapses to a handful of lines.
 */

import { describe, test, expect } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createGraphEdges } from '../../lib/graph-edges.js';
import { createSemanticResolver } from '../../lib/semantic-resolver.js';
import { LogGovernor } from '../../lib/observability/log-governor.js';

function alias(raw: string, canonical: string, fingerprint: string) {
  return { raw, canonical, tokens: canonical.split(' '), fingerprint };
}

describe('semantic resolver — resilience under a broken embedder', () => {
  test('a permanently-failing embedder stops re-loading and stops spamming after a few ticks', async () => {
    const db = createTestDb();
    const graphEdges = createGraphEdges(db);

    let factoryCalls = 0;
    const lines: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
    const push = (level: string) => (message: string, meta?: Record<string, unknown>) => lines.push({ level, message, meta });
    const governor = new LogGovernor(
      { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
      { windowMs: 60_000, burst: 3, now: () => 0 },
    );

    const resolver = createSemanticResolver(db, {
      modelId: 'mock-mini-lm',
      graphEdges,
      governor,
      embedderFactory: async () => {
        factoryCalls++;
        throw new Error('dlopen: Library not loaded: @rpath/libonnxruntime.1.24.3.dylib');
      },
    });

    // Simulate 40 fleet-agent ticks, each observing a fresh (cache-missing) alias needing embedding.
    for (let tick = 0; tick < 40; tick++) {
      resolver.observeAliases({
        projectDir: '/x',
        harbor: 'h',
        sourceType: 'memory',
        sourceId: `s-${tick}`,
        agentId: 'a',
        aliases: [alias(`raw term ${tick}`, `canon ${tick}`, `fp-${tick}`)],
      });
      await resolver.flush();
    }

    // The breaker opened after failureThreshold (3) load attempts — the native load is NOT retried 40×.
    expect(factoryCalls).toBeLessThanOrEqual(3);

    // Logging collapsed: `semantic_resolution_failed` emitted at most `burst` times, not once per tick.
    const failEmissions = lines.filter((l) => l.message === 'semantic_resolution_failed' && !l.meta?.log_rollup);
    expect(failEmissions.length).toBeLessThanOrEqual(3);
    expect(failEmissions.length).toBeGreaterThan(0); // it DID surface the problem — just didn't storm

    db.close();
  });
});
