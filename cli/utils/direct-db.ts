/**
 * Direct-DB Mode Utilities
 *
 * Tier 1 commands can work via direct SQLite access (no daemon needed).
 * Tier 2 commands require the running daemon for real-time features.
 */

import { initDatabase } from '../../lib/db.js';
import { createServices } from '../../lib/services.js';
import { createLocks } from '../../lib/locks.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createNoteEncryption } from '../../lib/note-encryption.js';

/**
 * Tier 1 commands can work via direct SQLite access (no daemon needed).
 */
export const TIER_1_COMMANDS: Set<string> = new Set([
  'claim',
  'c',
  'release',
  'r',
  'find',
  'f',
  'list',
  'l',
  'ps',
  'lock',
  'unlock',
  'locks',
  'status',
  'ports', // 'ports cleanup' is Tier 1
  'session',
  'sessions',
  'note',
  'notes',
]);

/**
 * Tier 2 commands require the running daemon for real-time features.
 */
export const TIER_2_COMMANDS: Set<string> = new Set([
  'pub',
  'publish',
  'sub',
  'subscribe',
  'wait',
  'agent',
  'agents',
  'up',
  'down',
  'channels',
  'webhook',
  'webhooks',
  'metrics',
  'health',
  'dashboard',
]);

/**
 * Lazily initialized direct-DB modules.
 * Shared across all direct-mode calls within a single CLI invocation.
 */
let _directDb: ReturnType<typeof initDatabase> | null = null;
let _directServices: ReturnType<typeof createServices> | null = null;
let _directLocks: ReturnType<typeof createLocks> | null = null;
let _directSessions: ReturnType<typeof createSessions> | null = null;

export function getDirectDb(): ReturnType<typeof initDatabase> {
  if (!_directDb) {
    _directDb = initDatabase();
  }
  return _directDb;
}

export function getDirectServices(): ReturnType<typeof createServices> {
  if (!_directServices) {
    _directServices = createServices(getDirectDb());
  }
  return _directServices;
}

export function getDirectLocks(): ReturnType<typeof createLocks> {
  if (!_directLocks) {
    _directLocks = createLocks(getDirectDb());
  }
  return _directLocks;
}

export function getDirectSessions(): ReturnType<typeof createSessions> {
  if (!_directSessions) {
    const db = getDirectDb();
    // Wire note-encryption so CLI direct-DB writes match the daemon's
    // encrypted-at-rest posture (F-06). Graceful degradation: if the
    // master key is unavailable (no keychain access, no file), notes
    // are stored plaintext with a warning logged by createNoteEncryption.
    // The daemon path uses `{ requireMasterKey: true }` and fails closed;
    // CLI keeps graceful-degradation so users without keychain access
    // can still run direct-DB commands. Follow-up: align once the
    // keychain story is cross-platform (napi-rs/keyring).
    _directSessions = createSessions(db, createNoteEncryption(), {
      requireAgentForFileClaims: true,
    });
    // Wire up activity log for direct mode too
    const activityLog = createActivityLog(db);
    _directSessions.setActivityLog(activityLog);
  }
  return _directSessions;
}

/**
 * Check if a command is Tier 1 (can work without daemon)
 */
export function isTier1Command(cmd: string): boolean {
  return TIER_1_COMMANDS.has(cmd);
}

/**
 * Check if a command is Tier 2 (requires daemon)
 */
export function isTier2Command(cmd: string): boolean {
  return TIER_2_COMMANDS.has(cmd);
}
