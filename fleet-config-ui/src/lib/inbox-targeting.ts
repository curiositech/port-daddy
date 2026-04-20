/**
 * Normalize the set of agents that are actually eligible for direct inbox
 * delivery. Direct inboxes target the live fleet runtime, so configured-only
 * agents are intentionally excluded here.
 *
 * Example:
 * - input: `['spark', 'spark', ' spider ', '']`
 * - output: `['spark', 'spider']`
 */
export function resolveInboxAgentTargets(liveAgents: string[]): string[] {
  return [...new Set(
    liveAgents
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];
}

export interface InboxAvailabilityInput {
  liveAgentCount: number;
  configuredAgentCount: number;
  projectRunning: boolean;
}

/**
 * Explain why the direct inbox roster is empty in operator-facing language.
 *
 * Example:
 * - input: `{ liveAgentCount: 0, configuredAgentCount: 8, projectRunning: false }`
 * - output: `No live fleet agents are available for direct inbox delivery. Start the fleet to message one of the 8 configured agents.`
 */
export function describeInboxAgentAvailability(input: InboxAvailabilityInput): string | null {
  if (input.liveAgentCount > 0) return null;

  if (input.configuredAgentCount > 0 && !input.projectRunning) {
    const suffix = input.configuredAgentCount === 1 ? '' : 's';
    return `No live fleet agents are available for direct inbox delivery. Start the fleet to message one of the ${input.configuredAgentCount} configured agent${suffix}.`;
  }

  if (input.configuredAgentCount > 0) {
    const suffix = input.configuredAgentCount === 1 ? '' : 's';
    return `No live fleet agents are currently deployed for direct inbox delivery, even though this project has ${input.configuredAgentCount} configured agent${suffix}. Check fleet health or relaunch the project runtime.`;
  }

  return 'No project agents are configured yet for direct inbox delivery.';
}
