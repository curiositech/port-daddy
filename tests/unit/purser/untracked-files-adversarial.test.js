// tests/unit/purser/untracked-files-adversarial.test.js
import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


// Helper to initialise a minimal git repo with a committed PDF
function initRepoWithTrackedPdf() {
  const dir = mkdtempSync(join(tmpdir(), 'purser-untracked-'));
  const git = (...args) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'purser test');

  const pdfDir = join(dir, 'whitepaper/published');
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, 'existing.pdf'), 'committed');

  git('add', '-A');
  git('commit', '-qm', 'add a committed PDF');

  return dir;
}

// Add an untracked PDF to the working tree
function addUntrackedPdf(dir) {
  const pdfPath = join(dir, 'whitepaper/published/untracked.pdf');
  writeFileSync(pdfPath, 'untracked content');
}

describe('Purser build fails when untracked PDF artifacts exist', () => {
  test('purser script exits non-zero if untracked PDFs are present', () => {
    const repoDir = initRepoWithTrackedPdf();
    try {
      addUntrackedPdf(repoDir);

      // Run the purser script – the exact script name is inferred from the
      // repository layout.  If the script accepts arguments, adjust accordingly.
      const result = spawnSync(
        'node',
        ['scripts/purser.mjs'],
        { cwd: repoDir, encoding: 'utf8', env: process.env }
      );

      // The build must fail – exit code non‑zero
      expect(result.status).not.toBe(0);

      // The error message should mention untracked files or something similar.
      // We are tolerant of the exact wording but require the word "untracked"
      // to be present in the stderr output.
      const stderr = result.stderr ?? '';
      expect(stderr.toLowerCase()).toMatch(/untracked/);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
