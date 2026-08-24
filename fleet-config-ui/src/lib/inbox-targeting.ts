import type { OperatorActorEntry } from '../types';

export interface InboxAgentTarget {
  target: string;
  label: string;
  actorState: OperatorActorEntry['actorState'];
  actorStateReason: string;
  lastActivityAt: number | null;
}

/**
 * Normalize daemon-backed actor entries into direct-inbox targets. Only a
 * server-stamped actorInboxBinding may select a target; session/display aliases
 * never become recipient authority. The route revalidates liveness at send time.
 *
 * Example:
 * - input: `[{ inboxTarget: 'spark', actorState: 'salvaged' }]`
 * - output: `[{ target: 'spark', label: 'spark', actorState: 'salvaged' }]`
 */
export function resolveInboxAgentTargets(actors: OperatorActorEntry[]): InboxAgentTarget[] {
  const seen = new Set<string>();
  const priority: Record<OperatorActorEntry['actorState'], number> = {
    running: 0,
    salvaged: 1,
    orphan_reconciled: 2,
    historical: 3,
    idle: 4,
  };

  return [...actors]
    .sort((left, right) => {
      const leftPriority = priority[left.actorState];
      const rightPriority = priority[right.actorState];
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0);
    })
    .flatMap((actor) => {
      const registry = actor.registry as (OperatorActorEntry['registry'] & {
        actorInboxBinding?: {
          verified?: unknown;
          actorId?: unknown;
          harbor?: unknown;
          inboxTarget?: unknown;
        } | null;
      }) | null;
      const binding = registry?.actorInboxBinding;
      const target = typeof binding?.actorId === 'string' ? binding.actorId.trim() : '';
      const harbor = typeof binding?.harbor === 'string' ? binding.harbor.trim() : '';
      if (
        binding?.verified !== true
        || !target
        || !harbor
        || registry?.id !== target
        || binding.inboxTarget !== target
      ) return [];
      if (!target || seen.has(target)) return [];
      seen.add(target);
      return [{
        target,
        label: actor.label || target,
        actorState: actor.actorState,
        actorStateReason: actor.actorStateReason,
        lastActivityAt: actor.lastActivityAt,
      }];
    });
}

export interface InboxAvailabilityInput {
  actorCount: number;
  configuredAgentCount: number;
  projectRunning: boolean;
}

/**
 * Explain why the direct inbox roster is empty in actor-model language.
 *
 * Example:
 * - input: `{ actorCount: 0, configuredAgentCount: 8, projectRunning: false }`
 * - output: `No known project actors are addressable yet. Start the fleet or wait for a first session to create durable actor state for the 8 configured agents.`
 */
export function describeInboxAgentAvailability(input: InboxAvailabilityInput): string | null {
  if (input.actorCount > 0) return null;

  if (input.configuredAgentCount > 0 && !input.projectRunning) {
    const suffix = input.configuredAgentCount === 1 ? '' : 's';
    return `No known project actors are addressable yet. Start the fleet or wait for a first session to create durable actor state for the ${input.configuredAgentCount} configured agent${suffix}.`;
  }

  if (input.configuredAgentCount > 0) {
    const suffix = input.configuredAgentCount === 1 ? '' : 's';
    return `This project has ${input.configuredAgentCount} configured agent${suffix}, but the daemon has not surfaced any actor state for them yet. Check runtime truth, salvage, and session lifecycle.`;
  }

  return 'No project actors are configured or known yet for direct inbox delivery.';
}
