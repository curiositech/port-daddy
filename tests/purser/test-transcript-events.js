const { createSpawnerHarborBridge } = require('../lib/agent-harbor/spawner-bridge');
const { db } = require('./test-utils');

describe('appendTranscriptEvent', () => {
  it('creates valid hash-chained events', () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.appendTranscriptEvent('agent-123', 'spawn-start', Date.now());
    bridge.appendTranscriptEvent('agent-123', 'assistant-message', Date.now() + 1000);
    const events = db.prepare('SELECT * FROM harbor_events WHERE streamType = "transcript-event"').all();
    expect(events).toHaveLength(2);
    expect(events[1].prev_hash).toBe(events[0].content_hash);
  });

  it('ignores duplicate agentIds without error', () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.appendTranscriptEvent('agent-123', 'spawn-start', Date.now());
    bridge.appendTranscriptEvent('agent-123', 'spawn-start', Date.now() + 1000);
    const events = db.prepare('SELECT * FROM harbor_events').all();
    expect(events).toHaveLength(2);
  });
});