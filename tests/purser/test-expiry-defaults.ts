import { describe, it, expect, beforeEach } from 'vitest';
import { handleExpiry } from '../src/mediator';

interface TestParley {
  id: string;
  prs: [number, number];
  expiry: string;
  outcome: string;
}

const mockParley: TestParley = {
  id: 'parley-1',
  prs: [1, 2],
  expiry: 'first-proceeds',
  outcome: '',
};

beforeEach(() => {
  // Reset any global state
});

describe('Helm Expiry Defaults', () => {
  it('applies first-proceeds outcome', async () => {
    const result = await handleExpiry(mockParley);
    expect(result.outcome).toBe('proceeds: alice/PR#1, rebases: bob/PR#2');
  });

  it('handles plain lapse without human intervention', async () => {
    const parley = { ...mockParley, expiry: 'lapse' };
    const result = await handleExpiry(parley);
    expect(result.outcome).toBe('Deadline lapsed - no agreement');
  });

  it('maintains v1 plain-lapse behavior', async () => {
    const parley = { ...mockParley, expiry: 'lapse' };
    const result = await handleExpiry(parley);
    expect(result.outcome).toBe('Deadline lapsed - no agreement');
  });
});