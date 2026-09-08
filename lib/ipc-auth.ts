/**
 * Port Daddy IPC Authentication
 *
 * Peer credential extraction from Unix domain sockets.
 * - Linux: SO_PEERCRED (pid, uid, gid)
 * - macOS: LOCAL_PEERCRED via getpeereid() (uid, gid) + pid from /proc or lsof
 *
 * Since Node.js doesn't expose SO_PEERCRED natively, we use a two-phase auth:
 * 1. Extract what we can from the socket (platform-dependent)
 * 2. Verify the self-reported agentId against the registered agent table
 *
 * The IPC socket is chmod 0600 (owner-only), so any connection is already
 * from the same user. The auth layer adds agent identity verification.
 */

import type { IpcConnection } from './ipc-server.js';
import type { PeerCredentials } from './ipc-types.js';
import { IpcAction } from './ipc-types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentVerifier {
  /** Check if an agent is registered. Returns the registered agent or null. */
  isRegistered(agentId: string): { id: string; identity?: string; purpose?: string } | null;
}

export interface AuthResult {
  allowed: boolean;
  agentId: string | null;
  reason?: string;
  peer?: PeerCredentials;
}

// ─── Peer Credential Extraction ─────────────────────────────────────────────

/**
 * Extract peer credentials from a Unix domain socket connection.
 * Returns what's available on the current platform.
 */
export function extractPeerCredentials(conn: IpcConnection): PeerCredentials | null {
  const socket = conn.socket;

  try {
    // Node.js internal: socket._handle.fd gives us the file descriptor
    const handle = (socket as unknown as { _handle?: { fd?: number; getpeername?: () => unknown } })._handle;
    if (!handle || handle.fd === undefined) return null;

    // On both platforms, the socket file is chmod 0600 so we know the
    // connecting process is the same user. We can get our own uid/pid.
    // For full SO_PEERCRED, a native addon like `unix-socket-credentials` is needed.
    //
    // For now, we trust the socket permission model (same user = authenticated)
    // and verify agent identity against the registration table.
    return {
      pid: 0,  // Unknown without native addon
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
    };
  } catch {
    return null;
  }
}

// ─── Agent Identity Verification ────────────────────────────────────────────

/**
 * Verify that a self-reported agentId matches a registered agent.
 *
 * Auth policy:
 * - First frame MUST contain agentId in payload
 * - agentId MUST match a registered agent (via pd begin or pd agent register)
 * - Unregistered agents can still send heartbeats (they'll be tracked but unverified)
 * - Requests (claims, locks, sessions) require verified identity
 */
export function verifyAgent(
  agentId: string | null,
  verifier: AgentVerifier | null,
  requireRegistered: boolean = false,
): AuthResult {
  if (!agentId) {
    return {
      allowed: !requireRegistered,
      agentId: null,
      reason: requireRegistered ? 'no_agent_id' : undefined,
    };
  }

  // If no verifier provided (e.g., during tests), allow all
  if (!verifier) {
    return { allowed: true, agentId };
  }

  const agent = verifier.isRegistered(agentId);

  if (!agent && requireRegistered) {
    return {
      allowed: false,
      agentId,
      reason: 'agent_not_registered',
    };
  }

  return {
    allowed: true,
    agentId,
  };
}

// ─── Auth Middleware for IPC Frames ─────────────────────────────────────────

/**
 * Actions that require a registered agent identity.
 * Fire-and-forget actions (heartbeat, pheromone) don't require registration
 * because they're idempotent and harmless from unregistered agents.
 */
const REQUIRES_REGISTRATION = new Set([
  'session.begin',
  'session.done',
  'session.note',
  'session.files.claim',
  'session.files.release',
  'lock.acquire',
  'lock.release',
  'salvage.claim',
]);

/**
 * Identity-bound mutations that the current IPC envelope cannot authorize.
 *
 * The Unix socket proves only a same-OS-user peer and carries a self-reported
 * display alias; it does not carry the daemon-minted actor credential that
 * the canonical HTTP write boundary verifies. These actions must therefore
 * fall back to their credentialed HTTP routes until IPC has equivalent
 * credential transport and one shared authorizer.
 */
const REQUIRES_CREDENTIALED_TRANSPORT = new Set<string>([
  IpcAction.BEGIN,
  IpcAction.DONE,
  IpcAction.SESSION_START,
  IpcAction.SESSION_END,
  IpcAction.SESSION_REMOVE,
  IpcAction.SESSION_TAKEOVER,
  IpcAction.NOTE,
  IpcAction.FILES_CLAIM,
  IpcAction.FILES_RELEASE,
  IpcAction.LOCK_ACQUIRE,
  IpcAction.LOCK_EXTEND,
  IpcAction.LOCK_RELEASE,
  IpcAction.SALVAGE_CLAIM,
]);

/**
 * Check whether an IPC frame's action requires registration.
 */
export function actionRequiresRegistration(action: string | undefined): boolean {
  return action ? REQUIRES_REGISTRATION.has(action) : false;
}

/** Return true when an action must use the canonical credentialed transport. */
export function actionRequiresCredentialedTransport(action: string | undefined): boolean {
  return action ? REQUIRES_CREDENTIALED_TRANSPORT.has(action) : false;
}
