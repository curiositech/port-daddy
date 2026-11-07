import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';

const workflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const vhsWorkflowPath = new URL('../../.github/workflows/vhs.yml', import.meta.url);
const workflow = readFileSync(workflowPath, 'utf8');

function portholeJob() {
  const start = workflow.indexOf('\n  porthole-cast-gate:');
  const end = workflow.indexOf('\n  changelog-guard:', start);
  if (start < 0 || end < 0) throw new Error('Unable to isolate porthole-cast-gate in ci.yml');
  return workflow.slice(start, end);
}

function portholeRecordingJob() {
  const start = workflow.indexOf('\n  porthole-recordings:');
  const end = workflow.indexOf('\n  rust-console:', start);
  if (start < 0 || end < 0) throw new Error('Unable to isolate porthole-recordings in ci.yml');
  return workflow.slice(start, end);
}

describe('Porthole cast CI contract', () => {
  test('installs the locked website dependencies before invoking the declared gate', () => {
    const job = portholeJob();
    const install = 'run: npm ci --prefix website-v2 --ignore-scripts';
    const replay = 'run: npm --prefix website-v2 run test:porthole';

    expect(job).toContain(install);
    expect(job).toContain(replay);
    expect(job.indexOf(install)).toBeLessThan(job.indexOf(replay));
    expect(job).not.toMatch(/run:\s+npx tsx\s+website-v2\/scripts\/check-porthole-casts\.mjs/);
  });

  test('Porthole is the only live terminal-recording workflow', () => {
    expect(existsSync(vhsWorkflowPath)).toBe(false);
    expect(workflow).not.toMatch(/\bwebsite-terminal-recordings\b/);
    expect(workflow).not.toMatch(/VHS_VERSION|uses:.*vhs|run:.*\bvhs\b/i);
  });

  test('records, validates, and retains the Porthole evidence bundle', () => {
    const job = portholeRecordingJob();
    const record = 'run: npm run record:gifs';
    const review = 'run: npm run test:gifs';
    const upload = 'name: Upload verified Porthole recordings';

    expect(job).toContain('python3 -m pip install --user asciinema');
    expect(job).toContain('AGG_VERSION: v1.9.0');
    expect(job).toContain(record);
    expect(job).toContain(review);
    expect(job).toContain(upload);
    expect(job).toContain('website-v2/public/casts');
    expect(job).toContain('website-v2/public/gifs');
    expect(job.indexOf(record)).toBeLessThan(job.indexOf(review));
    expect(job.indexOf(review)).toBeLessThan(job.indexOf(upload));
  });
});
