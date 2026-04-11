/**
 * Port Daddy IPC Client
 *
 * Connects to the daemon's binary IPC socket for high-frequency operations.
 * Used by agents for heartbeats, pheromone sprays, and pub/sub subscriptions.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Fire-and-forget sends (conv_id=0) for heartbeats
 * - Request-response with timeout and conversation correlation
 * - Subscription support (persistent frame callbacks)
 */

import net from 'node:net';
import { createFrameDecoder, encodeFrame, nextConvId } from './ipc-frame.js';
import {
  IPC_SOCK_PATH,
  Performative,
  FIRE_AND_FORGET,
  ConnectionState,
} from './ipc-types.js';
import type {
  IpcFrame,
  ConnectionStateName,
} from './ipc-types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (frame: IpcFrame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface IpcClientOptions {
  socketPath?: string;
  agentId: string;
  /** Auto-reconnect on disconnect (default: true) */
  reconnect?: boolean;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Request timeout in ms (default: 5000) */
  requestTimeout?: number;
  /** Called on every incoming frame (for subscriptions) */
  onFrame?: (frame: IpcFrame) => void;
  /** Called on connection state changes */
  onStateChange?: (state: ConnectionStateName) => void;
}

// ─── IPC Client ─────────────────────────────────────────────────────────────

