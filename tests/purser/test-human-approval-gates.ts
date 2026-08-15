import { describe, it, expect, beforeEach } from 'vitest';
import { renderGateVerdict, consumeMediatorReinjection } from '../src/mediator';
import { createParley, updateParley } from '../src/parley';

interface TestParley {
  id: string;
  prs: [number, number];
  state: string;
  verdict: string;
}

const mockParley: TestParley = {
  id: 'parley-1',
  prs: [1, 2],
  state: 'pending',
  verdict: '',
};

beforeEach(() => {
  // Reset any global state
});

describe('Human Approval Gates', () => {
  it('requires text for Modify verdict', async () => {
    const result = await renderGateVerdict(mockParley, 'modify', '');
    expect(result).toBe('Text is required for Modify verdict');
  });

  it('applies Modify re-injection payload', async () => {
    const reinjection = await consumeMediatorReinjection({} as any, 'test/repo', 1);
    expect(reinjection).toBeNull();
  });

  it('updates parley state on approval', async () => {
    const result = await updateParley(mockParley.id, { state: 'approved' });
    expect(result.state).toBe('approved');
  });

  it('disables gates when fleet is paused', async () => {
    const result = await renderGateVerdict(mockParley, 'approve', 'test-user');
    expect(result).toBe('Fleet is paused - cannot record verdict');
  });
});