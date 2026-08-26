import { describe, expect, it } from 'vitest';
import { createMissionEvents, createMissionFixture } from './fixtures';

describe('deterministic mission fixtures', () => {
  it.each([50, 100, 200])('creates the exact %i-node topology deterministically', (count) => {
    const first = createMissionFixture(count);
    const second = createMissionFixture(count);
    expect(first.nodes).toEqual(second.nodes);
    expect(first.edges).toEqual(second.edges);
    expect(first.nodes).toHaveLength(count);
    expect(first.edges.length).toBeGreaterThanOrEqual(count - 1);
  });

  it('keeps critical path, four provenance modes, and zoomable evidence visible', () => {
    const fixture = createMissionFixture(50);
    const modes = new Set(fixture.nodes.map((node) => node.data.provenance));
    expect(modes).toEqual(new Set(['live', 'recorded', 'fixture', 'unknown']));
    expect(fixture.nodes.filter((node) => node.data.critical).length).toBeGreaterThan(4);
    expect(fixture.nodes.every((node) => node.data.evidence.length >= 2)).toBe(true);
  });

  it('emits monotonic, versioned, idempotent event fixtures', () => {
    const fixture = createMissionFixture(18);
    const events = createMissionEvents(fixture.nodes, 48);
    expect(events.every((event, index) => event.sequence === 2101 + index)).toBe(true);
    expect(new Set(events.map((event) => event.idempotencyKey)).size).toBe(events.length);
    expect(events.every((event) => event.version === 1 && event.cursor === `seq:${event.sequence}`)).toBe(true);
  });
});
