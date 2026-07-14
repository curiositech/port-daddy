/**
 * Agent Cockpit Routes — "Watch + Grab the Wheel" Phase 0 foundation.
 *
 * Two ADDITIVE endpoints that let a console watch ONE agent/sortie in a single
 * merged stream and softly steer it. Neither changes the behavior of any
 * existing route.
 *
 *   GET  /agents/:id/stream      SSE — one feed merging the three things a
 *                                cockpit lane needs for a single agent:
 *                                  - agent.status     (register/unregister/heartbeat
 *                                                       events on the `agents` channel)
 *                                  - agent.tube       (messages on the agent's steering
 *                                                       channel `agent:<id>`)
 *                                  - agent.transcript (ship-run start/update/end for
 *                                                       this agent's spawned_agent_id)
 *
 *   POST /agents/:id/interrupt   SOFT cancel/steer signal — distinct from the
 *                                hard `DELETE /spawn/:id`. Publishes a typed
 *                                control message `{kind:'control.interrupt', ...}`
 *                                onto the agent's steering channel `agent:<id>`
 *                                that a cooperating agent loop can observe. Does
 *                                NOT kill the process — this is "pause/redirect."
 *
 * Steering-channel convention:
 *   The control channel for an agent is deterministically `agent:<id>`, so both
 *   the console (subscribing via /agents/:id/stream) and any cooperating agent
 *   loop can derive it from the agent id alone without out-of-band coordination.
 *
 * SSE idioms mirror routes/messaging.ts (GET /msg/:channel/subscribe) and
 * routes/transcripts.ts (GET /transcripts/stream): reply.hijack(), an initial
 * `event: connected`, a 30s `:heartbeat` keepalive, fail-closed cleanup on
 * client disconnect, and per-IP SSE connection limits.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateAgentId } from '../shared/validators.js';
import { assessTranscriptEntry } from '../lib/transcript-compliance.js';
import type { TranscriptEntry } from '../lib/transcripts.js';
import {
  canOpenConnection,
  trackConnection,
  untrackConnection,
  connectionLimits,
} from '../shared/connection-tracking.js';

/** Envelope version for the merged cockpit stream. */
export const AGENT_STREAM_ENVELOPE_VERSION = 1;

export type AgentStreamKind = 'agent.status' | 'agent.tube' | 'agent.transcript';

/** Typed envelope emitted on the merged stream (one per SSE `data:` line). */
export interface AgentStreamEnvelope {
  v: typeof AGENT_STREAM_ENVELOPE_VERSION;
  kind: AgentStreamKind;
  agentId: string;
  body: unknown;
  ts: number;
}

/**
 * Deterministic steering/control channel for an agent. Both the console and a
 * cooperating agent loop derive this from the agent id alone.
 */
export function agentSteeringChannel(agentId: string): string {
  return `agent:${agentId}`;
}

interface AgentCockpitMessaging {
  publish(
    channel: string,
    payload: unknown,
    opts?: { sender?: string | null; expires?: unknown; contentType?: 'text' | 'json' | 'binary' },
  ): { success: boolean; id?: number; error?: string };
  subscribe(channel: string, callback: (message: unknown) => void): (() => void) | null;
}

interface AgentCockpitAgents {
  get(id: string): { success: boolean; agent?: Record<string, unknown>; error?: string };
}

type AgentCockpitTranscriptEntry = TranscriptEntry;

interface AgentCockpitTranscripts {
  subscribe(listener: (event: { type: 'start' | 'update' | 'end'; entry: AgentCockpitTranscriptEntry }) => void): () => void;
  listTranscripts?(filter?: { agentId?: string; limit?: number }): AgentCockpitTranscriptEntry[];
  getTranscript?(id: string): AgentCockpitTranscriptEntry | null;
}

interface AgentCockpitRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  agents: AgentCockpitAgents;
  messaging: AgentCockpitMessaging;
  transcripts?: AgentCockpitTranscripts;
}

