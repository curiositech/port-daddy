import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = process.cwd();
const buildScript = join(repoRoot, 'scripts', 'build-whitepapers.sh');

function bashFunction(functionName, ...args) {
  return execFileSync(
    '/bin/bash',
    ['-c', 'source "$1"; shift; "$@"', 'whitepaper-test', buildScript, functionName, ...args],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
}

describe('reproducible whitepaper source scoping', () => {
  test('Spawn to Person depends only on its root and imported stp figures', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'spawn-to-person.tex',
    ).split('\n');

    expect(sources[0]).toBe('website-v2/public/whitepaper/spawn-to-person.tex');
    expect(sources).toHaveLength(14);
    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/fig-stp-rate-the-raters.tex',
    );
    expect(sources.slice(1).every((source) => source.includes('/figures/fig-stp-')))
      .toBe(true);
    expect(sources.some((source) => source.includes('fig-anchor-'))).toBe(false);
  });

  test('another paper excludes Spawn to Person figures from its epoch', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'anchor-protocol-whitepaper.tex',
    ).split('\n');

    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/fig-anchor-four-phases.tex',
    );
    expect(sources.some((source) => source.includes('/figures/fig-stp-'))).toBe(false);
  });

  test('paper_epoch equals the newest source commit author time', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'spawn-to-person.tex',
    ).split('\n');
    const expected = execFileSync(
      'git',
      ['log', '-1', '--format=%at', 'HEAD', '--', ...sources],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    const actual = bashFunction(
      'paper_epoch',
      'website-v2/public/whitepaper',
      'spawn-to-person.tex',
    );

    expect(actual).toBe(expected);
  });
});
