import { afterEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureStarterFleetProject } from '../../lib/fleet-bootstrap.js';

describe('ensureStarterFleetProject', () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test('ignores local Spark and Spider residue but not canonical .cartographer', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pd-fleet-bootstrap-'));
    tempDirs.push(projectDir);

    writeFileSync(join(projectDir, '.gitignore'), '# test repo\n');

    const result = ensureStarterFleetProject(projectDir);
    const gitignore = readFileSync(join(projectDir, '.gitignore'), 'utf-8');

    expect(result.addedGitignoreEntries).toEqual(['.spark/', '.spider/']);
    expect(gitignore).toContain('.spark/');
    expect(gitignore).toContain('.spider/');
    expect(gitignore).not.toContain('.cartographer/');

    expect(existsSync(join(projectDir, '.spark', 'ideas'))).toBe(true);
    expect(existsSync(join(projectDir, '.spider', 'connections'))).toBe(true);
    expect(existsSync(join(projectDir, '.cartographer'))).toBe(true);
  });
});
