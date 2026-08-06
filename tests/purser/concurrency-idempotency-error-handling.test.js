import { describe, it, beforeEach, afterEach } from 'vitest';
import { handleSessionIntelIngest } from '../../src/session-intel';
import { db } from '../../src/db';

const mockRequest = (digestDate, errorOnFirst = false) => ({
  json: async () => {
    if (errorOnFirst) {
      throw new Error('Database error');
    }
    return { digestDate };
  },
  status: 200
});

describe('Concurrency Error Handling', () => {
  beforeEach(() => {
    db.rows = [];
  });

  it('should retry after database error', async () => {
    const promises = Array(3).fill().map((_, i) => 
      handleSessionIntelIngest(mockRequest('2023-01-01', i === 0))
    );
    const results = await Promise.all(promises);
    
    expect(results.every(r => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(r => r.json()));
    const totalAccepted = bodies.reduce((sum, b) => sum + b.accepted, 0);
    expect(totalAccepted).toBe(1);
    expect(db.rows.length).toBe(1);
  });

  it('should reject invalid idempotency keys', async () => {
    const promises = [
      handleSessionIntelIngest(mockRequest('2023-01-01')),
      handleSessionIntelIngest(mockRequest('invalid-date')),
      handleSessionIntelIngest(mockRequest('2023-01-01'))
    ];
    const results = await Promise.all(promises);
    
    expect(results.every(r => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(r => r.json()));
    const totalAccepted = bodies.reduce((sum, b) => sum + b.accepted, 0);
    expect(totalAccepted).toBe(2);
    expect(db.rows.length).toBe(2);
  });
});