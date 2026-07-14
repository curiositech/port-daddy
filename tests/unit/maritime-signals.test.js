/**
 * Unit tests for lib/maritime-signals.ts — canonical PD state ↔ ICS letter map.
 */
import { describe, test, expect } from '@jest/globals';
import {
  SIGNAL_FOR_STATE,
  STATE_FOR_SIGNAL,
  ICS_MEANING,
  NATO_PHONETIC,
  SIGNAL_ANSI,
  HOISTS,
  signalFor,
  stateFor,
  formatSignal,
  colorize,
} from '../../lib/maritime-signals.js';

const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const ALL_STATES = [
  'claim-active', 'claim-stale', 'awaiting-human', 'burning-cash',
  'conflict', 'blocked', 'idle', 'spawning', 'fleet-healthy',
  'mayday', 'inform', 'request', 'refuse', 'affirmative',
];

describe('SIGNAL_FOR_STATE', () => {
  test('all 14 coordination states map to exactly one signal letter', () => {
    expect(Object.keys(SIGNAL_FOR_STATE).sort()).toEqual([...ALL_STATES].sort());
    for (const state of ALL_STATES) {
      const code = SIGNAL_FOR_STATE[state];
      expect(typeof code).toBe('string');
      expect(code).toHaveLength(1);
      expect(ALL_LETTERS).toContain(code);
    }
  });

  test('canonical mappings match the spec (post-research-pass)', () => {
    expect(SIGNAL_FOR_STATE['claim-active']).toBe('H');     // Hotel — pilot on board
    expect(SIGNAL_FOR_STATE['claim-stale']).toBe('Y');      // Yankee — dragging anchor
    expect(SIGNAL_FOR_STATE['awaiting-human']).toBe('F');   // Foxtrot — disabled; communicate
    expect(SIGNAL_FOR_STATE['burning-cash']).toBe('B');     // Bravo — carrying dangerous cargo
    expect(SIGNAL_FOR_STATE['conflict']).toBe('V');         // Victor — require assistance
    expect(SIGNAL_FOR_STATE['blocked']).toBe('D');          // Delta — maneuvering with difficulty
    expect(SIGNAL_FOR_STATE['idle']).toBe('M');             // Mike — stopped, no way through water
    expect(SIGNAL_FOR_STATE['spawning']).toBe('A');         // Alfa — diver down, keep clear
    expect(SIGNAL_FOR_STATE['fleet-healthy']).toBe('P');    // Papa / Blue Peter — about to sail
    expect(SIGNAL_FOR_STATE['mayday']).toBe('J');           // Juliett — on fire, dangerous cargo
    expect(SIGNAL_FOR_STATE['inform']).toBe('R');           // Procedure signal — received
    expect(SIGNAL_FOR_STATE['request']).toBe('K');          // Kilo — wish to communicate
    expect(SIGNAL_FOR_STATE['refuse']).toBe('N');           // November — negative
    expect(SIGNAL_FOR_STATE['affirmative']).toBe('C');      // Charlie — affirmative
  });
});

describe('ICS_MEANING & NATO_PHONETIC — all 26 letters', () => {
  test('every letter has an ICS_MEANING entry that is a non-empty string', () => {
    for (const letter of ALL_LETTERS) {
      expect(typeof ICS_MEANING[letter]).toBe('string');
      expect(ICS_MEANING[letter].length).toBeGreaterThan(0);
    }
    expect(Object.keys(ICS_MEANING).length).toBe(26);
  });

  test('every letter has a NATO_PHONETIC entry that is a non-empty string', () => {
    for (const letter of ALL_LETTERS) {
      expect(typeof NATO_PHONETIC[letter]).toBe('string');
      expect(NATO_PHONETIC[letter].length).toBeGreaterThan(0);
    }
    expect(Object.keys(NATO_PHONETIC).length).toBe(26);
  });

  test('every letter has a SIGNAL_ANSI entry', () => {
    for (const letter of ALL_LETTERS) {
      expect(typeof SIGNAL_ANSI[letter]).toBe('string');
    }
    expect(Object.keys(SIGNAL_ANSI).length).toBe(26);
  });

  test('NATO_PHONETIC anchors known canonical names', () => {
    expect(NATO_PHONETIC.A).toBe('Alpha');
    expect(NATO_PHONETIC.H).toBe('Hotel');
    expect(NATO_PHONETIC.K).toBe('Kilo');
    expect(NATO_PHONETIC.W).toBe('Whiskey');
    expect(NATO_PHONETIC.Y).toBe('Yankee');
  });

  test('R is labeled as a procedure acknowledgement, not 1931 single-letter folklore', () => {
    expect(ICS_MEANING.R).toBe('No 1969 single-letter meaning; procedure signal: Received');
    expect(ICS_MEANING.R).not.toMatch(/way is off my ship/i);
  });
});

