import { ActivityType } from './activity.js';
import { normalizeSelfSalvage } from './telos-salvage.js';
import type { StaleAgent } from './resurrection.js';

type ExpiredAgent = Pick<StaleAgent, 'id' | 'name' | 'purpose' | 'lastHeartbeat' | 'staleSince' | 'identityProject'>;

interface HeartbeatDeathDependencies {
  sessions: {
    abandonByAgent(agentId: string): string[];
    activeDurableSessionIdsByAgent(agentId: string, options?: { verifiedOnly?: boolean }): string[];
  };
  harbors: { leaveAll(agentId: string): number };
  resurrection: {
    holdForDurableSessions(agentId: string): { held: boolean; changed: boolean; replacementAlreadyAdmitted: boolean };
    getSalvageCapsule(agentId: string): Record<string, unknown> | undefined;
  };
  messaging: { publish(channel: string, payload: string): unknown };
  logger: { warn(message: string, metadata: Record<string, unknown>): unknown };
  activityLog: { log(type: string, options: { details: string; metadata: Record<string, unknown> }): unknown };
  custodian: {
    onSessionEnd(sessionId: string): Promise<void>;
    onAgentDead(agentId: string, identityProject: string, capsule?: Record<string, unknown>): Promise<void>;
  } | null;
}

/**
 * Process expiry is not durable work expiry. This design keeps session evidence,
 * process liveness, and recovery admission separate in the real daemon wiring.
 * @param deps Exact stores and existing policy-controlled notification hooks.
 * @returns A synchronous coordinator that harvests only truly ended sessions.
 */
export function createHeartbeatDeathHandler(deps: HeartbeatDeathDependencies) {
  return (agent: ExpiredAgent) => {
    const { sessions, harbors, resurrection, messaging, logger, activityLog, custodian } = deps;
    const preservedDurableSessionIds = sessions.activeDurableSessionIdsByAgent(agent.id);
    const hold = resurrection.holdForDurableSessions(agent.id);
    // Operational harbor membership expires with the process. Its saved work and
    // directory history do not confer live membership or control authority.
    const departedHarbors = harbors.leaveAll(agent.id);
    const abandonedSessionIds = sessions.abandonByAgent(agent.id);
    const count = abandonedSessionIds.length;
    if (count > 0) {
      logger.warn('ephemeral_sessions_abandoned', { agentId: agent.id, count, abandonedSessionIds });
      activityLog.log(ActivityType.SESSION_END, {
        details: `Heartbeat expiry abandoned ${count} ephemeral session(s) for ${agent.name || agent.id}`,
        metadata: { agentId: agent.id, count, abandonedSessionIds },
      });
    }
    if (custodian) for (const id of abandonedSessionIds) void custodian.onSessionEnd(id);

    const evidence = {
      agentId: agent.id, name: agent.name, purpose: agent.purpose,
      lastHeartbeat: agent.lastHeartbeat, staleSince: agent.staleSince,
      zombiedSessions: count, abandonedSessionIds, preservedDurableSessionIds,
    };
    if (hold.held) {
      // Repeated sweeps remain silent once the work and operational membership
      // have been reconciled; there is no new replacement queue entry or spawn.
      if (count > 0 || departedHarbors > 0 || hold.changed) {
        const event = { ...evidence, event: 'dormant', holdReason: 'durable_session_active',
          replacementAlreadyAdmitted: hold.replacementAlreadyAdmitted };
        messaging.publish('resurrection', JSON.stringify(event));
        messaging.publish('agents', JSON.stringify(event));
        logger.warn('agent_dormant', event);
      }
      return { abandonedSessionIds, preservedDurableSessionIds, queuedForReplacement: false,
        replacementAlreadyAdmitted: hold.replacementAlreadyAdmitted };
    }

    messaging.publish('resurrection', JSON.stringify({ ...evidence, event: 'dead' }));
    messaging.publish('agents', JSON.stringify({ ...evidence, event: 'dead',
      message: `Agent ${agent.name || agent.id} is dead and queued for resurrection` }));
    logger.warn('agent_dead', { agentId: agent.id, name: agent.name });
    activityLog.log(ActivityType.AGENT_CLEANUP, {
      details: `Agent ${agent.name || agent.id} detected as dead, queued for resurrection`,
      metadata: { agentId: agent.id, staleSince: agent.staleSince },
    });
    if (custodian) {
      // The capsule remains untrusted context. Its fields never supply the
      // authenticated project scope used by the existing permission check.
      const rawCapsule = resurrection.getSalvageCapsule(agent.id);
      const salvage = normalizeSelfSalvage(rawCapsule);
      if (rawCapsule && !salvage.success) logger.warn('salvage_capsule_invalid', { agentId: agent.id, error: salvage.error });
      void custodian.onAgentDead(agent.id, agent.identityProject ?? '', salvage.capsule as Record<string, unknown> | undefined);
    }
    return { abandonedSessionIds, preservedDurableSessionIds, queuedForReplacement: true, replacementAlreadyAdmitted: false };
  };
}
