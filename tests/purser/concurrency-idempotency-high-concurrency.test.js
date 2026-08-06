import { describe, it, beforeEach, afterEach } from 'vitest';
import { handleSessionIntelIngest } from '../../src/session-intel';
import { db } from '../../src/db';

const mockRequest = (digestDate) => ({
  json: async () => ({ digestDate }),
  status: 200
});

describe('High Concurrency Test', () => {
  beforeEach(() => {
    db.rows = [];
  });

  it('should handle 100 concurrent requests', async () => {
    const promises = Array(100).fill().map(() => handleSessionIntelIngest(mockRequest('2023-01-01')));
    const results = await Promise.all(promises);
    
    expect(results.every(r => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(r => r.json()));
    const totalAccepted = bodies.reduce((sum, b) => sum + b.accepted, 0);
    expect(totalAccepted).toBe(1);
    expect(db.rows.length).toBe(1);
  });
});