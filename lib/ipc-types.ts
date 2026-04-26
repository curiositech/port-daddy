/**
 * Port Daddy IPC Protocol Types
 *
 * Binary IPC over Unix domain socket for high-frequency agent communication.
 * FIPA-grounded performatives with MessagePack encoding.
 *
 * Frame format: [type:1][conv_id:4][payload_len:2][msgpack payload]
 * Total header: 7 bytes
 */

// ─── FIPA Performatives ─────────────────────────────────────────────────────
// Maps FIPA communicative acts to numeric codes for wire efficiency.

export const Performative = {
  // Informative acts (fire-and-forget when conv_id=0)
  INFORM:         0x01,  // Agent believes P, wants receiver to believe P
  INFORM_DONE:    0x02,  // Requested action completed successfully
  INFORM_REF:     0x03,  // Response to query-ref with the referent value

  // Request acts (always have conv_id for response matching)
  REQUEST:        0x10,  // Agent wants receiver to perform action
  QUERY_IF:       0x11,  // Agent wants to know if P is true
  QUERY_REF:      0x12,  // Agent wants the referent of a description
  CANCEL:         0x13,  // Cancel a previous request (same conv_id)

  // Response acts
  AGREE:          0x20,  // Will comply (async — result comes later)
  REFUSE:         0x21,  // Understood but declined (don't retry same params)
  FAILURE:        0x22,  // Tried and failed (retry with backoff)
  NOT_UNDERSTOOD: 0x23,  // Cannot parse or process (fix the request)

  // Subscription acts
  SUBSCRIBE:      0x30,  // Persistent interest in future inform(s)
  UNSUBSCRIBE:    0x31,  // Cancel subscription
} as const;

export type PerformativeCode = typeof Performative[keyof typeof Performative];

// Reverse lookup: code → name (for logging/debugging)
export const PERFORMATIVE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(Performative).map(([name, code]) => [code, name])
);

// ─── Frame ──────────────────────────────────────────────────────────────────

export interface IpcFrame {
  /** FIPA performative code */
  type: PerformativeCode;

  /**
   * Conversation ID for request-response correlation.
   * 0 = fire-and-forget (heartbeats, pheromone sprays, pub/sub inform).
   * Non-zero = expect a response with the same conv_id.
   */
  convId: number;

  /** MessagePack-encoded payload. Interpretation depends on type + action. */
  payload: Record<string, unknown>;
}

// ─── Actions ────────────────────────────────────────────────────────────────
// The `action` field in the payload identifies what operation is being
// requested/informed about. Maps to existing HTTP route handlers.

export const IpcAction = {
  // Agent lifecycle
  HEARTBEAT:      'heartbeat',
  REGISTER:       'agent.register',
  UNREGISTER:     'agent.unregister',

  // Sessions
  BEGIN:          'session.begin',
  DONE:           'session.done',
  SESSION_START:  'session.start',
  SESSION_END:    'session.end',
  SESSION_LIST:   'session.list',
  SESSION_REMOVE: 'session.remove',
  NOTE:           'session.note',
  FILES_CLAIM:    'session.files.claim',
  FILES_RELEASE:  'session.files.release',
  WHOAMI:         'sugar.whoami',

  // Ports
  CLAIM:          'port.claim',
  RELEASE:        'port.release',
  FIND:           'port.find',

  // Locks
  LOCK_ACQUIRE:   'lock.acquire',
  LOCK_CHECK:     'lock.check',
  LOCK_EXTEND:    'lock.extend',
  LOCK_LIST:      'lock.list',
  LOCK_RELEASE:   'lock.release',

  // Tuples
  TUPLE_OUT:      'tuple.out',
  TUPLE_RD:       'tuple.rd',
  TUPLE_IN:       'tuple.in',
  TUPLE_POLL:     'tuple.poll',
  TUPLE_SCAN:     'tuple.scan',
  TUPLE_COUNT:    'tuple.count',

  // Messaging
  PUBLISH:        'msg.publish',
  SUBSCRIBE:      'msg.subscribe',
  UNSUBSCRIBE:    'msg.unsubscribe',

  // Pheromone
  SPRAY:          'pheromone.spray',
  SNIFF:          'pheromone.sniff',

  // Salvage
  SALVAGE_LIST:   'salvage.list',
  SALVAGE_CLAIM:  'salvage.claim',

  // Fleet
  FLEET_PROMPT:   'fleet.prompt',
} as const;

export type IpcActionName = typeof IpcAction[keyof typeof IpcAction];

// ─── Peer Credentials ───────────────────────────────────────────────────────
// Extracted from the Unix socket connection via SO_PEERCRED (Linux) or
// LOCAL_PEERCRED (macOS). Zero-overhead authentication.

export interface PeerCredentials {
  pid: number;
  uid: number;
  gid?: number;  // Available on Linux, not always on macOS
}

// ─── Connection State ───────────────────────────────────────────────────────

export const ConnectionState = {
  CONNECTING:   'connecting',
  AUTHENTICATED: 'authenticated',
  READY:        'ready',
  CLOSING:      'closing',
  CLOSED:       'closed',
} as const;

export type ConnectionStateName = typeof ConnectionState[keyof typeof ConnectionState];

// ─── Protocol Constants ─────────────────────────────────────────────────────

/** Header size in bytes: type(1) + conv_id(4) + payload_len(2) */
export const HEADER_SIZE = 7;

/** Maximum payload size: 64KB (2 bytes = 65535) */
export const MAX_PAYLOAD_SIZE = 65535;

/** IPC socket path — imports from shared/paths for ~/.port-daddy/ default */
import { DEFAULT_IPC } from '../shared/paths.js';
export const IPC_SOCK_PATH = DEFAULT_IPC;

/** Conversation ID 0 = fire-and-forget (no response expected) */
export const FIRE_AND_FORGET = 0;
