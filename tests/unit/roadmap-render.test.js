import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ROADMAP_ITEMS_START_MARKER,
  ROADMAP_ITEMS_END_MARKER,
  DEFAULT_SECTION_HEADER,
  renderNextCutsMarkdown,
  applyRoadmapMarkdown,
} from '../../lib/roadmap-render.js';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkitem(overrides = {}) {
  return {
    id: 'id-' + (overrides.slug ?? 'x'),
    slug: 'sample-slug',
    summaryMd: 'sample summary',
    status: 'now',
    promotedFromFeedbackId: null,
    promotedByAgentId: null,
    promotedAt: null,
    lastTouchedAt: 1_700_000_000_000,
    dependencies: [],
    notes: [],
    harbor: 'port-daddy:fleet',
    ...overrides,
  };
}

describe('renderNextCutsMarkdown', () => {
  test('renders items as `- **`slug`** — summary` bullets', () => {
    const md = renderNextCutsMarkdown([
      mkitem({ slug: 'a', summaryMd: 'do a' }),
      mkitem({ slug: 'b', summaryMd: 'do b' }),
    ]);
    expect(md).toBe('- **`a`** — do a\n- **`b`** — do b');
  });

  test('filters by status (default: now)', () => {
    const md = renderNextCutsMarkdown([
      mkitem({ slug: 'a', summaryMd: 'a', status: 'now' }),
      mkitem({ slug: 'b', summaryMd: 'b', status: 'backlog' }),
    ]);
    expect(md).toContain('`a`');
    expect(md).not.toContain('`b`');
  });

  test('status: all keeps every item', () => {
    const md = renderNextCutsMarkdown(
      [
        mkitem({ slug: 'a', summaryMd: 'a', status: 'now' }),
        mkitem({ slug: 'b', summaryMd: 'b', status: 'done' }),
      ],
      { status: 'all' },
    );
    expect(md).toContain('`a`');
    expect(md).toContain('`b`');
  });

  test('multi-line summary becomes indented continuation lines', () => {
    const md = renderNextCutsMarkdown([
      mkitem({ slug: 's', summaryMd: 'first line\nsecond line\nthird line' }),
    ]);
    expect(md).toBe('- **`s`** — first line\n  second line\n  third line');
  });

  test('empty input renders a placeholder, not an empty string', () => {
    const md = renderNextCutsMarkdown([]);
    expect(md).toMatch(/no roadmap items at this status/);
  });

  test('limit caps the rendered count', () => {
    const md = renderNextCutsMarkdown(
      Array.from({ length: 5 }, (_, i) => mkitem({ slug: `s${i}`, summaryMd: `s${i}` })),
      { limit: 2 },
    );
    expect(md.split('\n')).toHaveLength(2);
  });
});

describe('applyRoadmapMarkdown', () => {
  test('inserts markers under the section header on first run', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-render-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(
      join(root, 'docs', 'ROADMAP.md'),
      `# Roadmap\n\n${DEFAULT_SECTION_HEADER}\n\nintro paragraph\n\n## Core Architecture\n\nstuff\n`,
    );

    const items = [mkitem({ slug: 'fleetbar-secrets', summaryMd: 'add credentials panel' })];
    const result = applyRoadmapMarkdown(root, items);

    expect(result.changed).toBe(true);
    expect(result.insertedMarkers).toBe(true);
    expect(result.after).toContain(ROADMAP_ITEMS_START_MARKER);
    expect(result.after).toContain(ROADMAP_ITEMS_END_MARKER);
    expect(result.after).toContain('- **`fleetbar-secrets`** — add credentials panel');
    // Human-authored intro paragraph survives.
    expect(result.after).toContain('intro paragraph');
    // Next H2 still present, in its original place.
    expect(result.after).toContain('## Core Architecture');
  });

  test('replaces only the marker block on subsequent runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-render-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(
      join(root, 'docs', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        DEFAULT_SECTION_HEADER,
        '',
        'intro that must survive',
        '',
        ROADMAP_ITEMS_START_MARKER,
        '- **`stale`** — stale bullet that should be replaced',
        ROADMAP_ITEMS_END_MARKER,
        '',
        '## Phase 0',
        '',
        'phase prose',
        '',
      ].join('\n'),
    );

    const result = applyRoadmapMarkdown(root, [
      mkitem({ slug: 'fresh', summaryMd: 'fresh bullet' }),
    ]);

    expect(result.changed).toBe(true);
    expect(result.insertedMarkers).toBe(false);
    expect(result.after).not.toContain('stale bullet');
    expect(result.after).toContain('- **`fresh`** — fresh bullet');
    expect(result.after).toContain('intro that must survive');
    expect(result.after).toContain('## Phase 0');
    expect(result.after).toContain('phase prose');
    // Markers still present exactly once each.
    const starts = result.after.match(new RegExp(ROADMAP_ITEMS_START_MARKER, 'g')) ?? [];
    expect(starts).toHaveLength(1);
  });

  test('is idempotent — re-running with the same items does not change the file', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-render-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(
      join(root, 'docs', 'ROADMAP.md'),
      `# Roadmap\n\n${DEFAULT_SECTION_HEADER}\n\nintro\n\n## Phase 0\n\nstuff\n`,
    );
    const items = [mkitem({ slug: 'x', summaryMd: 'do x' })];

    const first = applyRoadmapMarkdown(root, items);
    expect(first.changed).toBe(true);

    const second = applyRoadmapMarkdown(root, items);
    expect(second.changed).toBe(false);
    expect(second.before).toBe(second.after);
  });

  test('appends a fresh Next Cuts section + markers when the file lacks one', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-render-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'ROADMAP.md'), '# Roadmap\n\nbody\n');

    const result = applyRoadmapMarkdown(root, [
      mkitem({ slug: 's', summaryMd: 'do s' }),
    ]);

    expect(result.changed).toBe(true);
    expect(result.insertedMarkers).toBe(true);
    expect(result.after).toContain(DEFAULT_SECTION_HEADER);
    expect(result.after).toContain('- **`s`** — do s');
  });

  test('renders nothing visible when no items match the status filter', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-render-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(
      join(root, 'docs', 'ROADMAP.md'),
      `# r\n\n${DEFAULT_SECTION_HEADER}\n\nintro\n\n## Phase 0\n`,
    );

    const result = applyRoadmapMarkdown(
      root,
      [mkitem({ slug: 'done-thing', status: 'done', summaryMd: 'd' })],
      // default status filter is 'now' so the done item is filtered out
    );
    expect(result.changed).toBe(true);
    expect(result.after).toMatch(/no roadmap items at this status/);
  });
});
