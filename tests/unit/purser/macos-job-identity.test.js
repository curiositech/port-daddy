// tests/unit/purser/macos-job-identity.test.js
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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

  test('macOS job sets NODE_OPTIONS correctly and only there', () => {
    const macosJob = workflow.jobs[macosJobId];
    const ubuntuJob = workflow.jobs[ubuntuJobId];

    // macOS job env must exist and match exactly
    expect(macosJob.env).toEqual({ NODE_OPTIONS: expectedNodeOptions });

    // Ubuntu job must not have NODE_OPTIONS
    expect(ubuntuJob.env).toBeUndefined();

    // No other job should set NODE_OPTIONS
    for (const [jobId, job] of Object.entries(workflow.jobs)) {
      if (jobId === macosJobId) continue;
      if (job.env && job.env.NODE_OPTIONS !== undefined) {
        throw new Error(
          `Job "${jobId}" sets NODE_OPTIONS unexpectedly: ${job.env.NODE_OPTIONS}`
        );
      }
    }
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

  test('no other job shares the same NODE_OPTIONS or Jest run flags', () => {
    const jobsWithNodeOptions = [];
    const jobsWithJestFlags = [];

    for (const [jobId, job] of Object.entries(workflow.jobs)) {
      if (job.env && job.env.NODE_OPTIONS === expectedNodeOptions) {
        jobsWithNodeOptions.push(jobId);
      }
      const step = namedStep(job, 'Run unit tests');
      if (step && step.run.includes('node_modules/jest/bin/jest.js')) {
        jobsWithJestFlags.push(jobId);
      }
    }

    // Only macOS job should have the specific NODE_OPTIONS
    expect(jobsWithNodeOptions).toEqual([macosJobId]);

    // Both macOS and Ubuntu jobs should run Jest with the flag
    expect(jobsWithJestFlags.sort()).toEqual([macosJobId, ubuntuJobId].sort());
  });
});