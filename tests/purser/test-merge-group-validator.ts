import { describe, it, expect } from 'vitest';
import { validateMergeGroup } from '../../apps/fleet-executor/src/merge-group-validator';

describe('Merge Group Validator', () => {
  it('should pass with all valid App-owned checks', () => {
    const prs = [{ head: 'sha1', appId: 'app1', checkStatus: 'success' }, { head: 'sha2', appId: 'app1', checkStatus: 'neutral' }];
    expect(validateMergeGroup(prs)).toBe(true);
  });

  it('should fail on mismatched App ID', () => {
    const prs = [{ head: 'sha1', appId: 'app2', checkStatus: 'success' }];
    expect(validateMergeGroup(prs)).toBe(false);
  });

  it('should fail on missing App-owned check', () => {
    const prs = [{ head: 'sha1', appId: 'app1', checkStatus: 'pending' }];
    expect(validateMergeGroup(prs)).toBe(false);
  });

  it('should fail on spoofed App ID', () => {
    const prs = [{ head: 'sha1', appId: 'malicious-app', checkStatus: 'success' }];
    expect(validateMergeGroup(prs)).toBe(false);
  });
});