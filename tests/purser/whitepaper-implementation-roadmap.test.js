import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const roadmap = read('docs/roadmap/whitepaper-research-program.md');

describe('Roadmap implementation alignment', () => {
  test('Roadmap must reference exact code changes', () => {
    expect(roadmap).toContain('Extend the shipped commitment substrate');
    expect(roadmap).toContain('Require daemon-minted actor credentials');
    expect(roadmap).toContain('production library must publish');
    expect(roadmap).toContain('budget guard ship');
  });

  test('No vague implementation references in roadmap', () => {
    expect(roadmap).not.toMatch(/may|could|possibly|potentially/gi);
    expect(roadmap).not.toContain('experimental');
    expect(roadmap).not.toContain('prototype');
    expect(roadmap).not.toContain('unspecified');
  });

  test('Roadmap must explicitly reject stronger properties', () => {
    expect(roadmap).toContain('Universal write-boundary enforcement does not');
    expect(roadmap).toContain('Legacy migration does not');
    expect(roadmap).toContain('Reputation-grade outcomes do not');
  });
});