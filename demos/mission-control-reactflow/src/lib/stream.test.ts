import { describe, expect, it } from 'vitest';
import { createMissionEvents, createMissionFixture } from './fixtures';
import { BoundedEventBuffer, chunkFrame, encodeSSE, MAX_REPLAY_EVENTS, SSEFrameParser } from './stream';

describe('SSE-shaped transport contract', () => {
  const event = createMissionEvents(createMissionFixture(18).nodes, 1)[0];

  it('reassembles arbitrary partial frames without losing event identity', () => {
    const parser = new SSEFrameParser();
    const chunks = chunkFrame(encodeSSE(event), event.sequence);
    expect(chunks.flatMap((chunk) => parser.push(chunk))).toEqual([event]);
    expect(parser.pendingBytes()).toBe(0);
  });

  it('ignores malformed frames and recovers on the next valid frame', () => {
    const parser = new SSEFrameParser();
    expect(parser.push('event: broken\ndata: {oops}\n\n')).toEqual([]);
    expect(parser.push(encodeSSE(event))).toEqual([event]);
  });

  it('deduplicates retries and bounds replay memory', () => {
    const buffer = new BoundedEventBuffer();
    expect(buffer.append(event)).toBe(true);
    expect(buffer.append(event)).toBe(false);
    const events = createMissionEvents(createMissionFixture(18).nodes, MAX_REPLAY_EVENTS + 12);
    events.forEach((candidate) => buffer.append(candidate));
    expect(buffer.size()).toBe(MAX_REPLAY_EVENTS);
    expect(buffer.dropped).toBeGreaterThan(0);
    expect(buffer.since(events.at(-2)!.sequence)).toHaveLength(1);
  });
});
