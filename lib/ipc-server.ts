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
 */

import net from 'node:net';
import { createFrameDecoder, encodeFrame } from './ipc-frame.js';
import {
  IPC_SOCK_PATH,
  Performative,
  PERFORMATIVE_NAME,
  FIRE_AND_FORGET,
  ConnectionState,
} from './ipc-types.js';
import type {
  IpcFrame,
  PeerCredentials,
  ConnectionStateName,
} from './ipc-types.js';
import { existsSync, unlinkSync, chmodSync } from 'fs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IpcConnection {
  id: string;
  socket: net.Socket;
  state: ConnectionStateName;
  peer: PeerCredentials | null;
  agentId: string | null;
  decoder: ReturnType<typeof createFrameDecoder>;
  connectedAt: number;
}

export type FrameHandler = (
  frame: IpcFrame,
  conn: IpcConnection,
  reply: (response: IpcFrame) => void,
) => void;

export interface IpcServerOptions {
  socketPath?: string;
  onFrame: FrameHandler;
  onConnect?: (conn: IpcConnection) => void;
  onDisconnect?: (conn: IpcConnection) => void;
  onError?: (err: Error, conn?: IpcConnection) => void;
}

// ─── Peer Credential Extraction ─────────────────────────────────────────────

function extractPeerCredentials(socket: net.Socket): PeerCredentials | null {
  try {
    // Node.js exposes SO_PEERCRED via internal APIs on Linux
    // On macOS, we can get the PID from the socket
    const fd = (socket as unknown as { _handle?: { fd?: number } })._handle?.fd;
    if (fd === undefined) return null;

    // Use process.pid as fallback — real peer cred extraction needs native addon
    // or the agent self-identifying in the first frame (REGISTER performative)
    return null;  // Will be populated by agent's first INFORM/REQUEST with agentId
  } catch {
    return null;
  }
}

// ─── Connection ID Generator ────────────────────────────────────────────────

let _connSeq = 0;
function nextConnId(): string {
  return `ipc-${++_connSeq}-${Date.now().toString(36)}`;
}

// ─── IPC Server ─────────────────────────────────────────────────────────────

export function createIpcServer(options: IpcServerOptions) {
  const socketPath = options.socketPath ?? IPC_SOCK_PATH;
  const connections = new Map<string, IpcConnection>();
  let server: net.Server | null = null;

  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up stale socket file
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath); } catch {}
      }

      server = net.createServer((socket) => {
        const conn: IpcConnection = {
          id: nextConnId(),
          socket,
          state: ConnectionState.CONNECTING,
          peer: extractPeerCredentials(socket),
          agentId: null,
          decoder: createFrameDecoder(),
          connectedAt: Date.now(),
        };

        connections.set(conn.id, conn);
        conn.state = ConnectionState.READY;

        options.onConnect?.(conn);

        // ── Data handler: decode frames and dispatch ──
        socket.on('data', (chunk: Buffer) => {
          let frames: IpcFrame[];
          try {
            frames = conn.decoder.push(chunk);
          } catch (err) {
            // Malformed data — send NOT_UNDERSTOOD and keep going
            const errFrame: IpcFrame = {
              type: Performative.NOT_UNDERSTOOD,
              convId: FIRE_AND_FORGET,
              payload: { error: 'frame_decode_error', message: String(err) },
            };
            try { socket.write(encodeFrame(errFrame)); } catch {}
            return;
          }

          for (const frame of frames) {
            // Track agent identity from first frame with agentId
            if (!conn.agentId && frame.payload.agentId) {
              conn.agentId = String(frame.payload.agentId);
            }

            // Build reply function scoped to this frame's convId
            const reply = (response: IpcFrame) => {
              // Force response to use same convId as request
              const responseFrame: IpcFrame = {
                ...response,
                convId: frame.convId,
              };
              try {
                socket.write(encodeFrame(responseFrame));
              } catch (err) {
                options.onError?.(err as Error, conn);
              }
            };

            // Dispatch to handler
            try {
              options.onFrame(frame, conn, reply);
            } catch (err) {
              // Handler threw — send FAILURE response
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
      // Close all connections gracefully
      for (const conn of connections.values()) {
        conn.state = ConnectionState.CLOSING;
        conn.socket.destroy();
      }
      connections.clear();

      if (server) {
        server.close(() => {
          // Clean up socket file
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
      try {
        conn.socket.write(encoded);
      } catch {}
    }
  }

  /** Send a frame to a specific agent by agentId */
  function sendTo(agentId: string, frame: IpcFrame): boolean {
    for (const conn of connections.values()) {
      if (conn.agentId === agentId && conn.state === ConnectionState.READY) {
        try {
          conn.socket.write(encodeFrame(frame));
          return true;
        } catch {
          return false;
        }
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
