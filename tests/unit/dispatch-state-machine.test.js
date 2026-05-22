/**
 * Tests for lib/dispatch/state-machine.ts -- the transition table.
 *
 * The test cases enumerate every legal transition and a representative
 * sample of illegal ones. The transition table is small enough (8 live
 * states + 2 terminals, ~10 legal arrows + 2 privileged-jump arrows per
 * non-terminal) that we can hit it exhaustively.
 */

import {
  canTransition,
  assertTransition,
  nextStates,
  isTerminal,
  isNonTerminal,
  describeState,
  stateGlyph,
  TERMINAL_STATES,
} from '../../lib/dispatch/state-machine.js';

const ALL_STATES = [
  'proposed',
  'claimed',
  'in_progress',
  'produced',
  'review_pending',
  'accepted',
  'rejected',
  'settled',
  'failed',
  'salvage',
];

describe('canTransition -- legal forward arrows', () => {
  test.each([
    ['proposed', 'claimed'],
    ['claimed', 'in_progress'],
    ['in_progress', 'produced'],
    ['produced', 'review_pending'],
    ['review_pending', 'accepted'],
    ['review_pending', 'rejected'],
    ['accepted', 'settled'],
    ['rejected', 'salvage'],
  ])('%s -> %s is legal', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
});

describe('canTransition -- privileged jumps from non-terminal', () => {
  const nonTerminal = ['proposed', 'claimed', 'in_progress', 'produced', 'review_pending', 'accepted', 'rejected'];

  test.each(nonTerminal.map((s) => [s]))('%s -> failed is legal', (from) => {
    expect(canTransition(from, 'failed')).toBe(true);
  });

  test.each(nonTerminal.map((s) => [s]))('%s -> salvage is legal', (from) => {
    expect(canTransition(from, 'salvage')).toBe(true);
  });
});

describe('canTransition -- illegal transitions', () => {
  test('terminal states have no outgoing edges', () => {
    for (const term of TERMINAL_STATES) {
      for (const to of ALL_STATES) {
        if (to === term) continue;
        expect(canTransition(term, to)).toBe(false);
      }
    }
  });

  test('cannot skip ahead in the linear path', () => {
    expect(canTransition('proposed', 'in_progress')).toBe(false);
    expect(canTransition('claimed', 'produced')).toBe(false);
    expect(canTransition('in_progress', 'review_pending')).toBe(false);
    expect(canTransition('produced', 'accepted')).toBe(false);
    expect(canTransition('produced', 'rejected')).toBe(false);
  });

  test('cannot go backwards', () => {
    expect(canTransition('claimed', 'proposed')).toBe(false);
    expect(canTransition('in_progress', 'claimed')).toBe(false);
    expect(canTransition('accepted', 'review_pending')).toBe(false);
  });

  test('self-transition is not a transition', () => {
    for (const s of ALL_STATES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  test('cannot cross between the accepted and rejected branches', () => {
    // Forward path only -- accepted cannot become rejected or vice versa.
    expect(canTransition('accepted', 'rejected')).toBe(false);
    expect(canTransition('rejected', 'accepted')).toBe(false);
    // Natural target of rejected is salvage, not settled.
    expect(canTransition('rejected', 'settled')).toBe(false);
    // Privileged jumps (failed, salvage) ARE legal from accepted -- it is
    // non-terminal until settled. This is the operator escape hatch: an
    // accepted dispatch can be salvaged if the merge breaks prod.
    expect(canTransition('accepted', 'salvage')).toBe(true);
    expect(canTransition('accepted', 'failed')).toBe(true);
  });
});

describe('assertTransition', () => {
  test('does not throw on legal transitions', () => {
    expect(() => assertTransition('proposed', 'claimed')).not.toThrow();
    expect(() => assertTransition('in_progress', 'failed')).not.toThrow();
  });

  test('throws with a clear message on illegal transitions', () => {
    expect(() => assertTransition('proposed', 'settled')).toThrow(/illegal/);
    expect(() => assertTransition('settled', 'failed')).toThrow(/illegal/);
  });
});

describe('nextStates', () => {
  test('proposed -> [claimed, failed, salvage]', () => {
    expect(nextStates('proposed').sort()).toEqual(['claimed', 'failed', 'salvage']);
  });

  test('review_pending -> [accepted, rejected, failed, salvage]', () => {
    expect(nextStates('review_pending').sort()).toEqual(
      ['accepted', 'failed', 'rejected', 'salvage'],
    );
  });

  test('accepted -> [settled, failed, salvage]', () => {
    expect(nextStates('accepted').sort()).toEqual(['failed', 'salvage', 'settled']);
  });

  test('settled (terminal) -> []', () => {
    expect(nextStates('settled')).toEqual([]);
  });

  test('failed (terminal) -> []', () => {
    expect(nextStates('failed')).toEqual([]);
  });
});

describe('isTerminal / isNonTerminal', () => {
  test('terminal states are settled, failed, salvage', () => {
    expect(isTerminal('settled')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('salvage')).toBe(true);
  });

  test('all other states are non-terminal', () => {
    for (const s of ['proposed', 'claimed', 'in_progress', 'produced', 'review_pending', 'accepted', 'rejected']) {
      expect(isNonTerminal(s)).toBe(true);
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe('describeState + stateGlyph', () => {
  test('every state has a non-empty description', () => {
    for (const s of ALL_STATES) {
      expect(typeof describeState(s)).toBe('string');
      expect(describeState(s).length).toBeGreaterThan(0);
    }
  });

  test('every state has a single-character glyph', () => {
    for (const s of ALL_STATES) {
      const g = stateGlyph(s);
      expect(g.length).toBe(1);
    }
  });

  test('glyphs are unique across states (no two states share a glyph)', () => {
    const seen = new Set();
    for (const s of ALL_STATES) {
      const g = stateGlyph(s);
      expect(seen.has(g)).toBe(false);
      seen.add(g);
    }
  });
});
