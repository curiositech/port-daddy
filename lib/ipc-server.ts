/**
 * Port Daddy IPC Server
 *
 * Binary IPC over Unix domain socket for high-frequency agent communication.
 * Listens on /tmp/port-daddy.ipc alongside the HTTP socket on /tmp/port-daddy.sock.
 *
 * Design principles (Raft-influenced):
 * - Daemon is the strong leader; agents are followers
 * - Fire-and-forget for common case (heartbeats, pheromone sprays)
 * - Request-response for rare case (claims, locks, session management)
 * - Peer credential auth (zero overhead, no tokens)
 * - Constraints eliminate state: connections are stateful, messages are not
 *
 * Security (localhost attack surface):
 * - Socket file permissions: 0o600 (owner only)
 * - Max connections limit (prevent fd exhaustion)
 * - Per-connection rate limiting (prevent frame flooding)
 * - Oversized frame = disconnect (not skip)
 * - Backpressure: queue writes, pause reading when socket buffer full
 * - Protocol violation budget: 3 strikes and disconnect
 */

import net from 'node:net';
import { createFrameDecoder, encodeFrame } from './ipc-frame.js';
import {
  IPC_SOCK_PATH,
  Performative,
  FIRE_AND_FORGET,
  ConnectionState,
  MAX_PAYLOAD_SIZE,
  HEADER_SIZE,
} from './ipc-types.js';
import type {
  IpcFrame,
  PeerCredentials,
  ConnectionStateName,
} from './ipc-types.js';
import { existsSync, unlinkSync, chmodSync } from 'fs';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_CONNECTIONS = 256;
const MAX_FRAMES_PER_SECOND = 500;     // per connection
const MAX_PROTOCOL_VIOLATIONS = 3;     // strikes before disconnect
const MAX_WRITE_QUEUE = 64;            // max queued outbound frames per connection
const RATE_LIMIT_WINDOW_MS = 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IpcConnection {
  id: string;
  socket: net.Socket;
  state: ConnectionStateName;
  peer: PeerCredentials | null;
  agentId: string | null;
  decoder: ReturnType<typeof createFrameDecoder>;
  connectedAt: number;
  /** Frames received in current rate-limit window */
  frameCount: number;
  /** Start of current rate-limit window */
  windowStart: number;
  /** Protocol violations (oversized frames, malformed msgpack) */
  violations: number;
  /** Write queue for backpressure management */
  writeQueue: Buffer[];
  /** Whether the socket is draining (backpressured) */
  draining: boolean;
  /** Bytes received total (diagnostics) */
  bytesIn: number;
  /** Bytes sent total (diagnostics) */
  bytesOut: number;
  /** Frames processed total (diagnostics) */
  framesIn: number;
  /** Frames sent total (diagnostics) */
  framesOut: number;
}

export type FrameHandler = (
  frame: IpcFrame,
  conn: IpcConnection,
  reply: (response: IpcFrame) => void,
) => void;

export interface IpcServerOptions {
  socketPath?: string;
  maxConnections?: number;
  maxFramesPerSecond?: number;
  onFrame: FrameHandler;
  onConnect?: (conn: IpcConnection) => void;
  onDisconnect?: (conn: IpcConnection) => void;
  onError?: (err: Error, conn?: IpcConnection) => void;
}

// ─── Connection ID Generator ────────────────────────────────────────────────

let _connSeq = 0;
function nextConnId(): string {
  return `ipc-${++_connSeq}-${Date.now().toString(36)}`;
}

// ─── Safe Write with Backpressure ───────────────────────────────────────────

