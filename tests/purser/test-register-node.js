const { createSpawnerHarborBridge } = require('../lib/agent-harbor/spawner-bridge');
const { db } = require('./test-utils');

describe('registerNode', () => {
  it('registers a valid agent with C0', () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.registerNode('agent-123', 'test-identity', Date.now());
    const rows = db.prepare('SELECT * FROM agent_node').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].complianceLevel).toBe('C0');
  });

  it('handles empty agentId gracefully', () => {
    const bridge = createSpawnerHarborBridge(db);
    bridge.registerNode('', null, Date.now());
    const rows = db.prepare('SELECT * FROM agent_node').all();
    expect(rows).toHaveLength(0);
  });

  it('does not throw on database errors', () => {
    const badDb = { prepare: () => ({ all: () => { throw new Error('DB error'); } }) };
    const bridge = createSpawnerHarborBridge(badDb);
    expect(() => bridge.registerNode('agent-123', 'id', Date.now())).not.toThrow();
  });
});