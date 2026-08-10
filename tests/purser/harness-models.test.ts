import { describe, it, expect } from 'vitest';
import { validateMergeGroupModel } from '../../apps/fleet-executor/harness-models';

describe('Harness Models', () => {
  it('rejects invalid PR head formats', () => {
    expect(() => validateMergeGroupModel({
      headSha: 12345, // invalid type
      syntheticSha: 'valid-sha',
      appId: 'valid-app-id',
    })).toThrow();
  });

  it('validates required fields presence', () => {
    expect(() => validateMergeGroupModel({
      syntheticSha: 'valid-sha',
      appId: 'valid-app-id',
    })).toThrow();
  });

  it('accepts valid model structure', () => {
    expect(() => validateMergeGroupModel({
      headSha: 'valid-sha',
      syntheticSha: 'valid-sha',
      appId: 'valid-app-id',
    })).not.toThrow();
  });
});