import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRoadmapProgress,
  parseFeedbackEntries,
  parseNextCuts,
} from '../../lib/roadmap-progress.js';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('roadmap progress parser', () => {
  test('parseNextCuts preserves wrapped roadmap summaries', () => {
    const cuts = parseNextCuts(`# Roadmap

## Next Cuts

- **\`cartographer-roadmap-progress-screen\`** — FOMO killer. One
  dashboard panel surfacing Next Cuts + open dogfood feedback +
  curated trove \`now\` + velocity.
- **\`crew-screen-roles-not-pids\`** — Show roles, not process IDs.

## Later
`);

    expect(cuts).toEqual([
      {
        slug: 'cartographer-roadmap-progress-screen',
        summary: 'FOMO killer. One dashboard panel surfacing Next Cuts + open dogfood feedback + curated trove `now` + velocity.',
      },
      {
        slug: 'crew-screen-roles-not-pids',
        summary: 'Show roles, not process IDs.',
      },
    ]);
  });

  test('parseFeedbackEntries keeps status metadata out of the hook', () => {
    const entries = parseFeedbackEntries(`## Now

### \`cartographer-roadmap-progress-screen\`

- status: \`now\`
- surface: dashboard
- why it matters:
  - the operator has to open four files to know what is pending
- next cut:
  - add a read-only structured endpoint
`);

    expect(entries).toEqual([
      {
        slug: 'cartographer-roadmap-progress-screen',
        status: 'now',
        surface: 'dashboard',
        hook: 'the operator has to open four files to know what is pending',
      },
    ]);
  });

  test('getRoadmapProgress reads the curated files into one payload', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-progress-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs', 'recovery'), { recursive: true });
    mkdirSync(join(root, '.cartographer'), { recursive: true });

    writeFileSync(join(root, 'docs', 'ROADMAP.md'), `# Roadmap

## Next Cuts

- **\`cartographer-roadmap-progress-screen\`** — FOMO killer.
`);
    writeFileSync(join(root, 'docs', 'recovery', 'IDEAS-TROVE.md'), `# Ideas

### \`cartographer-roadmap-progress-screen\`

- status: \`now\`
- why it matters:
  - everything pending belongs in one glance
`);
    writeFileSync(join(root, 'docs', 'recovery', 'DOGFOOD-FEEDBACK.md'), `# Feedback

### \`coordination-ticker-as-high-signal-feed\`

- status: \`backlog\`
- surface: dashboard
`);
    writeFileSync(join(root, 'docs', 'recovery', 'CURRENT-WORK.md'), '# Current\n\nActive slice.');
    writeFileSync(join(root, '.cartographer', 'status.md'), '# Status\n\nNominal.');

    const progress = getRoadmapProgress({ rootDir: root });

    expect(progress.nextCuts).toHaveLength(1);
    expect(progress.ideasNow.map((entry) => entry.slug)).toEqual(['cartographer-roadmap-progress-screen']);
    expect(progress.dogfoodFeedback.map((entry) => entry.slug)).toEqual(['coordination-ticker-as-high-signal-feed']);
    expect(progress.currentWorkExcerpt).toContain('Active slice.');
    expect(progress.cartographerStatusExcerpt).toContain('Nominal.');
    expect(progress.warnings).toEqual([]);
    expect(progress.freshness.latestUpdateMs).toEqual(expect.any(Number));
  });
});
