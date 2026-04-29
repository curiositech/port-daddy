import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRoadmapProgress,
  loadCartographerConfig,
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
    expect(progress.liveFeedback).toEqual([]);
    expect(progress.feedbackSummary).toBeNull();
    expect(progress.dogfoodFeedback.map((entry) => entry.slug)).toEqual(['coordination-ticker-as-high-signal-feed']);
    expect(progress.currentWorkExcerpt).toContain('Active slice.');
    expect(progress.cartographerStatusExcerpt).toContain('Nominal.');
    expect(progress.warnings).toEqual([]);
    expect(progress.freshness.latestUpdateMs).toEqual(expect.any(Number));
  });

  test('getRoadmapProgress surfaces live tuple-backed feedback', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-live-feedback-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs', 'recovery'), { recursive: true });
    mkdirSync(join(root, '.cartographer'), { recursive: true });
    writeFileSync(join(root, 'docs', 'ROADMAP.md'), `# Roadmap\n\n## Next Cuts\n`);
    writeFileSync(join(root, 'docs', 'recovery', 'IDEAS-TROVE.md'), '# Ideas\n');
    writeFileSync(join(root, 'docs', 'recovery', 'DOGFOOD-FEEDBACK.md'), '# Feedback\n');
    writeFileSync(join(root, 'docs', 'recovery', 'CURRENT-WORK.md'), '# Current\n');
    writeFileSync(join(root, '.cartographer', 'status.md'), '# Status\n');

    const feedback = {
      list: () => [
        {
          feedbackId: 'fb-1',
          slug: 'cartographer-live-body-salvage-friction',
          summary: 'Cartographer wake/salvage feedback should affect roadmap truth.',
          surface: 'CLI',
          severity: 'high',
          status: 'open',
          source: 'agent',
          suggested: 'Expose the live tuple feedback queue in roadmap progress.',
          hook: 'operator asks whether Cartographer can listen',
          droppedBy: 'agent-dfdc92f3',
          project: 'port-daddy',
          harbor: 'port-daddy:fleet',
          at: 1_700_000_000_000,
          harvestedAt: null,
          harvestedIntoSlug: null,
        },
      ],
      summary: () => ({
        total: 1,
        open: 1,
        harvested: 0,
        bySeverity: { low: 0, medium: 0, high: 1, critical: 0 },
        bySurface: { CLI: 1 },
      }),
    };

    const progress = getRoadmapProgress({ rootDir: root, feedback, feedbackHarbor: 'port-daddy:fleet' });

    expect(progress.liveFeedback).toEqual([
      expect.objectContaining({
        feedbackId: 'fb-1',
        slug: 'cartographer-live-body-salvage-friction',
        status: 'open',
        severity: 'high',
        provenance: 'tuple',
      }),
    ]);
    expect(progress.feedbackSummary?.open).toBe(1);
    expect(progress.sources.feedbackTupleHarbor).toBe('port-daddy:fleet');
    expect(progress.freshness.latestUpdateMs).toBeGreaterThanOrEqual(1_700_000_000_000);
  });

  test('getRoadmapProgress keeps markdown truth available when live feedback fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-live-feedback-failure-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs', 'recovery'), { recursive: true });
    mkdirSync(join(root, '.cartographer'), { recursive: true });
    writeFileSync(join(root, 'docs', 'ROADMAP.md'), `# Roadmap

## Next Cuts

- **\`still-visible\`** — Curated roadmap must survive tuple outages.
`);
    writeFileSync(join(root, 'docs', 'recovery', 'IDEAS-TROVE.md'), '# Ideas\n');
    writeFileSync(join(root, 'docs', 'recovery', 'DOGFOOD-FEEDBACK.md'), `# Feedback

### \`markdown-backstop\`

- status: \`now\`
- surface: recovery-docs
- why it matters:
  - live feedback failures should not blank the operator map
`);
    writeFileSync(join(root, 'docs', 'recovery', 'CURRENT-WORK.md'), '# Current\n');
    writeFileSync(join(root, '.cartographer', 'status.md'), '# Status\n');

    const feedback = {
      list: () => {
        throw new Error('tuple DB temporarily unavailable');
      },
      summary: () => {
        throw new Error('should not be called after list fails');
      },
    };

    const progress = getRoadmapProgress({ rootDir: root, feedback });

    expect(progress.nextCuts.map((entry) => entry.slug)).toEqual(['still-visible']);
    expect(progress.dogfoodFeedback.map((entry) => entry.slug)).toEqual(['markdown-backstop']);
    expect(progress.liveFeedback).toEqual([]);
    expect(progress.feedbackSummary).toBeNull();
    expect(progress.warnings).toEqual([
      expect.stringContaining('live feedback tuples could not be read: tuple DB temporarily unavailable'),
    ]);
  });

  test('getRoadmapProgress respects .cartographer/config.yml path overrides', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-config-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.cartographer'), { recursive: true });
    mkdirSync(join(root, 'planning'), { recursive: true });

    writeFileSync(
      join(root, '.cartographer', 'config.yml'),
      `paths:\n  roadmap: planning/Roadmap.md\n  ideas_trove: planning/Ideas.md\n`,
    );
    writeFileSync(join(root, 'planning', 'Roadmap.md'), `# r\n\n## Next Cuts\n\n- **\`x\`** — y\n`);
    writeFileSync(
      join(root, 'planning', 'Ideas.md'),
      `### \`x\`\n\n- status: \`now\`\n- surface: cli\n`,
    );

    const progress = getRoadmapProgress({ rootDir: root });
    expect(progress.nextCuts.map((c) => c.slug)).toEqual(['x']);
    expect(progress.ideasNow.map((e) => e.slug)).toEqual(['x']);
    expect(progress.sources.roadmapPath).toBe(join(root, 'planning', 'Roadmap.md'));
    expect(progress.sources.ideasTrovePath).toBe(join(root, 'planning', 'Ideas.md'));
  });

  test('getRoadmapProgress prefers explicit paths over config and defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-explicit-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.cartographer'), { recursive: true });
    mkdirSync(join(root, 'a'), { recursive: true });
    mkdirSync(join(root, 'b'), { recursive: true });

    writeFileSync(join(root, '.cartographer', 'config.json'), JSON.stringify({ paths: { roadmap: 'a/r.md' } }));
    writeFileSync(join(root, 'a', 'r.md'), `## Next Cuts\n\n- **\`from-config\`** — fc\n`);
    writeFileSync(join(root, 'b', 'r.md'), `## Next Cuts\n\n- **\`from-input\`** — fi\n`);

    const progress = getRoadmapProgress({ rootDir: root, paths: { roadmap: 'b/r.md' } });
    expect(progress.nextCuts.map((c) => c.slug)).toEqual(['from-input']);
  });

  test('loadCartographerConfig surfaces malformed YAML as a warning instead of throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-malformed-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.cartographer'), { recursive: true });
    writeFileSync(join(root, '.cartographer', 'config.yml'), 'paths:\n  roadmap: [unterminated\n');

    const cfg = loadCartographerConfig(root);
    expect(cfg.warning).toMatch(/config\.yml/);
    expect(cfg.paths).toEqual({});

    const progress = getRoadmapProgress({ rootDir: root });
    expect(progress.warnings.some((w) => /config\.yml/.test(w))).toBe(true);
  });

  test('loadCartographerConfig accepts absolute paths verbatim', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-abs-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'pd-roadmap-abs-elsewhere-'));
    tempDirs.push(root, elsewhere);
    mkdirSync(join(root, '.cartographer'), { recursive: true });

    const absRoadmap = join(elsewhere, 'Roadmap.md');
    writeFileSync(absRoadmap, `## Next Cuts\n\n- **\`abs\`** — ok\n`);
    writeFileSync(
      join(root, '.cartographer', 'config.yml'),
      `paths:\n  roadmap: ${absRoadmap}\n`,
    );

    const progress = getRoadmapProgress({ rootDir: root });
    expect(progress.sources.roadmapPath).toBe(absRoadmap);
    expect(progress.nextCuts.map((c) => c.slug)).toEqual(['abs']);
  });
});
