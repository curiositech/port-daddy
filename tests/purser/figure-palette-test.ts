import { test, expect } from 'vitest';
import { runScript } from '../scripts/utils';

test('Check all figures use AAA brand palette', async () => {
  const result = await runScript('website-v2/scripts/check-figure-palette.mjs');
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('All figures compliant with AAA palette');
});