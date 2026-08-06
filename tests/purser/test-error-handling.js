const { createSpawnerHarborBridge } = require('../lib/agent-harbor/spawner-bridge');
const { db } = require('./test-utils');

describe('best-effort error handling', () => {
  it('does not throw on invalid DB', () => {
    const badDb = { prepare: () => ({ all: () => { throw new Error('DB error'); } }) };
    const bridge = createSpawnerHarborBridge(badDb);
    expect(() => bridge.registerNode('agent-123', 'id', Date.now())).not.toThrow();
    expect(() => bridge.appendTranscriptEvent('agent-123', 'spawn-start', Date.now())).not.toThrow();
    expect(() => bridge.runProbeAndRecord('agent-123')).not.toThrow();
  });
});