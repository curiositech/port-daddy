/**
 * The operator's 2026-09-23 request imports every supplied skill bundle,
 * superseding #8908's narrower selection. Catalog presence does not authorize
 * platform execution, dependency installation, or an external service.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills');

describe('the complete requested catalog preserves platform-specific knowledge', () => {
  test.each(['airflow-dag-orchestrator', 'android-background-task-specialist'])(
    '%s has a usable canonical entrypoint',
    (name) => {
      const entrypoint = join(skillsDir, name, 'SKILL.md');
      expect(existsSync(entrypoint)).toBe(true);
      const contents = readFileSync(entrypoint, 'utf8');
      expect(contents).toMatch(/^---\r?\n/);
      expect(contents).toMatch(new RegExp(`^name: ${name}$`, 'm'));
      expect(contents).toMatch(/^description:\s*\S/m);
    },
  );

  test('general planning bundles remain alongside the platform bundles', () => {
    expect(existsSync(join(skillsDir, 'hypertree-planning', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsDir, 'dag-chain-decomposition', 'SKILL.md'))).toBe(true);
  });
});
