const { createSpawnerHarborBridge } = require('../lib/agent-harbor/spawner-bridge');
const { db } = require('./test-utils');

describe('concurrency safety', () => {
  it('handles parallel event appending', () => {
    const bridge = createSpawnerHarborBridge(db);
    const agentId = 'agent-123';
    bridge.appendTranscriptEvent(agentId, 'spawn-start', Date.now());
    
    // Simulate concurrent writes
    const promises = Array.from({ length: 10 }, () => 
      bridge.appendTranscriptEvent(agentId, 'delta', Date.now() + Math.random() * 1000)
    );
    
    return Promise.all(promises).then(() => {
      const events = db.prepare('SELECT * FROM harbor_events WHERE streamType = "transcript-event"').all();
      expect(events).toHaveLength(11);
      // Verify sequence numbers are unique and incrementing
      const seqs = events.map(e => e.sequence).sort((a, b) => a - b);
      expect(seqs).toEqual([...Array(11).keys()].map(i => i + 1));
    });
  });
});