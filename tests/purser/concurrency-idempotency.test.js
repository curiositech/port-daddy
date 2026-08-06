import { describe, it, expect } from 'vitest';
import { handleSessionIntelIngest } from '../../apps/relay/src/session-intel.js';
import { makeD1, makeEnv } from '../session-intel.test.js';

const OPERATOR = 'super-secret-operator-token-32bytes-min';

describe('Concurrency and Idempotency', () => {
  it('handles concurrent uploads with same digestDate', async () => {
    const { db } = makeD1();
    const env = makeEnv(db);
    const digestDate = '2026-08-05';
    const findings = [{
      kind: 'recurring-eureka-arc',
      title: 'test',
      occurrences: 1,
      sessionCount: 2,
      payload: {}
    }];

    // Simulate concurrent uploads
    const promises = Array.from({ length: 5 }, () =>
      handleSessionIntelIngest(
        new Request('https://relay.example.com/v1/session-intel/ingest', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPERATOR}` },
          body: JSON.stringify({ digestDate, findings })
        }),
        env
      )
    );

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.status === 200);

    expect(successful.length).toBe(1);
    expect(db.rows.length).toBe(1);
    expect(db.rows[0].digest_date).toBe(digestDate);
  });

  it('prevents duplicate inserts for same digestDate', async () => {
    const { db } = makeD1();
    const env = makeEnv(db);
    const digestDate = '2026-08-05';
    const findings = [{
      kind: 'recurring-eureka-arc',
      title: 'test',
      occurrences: 1,
      sessionCount: 2,
      payload: {}
    }];

    await handleSessionIntelIngest(
      new Request('https://relay.example.com/v1/session-intel/ingest', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPERATOR}` },
        body: JSON.stringify({ digestDate, findings })
      }),
      env
    );

    const res = await handleSessionIntelIngest(
      new Request('https://relay.example.com/v1/session-intel/ingest', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPERATOR}` },
        body: JSON.stringify({ digestDate, findings })
      }),
      env
    );

    expect(res.status).toBe(200);
    expect(db.rows.length).toBe(1);
  });
});