import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useActivityStream } from './useActivityStream'

// Mock EventSource
class MockEventSource {
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onopen: ((ev: any) => void) | null = null;
  close = vi.fn();
  static instances: MockEventSource[] = [];
  
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  
  emit(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  open() {
    if (this.onopen) this.onopen({} as any);
  }
}

describe('useActivityStream', () => {
  let originalEventSource: any;

  beforeEach(() => {
    MockEventSource.instances = [];
    originalEventSource = global.EventSource;
    global.EventSource = MockEventSource as any;
  });

  afterEach(() => {
    global.EventSource = originalEventSource;
  });

  it('connects to the correct endpoint', () => {
    renderHook(() => useActivityStream());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('http://localhost:9876/activity/subscribe');
  });

  it('accumulates activities as they arrive', () => {
    const { result } = renderHook(() => useActivityStream());
    const mock = MockEventSource.instances[0];
    
    const activity = { id: 1, type: 'service.claim', details: 'port 3000', timestamp: Date.now() };
    
    act(() => {
      mock.emit(activity);
    });

    expect(result.current.activities).toHaveLength(1);
    expect(result.current.activities[0]).toEqual(activity);
  });

  it('limits the number of activities', () => {
    const { result } = renderHook(() => useActivityStream({ limit: 2 }));
    const mock = MockEventSource.instances[0];
    
    act(() => {
      mock.emit({ id: 1, type: 'test' });
      mock.emit({ id: 2, type: 'test' });
      mock.emit({ id: 3, type: 'test' });
    });

    expect(result.current.activities).toHaveLength(2);
    expect(result.current.activities[0].id).toBe(3); // Newest first
  });

  it('updates connection status', () => {
    const { result } = renderHook(() => useActivityStream());
    const mock = MockEventSource.instances[0];

    expect(result.current.connected).toBe(false);

    act(() => {
      mock.open();
    });

    expect(result.current.connected).toBe(true);
  });
});
