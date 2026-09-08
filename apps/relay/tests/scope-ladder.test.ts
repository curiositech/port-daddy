import { describe, it, expect } from 'vitest';
import { SCOPE_TIERS, tierRank, widensScope } from '../src/scope-ladder.js';

describe('scope ladder (ADR-0101 single source of truth)', () => {
  it('declares the tiers once, in order', () => {
    expect(SCOPE_TIERS).toEqual(['private', 'repo', 'team', 'public']);
  });

  it('ranks tiers by widening scope', () => {
    expect(tierRank('private')).toBeLessThan(tierRank('repo'));
    expect(tierRank('repo')).toBeLessThan(tierRank('team'));
    expect(tierRank('team')).toBeLessThan(tierRank('public'));
  });

  it('widensScope is true only when moving toward a wider tier', () => {
    expect(widensScope('private', 'public')).toBe(true);
    expect(widensScope('repo', 'team')).toBe(true);
    expect(widensScope('team', 'repo')).toBe(false);
    expect(widensScope('public', 'public')).toBe(false);
  });
});