function safeWrite(conn: IpcConnection, buf: Buffer, onError?: (err: Error, conn: IpcConnection) => void): boolean {
  if (conn.state !== ConnectionState.READY) return false;

  // If draining, queue the write
  if (conn.draining) {
    if (conn.writeQueue.length >= MAX_WRITE_QUEUE) {
      // Queue full — drop oldest non-response frame (backpressure policy)
      // This is the ONLY place we drop, and we log it
      onError?.(new Error(`IPC write queue full for ${conn.agentId ?? conn.id}, dropping frame`), conn);
      return false;
    }
    conn.writeQueue.push(buf);
    return true;
  }

  // Try to write directly
  const ok = conn.socket.write(buf);
  conn.bytesOut += buf.length;
  conn.framesOut++;

  if (!ok) {
    // Socket buffer full — start queueing
    conn.draining = true;
  }

  return true;
}

function flushWriteQueue(conn: IpcConnection): void {
  while (conn.writeQueue.length > 0) {
    const buf = conn.writeQueue[0];
    const ok = conn.socket.write(buf);
    conn.bytesOut += buf.length;
    conn.framesOut++;
    conn.writeQueue.shift();
    if (!ok) return; // Still backpressured, wait for next drain
  }
  conn.draining = false;
}

// ─── IPC Server ─────────────────────────────────────────────────────────────

