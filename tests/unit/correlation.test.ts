/**
 * Tests for lib/observability/correlation.ts — the requestId/actorId/tenantId threading that the
 * absence audit flagged as the #1 multi-tenant blocker. Guards:
 *   - context propagates across awaits            (AsyncLocalStorage survives async boundaries)
 *   - withCorrelation merges only present keys     (no null tenant_id noise on single-tenant dev)
 *   - nested scopes don't leak                     (one request can't see another's tenant)
 *   - request ids are unique within a process
 */

import { describe, expect, test } from '@jest/globals';
import { runWithContext, currentContext, withCorrelation, newRequestId } from '../../lib/observability/correlation.js';

describe('correlation context', () => {
  test('propagates across awaits', async () => {
    await runWithContext({ requestId: 'r1', tenantId: 't1' }, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      expect(currentContext().requestId).toBe('r1');
      expect(currentContext().tenantId).toBe('t1');
    });
  });

  test('withCorrelation merges only present keys', () => {
    expect(withCorrelation({ a: 1 })).toEqual({ a: 1 }); // outside scope: no null noise
    runWithContext({ tenantId: 't1' }, () => {
      expect(withCorrelation({ a: 1 })).toEqual({ a: 1, tenant_id: 't1' });
      expect(withCorrelation()).toEqual({ tenant_id: 't1' });
    });
  });

  test('nested scopes do not leak', () => {
    runWithContext({ tenantId: 'outer' }, () => {
      runWithContext({ tenantId: 'inner' }, () => {
        expect(currentContext().tenantId).toBe('inner');
      });
      expect(currentContext().tenantId).toBe('outer');
    });
    expect(currentContext().tenantId).toBeUndefined();
  });

  test('request ids are unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRequestId()));
    expect(ids.size).toBe(1000);
  });
});
