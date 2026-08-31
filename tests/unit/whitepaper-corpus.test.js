import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const corpus = JSON.parse(readFileSync(resolve(repoRoot, 'whitepaper/corpus.json'), 'utf8'));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('canonical whitepaper corpus', () => {
  test('the repository contract accepts the consolidated corpus', () => {
    expect(execFileSync(process.execPath, ['scripts/check-whitepaper-corpus.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })).toContain('7 chapters, 1 collected volume');
  });

  test('the website mirrors only manifest-listed canonical PDFs', () => {
    execFileSync(process.execPath, ['scripts/sync-whitepaper-publications.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    const publications = [
      ...corpus.chapters.map((chapter) => [chapter.published, chapter.publicPath]),
      [corpus.collectedVolume.published, corpus.collectedVolume.publicPath],
      ...corpus.researchPublications.map((publication) => [publication.source, publication.publicPath]),
    ];
    for (const [source, publicPath] of publications) {
      const mirror = resolve(repoRoot, 'website-v2/public', publicPath.replace(/^\//u, ''));
      expect(sha256(resolve(repoRoot, source))).toBe(sha256(mirror));
    }
  });

  test('generated website PDF mirrors are absent from the Git index', () => {
    const tracked = execFileSync('git', [
      'ls-files',
      '--',
      'website-v2/public/whitepaper/*.pdf',
      'website-v2/public/research/*.pdf',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();

    expect(tracked).toBe('');
  });

  test('external review dependencies are explicit rather than silently missing', () => {
    expect(corpus.externalInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'GeminiFeedback.pdf', status: 'not-present' }),
      expect.objectContaining({ name: 'harbor-feedback-and-exercise-solutions.pdf', status: 'not-present' }),
      expect.objectContaining({ name: 'port_daddy_feedback_analysis_v2.pdf', status: 'not-present' }),
    ]));
  });
});
