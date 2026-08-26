import type { MissionEvent } from '../types';

export const MAX_REPLAY_EVENTS = 160;
export const MAX_PENDING_EVENTS = 24;

export class SSEFrameParser {
  private carry = '';

  push(chunk: string): MissionEvent[] {
    this.carry += chunk.replace(/\r\n/g, '\n');
    const frames = this.carry.split('\n\n');
    this.carry = frames.pop() ?? '';
    return frames.flatMap((frame) => {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return [];
      try {
        return [JSON.parse(data) as MissionEvent];
      } catch {
        return [];
      }
    });
  }

  pendingBytes() {
    return this.carry.length;
  }

  reset() {
    this.carry = '';
  }
}

export class BoundedEventBuffer {
  private seen = new Set<string>();
  private events: MissionEvent[] = [];
  dropped = 0;

  append(event: MissionEvent) {
    if (this.seen.has(event.idempotencyKey)) return false;
    this.seen.add(event.idempotencyKey);
    this.events.push(event);
    if (this.events.length > MAX_REPLAY_EVENTS) {
      const removed = this.events.shift();
      if (removed) this.seen.delete(removed.idempotencyKey);
      this.dropped += 1;
    }
    return true;
  }

  since(sequence: number) {
    return this.events.filter((event) => event.sequence > sequence);
  }

  latestCursor() {
    return this.events.at(-1)?.cursor ?? 'seq:0';
  }

  size() {
    return this.events.length;
  }
}

export function encodeSSE(event: MissionEvent) {
  return `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function chunkFrame(frame: string, sequence: number) {
  const first = Math.max(1, (sequence * 7) % Math.max(2, frame.length - 2));
  const second = Math.max(first + 1, Math.min(frame.length - 1, first + 17));
  return [frame.slice(0, first), frame.slice(first, second), frame.slice(second)].filter(Boolean);
}
