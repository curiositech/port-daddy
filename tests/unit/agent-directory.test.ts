import { buildAgentDirectoryEntries, extractFleetAgentName, listKnownAgentChannels } from '../../fleet-config-ui/src/agent-directory';
import type { FleetConfig, RegistryAgent, SalvageAgent, SpawnedAgent } from '../../fleet-config-ui/src/types';

describe('agent directory helpers', () => {
  test('extractFleetAgentName prefers fleet identity context and falls back to purpose', () => {
    expect(extractFleetAgentName({
      identity: 'port-daddy:fleet:qa',
      identityStack: 'fleet',
      identityContext: 'qa',
      purpose: 'something else',
    })).toBe('qa');

    expect(extractFleetAgentName({
      identity: 'port-daddy:sortie:review',
      purpose: 'Fleet agent: gardener',
    })).toBe('gardener');

    expect(extractFleetAgentName({
      identity: 'port-daddy:sortie:review',
      purpose: 'Ad hoc mission',
    })).toBeNull();
  });

  test('buildAgentDirectoryEntries merges registry, spawned, and salvage views by agent id', () => {
    const registryAgent: RegistryAgent = {
      id: 'spawned-123',
      name: null,
      pid: 123,
      type: 'cli',
      registeredAt: 100,
      lastHeartbeat: 200,
      isActive: true,
      maxServices: 10,
      maxLocks: 10,
      metadata: null,
      agentCard: null,
      skills: [],
      worktreeId: null,
      identity: 'port-daddy:fleet:qa',
      identityProject: 'port-daddy',
      identityStack: 'fleet',
      identityContext: 'qa',
      purpose: 'Fleet agent: qa',
      status: 'ready',
      readiness: null,
      isReady: true,
      progress: null,
      healthAssessment: {
        liveness: 'alive',
        graceRemaining: 1000,
      },
    };

    const spawnedAgent: SpawnedAgent = {
      agentId: 'spawned-123',
      backend: 'codex',
      model: 'gpt-5.3-codex',
      status: 'running',
      identity: 'port-daddy:fleet:qa',
      purpose: 'Fleet agent: qa',
      startedAt: 150,
      completedAt: null,
    };

    const salvageAgent: SalvageAgent = {
      id: 'ghost-1',
      name: 'ghost-1',
      purpose: 'Fleet agent: gardener',
      sessionId: 'session-1',
      lastHeartbeat: 50,
      staleSince: 250,
      status: 'dead',
      notes: ['last note'],
      identityProject: 'port-daddy',
      identityStack: 'fleet',
      identityContext: 'gardener',
    };

    const entries = buildAgentDirectoryEntries({
      registryAgents: [registryAgent],
      spawnedAgents: [spawnedAgent],
      salvageAgents: [salvageAgent],
      configuredFleetAgents: ['qa', 'gardener'],
    });

    expect(entries).toHaveLength(2);

    const merged = entries.find((entry) => entry.id === 'spawned-123');
    expect(merged).toMatchObject({
      label: 'qa',
      fleetAgentName: 'qa',
      isConfiguredFleetAgent: true,
    });
    expect(merged?.registry?.id).toBe('spawned-123');
    expect(merged?.spawned?.agentId).toBe('spawned-123');

    const ghost = entries.find((entry) => entry.id === 'ghost-1');
    expect(ghost).toMatchObject({
      fleetAgentName: 'gardener',
      isConfiguredFleetAgent: true,
    });
    expect(ghost?.salvage?.status).toBe('dead');
  });

  test('listKnownAgentChannels returns trigger and published channels for a fleet agent', () => {
    const config: FleetConfig = {
      name: 'port-daddy',
      agents: [{
        name: 'qa',
        backend: 'codex',
        prompt: 'review',
        trigger: 'git:committed',
        onSuccess: 'publish qa:clean',
        onFailure: 'publish qa:findings',
      }],
      watchers: [],
      channels: {
        'git:committed': { description: 'commit' },
        'qa:clean': { description: 'clean' },
        'qa:findings': { description: 'findings' },
      },
    };

    expect(listKnownAgentChannels(config, 'qa')).toEqual([
      { kind: 'trigger', logical: 'git:committed' },
      { kind: 'onSuccess', logical: 'qa:clean' },
      { kind: 'onFailure', logical: 'qa:findings' },
    ]);
  });
});