export const agentCockpitPlugin: FastifyPluginAsync<{ deps: AgentCockpitRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { logger, metrics, agents, messaging, transcripts } = opts.deps;

  // ── GET /agents/:id/stream  (merged SSE) ─────────────────────────────────
  fastify.get('/agents/:id/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp: string = request.ip || 'unknown';

    try {
      const agentId = (request.params as { id?: string }).id as string;
      const idValidation = validateAgentId(agentId);
      if (!idValidation.valid) {
        reply.code(400);
        return { error: idValidation.error };
      }

      if (!canOpenConnection(clientIp, 'sse')) {
        reply
          .code(429)
          .header('Retry-After', '10')
          .header('Cache-Control', 'no-store');
        return { error: 'too many concurrent SSE connections' };
      }

      const steeringChannel = agentSteeringChannel(agentId);

      // Hijack the response for SSE (mirrors routes/messaging.ts). Once
      // hijacked, errors are surfaced as SSE frames, not JSON responses.
      reply.hijack();
      const raw = reply.raw;

      trackConnection(clientIp, 'sse', raw as never);

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Source 1 — agent lifecycle events. The `agents` channel carries
      // register/unregister events as JSON for ALL agents; forward only ours.
      const unsubAgents = messaging.subscribe('agents', (message: unknown) => {
        const decoded = decodeAgentChannelEvent(extractMessagePayload(message));
        if (decoded && decoded.agentId === agentId) {
          writeEnvelope(raw, { kind: 'agent.status', agentId, body: decoded });
        }
      });

      // Source 2 — the agent's steering channel (tube + control messages).
      const unsubTube = messaging.subscribe(steeringChannel, (message: unknown) => {
        writeEnvelope(raw, { kind: 'agent.tube', agentId, body: extractMessagePayload(message) });
      });

      if (!unsubAgents || !unsubTube) {
        // Broker at its subscriber ceiling — fail closed over SSE.
        try { unsubAgents?.(); } catch { /* noop */ }
        try { unsubTube?.(); } catch { /* noop */ }
        try { raw.write('event: error\ndata: {"reason":"subscription limit exceeded"}\n\n'); } catch { /* dead */ }
        untrackConnection(clientIp, 'sse', raw as never);
        try { raw.end(); } catch { /* already ended */ }
        return;
      }

      // Source 3 — ship-run transcript events for this agent.
      const unsubTranscripts = transcripts
        ? transcripts.subscribe((event) => {
            if (event.entry && event.entry.spawned_agent_id === agentId) {
              writeEnvelope(raw, {
                kind: 'agent.transcript',
                agentId,
                body: transcriptEnvelopeBody(event.type, event.entry),
              });
            }
          })
        : (() => {});

      raw.write(`event: connected\ndata: ${JSON.stringify({ agentId, channel: steeringChannel })}\n\n`);
      writeInitialSnapshots(raw, agentId, agents, transcripts);

      const heartbeat = setInterval(() => {
        try { raw.write(':heartbeat\n\n'); } catch { /* dead conn */ }
      }, 30000);

      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        clearTimeout(connectionTimeout);
        try { unsubAgents(); } catch { /* already gone */ }
        try { unsubTube(); } catch { /* already gone */ }
        try { unsubTranscripts(); } catch { /* already gone */ }
        untrackConnection(clientIp, 'sse', raw as never);
        try { raw.end(); } catch { /* already ended */ }
        logger.info('agent_stream_disconnected', { agentId, ip: clientIp });
      };

      const connectionTimeout = setTimeout(() => {
        try { raw.write('event: timeout\ndata: {"reason":"connection timeout"}\n\n'); } catch { /* dead conn */ }
        cleanup();
      }, connectionLimits.sseTimeout);

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);

      logger.info('agent_stream_connected', { agentId, ip: clientIp, channel: steeringChannel });
    } catch (error) {
      metrics.errors++;
      logger.error?.('agent_stream_error', { error: (error as Error).message });
      // If we already hijacked, the headers are gone; this only fires for
      // pre-hijack failures, where returning a body is still valid.
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // ── POST /agents/:id/interrupt  (soft cancel/steer) ──────────────────────
  fastify.post('/agents/:id/interrupt', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agentId = (request.params as { id?: string }).id as string;
      const idValidation = validateAgentId(agentId);
      if (!idValidation.valid) {
        reply.code(400);
        return { error: idValidation.error };
      }

      const existing = agents.get(agentId);
      if (!existing.success) {
        reply.code(404);
        return { success: false, error: existing.error || 'no such agent' };
      }

      const body = (request.body as { reason?: unknown }) || {};
      const reason = typeof body.reason === 'string' ? body.reason : undefined;

      const steeringChannel = agentSteeringChannel(agentId);
      const control = {
        kind: 'control.interrupt' as const,
        agentId,
        ...(reason ? { reason } : {}),
        ts: Date.now(),
      };

      // Publish the typed control message onto the agent's steering channel as
      // JSON so a cooperating agent loop observing the channel can act on it.
      const published = messaging.publish(steeringChannel, control, { contentType: 'json' });
      if (!published.success) {
        metrics.errors++;
        reply.code(500);
        return { success: false, error: published.error || 'failed to publish interrupt' };
      }

      logger.info('agent_interrupt', { agentId, reason: reason ?? null, messageId: published.id ?? null });

      return {
        success: true,
        agentId,
        channel: steeringChannel,
        delivered: true,
        messageId: published.id ?? null,
        control,
      };
    } catch (error) {
      metrics.errors++;
      logger.error?.('agent_interrupt_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

let streamEventSeq = 0;

/**
 * The in-memory subscribe callback receives the broker's MessagePayload
 * ({ id, channel, payload, sender, createdAt }). The cockpit envelope only
 * cares about the inner `payload`. Defensive: tolerate raw payloads too.
 */
export function extractMessagePayload(message: unknown): unknown {
  if (message && typeof message === 'object' && 'payload' in (message as Record<string, unknown>)) {
    return (message as Record<string, unknown>).payload;
  }
  return message;
}

/**
 * Decode a lifecycle event from the `agents` channel. Those are published by
 * routes/agents.ts as JSON-stringified `{ event, agentId, ... }`. The broker
 * may hand us a parsed object (json content-type) or a string; tolerate both.
 * Returns null when the shape isn't an agent lifecycle event.
 */
export function decodeAgentChannelEvent(payload: unknown): (Record<string, unknown> & { agentId: string }) | null {
  let obj: unknown = payload;
  if (typeof payload === 'string') {
    try { obj = JSON.parse(payload); } catch { return null; }
  }
  if (obj && typeof obj === 'object' && typeof (obj as Record<string, unknown>).agentId === 'string') {
    return obj as Record<string, unknown> & { agentId: string };
  }
  return null;
}

/**
 * Write a typed envelope as one SSE `data:` frame. Stamps `v` + `ts` and is
 * defensive against a dead connection (writes can throw after disconnect).
 */
function writeEnvelope(
  raw: { write(chunk: string): boolean },
  partial: { kind: AgentStreamKind; agentId: string; body: unknown },
): void {
  streamEventSeq = (streamEventSeq + 1) % Number.MAX_SAFE_INTEGER;
  const id = `${partial.agentId}:${Date.now()}:${streamEventSeq}`;
  const envelope: AgentStreamEnvelope = {
    v: AGENT_STREAM_ENVELOPE_VERSION,
    kind: partial.kind,
    agentId: partial.agentId,
    body: partial.body,
    ts: Date.now(),
  };
  try {
    raw.write(`id: ${id}\nevent: ${partial.kind}\ndata: ${JSON.stringify(envelope)}\n\n`);
  } catch {
    /* client disconnected — cleanup handler will tear down */
  }
}

function writeInitialSnapshots(
  raw: { write(chunk: string): boolean },
  agentId: string,
  agents: AgentCockpitAgents,
  transcripts?: AgentCockpitTranscripts,
): void {
  const currentAgent = agents.get(agentId);
  if (currentAgent.success && currentAgent.agent) {
    writeEnvelope(raw, {
      kind: 'agent.status',
      agentId,
      body: { event: 'snapshot', agentId, ...currentAgent.agent },
    });
  }

  const tx = latestTranscriptForAgent(transcripts, agentId);
  if (tx) {
    writeEnvelope(raw, {
      kind: 'agent.transcript',
      agentId,
      body: transcriptEnvelopeBody('snapshot', tx),
    });
  }
}

function transcriptEnvelopeBody(
  type: 'snapshot' | 'start' | 'update' | 'end',
  entry: AgentCockpitTranscriptEntry,
): Record<string, unknown> {
  return {
    type,
    entry,
    compliance: assessTranscriptEntry(entry),
  };
}

function latestTranscriptForAgent(
  transcripts: AgentCockpitTranscripts | undefined,
  agentId: string,
): AgentCockpitTranscriptEntry | null {
  if (!transcripts?.listTranscripts) return null;
  const [header] = transcripts.listTranscripts({ agentId, limit: 1 }) || [];
  if (!header) return null;
  if (transcripts.getTranscript && typeof header.id === 'string') {
    return transcripts.getTranscript(header.id) || header;
  }
  return header;
}
