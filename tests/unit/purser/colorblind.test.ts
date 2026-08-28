/**
 * tests/unit/purser/colorblind.test.ts
 *
 * Verifies that the ClaimTree visualizer uses a colour palette that is safe for
 * common forms of colour‑blindness. The test fails if any claim‑state colour is
 * not part of the approved list.
 */

import { describe, it, expect } from '@jest/globals';
import { CLAIM_STATE_COLORS } from '../../../website-v2/src/pages/docs/concepts/ClaimTree.tsx';

// Approved colours – each entry has been chosen because it is distinguishable
// for protanopia, deuteranopia, and tritanopia while also meeting WCAG contrast
// on a neutral background.
const COLORBLIND_SAFE_PALETTE = new Set<string>([
  '#0b7285', // cyan‑blue
  '#e8590c', // vivid orange
  '#f59f00', // amber
  '#37b24d', // green
  '#5f3dc4', // purple
  '#495057', // neutral gray
]);

describe('ClaimTree colour palette', () => {
  it('exposes a mapping from claim states to hex colours', () => {
    // Mapping must be an object.
    expect(typeof CLAIM_STATE_COLORS).toBe('object');
    // Every entry should be a string key with a 6‑digit hex colour value.
    for (const [state, colour] of Object.entries(CLAIM_STATE_COLORS)) {
      expect(typeof state).toBe('string');
      expect(typeof colour).toBe('string');
      expect(/^#[0-9a-fA-F]{6}$/.test(colour)).toBe(true);
    }
  });

  it('uses only colour‑blind‑safe colours', () => {
    const nonCompliant: Array<[string, string]> = [];

    for (const [state, colour] of Object.entries(CLAIM_STATE_COLORS)) {
      // Normalise to lower‑case to avoid false negatives.
      if (!COLORBLIND_SAFE_PALETTE.has(colour.toLowerCase())) {
        nonCompliant.push([state, colour]);
      }
    }

    if (nonCompliant.length > 0) {
      const messages = nonCompliant.map(
        ([state, colour]) => `State "${state}" uses non‑safe colour "${colour}"`
      );
      throw new Error(
        `ClaimTree colour palette contains non‑colour‑blind‑safe entries:\n${messages.join(
          '\n'
        )}`
      );
    }

    // All colours are approved.
    expect(true).toBe(true);
  });
});