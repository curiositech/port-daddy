/**
 * Agents Routes
 *
 * V2 Agent Endpoints for agent registry and heartbeat.
 * Provides agent registration, heartbeat, and resource tracking.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateAgentId } from '../shared/validators.js';
import { WebhookEvent } from '../lib/webhooks.js';

interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: string;
  type: string;
  read: boolean;
  createdAt: number;
}

interface AgentsRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  agents: {
    register(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    heartbeat(id: string, opts: Record<string, unknown>): Record<string, unknown>;
    unregister(id: string): Record<string, unknown>;
    get(id: string): Record<string, unknown>;
    list(opts: { activeOnly: boolean }): unknown;
  };
  agentInbox: {
    send(agentId: string, content: string, opts?: { from?: string; type?: string }): { success: boolean; messageId?: number; error?: string };
    list(agentId: string, opts?: { unreadOnly?: boolean; limit?: number; since?: number }): { success: boolean; messages: InboxMessage[]; count: number };
    markRead(agentId: string, messageId: number): { success: boolean };
    markAllRead(agentId: string): { success: boolean; marked: number };
    clear(agentId: string): { success: boolean; deleted: number };
    stats(agentId: string): { success: boolean; total: number; unread: number };
  };
  activityLog: {
    logAgent: {
      register(id: string): void;
      heartbeat(id: string): void;
      unregister(id: string): void;
    };
  };
  webhooks: {
    trigger(event: string, payload: Record<string, unknown>, opts: { targetId: string }): void;
  };
  messaging: {
    publish(channel: string, message: string): { success: boolean };
  };
}

/**
 * Create agents routes
 *
 * @param deps - Route dependencies
 * @returns Express router with agent routes
 */
