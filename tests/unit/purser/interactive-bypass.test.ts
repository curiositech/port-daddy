import { describe, expect, test } from '@jest/globals';
import { shouldShowSugarParleyExperience } from '../../../cli/commands/sugar.js';

describe('Sugar Parley interactive capability boundary', () => {
  test('does not offer the card when the caller reports a non-interactive pipe', () => {
    expect(shouldShowSugarParleyExperience({}, false, {})).toBe(false);
  });
});
