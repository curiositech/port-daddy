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

export function createBarnacleWatcher(logger: any) {
  let isResurrecting = false;

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

    if (!existsSync(BINARY_PATH)) {
      logger.error('barnacle_binary_missing', { path: BINARY_PATH });
      isResurrecting = false;
      return;
    }

    const child = spawn(BINARY_PATH, [], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();
    
    // Reset resurrection flag after a grace period
    setTimeout(() => {
      isResurrecting = false;
    }, 10000);
  }

  return {
    start() {
      console.error(`🐕 Barnacle Watcher active. Monitoring ${BARNACLE_URL}...`);
      setInterval(async () => {
        const alive = await checkBarnacle();
        if (!alive) {
          resurrectBarnacle();
        }
      }, 10000);
    }
  };
}
