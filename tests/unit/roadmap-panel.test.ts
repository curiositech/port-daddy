import { describe, expect, test } from '@jest/globals';

import { summarizeRoadmapProgress } from '../../fleet-config-ui/src/lib/roadmap-panel.ts';
import type { RoadmapProgress } from '../../fleet-config-ui/src/types.ts';

function makeProgress(overrides: Partial<RoadmapProgress> = {}): RoadmapProgress {
  return {
    generatedAt: 1,
    sources: {
      roadmapPath: '/repo/docs/ROADMAP.md',
      ideasTrovePath: '/repo/docs/recovery/IDEAS-TROVE.md',
      dogfoodFeedbackPath: '/repo/docs/recovery/DOGFOOD-FEEDBACK.md',
      currentWorkPath: '/repo/docs/recovery/CURRENT-WORK.md',
      cartographerStatusPath: '/repo/.cartographer/status.md',
    },
    freshness: { latestUpdateMs: 1, hoursSinceLastUpdate: 0.2 },
    nextCuts: [
      { slug: 'cartographer-roadmap-progress-screen', summary: 'Surface roadmap state.' },
      { slug: 'crew-screen-roles-not-pids', summary: 'Show roles.' },
    ],
    ideasNow: [
      { slug: 'cartographer-roadmap-progress-screen', status: 'now', surface: 'Fleet UI', hook: 'one glance' },
    ],
    liveFeedback: [
      { slug: 'cartographer-live-body-salvage-friction', status: 'open', surface: 'CLI', hook: 'wake path is opaque', feedbackId: 'fb-1', severity: 'high', provenance: 'tuple' },
    ],
    feedbackSummary: {
      total: 1,
      open: 1,
      harvested: 0,
      bySeverity: { low: 0, medium: 0, high: 1, critical: 0 },
      bySurface: { CLI: 1 },
    },
    dogfoodFeedback: [
      { slug: 'coordination-ticker-as-high-signal-feed', status: 'backlog', surface: 'Fleet UI', hook: null },
    ],
    currentWorkExcerpt: null,
    cartographerStatusExcerpt: null,
    warnings: [],
    ...overrides,
  };
}

describe('RoadmapPanel helpers', () => {
  test('summarizeRoadmapProgress gives operators the section counts', () => {
    expect(summarizeRoadmapProgress(makeProgress())).toBe('2 next cuts, 1 now, 1 live feedback, 1 curated');
  });

  test('summarizeRoadmapProgress handles unloaded state', () => {
    expect(summarizeRoadmapProgress(null)).toBe('No roadmap projection loaded.');
  });
});
