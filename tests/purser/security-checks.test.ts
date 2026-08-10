import { describe, it, expect } from 'vitest';
import { verifySecurityChecks } from '../../apps/fleet-executor/security-checks';

describe('Security Checks', () => {
  it('rejects incomplete run conclusions', async () => {
    const result = await verifySecurityChecks({
      conclusion: 'incomplete',
      status: 'success',
      appId: 'valid-app-id',
    });
    expect(result).toBeFalse();
  });

  it('blocks non-completed runs', async () => {
    const result = await verifySecurityChecks({
      conclusion: 'neutral',
      status: 'in_progress',
      appId: 'valid-app-id',
    });
    expect(result).toBeFalse();
  });

  it('validates App ID authenticity', async () => {
    const result = await verifySecurityChecks({
      conclusion: 'success',
      status: 'success',
      appId: 'malicious-app-id',
    });
    expect(result).toBeFalse();
  });
});