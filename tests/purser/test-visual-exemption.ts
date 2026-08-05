import { readFileSync } from 'fs';

const filePath = '../../docs/pr-assets/companion-paper-figure-repairs.md';
const expectedRef = 'PR #5831';

describe('Visual exemption validation', () => {
  test('Companion paper figures must reference PR #5831', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain(expectedRef);
  });
});