import { describe, expect, test } from '@jest/globals';

import { sanitizeRoutineSquidStatusDetails } from '../../lib/squid/status-privacy.js';

const provider = {
  name: 'Codex CLI',
  slug: 'codex' as const,
  detected: true,
  expectedScope: 'user' as const,
  configPath: '/Users/operator/.codex/config.toml',
  configured: true,
  wired: true,
  missingTentacles: [],
};

const matrix = {
  path: '/Users/operator/.port-daddy/matrix.env',
  exists: true,
  alerts: ['/Users/operator/project/secret.ts changed'],
  pheromones: ['/Users/operator/project/secret.ts is hot'],
  locks: ['/Users/operator/project/secret.ts locked'],
  window: {
    limitPerKind: 20,
    maxValueChars: 512,
    totals: { alerts: 1, pheromones: 40, locks: 1 },
    returned: { alerts: 1, pheromones: 20, locks: 1 },
    truncated: { alerts: false, pheromones: true, locks: false, any: true },
    valueCharsTruncated: { alerts: 0, pheromones: 0, locks: 0, any: false },
  },
};

describe('routine Squid status privacy', () => {
  test('hides absolute paths and retained values while preserving exact totals', () => {
    const result = sanitizeRoutineSquidStatusDetails({
      workspace: '/Users/operator/project',
      providers: [provider],
      repair: 'pd squid on --cwd "/Users/operator/project"',
      matrix,
      debugEnabled: false,
    });
    const json = JSON.stringify(result);

    expect(result.detailsHidden).toBe(true);
    expect(result.workspace).toBe('project');
    expect(result.providers[0].configPath).toBe('');
    expect(result.matrix.path).toBe('');
    expect(result.matrix.alerts).toEqual([]);
    expect(result.matrix.pheromones).toEqual([]);
    expect(result.matrix.locks).toEqual([]);
    expect(result.matrix.window.totals).toEqual({ alerts: 1, pheromones: 40, locks: 1 });
    expect(result.matrix.window.returned).toEqual({ alerts: 0, pheromones: 0, locks: 0 });
    expect(result.matrix.window.truncated).toEqual({ alerts: true, pheromones: true, locks: true, any: true });
    expect(json).not.toContain('/Users/operator');
    expect(json).not.toContain('secret.ts');
  });

  test('returns full path detail only for explicitly enabled debug capture', () => {
    const result = sanitizeRoutineSquidStatusDetails({
      workspace: '/Users/operator/project',
      providers: [provider],
      repair: 'pd squid on --cwd "/Users/operator/project"',
      matrix,
      debugEnabled: true,
    });

    expect(result.detailsHidden).toBe(false);
    expect(result.workspace).toBe('/Users/operator/project');
    expect(result.providers[0].configPath).toContain('/Users/operator');
    expect(result.matrix.pheromones).toHaveLength(1);
  });
});
