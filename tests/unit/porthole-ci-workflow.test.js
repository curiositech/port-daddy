import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const workflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const workflow = readFileSync(workflowPath, 'utf8');

function portholeJob() {
  const start = workflow.indexOf('\n  porthole-cast-gate:');
  const end = workflow.indexOf('\n  changelog-guard:', start);
  if (start < 0 || end < 0) throw new Error('Unable to isolate porthole-cast-gate in ci.yml');
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
});
