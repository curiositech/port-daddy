/**
 * Barnacle Client — Reciprocal Watcher for the Rust Watchdog
 * 
 * Part of the Ouroboros Architecture: The Daemon watches the Barnacle
 * while the Barnacle watches the Daemon.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BARNACLE_PORT = 9875;
const BARNACLE_URL = `http://localhost:${BARNACLE_PORT}/health`;
const BINARY_PATH = join(__dirname, '../dist/core/pd-barnacle');

export interface BarnacleWatcherStatus {
  monitoredUrl: string;
  binaryPath: string;
  binaryExists: boolean;
  enabled: boolean;
  state: 'idle' | 'healthy' | 'degraded' | 'disabled';
  reason: string | null;
  lastCheckAt: number | null;
  lastHealthyAt: number | null;
  lastFailureAt: number | null;
  lastResurrectedAt: number | null;
  failureCount: number;
}

export function createBarnacleWatcher(logger: any) {
  let isResurrecting = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const status: BarnacleWatcherStatus = {
    monitoredUrl: BARNACLE_URL,
    binaryPath: BINARY_PATH,
    binaryExists: existsSync(BINARY_PATH),
    enabled: false,
    state: existsSync(BINARY_PATH) ? 'idle' : 'disabled',
    reason: existsSync(BINARY_PATH) ? null : 'barnacle binary missing',
    lastCheckAt: null,
    lastHealthyAt: null,
    lastFailureAt: null,
    lastResurrectedAt: null,
    failureCount: 0,
  };

  async function checkBarnacle(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(BARNACLE_URL, { signal: controller.signal });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  function resurrectBarnacle() {
    if (isResurrecting) return;
    isResurrecting = true;

    logger.warn('barnacle_dead', { message: 'Rust Watchdog not responding. Resurrecting...' });

    status.binaryExists = existsSync(BINARY_PATH);
    if (!status.binaryExists) {
      logger.error('barnacle_binary_missing', { path: BINARY_PATH });
      status.enabled = false;
      status.state = 'disabled';
      status.reason = 'barnacle binary missing';
      isResurrecting = false;
      return;
    }

    const child = spawn(BINARY_PATH, [], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();
    status.enabled = true;
    status.state = 'degraded';
    status.reason = 'barnacle restart requested';
    status.lastResurrectedAt = Date.now();
    
    // Reset resurrection flag after a grace period
    setTimeout(() => {
      isResurrecting = false;
    }, 10000);
  }

  async function observeBarnacle(): Promise<void> {
    status.lastCheckAt = Date.now();
    const alive = await checkBarnacle();
    if (alive) {
      status.enabled = true;
      status.state = 'healthy';
      status.reason = null;
      status.lastHealthyAt = Date.now();
      return;
    }

    status.failureCount += 1;
    status.lastFailureAt = Date.now();
    if (!status.binaryExists) {
      status.enabled = false;
      status.state = 'disabled';
      status.reason = 'barnacle binary missing';
      return;
    }

    status.enabled = true;
    status.state = 'degraded';
    status.reason = 'barnacle health check failed';
    resurrectBarnacle();
  }

  return {
    start() {
      if (timer) return;

      status.binaryExists = existsSync(BINARY_PATH);
      if (!status.binaryExists) {
        status.enabled = false;
        status.state = 'disabled';
        status.reason = 'barnacle binary missing';
        logger.info('barnacle_watcher_disabled', {
          reason: status.reason,
          path: BINARY_PATH,
        });
        return;
      }

      status.enabled = true;
      status.state = 'idle';
      status.reason = null;
      console.error(`🐕 Barnacle Watcher active. Monitoring ${BARNACLE_URL}...`);
      void observeBarnacle();
      timer = setInterval(() => {
        void observeBarnacle();
      }, 10000);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      status.enabled = false;
      if (status.state !== 'disabled') {
        status.state = 'idle';
      }
    },

    getStatus(): BarnacleWatcherStatus {
      return {
        ...status,
      };
    },
  };
}
