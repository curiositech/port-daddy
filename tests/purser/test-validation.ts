import { validateBudgetUsd, validateTelemetry, required, parseJsonObject } from '../../lib/agent-run-receipts';

describe('Validation Functions', () => {
  test('validateBudgetUsd rejects NaN', () => {
    expect(() => validateBudgetUsd(NaN)).toThrow();
  });

  test('validateBudgetUsd rejects Infinity', () => {
    expect(() => validateBudgetUsd(Infinity)).toThrow();
  });

  test('validateBudgetUsd rejects negative numbers', () => {
    expect(() => validateBudgetUsd(-1)).toThrow();
  });

  test('required throws for empty string', () => {
    expect(() => required('', 'test')).toThrow();
  });

  test('required rejects null bytes', () => {
    expect(() => required('a\0b', 'test')).toThrow();
  });

  test('parseJsonObject returns null for invalid JSON', () => {
    expect(parseJsonObject<Record<string, unknown>>('invalid')).toBeNull();
  });
});