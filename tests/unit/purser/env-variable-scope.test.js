// tests/unit/purser/env-variable-scope.test.js
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
const workflowYml = readFileSync(
  join(repoRoot, '.github', 'workflows', 'ci.yml'),
  'utf8',
);
const workflow = parse(workflowYml);

function namedStep(job, name) {
  return job.steps.find((step) => step.name === name);
}

describe('NODE_OPTIONS environment variable scoping', () => {
  test('macOS job has correct name, runs-on, env and run', () => {
    const macosJob = workflow.jobs['unit-tests-macos'];
    expect(macosJob).toBeDefined();
    expect(macosJob.name).toBe('unit-tests (macos-latest, 22)');
    expect(macosJob['runs-on']).toBe('macos-latest');

    const macosStep = namedStep(macosJob, 'Run unit tests');
    expect(macosStep).toBeDefined();
    expect(macosJob.env).toBeUndefined();
    expect(macosStep.env).toEqual({
      NODE_OPTIONS: '--max-old-space-size=4096',
    });
    expect(macosStep.run).toContain('node_modules/jest/bin/jest.js');
    expect(macosStep.run).toContain('--selectProjects unit');
  });

  test('Ubuntu job does not set NODE_OPTIONS', () => {
    const ubuntuJob = workflow.jobs['unit-tests'];
    expect(ubuntuJob).toBeDefined();

    const ubuntuStep = namedStep(ubuntuJob, 'Run unit tests');
    expect(ubuntuStep).toBeDefined();
    expect(ubuntuStep.env).toBeUndefined();
  });

  test('only the two explicitly macOS Jest steps set NODE_OPTIONS', () => {
    const jobs = workflow.jobs;
    const stepsWithNodeOptions = [];
    for (const [jobId, job] of Object.entries(jobs)) {
      if (!job.steps) continue;
      for (const step of job.steps) {
        if (step.env && step.env.NODE_OPTIONS !== undefined) {
          stepsWithNodeOptions.push(`${jobId}:${step.name}`);
        }
      }
    }
    expect(stepsWithNodeOptions).toEqual([
      'unit-tests-macos:Run unit tests',
      'unit-tests-compat:Run unit tests (macOS 4 GiB heap)',
    ]);
  });

  test('the compatibility limit is guarded by runner OS and every other job is unchanged', () => {
    const compatibilityStep = namedStep(
      workflow.jobs['unit-tests-compat'],
      'Run unit tests (macOS 4 GiB heap)',
    );
    expect(compatibilityStep.if).toBe("runner.os == 'macOS'");

    const jobs = workflow.jobs;
    for (const [jobId, job] of Object.entries(jobs)) {
      if (
        jobId === 'unit-tests-macos' ||
        jobId === 'unit-tests' ||
        jobId === 'unit-tests-compat'
      ) continue;
      if (!job.steps) continue;
      for (const step of job.steps) {
        if (step.env && step.env.NODE_OPTIONS !== undefined) {
          throw new Error(
            `Job ${jobId} step ${step.name} has NODE_OPTIONS set`,
          );
        }
      }
    }
  });
});
