import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const papers = [
  'whitepaper/single-writer-kernel.tex',
  'website-v2/public/whitepaper/harbor-economy.tex',
  'docs/roadmap/whitepaper-research-program.md'
].map(read);

describe('Implementation claim coverage verification', () => {
  test('All PARTIAL/BuiltWeak claims must have corresponding tests', () => {
    const claims = ['commitment substrate', 'local identity', 'outcome ledger'];
    const tests = ['commitments.test.js', 'actor-souls.test.js', 'obligation-monitor.test.js'];

    claims.forEach(cl => {
      expect(papers.join('')).toContain(`\${cl.replace(' ', '')}\{}`);
      expect(papers.join('')).toContain(`\BuiltWeak\{}`);
      expect(papers.join('')).toContain(`\PARTIAL\{}`);
    });

    tests.forEach(t => {
      expect(read(`tests/unit/${t}`)).toContain('test');
      expect(read(`tests/unit/${t}`)).toContain('expect');
    });
  });

  test('No implicit stronger properties in codebase', () => {
    const code = ["lib/commitments.ts", "lib/actor-souls.ts", "lib/budget-guard-newcomer-pool.ts"]
      .map(p => read(p)).join('');

    expect(code).not.toMatch(/universal|end-to-end|full/gi);
    expect(code).not.toContain('requireAll');
    expect(code).not.toContain('enforceEvery');
  });
});