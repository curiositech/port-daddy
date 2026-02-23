/**
 * Agent Coordination Protocol
 *
 * This module provides typed helpers for multi-agent coordination.
 * It wraps Port Daddy's primitives with the standard message protocol.
 *
 * Usage:
 *   import { AgentCoordinator } from './agent-protocol';
 *   const agent = new AgentCoordinator('my-agent-id');
 *   await agent.joinRoom('bug:JIRA-123:war-room');
 *   await agent.publishFinding('Bug introduced in commit abc123', { commit: 'abc123' });
 */

import { PortDaddy } from '../../lib/client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────────────────────────────────────

export type MessageType =
  | 'status'    // Agent status update (joining, working, leaving)
  | 'finding'   // Discovery or analysis result
  | 'question'  // Request for help/information
  | 'answer'    // Response to a question
  | 'claim'     // Claiming a resource (file, line range, etc.)
  | 'release'   // Releasing a claimed resource
  | 'done';     // Declaring convergence/completion

export interface AgentMessage<T = Record<string, unknown>> {
  agent: string;
  type: MessageType;
  message: string;
  data?: T;
  replyTo?: string;
  ts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel Naming Conventions
// ─────────────────────────────────────────────────────────────────────────────

export const Channels = {
  /** Channel for a specific bug/issue investigation */
  bug: (id: string) => `bug:${id}:war-room`,

  /** Channel for edits to a specific file */
  file: (path: string) => `file:${path.replace(/\//g, ':')}:edits`,

  /** Channel for project-wide announcements */
  project: (name: string, topic: string) => `project:${name}:${topic}`,

  /** Direct inbox for an agent */
  inbox: (agentId: string) => `agent:${agentId}:inbox`,

  /** Custom channel */
  custom: (scope: string, topic: string, qualifier?: string) =>
    qualifier ? `${scope}:${topic}:${qualifier}` : `${scope}:${topic}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator Class
// ─────────────────────────────────────────────────────────────────────────────

export class AgentCoordinator {
  private client: PortDaddy;
  private agentId: string;
  private activeChannels: Set<string> = new Set();
  private messageHandlers: Map<string, (msg: AgentMessage) => void> = new Map();

  constructor(agentId: string, options?: { baseUrl?: string }) {
    this.agentId = agentId;
    this.client = new PortDaddy(options?.baseUrl);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Room Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Join a coordination channel and announce presence
   */
  async joinRoom(channel: string, purpose?: string): Promise<void> {
    this.activeChannels.add(channel);
    await this.publish(channel, 'status', purpose ?? `Joining ${channel}`);
  }

  /**
   * Leave a coordination channel
   */
  async leaveRoom(channel: string, reason?: string): Promise<void> {
    await this.publish(channel, 'status', reason ?? `Leaving ${channel}`);
    this.activeChannels.delete(channel);
  }

  /**
   * Subscribe to messages on a channel
   */
  onMessage(channel: string, handler: (msg: AgentMessage) => void): void {
    this.messageHandlers.set(channel, handler);
    // Note: Actual SSE subscription would be set up here
    // For now, agents poll or use the CLI's `pd sub` command
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Publishing Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Publish a raw message to a channel
   */
  async publish<T>(
    channel: string,
    type: MessageType,
    message: string,
    data?: T,
    replyTo?: string
  ): Promise<void> {
    const msg: AgentMessage<T> = {
      agent: this.agentId,
      type,
      message,
      data,
      replyTo,
      ts: Date.now(),
    };
    await this.client.publish(channel, msg);
  }

  /**
   * Publish a finding/discovery
   */
  async publishFinding<T>(
    channel: string,
    message: string,
    data?: T
  ): Promise<void> {
    await this.publish(channel, 'finding', message, data);
  }

  /**
   * Ask a question and wait for an answer
   */
  async askQuestion<T>(
    channel: string,
    question: string,
    data?: T
  ): Promise<string> {
    const msgId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.publish(channel, 'question', question, { ...data, msgId });
    return msgId;
  }

  /**
   * Answer a question
   */
  async answerQuestion<T>(
    channel: string,
    questionId: string,
    answer: string,
    data?: T
  ): Promise<void> {
    await this.publish(channel, 'answer', answer, data, questionId);
  }

  /**
   * Declare that you're done / problem is solved
   */
  async declareDone<T>(
    channel: string,
    summary: string,
    solution?: T
  ): Promise<void> {
    await this.publish(channel, 'done', summary, solution);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Resource Coordination
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Claim exclusive access to a resource
   */
  async claimResource(
    channel: string,
    resource: string,
    intent: string,
    ttlMs: number = 300000
  ): Promise<boolean> {
    const lockName = `${channel}:${resource}`;
    const result = await this.client.lock(lockName, { ttl: ttlMs });

    if (result.success) {
      await this.publish(channel, 'claim', `Claiming ${resource}: ${intent}`, {
        resource,
        intent,
        ttlMs,
      });
      return true;
    }
    return false;
  }

  /**
   * Release a claimed resource
   */
  async releaseResource(channel: string, resource: string): Promise<void> {
    const lockName = `${channel}:${resource}`;
    await this.client.unlock(lockName);
    await this.publish(channel, 'release', `Released ${resource}`, { resource });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistent Memory
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record a finding in permanent memory (survives beyond the session)
   */
  async recordNote(content: string, type?: string): Promise<void> {
    await this.client.note(content, { type });
  }

  /**
   * Get recent notes
   */
  async getNotes(options?: { limit?: number; since?: number }) {
    return this.client.notes(options);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: Create a coordinator with environment-based agent ID
// ─────────────────────────────────────────────────────────────────────────────

export function createCoordinator(agentId?: string): AgentCoordinator {
  const id = agentId
    ?? process.env.AGENT_ID
    ?? `agent-${Date.now().toString(36)}`;
  return new AgentCoordinator(id);
}