export function createIpcClient(options: IpcClientOptions) {
  const socketPath = options.socketPath ?? IPC_SOCK_PATH;
  const reconnect = options.reconnect ?? true;
  const maxReconnectDelay = options.maxReconnectDelay ?? 30_000;
  const requestTimeout = options.requestTimeout ?? 5_000;

  let socket: net.Socket | null = null;
  let decoder = createFrameDecoder();
  let state: ConnectionStateName = ConnectionState.CLOSED;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  // Track active subscriptions for replay on reconnect
  const activeSubscriptions = new Set<string>();

  // Pending request-response correlation map
  const pending = new Map<number, PendingRequest>();

  function setState(newState: ConnectionStateName) {
    state = newState;
    options.onStateChange?.(newState);
  }

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (destroyed) return reject(new Error('Client destroyed'));
      if (state === ConnectionState.READY) return resolve();

      setState(ConnectionState.CONNECTING);
      decoder.reset();

      // Connect with timeout — prevent indefinite hang if server backlog full
      const connectTimeout = setTimeout(() => {
        if (socket) socket.destroy();
        reject(new Error(`IPC connect timeout (${requestTimeout}ms)`));
      }, requestTimeout);
      if (typeof connectTimeout.unref === 'function') connectTimeout.unref();

      socket = net.connect(socketPath, () => {
        clearTimeout(connectTimeout);
        setState(ConnectionState.READY);
        reconnectAttempt = 0;

        // Replay subscriptions from before disconnect
        for (const channel of activeSubscriptions) {
          send(Performative.SUBSCRIBE, { action: 'msg.subscribe', channel });
        }

        resolve();
      });

      socket.on('data', (chunk: Buffer) => {
        const frames = decoder.push(chunk);
        for (const frame of frames) {
          // Server-initiated REFUSE = we're being disconnected or rate-limited
          if (frame.type === Performative.REFUSE && frame.convId === FIRE_AND_FORGET) {
            options.onFrame?.(frame);  // Let caller know
            continue;
          }

          // Check if this is a response to a pending request
          if (frame.convId !== FIRE_AND_FORGET && pending.has(frame.convId)) {
            const req = pending.get(frame.convId)!;
            pending.delete(frame.convId);
            clearTimeout(req.timer);
            req.resolve(frame);
          } else {
            // Unsolicited frame (subscription data, broadcast)
            options.onFrame?.(frame);
          }
        }
      });

      socket.on('close', () => {
        setState(ConnectionState.CLOSED);
        decoder.reset();

        // Reject all pending requests
        for (const [convId, req] of pending) {
          clearTimeout(req.timer);
          req.reject(new Error('Connection closed'));
          pending.delete(convId);
        }

        // Auto-reconnect
        if (reconnect && !destroyed) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempt),
            maxReconnectDelay,
          );
          reconnectAttempt++;
          reconnectTimer = setTimeout(() => {
            connect().catch(() => {}); // Reconnect failures retry automatically
          }, delay);
          if (typeof reconnectTimer.unref === 'function') reconnectTimer.unref();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(connectTimeout);
        if (state === ConnectionState.CONNECTING) {
          reject(err);
        }
      });
    });
  }

  /**
   * Send a fire-and-forget frame. No response expected.
   * Used for heartbeats, pheromone sprays, pub/sub publishes.
   * Returns false if not connected or write failed.
   */
  function send(type: IpcFrame['type'], payload: Record<string, unknown>): boolean {
    if (!socket || state !== ConnectionState.READY) return false;
    const frame: IpcFrame = {
      type,
      convId: FIRE_AND_FORGET,
      payload: { ...payload, agentId: options.agentId },
    };
    try {
      const buf = encodeFrame(frame);
      return socket.write(buf);  // false = backpressured, but data is buffered by Node
    } catch {
      return false;
    }
  }

  /**
   * Send a request and wait for the correlated response.
   * Used for claims, locks, session management.
   */
  function request(
    type: IpcFrame['type'],
    payload: Record<string, unknown>,
    timeout?: number,
  ): Promise<IpcFrame> {
    return new Promise((resolve, reject) => {
      if (!socket || state !== ConnectionState.READY) {
        return reject(new Error('Not connected'));
      }

      const convId = nextConvId();
      const timer = setTimeout(() => {
        pending.delete(convId);
        reject(new Error(`IPC request timeout (${timeout ?? requestTimeout}ms)`));
      }, timeout ?? requestTimeout);
      if (typeof timer.unref === 'function') timer.unref();

      pending.set(convId, { resolve, reject, timer });

      const frame: IpcFrame = {
        type,
        convId,
        payload: { ...payload, agentId: options.agentId },
      };

      try {
        socket.write(encodeFrame(frame));
      } catch (err) {
        pending.delete(convId);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /** Convenience: send a heartbeat (fire-and-forget INFORM) */
  function heartbeat(): void {
    send(Performative.INFORM, {
      action: 'heartbeat',
      ts: Date.now(),
    });
  }

  /** Convenience: spray a pheromone (fire-and-forget INFORM) */
  function spray(table: string, id: string, key: string, strength: number): void {
    send(Performative.INFORM, {
      action: 'pheromone.spray',
      table, id, key, strength,
    });
  }

  /** Convenience: publish to a channel (fire-and-forget INFORM) */
  function publish(channel: string, message: string): void {
    send(Performative.INFORM, {
      action: 'msg.publish',
      channel, message,
    });
  }

  /** Convenience: claim a port (request-response) */
  async function claim(identity: string): Promise<IpcFrame> {
    return request(Performative.REQUEST, {
      action: 'port.claim',
      identity,
    });
  }

  /**
   * Subscribe to a pub/sub channel. Messages arrive via onFrame callback
   * as INFORM frames with payload.action='msg.delivery'.
   * Survives reconnects — subscriptions are replayed automatically.
   */
  function subscribe(channel: string): boolean {
    activeSubscriptions.add(channel);
    return send(Performative.SUBSCRIBE, { action: 'msg.subscribe', channel });
  }

  /**
   * Unsubscribe from a pub/sub channel.
   */
  function unsubscribe(channel: string): boolean {
    activeSubscriptions.delete(channel);
    return send(Performative.INFORM, { action: 'msg.unsubscribe', channel });
  }

  /** Disconnect and stop reconnecting */
  function destroy(): void {
    destroyed = true;
    activeSubscriptions.clear();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    for (const [, req] of pending) {
      clearTimeout(req.timer);
      req.reject(new Error('Client destroyed'));
    }
    pending.clear();
    if (socket) {
      socket.destroy();
      socket = null;
    }
    setState(ConnectionState.CLOSED);
  }

  return {
    connect,
    send,
    request,
    heartbeat,
    spray,
    publish,
    claim,
    subscribe,
    unsubscribe,
    destroy,
    get state() { return state; },
    get pendingCount() { return pending.size; },
    get subscriptionCount() { return activeSubscriptions.size; },
  };
}
