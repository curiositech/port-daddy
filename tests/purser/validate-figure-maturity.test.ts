import { expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIGURE_DIR = join(__dirname, '../../website-v2/public/whitepaper/figures');

describe('Figure maturity labels validation', () => {
  test('Honest state figure has correct labels', () => {
    const content = readFileSync(join(FIGURE_DIR, 'fig-stp-honest-state.tex'), 'utf-8');
    expect(content).toContain('\BUILTWEAK');
    expect(content).toContain('\VISION');
    expect(content).not.toContain('\DESIGNED');
  });

  test('Keystone split figure shows partial local identity', () => {
    const content = readFileSync(join(FIGURE_DIR, 'fig-stp-keystone-split.tex'), 'utf-8');
    expect(content).toContain('\textsc{partial}');
    expect(content).toContain('daemon-minted actor-souls');
  });

  test('Three organs figure uses partial labels', () => {
    const content = readFileSync(join(FIGURE_DIR, 'fig-stp-three-organs.tex'), 'utf-8');
    expect(content).toContain('\textsc{partial}');
    expect(content).toContain('append-only; closes only against an oracle');
  });
});