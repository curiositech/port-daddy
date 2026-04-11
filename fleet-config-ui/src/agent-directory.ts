import type { FleetConfig, RegistryAgent, SalvageAgent, SpawnedAgent } from './types';

export interface AgentChannelBinding {
  kind: 'trigger' | 'onSuccess' | 'onFailure';
  logical: string;
}

export interface AgentDirectoryEntry {
  id: string;
  label: string;
  purpose: string | null;
  identity: string | null;
  fleetAgentName: string | null;
  isConfiguredFleetAgent: boolean;
  registry: RegistryAgent | null;
  spawned: SpawnedAgent | null;
  salvage: SalvageAgent | null;
  sortTimestamp: number;
}

function extractPublishedChannel(command?: string): string | null {
  if (!command) return null;
  const trimmed = command.trim();
  if (!trimmed.startsWith('publish ')) return null;
  const channel = trimmed.slice('publish '.length).trim();
  return channel || null;
}

function identityFromSalvage(agent: SalvageAgent): string | null {
  return [
    agent.identityProject,
    agent.identityStack,
    agent.identityContext,
  ].filter((part): part is string => !!part && part.trim().length > 0).join(':') || null;
}

export function extractFleetAgentName(input: {
  identity?: string | null;
  identityStack?: string | null;
  identityContext?: string | null;
  purpose?: string | null;
}): string | null {
  if (input.identityStack === 'fleet' && input.identityContext) {
    return input.identityContext;
  }

  const identity = input.identity?.trim();
  if (identity) {
    const segments = identity.split(':').filter(Boolean);
    const fleetIndex = segments.indexOf('fleet');
    if (fleetIndex >= 0 && segments[fleetIndex + 1]) {
      return segments[fleetIndex + 1];
    }
  }

  const purpose = input.purpose?.trim();
  if (!purpose) return null;
  const match = purpose.match(/^Fleet agent:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function listKnownAgentChannels(config: FleetConfig | null | undefined, fleetAgentName: string | null): AgentChannelBinding[] {
  if (!config || !fleetAgentName) return [];
  const agent = config.agents.find((candidate) => candidate.name === fleetAgentName);
  if (!agent) return [];

  const bindings: AgentChannelBinding[] = [];
  if (agent.trigger) {
    bindings.push({ kind: 'trigger', logical: agent.trigger });
  }

  const onSuccess = extractPublishedChannel(agent.onSuccess);
  if (onSuccess) {
    bindings.push({ kind: 'onSuccess', logical: onSuccess });
  }

  const onFailure = extractPublishedChannel(agent.onFailure);
  if (onFailure) {
    bindings.push({ kind: 'onFailure', logical: onFailure });
  }

  return bindings;
}

export function buildAgentDirectoryEntries(input: {
  registryAgents: RegistryAgent[];
  spawnedAgents: SpawnedAgent[];
  salvageAgents: SalvageAgent[];
  configuredFleetAgents?: string[];
}): AgentDirectoryEntry[] {
  const configuredFleetAgents = new Set(input.configuredFleetAgents ?? []);
  const entities = new Map<string, AgentDirectoryEntry>();

  const upsert = (id: string, patch: Partial<AgentDirectoryEntry>, timestamp: number) => {
    const current = entities.get(id);
    const merged: AgentDirectoryEntry = {
      id,
      label: patch.label ?? current?.label ?? id,
      purpose: patch.purpose ?? current?.purpose ?? null,
      identity: patch.identity ?? current?.identity ?? null,
      fleetAgentName: patch.fleetAgentName ?? current?.fleetAgentName ?? null,
      isConfiguredFleetAgent: patch.isConfiguredFleetAgent ?? current?.isConfiguredFleetAgent ?? false,
      registry: patch.registry ?? current?.registry ?? null,
      spawned: patch.spawned ?? current?.spawned ?? null,
      salvage: patch.salvage ?? current?.salvage ?? null,
      sortTimestamp: Math.max(timestamp, current?.sortTimestamp ?? 0),
    };
    entities.set(id, merged);
  };

  for (const agent of input.registryAgents) {
    const fleetAgentName = extractFleetAgentName(agent);
    upsert(agent.id, {
      label: agent.name || fleetAgentName || agent.id,
      purpose: agent.purpose,
      identity: agent.identity,
      fleetAgentName,
      isConfiguredFleetAgent: fleetAgentName ? configuredFleetAgents.has(fleetAgentName) : false,
      registry: agent,
    }, agent.lastHeartbeat);
  }

  for (const agent of input.spawnedAgents) {
    const fleetAgentName = extractFleetAgentName({
      identity: agent.identity,
      purpose: agent.purpose,
    });
    upsert(agent.agentId, {
      label: fleetAgentName || agent.agentId,
      purpose: agent.purpose ?? null,
      identity: agent.identity ?? null,
      fleetAgentName,
      isConfiguredFleetAgent: fleetAgentName ? configuredFleetAgents.has(fleetAgentName) : false,
      spawned: agent,
    }, agent.completedAt ?? agent.startedAt);
  }

  for (const agent of input.salvageAgents) {
    const fleetAgentName = extractFleetAgentName({
      identity: identityFromSalvage(agent),
      identityStack: agent.identityStack,
      identityContext: agent.identityContext,
      purpose: agent.purpose,
    });
    upsert(agent.id, {
      label: agent.name || fleetAgentName || agent.id,
      purpose: agent.purpose,
      identity: identityFromSalvage(agent),
      fleetAgentName,
      isConfiguredFleetAgent: fleetAgentName ? configuredFleetAgents.has(fleetAgentName) : false,
      salvage: agent,
    }, agent.staleSince);
  }

  return [...entities.values()].sort((left, right) => right.sortTimestamp - left.sortTimestamp);
}
