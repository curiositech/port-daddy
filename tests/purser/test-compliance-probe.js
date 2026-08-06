const { createSpawnerHarborBridge } = require('../lib/agent-harbor/spawner-bridge');
const { db } = require('./test-utils');
const { runComplianceProbe } = require('../lib/agent-harbor/compliance-probe');

describe('runProbeAndRecord', () => {
  it('grants exactly C1 for valid agent', async () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.registerNode('agent-123', 'id', Date.now());
    bridge.appendTranscriptEvent('agent-123', 'spawn-start', Date.now());
    await bridge.runProbeAndRecord('agent-123');
    const results = db.prepare('SELECT * FROM compliance_probe_result').all();
    expect(results).toHaveLength(1);
    expect(results[0].witnessedLevel).toBe('C1');
  });

  it('grants C0 for agent with no events', async () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.registerNode('agent-456', 'id', Date.now());
    await bridge.runProbeAndRecord('agent-456');
    const results = db.prepare('SELECT * FROM compliance_probe_result').all();
    expect(results).toHaveLength(1);
    expect(results[0].witnessedLevel).toBe('C0');
  });
});