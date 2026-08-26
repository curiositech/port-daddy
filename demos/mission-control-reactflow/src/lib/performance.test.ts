import { describe, expect, it } from 'vitest';
import { createMissionEvents, createMissionFixture } from './fixtures';
import { layoutMission, layoutProfileFor, viewportPolicyFor } from './layout';
import { useMissionStore } from '../store';

describe('measured graph performance', () => {
  it('keeps the hero and scale viewport policies deterministic and distinct', () => {
    expect(layoutProfileFor(18)).toEqual({ nodeWidth: 214, nodeHeight: 150, xGap: 26, yGap: 42 });
    expect(viewportPolicyFor(18, false).minZoom).toBeGreaterThan(viewportPolicyFor(18, true).minZoom);
    expect(viewportPolicyFor(100, false).maxZoom).toBeLessThan(viewportPolicyFor(50, false).maxZoom);
    expect(viewportPolicyFor(200, false).maxZoom).toBeLessThan(viewportPolicyFor(100, false).maxZoom);
  });

  it.each([50, 100, 200])('lays out and serializes %i deterministic nodes within the lab budget', (count) => {
    const fixture = createMissionFixture(count);
    const started = performance.now();
    const { metrics } = layoutMission(fixture.nodes, fixture.edges);
    const elapsed = performance.now() - started;
    console.info(JSON.stringify({ kind: 'layout', count, elapsedMs: Number(elapsed.toFixed(3)), serializedBytes: metrics.serializedBytes }));
    expect(metrics.count).toBe(count);
    expect(elapsed).toBeLessThan(100);
    expect(metrics.serializedBytes).toBeLessThan(2_000_000);
  });

  it('preserves untouched node references during a stream update', () => {
    const fixture = createMissionFixture(200);
    const store = useMissionStore.getState();
    store.initializeNodes(fixture.nodes.map((node) => node.id));
    const before = useMissionStore.getState().runtimeById;
    const event = createMissionEvents(fixture.nodes, 1)[0];
    useMissionStore.getState().applyEvent(event);
    const after = useMissionStore.getState().runtimeById;
    expect(after[event.nodeId]).not.toBe(before[event.nodeId]);
    expect(after['node-199']).toBe(before['node-199']);
  });

  it('applies 1,000 targeted stream updates without changing untouched entities', () => {
    const fixture = createMissionFixture(200);
    useMissionStore.getState().initializeNodes(fixture.nodes.map((node) => node.id));
    const untouched = useMissionStore.getState().runtimeById['node-199'];
    const events = createMissionEvents(fixture.nodes.slice(0, 18), 1_000);
    const started = performance.now();
    events.forEach((event) => useMissionStore.getState().applyEvent(event));
    const elapsed = performance.now() - started;
    console.info(JSON.stringify({ kind: 'stream-update', updates: events.length, elapsedMs: Number(elapsed.toFixed(3)), averageMs: Number((elapsed / events.length).toFixed(5)) }));
    expect(elapsed).toBeLessThan(250);
    expect(useMissionStore.getState().runtimeById['node-199']).toBe(untouched);
  });
});
