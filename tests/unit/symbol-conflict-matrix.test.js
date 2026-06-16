import { matrixConflict, isContractChanging, coerceClaimType, ALL_CLAIM_TYPES } from '../../lib/symbol-conflict-matrix.js';

describe('matrixConflict', () => {
  test('read/modify pair matches the skill matrix', () => {
    expect(matrixConflict('modify', 'modify')).toBe('blocking');
    expect(matrixConflict('modify', 'read')).toBe('warning');
    expect(matrixConflict('read', 'read')).toBe('safe');
  });

  test('two creations are safe; creation vs delete/rename is not', () => {
    expect(matrixConflict('add-sibling', 'add-sibling')).toBe('safe');
    expect(matrixConflict('add-sibling', 'delete')).toBe('warning');
    expect(matrixConflict('add-sibling', 'rename')).toBe('warning');
    expect(matrixConflict('add-child', 'add-child')).toBe('warning');
  });

  test('delete and rename clash with everything except a sibling-add (warning)', () => {
    for (const other of ['modify', 'read', 'add-child', 'delete', 'rename']) {
      expect(matrixConflict('rename', other)).toBe('blocking');
      expect(matrixConflict('delete', other)).toBe('blocking');
    }
    expect(matrixConflict('rename', 'add-sibling')).toBe('warning');
  });

  test('is symmetric', () => {
    for (const a of ALL_CLAIM_TYPES) for (const b of ALL_CLAIM_TYPES) {
      expect(matrixConflict(a, b)).toBe(matrixConflict(b, a));
    }
  });

  test('unknown type falls back to warning (fail-safe)', () => {
    expect(matrixConflict('weird', 'modify')).toBe('warning');
  });
});

describe('isContractChanging', () => {
  test('modify/delete/rename change the contract; read/adds do not', () => {
    expect(['modify', 'delete', 'rename'].every(isContractChanging)).toBe(true);
    expect(['read', 'add-sibling', 'add-child'].some(isContractChanging)).toBe(false);
  });
});

describe('coerceClaimType', () => {
  test('passes valid types, defaults the rest to modify', () => {
    expect(coerceClaimType('rename')).toBe('rename');
    expect(coerceClaimType('add-sibling')).toBe('add-sibling');
    expect(coerceClaimType('garbage')).toBe('modify');
    expect(coerceClaimType(undefined)).toBe('modify');
  });
});