export function createAgentsRoutes(deps: AgentsRouteDeps): Router {
  const { logger, metrics, agents, agentInbox, activityLog, webhooks, messaging } = deps;
  const router = Router();

  // ==========================================================================
  // POST /agents - Register an agent
  // ==========================================================================
  router.post('/agents', (req: Request, res: Response) => {
    try {
      const { id, name, type, metadata, maxServices, maxLocks, identity, worktreeId, purpose } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'agent id required' });
      }

      // Validate agent ID format
      const idValidation = validateAgentId(id);
      if (!idValidation.valid) {
        return res.status(400).json({ error: idValidation.error });
      }

      const result = agents.register(id, {
        name,
        pid: parseInt(req.headers['x-pid'] as string, 10) || process.pid,
        type: type || 'cli',
        metadata,
        maxServices,
        maxLocks,
        // Context-aware salvage: semantic identity for project prefix filtering
        identity,
        worktreeId,
        purpose
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Log activity
      if (result.registered) {
        activityLog.logAgent.register(id);

        // Trigger webhooks
        webhooks.trigger(WebhookEvent.AGENT_REGISTER, {
          agentId: id,
          name: name || id,
          type: type || 'cli',
          identity,
          purpose
        }, { targetId: id });

        // Broadcast to the radio - compulsory status sharing
        messaging.publish('agents', JSON.stringify({
          event: 'registered',
          agentId: id,
          name: name || id,
          type: type || 'cli',
          identity,
          purpose: purpose || metadata?.purpose || null,
          timestamp: Date.now()
        }));
      }

      logger.info('agent_registered', { agentId: id, registered: result.registered as boolean, identity, salvageHint: result.salvageHint });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('agent_register_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // POST /agents/:id/heartbeat - Send heartbeat
  // ==========================================================================
  router.post('/agents/:id/heartbeat', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const result = agents.heartbeat(id, {
        pid: parseInt(req.headers['x-pid'] as string, 10) || process.pid
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Log activity (with sampling to avoid log spam)
      // Only log every 10th heartbeat or on registration
      if (result.registered || Math.random() < 0.1) {
        activityLog.logAgent.heartbeat(id);
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // DELETE /agents/:id - Unregister an agent
  // ==========================================================================
  router.delete('/agents/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const result = agents.unregister(id);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Log activity
      if (result.unregistered) {
        activityLog.logAgent.unregister(id);

        // Trigger webhooks
        webhooks.trigger(WebhookEvent.AGENT_UNREGISTER, {
          agentId: id
        }, { targetId: id });

        // Broadcast to the radio
        messaging.publish('agents', JSON.stringify({
          event: 'unregistered',
          agentId: id,
          timestamp: Date.now()
        }));
      }

      logger.info('agent_unregistered', { agentId: id });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /agents/:id - Get agent info
  // ==========================================================================
  router.get('/agents/:id', (req: Request, res: Response) => {
    try {
      const result = agents.get(req.params.id as string);

      if (!result.success) {
        return res.status(404).json({ error: result.error });
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /agents - List all agents
  // ==========================================================================
  router.get('/agents', (req: Request, res: Response) => {
    try {
      const { active } = req.query;
      const result = agents.list({ activeOnly: active === 'true' });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // AGENT INBOX ROUTES
  // ==========================================================================

  // POST /agents/:id/inbox - Send message to agent's inbox
  router.post('/agents/:id/inbox', (req: Request, res: Response) => {
    try {
      const agentId = req.params.id as string;
      const { content, from, type } = req.body;

      if (!content) {
        return res.status(400).json({ error: 'content required' });
      }

      // Check if agent exists (optional: could allow messages to non-existent agents)
      const agentResult = agents.get(agentId);
      if (!agentResult.success) {
        return res.status(404).json({ error: 'agent not found' });
      }

      const result = agentInbox.send(agentId, content, { from, type });

      if (!result.success) {
        const statusCode = (result as Record<string, unknown>).code === 'RESOURCE_LIMIT' ? 429 : 400;
        return res.status(statusCode).json({ error: result.error, code: (result as Record<string, unknown>).code });
      }

      // Broadcast that a message was received
      messaging.publish(`agent:${agentId}:inbox`, JSON.stringify({
        event: 'message',
        from,
        type: type || 'message',
        preview: content.substring(0, 100)
      }));

      logger.info('inbox_message_sent', { agentId, from, messageId: result.messageId });
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('inbox_send_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // GET /agents/:id/inbox - Read agent's inbox
  router.get('/agents/:id/inbox', (req: Request, res: Response) => {
    try {
      const agentId = req.params.id as string;
      const { unread, limit, since } = req.query;

      const result = agentInbox.list(agentId, {
        unreadOnly: unread === 'true',
        limit: limit ? parseInt(limit as string, 10) : undefined,
        since: since ? parseInt(since as string, 10) : undefined
      });

      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // GET /agents/:id/inbox/stats - Get inbox stats
  router.get('/agents/:id/inbox/stats', (req: Request, res: Response) => {
    try {
      const agentId = req.params.id as string;
      const result = agentInbox.stats(agentId);
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // PUT /agents/:id/inbox/:messageId/read - Mark message as read
  router.put('/agents/:id/inbox/:messageId/read', (req: Request, res: Response) => {
    try {
      const agentId = req.params.id as string;
      const messageId = parseInt(req.params.messageId as string, 10);

      const result = agentInbox.markRead(agentId, messageId);
      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // PUT /agents/:id/inbox/read-all - Mark all messages as read
  router.put('/agents/:id/inbox/read-all', (req: Request, res: Response) => {
    try {
      const agentId = req.params.id as string;
      const result = agentInbox.markAllRead(agentId);
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // DELETE /agents/:id/inbox - Clear inbox
  router.delete('/agents/:id/inbox', (req: Request, res: Response) => {
    try {
      const agentId = req.params.id as string;
      const result = agentInbox.clear(agentId);
      logger.info('inbox_cleared', { agentId, deleted: result.deleted });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
