import { describe, it, expect } from 'vitest';
import { validateDependencies } from '../../apps/fleet-executor/dependency-validation';

describe('Dependency Validation', () => {
  it('blocks missing critical dependencies', () => {
    expect(validateDependencies({
      requiredDeps: ['dep1'],
      installedDeps: []
    })).toBeFalse();
  });

  it('allows complete dependency graph', () => {
    expect(validateDependencies({
      requiredDeps: ['dep1', 'dep2'],
      installedDeps: ['dep1', 'dep2']
    })).toBeTrue();
  });

  it('rejects malicious dependency patterns', () => {
    expect(validateDependencies({
      requiredDeps: ['malicious-package'],
      installedDeps: ['malicious-package']
    })).toBeFalse();
  });
});