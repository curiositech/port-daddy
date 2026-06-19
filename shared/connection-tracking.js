/**
 * Connection Tracking Module
 *
 * Tracks SSE and long-poll connections to prevent resource exhaustion.
 * Enforces per-IP and global connection limits.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export const connectionLimits = {
  maxLongPoll: 50,        // Max concurrent long-poll connections total
  maxSSE: 100,            // Max concurrent SSE connections total
  maxPerIP: 5,            // Max connections per IP (both types)
  pollInterval: 1000,     // Long-poll check interval (reduced from 100ms)
  sseTimeout: 300000      // SSE connection timeout (5 minutes)
};

// =============================================================================
// STATE
// =============================================================================

const activeConnections = {
  longPoll: new Map(),    // ip -> count
  sse: new Map(),         // ip -> Set<res>
  totalLongPoll: 0,
  totalSSE: 0
};

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Check if a new connection can be opened
 * @param {string} ip - Client IP address
 * @param {'longPoll' | 'sse'} type - Connection type
 * @returns {boolean} Whether the connection is allowed
 */
export function canOpenConnection(ip, type) {
  const map = type === 'longPoll' ? activeConnections.longPoll : activeConnections.sse;
  const total = type === 'longPoll' ? activeConnections.totalLongPoll : activeConnections.totalSSE;
  const max = type === 'longPoll' ? connectionLimits.maxLongPoll : connectionLimits.maxSSE;

  if (total >= max) return false;
  const ipCount = map.get(ip) || (type === 'sse' ? new Set() : 0);
  const count = type === 'sse' ? ipCount.size : ipCount;
  return count < connectionLimits.maxPerIP;
}

/**
 * Track a new connection
 * @param {string} ip - Client IP address
 * @param {'longPoll' | 'sse'} type - Connection type
 * @param {Object} [res] - Response object (required for SSE)
 */
export function trackConnection(ip, type, res = null) {
  if (type === 'longPoll') {
    activeConnections.longPoll.set(ip, (activeConnections.longPoll.get(ip) || 0) + 1);
    activeConnections.totalLongPoll++;
  } else {
    if (!activeConnections.sse.has(ip)) {
      activeConnections.sse.set(ip, new Set());
    }
    activeConnections.sse.get(ip).add(res);
    activeConnections.totalSSE++;
  }
}

/**
 * Untrack a closed connection
 * @param {string} ip - Client IP address
 * @param {'longPoll' | 'sse'} type - Connection type
 * @param {Object} [res] - Response object (required for SSE)
 */
export function untrackConnection(ip, type, res = null) {
  if (type === 'longPoll') {
    const count = activeConnections.longPoll.get(ip) || 0;
    if (count <= 1) {
      activeConnections.longPoll.delete(ip);
    } else {
      activeConnections.longPoll.set(ip, count - 1);
    }
    activeConnections.totalLongPoll = Math.max(0, activeConnections.totalLongPoll - 1);
  } else {
    const set = activeConnections.sse.get(ip);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        activeConnections.sse.delete(ip);
      }
    }
    activeConnections.totalSSE = Math.max(0, activeConnections.totalSSE - 1);
  }
}

/**
 * Get current connection statistics
 * @returns {Object} Connection stats
 */
export function getConnectionStats() {
  return {
    totalLongPoll: activeConnections.totalLongPoll,
    totalSSE: activeConnections.totalSSE,
    uniqueIPs: {
      longPoll: activeConnections.longPoll.size,
      sse: activeConnections.sse.size
    },
    limits: { ...connectionLimits }
  };
}

/**
 * Reset all connection tracking (for testing)
 */
export function resetConnections() {
  activeConnections.longPoll.clear();
  activeConnections.sse.clear();
  activeConnections.totalLongPoll = 0;
  activeConnections.totalSSE = 0;
}
