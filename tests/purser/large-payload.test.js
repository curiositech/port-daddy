import { describe, it, expect } from 'vitest';
import { handleSessionIntelIngest } from '../../apps/relay/src/session-intel.js';
import { makeD1, makeEnv } from '../session-intel.test.js';

const OPERATOR = 'super-secret-operator-token-32bytes-min';

describe('Large Payload Handling', () => {
  it('accepts 200 findings with large payloads', async () => {
    const { db } = makeD1();
    const env = makeEnv(db);
    const findings = Array.from({ length: 200 }, (_, i) => ({
      kind: 'recurring-eureka-arc',
      title: `test-${i}`,
      occurrences: 1,
      sessionCount: 2,
      payload: {
        largeData: 'a'.repeat(10000)
      }
    }));

    const res = await handleSessionIntelIngest(
      new Request('https://relay.example.com/v1/session-intel/ingest', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPERATOR}` },
        body: JSON.stringify({
          digestDate: '2026-08-05',
          findings
        })
      }),
      env
    );

    expect(res.status).toBe(200);
    expect(db.rows.length).toBe(200);
  });

  it('rejects batch with 201 findings', async () => {
    const { db } = makeD1();
    const env = makeEnv(db);
    const findings = Array.from({ length: 201 }, () => ({
      kind: 'recurring-eureka-arc',
      title: 'test',
      occurrences: 1,
      sessionCount: 2,
      payload: {}
    }));

    const res = await handleSessionIntelIngest(
      new Request('https://relay.example.com/v1/session-intel/ingest', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPERATOR}` },
        body: JSON.stringify({
          digestDate: '2026-08-05',
          findings
        })
      }),
      env
    );

    expect(res.status).toBe(400);
    expect(db.rows.length).toBe(0);
  });
});