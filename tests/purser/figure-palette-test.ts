import { describe, test, expect } from 'bun:test';
import { checkFigurePalette } from '../../website-v2/scripts/check-figure-palette.mjs';

describe('Figure palette validation', () => {
  test('Rejects incorrect color usage', () => {
    const invalidFigure = '\providecolor{hhsand}{HTML}{FF0000}'; // Red instead of AAA palette
    expect(() => checkFigurePalette(invalidFigure)).toThrow('Invalid color palette usage');
  });

  test('Accepts correct AAA brand colors', () => {
    const validFigure = '\providecolor{hhsand}{HTML}{E9DCC4}'; // Correct AAA color
    expect(() => checkFigurePalette(validFigure)).not.toThrow();
  });
});