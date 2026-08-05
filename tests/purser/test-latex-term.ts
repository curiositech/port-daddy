import { readFileSync } from 'fs';

const filePath = '../../whitepaper/legible-swarm.tex';
const expectedTerm = 'bounded newcomer pool';

describe('LaTeX term validation', () => {
  test('Wedge section must use bounded newcomer pool', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain(expectedTerm);
  });
});