describe('signalFor / stateFor — bidirectional inverse for canonical pairs', () => {
  test('signalFor is the inverse of stateFor for all canonical mappings', () => {
    // Every state has a unique letter under the post-research mapping
    for (const state of ALL_STATES) {
      const letter = signalFor(state);
      expect(stateFor(letter)).toBe(state);
    }
  });

  test('signalFor throws on unknown state (fail-loud)', () => {
    expect(() => signalFor('not-a-state')).toThrow(/unknown coordination state/);
    expect(() => signalFor('')).toThrow(/unknown coordination state/);
    expect(() => signalFor(undefined)).toThrow(/unknown coordination state/);
  });

  test('stateFor returns undefined for letters without a PD state', () => {
    expect(stateFor('E')).toBeUndefined();
    expect(stateFor('G')).toBeUndefined();
    expect(stateFor('I')).toBeUndefined();
    expect(stateFor('L')).toBeUndefined();
    expect(stateFor('Q')).toBeUndefined();
    expect(stateFor('U')).toBeUndefined();
    expect(stateFor('W')).toBeUndefined();
    expect(stateFor('Z')).toBeUndefined();
  });
});

describe('formatSignal', () => {
  test('formatSignal("claim-active") === "[H] claim-active"', () => {
    expect(formatSignal('claim-active')).toBe('[H] claim-active');
  });

  test('formatSignal works for all canonical states', () => {
    expect(formatSignal('mayday')).toBe('[J] mayday');
    expect(formatSignal('blocked')).toBe('[D] blocked');
    expect(formatSignal('refuse')).toBe('[N] refuse');
    expect(formatSignal('awaiting-human')).toBe('[F] awaiting-human');
    expect(formatSignal('burning-cash')).toBe('[B] burning-cash');
    expect(formatSignal('request')).toBe('[K] request');
  });
});

describe('colorize', () => {
  test('colorize wraps with the signal letter and a reset', () => {
    const out = colorize('claim-active', 'foo');
    // claim-active → H → green
    expect(out).toContain('[H] foo');
  });

  test('colorize defaults label to the state name', () => {
    const out = colorize('claim-active');
    expect(out).toContain('[H] claim-active');
  });
});

describe('HOISTS', () => {
  test('every hoist has at least one letter member', () => {
    for (const [name, hoist] of Object.entries(HOISTS)) {
      expect(Array.isArray(hoist.letters)).toBe(true);
      expect(hoist.letters.length).toBeGreaterThan(0);
      for (const letter of hoist.letters) {
        expect(ALL_LETTERS).toContain(letter);
      }
      expect(typeof hoist.meaning).toBe('string');
      expect(hoist.meaning.length).toBeGreaterThan(0);
      void name;
    }
  });

  test('canonical hoists are present', () => {
    expect(HOISTS['K-1']).toBeDefined();
    expect(HOISTS['U-Y']).toBeDefined();
    expect(HOISTS['P-Q']).toBeDefined();
    expect(HOISTS['D-V']).toBeDefined();
    expect(HOISTS['F-G']).toBeDefined();
    expect(HOISTS['O-W']).toBeDefined();
  });
});
