// tests/unit/purser/macos-job-identity.test.js
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const workflow = parse(
  readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
);

function namedStep(job, name) {
  return job.steps.find((step) => step.name === name);
}

describe('macOS job identity constraints', () => {
  const macosJobId = 'unit-tests-macos';
  const ubuntuJobId = 'unit-tests';
  const expectedMacosJobName = 'unit-tests (macos-latest, 22)';
  const expectedNodeOptions = '--max-old-space-size=4096';

  test('macOS job has the correct name and runner', () => {
    const job = workflow.jobs[macosJobId];
    expect(job).toBeDefined();
    expect(job.name).toBe(expectedMacosJobName);
    expect(job['runs-on']).toBe('macos-latest');
  });

  test('macOS Jest step sets NODE_OPTIONS correctly and only there', () => {
    const macosJob = workflow.jobs[macosJobId];
    const ubuntuJob = workflow.jobs[ubuntuJobId];
    const macosStep = namedStep(macosJob, 'Run unit tests');
    const ubuntuStep = namedStep(ubuntuJob, 'Run unit tests');

    // The larger heap belongs only to the process that needs it. Setup, type
    // checking, and the rest of the job retain their normal process limits.
    expect(macosJob.env).toBeUndefined();
    expect(macosStep.env).toEqual({ NODE_OPTIONS: expectedNodeOptions });

    // Ubuntu's job and Jest step remain unchanged.
    expect(ubuntuJob.env).toBeUndefined();
    expect(ubuntuStep.env).toBeUndefined();

    // No job-level or other step-level NODE_OPTIONS may broaden the policy.
    const stepsWithNodeOptions = [];
    for (const [jobId, job] of Object.entries(workflow.jobs)) {
      if (job.env && job.env.NODE_OPTIONS !== undefined) {
        throw new Error(
          `Job "${jobId}" sets NODE_OPTIONS unexpectedly: ${job.env.NODE_OPTIONS}`
        );
      }
      for (const step of job.steps ?? []) {
        if (step.env?.NODE_OPTIONS !== undefined) {
          stepsWithNodeOptions.push(`${jobId}:${step.name}`);
        }
      }
    }
    expect(stepsWithNodeOptions).toEqual([
      'unit-tests-macos:Run unit tests',
      'unit-tests-compat:Run unit tests (macOS 4 GiB heap)',
    ]);
  });

  test('macOS job run command contains Jest invocation with correct flags', () => {
    const macosStep = namedStep(workflow.jobs[macosJobId], 'Run unit tests');
    expect(macosStep).toBeDefined();
    expect(macosStep.run).toContain('node_modules/jest/bin/jest.js');
    expect(macosStep.run).toContain('--selectProjects unit');
  });

  test('Ubuntu job run command contains Jest invocation with correct flags', () => {
    const ubuntuStep = namedStep(workflow.jobs[ubuntuJobId], 'Run unit tests');
    expect(ubuntuStep).toBeDefined();
    expect(ubuntuStep.run).toContain('node_modules/jest/bin/jest.js');
    expect(ubuntuStep.run).toContain('--selectProjects unit');
  });

  test('both required node-22 jobs keep their Jest run flags', () => {
    for (const jobId of [macosJobId, ubuntuJobId]) {
      const step = namedStep(workflow.jobs[jobId], 'Run unit tests');
      expect(step.run).toContain('node_modules/jest/bin/jest.js');
      expect(step.run).toContain('--selectProjects unit');
    }
  });
});
