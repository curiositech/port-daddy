import { describe, it, beforeEach, afterEach } from 'vitest';
import { handleSessionIntelIngest } from '../../src/session-intel';
import { db } from '../../src/db';

const mockRequest = (digestDate) => ({
  json: async () => ({ digestDate }),
  status: 200
});

describe('Concurrency Edge Cases', () => {
  beforeEach(() => {
    db.rows = [];
  });

  it('should deduplicate 5 identical requests', async () => {
    const promises = Array(5).fill().map(() => handleSessionIntelIngest(mockRequest('2023-01-01')));
    const results = await Promise.all(promises);
    
    expect(results.every(r => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(r => r.json()));
    const totalAccepted = bodies.reduce((sum, b) => sum + b.accepted, 0);
    expect(totalAccepted).toBe(1);
    expect(db.rows.length).toBe(1);
  });

  it('should allow distinct digestDates', async () => {
    const dates = ['2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05'];
    const promises = dates.map(date => handleSessionIntelIngest(mockRequest(date)));
    const results = await Promise.all(promises);
    
    expect(results.every(r => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(r => r.json()));
    const totalAccepted = bodies.reduce((sum, b) => sum + b.accepted, 0);
    expect(totalAccepted).toBe(5);
    expect(db.rows.length).toBe(5);
  });

  it('should handle mixed requests', async () => {
    const promises = [
      handleSessionIntelIngest(mockRequest('2023-01-01')),
      handleSessionIntelIngest(mockRequest('2023-01-01')),
      handleSessionIntelIngest(mockRequest('2023-01-02')),
      handleSessionIntelIngest(mockRequest('2023-01-03')),
      handleSessionIntelIngest(mockRequest('2023-01-01'))
    ];
    const results = await Promise.all(promises);
    
    expect(results.every(r => r.status === 200)).toBe(true);
    const bodies = await Promise.all(results.map(r => r.json()));
    const totalAccepted = bodies.reduce((sum, b) => sum + b.accepted, 0);
    expect(totalAccepted).toBe(3);
    expect(db.rows.length).toBe(3);
  });
});