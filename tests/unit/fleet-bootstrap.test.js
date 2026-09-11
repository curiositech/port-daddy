import { afterEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  test('does not call an ungated scoped hook current or overwrite its custom work', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'pd-fleet-hook-review-'));
    tempDirs.push(projectDir);
    const hooks = join(projectDir, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    const source = '#!/bin/sh\n# Port Daddy Post-Commit Hook\nCHANNEL="project:fixture:git:committed"\nprintf "foreign work"\n';
    writeFileSync(join(hooks, 'post-commit'), source);
    const result = ensureStarterFleetProject(projectDir);
    expect(result.hookStatus).toBe('needs_review');
    expect(result.warnings.join(' ')).toContain('Off gate');
    expect(readFileSync(join(hooks, 'post-commit'), 'utf8')).toBe(source);
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
