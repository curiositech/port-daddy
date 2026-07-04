/**
 * Fleet approvals surface — the live human-gate loop over the trust gate's
 * L2 queue (ADR-0093 + websocket-streaming skill).
 *
 * GET  /fleet/approvals/stream   (WebSocket)
 *   On connect: `{type:'snapshot', proposals}` for resync (reconnecting
 *   clients rebuild local state from it — deltas only afterwards).
 *   Server → client: human_gate_waiting / human_gate_resolved / error.
 *   Client → server: `{type:'human_decision', id, decision, feedback?}`.
 *
 * REST fallbacks (FleetBar/pd-console/curl don't need a socket):
 *   GET  /fleet/approvals                — pending list
 *   POST /fleet/approvals/:id/decision   — {decision:'approve'|'reject', feedback?}
 *
 * Trust model: same as every other daemon route — loopback-bound daemon,
 * the local operator IS the authority. Approving here is exactly as
 * privileged as the pre-existing POST /fleet/agent/run. Connection caps
 * reuse the daemon-wide tracker so a runaway dashboard cannot fd-starve
 * the daemon.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import {
  getSharedApprovalStream,
  type ApprovalClientEvent,
  type ApprovalServerEvent,
} from '../lib/fleet/approval-stream.js';
import { canOpenConnection, trackConnection, untrackConnection } from '../shared/connection-tracking.js';

export interface FleetApprovalsRouteDeps {
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

function parseClientEvent(raw: unknown): ApprovalClientEvent | null {
  let obj: unknown = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      obj = JSON.parse(raw.toString());
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const e = obj as Record<string, unknown>;
  if (e.type !== 'human_decision') return null;
  if (typeof e.id !== 'string' || !e.id) return null;
  if (e.decision !== 'approve' && e.decision !== 'reject') return null;
  return {
    type: 'human_decision',
    id: e.id,
    decision: e.decision,
    feedback: typeof e.feedback === 'string' ? e.feedback : undefined,
  };
}

export const fleetApprovalsPlugin: FastifyPluginAsync<{ deps: FleetApprovalsRouteDeps }> = async (
  fastify,
  opts,
) => {
  const logger = opts.deps?.logger;
  // Registered inside this plugin scope: only these routes speak ws.
  await fastify.register(websocket);

  // ── WebSocket: snapshot + live deltas + decisions ─────────────────────────
  fastify.get('/fleet/approvals/stream', { websocket: true }, (socket, req) => {
    const ip = req.ip || 'unknown';
    if (!canOpenConnection(ip, 'sse')) {
      socket.send(JSON.stringify({ type: 'error', message: 'too many concurrent connections' } satisfies ApprovalServerEvent));
      socket.close(1013, 'try again later');
      return;
    }
    trackConnection(ip, 'sse', socket as never);

    const stream = getSharedApprovalStream();
    const send = (event: ApprovalServerEvent): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    };

    // Resync contract: full snapshot on every (re)connect, deltas after.
    send({ type: 'snapshot', proposals: stream.list() });
    const unsubscribe = stream.subscribe(send);

    socket.on('message', (data: Buffer) => {
      const event = parseClientEvent(data);
      if (!event) {
        send({ type: 'error', message: 'malformed client event (expected human_decision)' });
        return;
      }
      void stream
        .decide(event, `ws:${ip}`)
        .then((outcome) => {
          // decide() broadcasts resolutions to ALL subscribers; error
          // outcomes are broadcast too, so nothing extra to send here.
          logger?.info('fleet_approval_decision', {
            id: event.id,
            decision: event.decision,
            outcome: outcome.type,
            via: 'websocket',
            ip,
          });
        })
        .catch((err: Error) => {
          send({ type: 'error', id: event.id, message: err.message });
        });
    });

    socket.on('close', () => {
      unsubscribe();
      // Balance trackConnection or this IP hits maxPerIP after 5 sockets
      // and is refused forever.
      untrackConnection(ip, 'sse', socket as never);
    });
  });

  // ── REST fallbacks ─────────────────────────────────────────────────────────
  fastify.get('/fleet/approvals', async () => {
    return { success: true, proposals: getSharedApprovalStream().list() };
  });

  fastify.post('/fleet/approvals/:id/decision', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { decision?: string; feedback?: string };
    const event = parseClientEvent({ type: 'human_decision', id, decision: body.decision, feedback: body.feedback });
    if (!event) {
      reply.code(400);
      return { success: false, error: 'decision must be "approve" or "reject"' };
    }
    const outcome = await getSharedApprovalStream().decide(event, `rest:${request.ip ?? 'unknown'}`);
    logger?.info('fleet_approval_decision', { id, decision: event.decision, outcome: outcome.type, via: 'rest' });
    if (outcome.type === 'error') {
      reply.code(outcome.message.includes('unknown') ? 404 : 409);
      return { success: false, error: outcome.message };
    }
    return { success: true, resolved: outcome };
  });
};
