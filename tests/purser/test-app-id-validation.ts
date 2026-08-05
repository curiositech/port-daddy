import { describe, it, expect } from 'vitest';
import { validateAppId } from '../../apps/fleet-executor/src/app-id-validation';

describe('App ID Validator', () => {
  it('should accept valid App ID', () => {
    expect(validateAppId('app1')).toBe(true);
  });

  it('should reject foreign App ID', () => {
    expect(validateAppId('foreign-app')).toBe(false);
  });

  it('should reject empty App ID', () => {
    expect(validateAppId('')).toBe(false);
  });

  it('should reject App ID with special characters', () => {
    expect(validateAppId('app#1')).toBe(false);
  });
});