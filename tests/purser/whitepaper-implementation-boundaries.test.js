import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const papers = [
  'whitepaper/single-writer-kernel.tex',
  'website-v2/public/whitepaper/harbor-economy.tex',
  'docs/roadmap/whitepaper-research-program.md'
].map(read);

describe('Boundary enforcement verification', () => {
  test('PARTIAL claims must not imply stronger properties', () => {
    expect(papers.join('')).not.toMatch(/\PARTIAL\{.*universal.*\}/s);
    expect(papers.join('')).not.toMatch(/\BuiltWeak\{.*end-to-end.*\}/s);
    expect(papers.join('')).not.toContain('full write gating');
    expect(papers.join('')).not.toContain('unrestricted access');
  });

  test('Roadmap must explicitly name promotion paths', () => {
    expect(papers[2]).toContain('Extend the shipped commitment substrate');
    expect(papers[2]).toContain('Require daemon-minted actor credentials');
    expect(papers[2]).toContain('production library must publish');
  });

  test('No ambiguous implementation language in papers', () => {
    expect(papers.join('')).not.toMatch(/may|could|possibly|potentially/gi);
    expect(papers.join('')).not.toContain('experimental');
    expect(papers.join('')).not.toContain('prototype');
  });
});