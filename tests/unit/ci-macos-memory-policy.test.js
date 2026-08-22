import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = parse(
  readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
);

function namedStep(job, name) {
  return job.steps.find((step) => step.name === name);
}

describe('required macOS unit-test memory policy', () => {
  test('keeps the required check identity stable', () => {
    const job = workflow.jobs['unit-tests-macos'];

    expect(job.name).toBe('unit-tests (macos-latest, 22)');
    expect(job['runs-on']).toBe('macos-latest');
  });

  test('gives only the macOS Jest process enough heap for the full suite', () => {
    const macosStep = namedStep(workflow.jobs['unit-tests-macos'], 'Run unit tests');
    const ubuntuStep = namedStep(workflow.jobs['unit-tests'], 'Run unit tests');

    expect(macosStep.env).toEqual({
      NODE_OPTIONS: '--max-old-space-size=4096',
    });
    expect(macosStep.run).toContain('node_modules/jest/bin/jest.js');
    expect(macosStep.run).toContain('--selectProjects unit');
    expect(ubuntuStep.env).toBeUndefined();
  });
});