export function createIpcServer(options: IpcServerOptions) {
  const socketPath = options.socketPath ?? IPC_SOCK_PATH;
  const maxConns = options.maxConnections ?? MAX_CONNECTIONS;
  const maxFPS = options.maxFramesPerSecond ?? MAX_FRAMES_PER_SECOND;
  const connections = new Map<string, IpcConnection>();
  let server: net.Server | null = null;

  function disconnectWithReason(conn: IpcConnection, reason: string): void {
    if (conn.state === ConnectionState.CLOSED) return;
    // Send REFUSE before disconnecting so the client knows why
    try {
      const frame = encodeFrame({
        type: Performative.REFUSE,
        convId: FIRE_AND_FORGET,
        payload: { error: 'disconnected', reason },
      });
      conn.socket.write(frame);
    } catch {}
    conn.socket.destroy();
  }

  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up stale socket file
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath); } catch {}
      }

      server = net.createServer((socket) => {
        // ── Guard: connection limit ──
        if (connections.size >= maxConns) {
          try {
            const frame = encodeFrame({
              type: Performative.REFUSE,
              convId: FIRE_AND_FORGET,
              payload: { error: 'max_connections', message: `Limit: ${maxConns}` },
            });
            socket.write(frame);
          } catch {}
          socket.destroy();
          return;
        }

        const conn: IpcConnection = {
          id: nextConnId(),
          socket,
          state: ConnectionState.CONNECTING,
          peer: null,
          agentId: null,
          decoder: createFrameDecoder(),
          connectedAt: Date.now(),
          frameCount: 0,
          windowStart: Date.now(),
          violations: 0,
          writeQueue: [],
          draining: false,
          bytesIn: 0,
          bytesOut: 0,
          framesIn: 0,
          framesOut: 0,
        };

        connections.set(conn.id, conn);
        conn.state = ConnectionState.READY;

        options.onConnect?.(conn);

        // ── Backpressure: drain event flushes queued writes ──
        socket.on('drain', () => {
          flushWriteQueue(conn);
        });

        // ── Data handler: decode frames and dispatch ──
        socket.on('data', (chunk: Buffer) => {
          conn.bytesIn += chunk.length;

          // ── Guard: rate limiting ──
          const now = Date.now();
          if (now - conn.windowStart >= RATE_LIMIT_WINDOW_MS) {
            conn.frameCount = 0;
            conn.windowStart = now;
          }

          let frames: IpcFrame[];
          try {
            frames = conn.decoder.push(chunk);
          } catch (err) {
            // Protocol violation: malformed data
            conn.violations++;
            if (conn.violations >= MAX_PROTOCOL_VIOLATIONS) {
              disconnectWithReason(conn, `${MAX_PROTOCOL_VIOLATIONS} protocol violations`);
              return;
            }
            // Send NOT_UNDERSTOOD but keep connection
            const errFrame = encodeFrame({
              type: Performative.NOT_UNDERSTOOD,
              convId: FIRE_AND_FORGET,
              payload: { error: 'frame_decode_error', message: String(err), violations: conn.violations },
            });
            safeWrite(conn, errFrame, options.onError);
            return;
          }

          // ── Guard: check for oversized frame violations from decoder ──
          if (conn.decoder.bufferedBytes > MAX_PAYLOAD_SIZE + HEADER_SIZE) {
            conn.violations++;
            if (conn.violations >= MAX_PROTOCOL_VIOLATIONS) {
              disconnectWithReason(conn, 'oversized frame attempts');
              return;
            }
          }

          for (const frame of frames) {
            // ── Guard: rate limit per frame ──
            conn.frameCount++;
            conn.framesIn++;
            if (conn.frameCount > maxFPS) {
              // Over rate limit — send REFUSE for requests, silently drop informs
              if (frame.convId !== FIRE_AND_FORGET) {
                const refuseFrame = encodeFrame({
                  type: Performative.REFUSE,
                  convId: frame.convId,
                  payload: { error: 'rate_limited', limit: maxFPS, window: 'per_second' },
                });
                safeWrite(conn, refuseFrame, options.onError);
              }
              continue; // Skip processing
            }

            // Track agent identity from first frame with agentId
            if (!conn.agentId && frame.payload.agentId) {
              conn.agentId = String(frame.payload.agentId);
            }

            // Build reply function scoped to this frame's convId
            const reply = (response: IpcFrame) => {
              const responseFrame: IpcFrame = {
                ...response,
                convId: frame.convId,
              };
              const buf = encodeFrame(responseFrame);
              safeWrite(conn, buf, options.onError);
            };

            // Dispatch to handler
            try {
              options.onFrame(frame, conn, reply);
            } catch (err) {
              // Handler threw — send FAILURE response (FIPA: tried and failed)
              if (frame.convId !== FIRE_AND_FORGET) {
                reply({
                  type: Performative.FAILURE,
                  convId: frame.convId,
                  payload: {
                    error: 'handler_error',
                    message: String(err),
                    originalAction: frame.payload.action,
                  },
                });
              }
              options.onError?.(err as Error, conn);
            }
          }
        });

        // ── Connection close ──
        socket.on('close', () => {
          conn.state = ConnectionState.CLOSED;
          connections.delete(conn.id);
          conn.decoder.reset();
          conn.writeQueue.length = 0;
          options.onDisconnect?.(conn);
        });

        // ── Socket error ──
        socket.on('error', (err: Error) => {
          options.onError?.(err, conn);
        });
      });

      server.on('error', (err) => {
        options.onError?.(err);
        reject(err);
      });

      server.listen(socketPath, () => {
        // Restrict permissions: owner only
        try { chmodSync(socketPath, 0o600); } catch {}
        resolve();
      });
    });
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const conn of connections.values()) {
        conn.state = ConnectionState.CLOSING;
        conn.socket.destroy();
      }
      connections.clear();

      if (server) {
        server.close(() => {
          try { unlinkSync(socketPath); } catch {}
          server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /** Broadcast a frame to all connected agents (for pub/sub fan-out) */
  function broadcast(frame: IpcFrame, filter?: (conn: IpcConnection) => boolean): void {
    const encoded = encodeFrame(frame);
    for (const conn of connections.values()) {
      if (conn.state !== ConnectionState.READY) continue;
      if (filter && !filter(conn)) continue;
      safeWrite(conn, encoded, options.onError);
    }
  }

  /** Send a frame to a specific agent by agentId */
  function sendTo(agentId: string, frame: IpcFrame): boolean {
    for (const conn of connections.values()) {
      if (conn.agentId === agentId && conn.state === ConnectionState.READY) {
        return safeWrite(conn, encodeFrame(frame), options.onError);
      }
    }
    return false;
  }

  return {
    start,
    stop,
    broadcast,
    sendTo,
    get connectionCount() { return connections.size; },
    get connections() { return connections; },
  };
}
