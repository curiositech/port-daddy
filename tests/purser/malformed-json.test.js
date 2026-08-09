import { describe, it, expect } from 'vitest';
import { handleSessionIntelIngest } from '../../apps/relay/src/session-intel.js';
import { makeD1, makeEnv } from '../session-intel.test.js';

const OPERATOR = 'super-secret-operator-token-32bytes-min';

describe('Malformed JSON Handling', () => {
  it('rejects invalid JSON payloads', async () => {
    const { db } = makeD1();
    const env = makeEnv(db);
    const invalidPayload = '{ "digestDate": "2026-08-05", "findings": [{ "kind": "recurring-eureka-arc", "title": "test", "occurrences": 1, "sessionCount": 2, "payload": {"invalid": "syntax" } ]';

    const res = await handleSessionIntelIngest(
      new Request('https://relay.example.com/v1/session-intel/ingest', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPERATOR}` },
        body: invalidPayload
      }),
      env
    );

    expect(res.status).toBe(400);
    expect(db.rows.length).toBe(0);
  });

  it('rejects missing required fields', async () => {
    const { db } = makeD1();
    const env = makeEnv(db);
    const findings = [{
      kind: 'recurring-eureka-arc',
      title: 'test',
      occurrences: 1,
      sessionCount: 2,
      payload: {}
    }];

    const res = await handleSessionIntelIngest(
      new Request('https://relay.example.com/v1/session-intel/ingest', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPERATOR}` },
        body: JSON.stringify({
          digestDate: '2026-08-05',
          findings: [{ ...findings[0], title: undefined }]
        })
      }),
      env
    );

    expect(res.status).toBe(400);
    expect(db.rows.length).toBe(0);
  });
});