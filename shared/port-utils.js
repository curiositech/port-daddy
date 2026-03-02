/**
 * Port Utility Functions
 *
 * Handles port availability checking, system port scanning,
 * and process liveness checks.
 */

import { spawn, spawnSync } from 'node:child_process';

// =============================================================================
// CONFIGURATION
// =============================================================================

const SYSTEM_PORTS_CACHE_TTL = 10000; // 10 seconds (increased from 2s for performance)
const MAX_LINES_TO_PARSE = 1000;

// =============================================================================
// STATE
// =============================================================================

let systemPortsCache = { data: null, timestamp: 0 };

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Check if a process is alive by PID
 * @param {number} pid - Process ID
 * @returns {boolean} Whether the process is alive
 */
export function isProcessAlive(pid) {
  try {
    const result = spawnSync('ps', ['-p', String(pid)], {
      stdio: 'ignore',
      timeout: 1000
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a process is alive (async version)
 * @param {number} pid - Process ID
 * @returns {Promise<boolean>} Whether the process is alive
 */
export async function isProcessAliveAsync(pid) {
  return new Promise((resolve) => {
    const proc = spawn('ps', ['-p', String(pid)], { stdio: 'ignore' });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 1000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Get all system ports that are in use (sync version)
 * Returns cached data only — never blocks the event loop with spawnSync.
 * The cache is populated by startSystemPortsRefresh() on an interval.
 * @returns {Array<{port: number, pid: number, command: string, user: string}>}
 */
export function getSystemPorts() {
  return systemPortsCache.data || [];
}

/**
 * Start a background refresh loop for the system ports cache.
 * Call once at daemon startup. Uses async spawn so it never blocks the event loop.
 * @param {number} [intervalMs=10000] - Refresh interval in milliseconds
 * @returns {{ stop: () => void }} Handle to stop the refresh loop
 */
export function startSystemPortsRefresh(intervalMs = SYSTEM_PORTS_CACHE_TTL) {
  // Immediate first refresh
  refreshSystemPortsAsync();

  const timer = setInterval(() => refreshSystemPortsAsync(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

/**
 * Async refresh of system ports cache (non-blocking)
 */
function refreshSystemPortsAsync() {
  const proc = spawn('lsof', ['-i', '-P', '-n', '-sTCP:LISTEN'], {
    stdio: ['ignore', 'pipe', 'ignore']
  });

  let stdout = '';
  const timeout = setTimeout(() => {
    proc.kill();
  }, 5000);

  proc.stdout.on('data', (data) => {
    if (stdout.length < 1024 * 1024) {
      stdout += data.toString();
    }
  });

  proc.on('close', (code) => {
    clearTimeout(timeout);
    if (code === 0 && stdout) {
      const ports = parseLsofOutput(stdout);
      systemPortsCache = { data: ports, timestamp: Date.now() };
    }
  });

  proc.on('error', () => {
    clearTimeout(timeout);
  });
}

/**
 * Get all system ports that are in use (async version)
 * Uses caching to reduce system calls.
 * @returns {Promise<Array<{port: number, pid: number, command: string, user: string}>>}
 */
export async function getSystemPortsAsync() {
  const now = Date.now();
  if (systemPortsCache.data && (now - systemPortsCache.timestamp) < SYSTEM_PORTS_CACHE_TTL) {
    return systemPortsCache.data;
  }

  return new Promise((resolve) => {
    const proc = spawn('lsof', ['-i', '-P', '-n', '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    let stdout = '';
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(systemPortsCache.data || []);
    }, 5000);

    proc.stdout.on('data', (data) => {
      if (stdout.length < 1024 * 1024) { // Max 1MB
        stdout += data.toString();
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout) {
        resolve(systemPortsCache.data || []);
        return;
      }

      const ports = parseLsofOutput(stdout);
      systemPortsCache = { data: ports, timestamp: now };
      resolve(ports);
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(systemPortsCache.data || []);
    });
  });
}

/**
 * Parse lsof output into port information
 * @param {string} stdout - Raw lsof output
 * @returns {Array<{port: number, pid: number, command: string, user: string}>}
 */
function parseLsofOutput(stdout) {
  const lines = stdout.trim().split('\n').slice(1); // Skip header
  const ports = [];
  const seen = new Set();

  for (let i = 0; i < Math.min(lines.length, MAX_LINES_TO_PARSE); i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    const user = parts[2];
    const name = parts[8];
    const portMatch = name.match(/:(\d+)$/);

    if (portMatch) {
      const port = parseInt(portMatch[1], 10);
      if (!seen.has(port)) {
        seen.add(port);
        ports.push({ port, pid, command, user });
      }
    }
  }

  return ports.sort((a, b) => a.port - b.port);
}

/**
 * Check if a specific port is in use on the system (sync)
 * @param {number} port - Port to check
 * @returns {boolean} Whether the port is in use
 */
export function isPortInUseOnSystem(port) {
  try {
    const result = spawnSync('lsof', ['-i', `:${port}`, '-P', '-n', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 2000
    });
    return result.status === 0 && result.stdout && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a specific port is in use on the system (async)
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} Whether the port is in use
 */
export async function isPortInUseOnSystemAsync(port) {
  return new Promise((resolve) => {
    const proc = spawn('lsof', ['-i', `:${port}`, '-P', '-n', '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    let hasOutput = false;
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 2000);

    proc.stdout.on('data', (data) => {
      if (data.toString().trim().length > 0) {
        hasOutput = true;
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0 && hasOutput);
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Batch check which processes are alive from a list of PIDs
 * Uses a single lsof call for efficiency.
 * @param {number[]} pids - Array of PIDs to check
 * @returns {Promise<Set<number>>} Set of alive PIDs
 */
export async function batchCheckProcesses(pids) {
  if (pids.length === 0) return new Set();

  return new Promise((resolve) => {
    const proc = spawn('ps', ['-p', pids.join(','), '-o', 'pid='], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    let stdout = '';
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(new Set());
    }, 5000);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      const alivePids = new Set(
        stdout.trim().split('\n')
          .map(line => parseInt(line.trim(), 10))
          .filter(pid => !isNaN(pid))
      );
      resolve(alivePids);
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(new Set());
    });
  });
}

/**
 * Clear the system ports cache (for testing)
 */
export function clearSystemPortsCache() {
  systemPortsCache = { data: null, timestamp: 0 };
}

/**
 * Format uptime in human-readable format
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime string
 */
export function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
