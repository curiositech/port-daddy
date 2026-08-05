/**
 * Watch Module — Ambient Agent Kernel
 *
 * Subscribe to a Port Daddy pub/sub channel and run a shell command
 * on each message. Hardened for production ambient-agent use:
 *
 *   - Exponential backoff reconnect (1s → 2s → 4s → ... → 30s max)
 *   - Concurrency semaphore: at most N exec processes at once (default 3)
 *   - Per-exec AbortController timeout (default 30s)
 *   - Rate limiting: minimum interval between executions (default: none)
 *
 * Usage:
 *   const { watch } = createWatch();
 *   const handle = watch('deployments', {
 *     exec: './handle-deploy.sh',
 *     maxConcurrent: 2,
 *     timeout: 60_000,
 *     minInterval: 5_000,
 *   });
 *   // Later:
 *   handle.stop();
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { DEFAULT_DAEMON_PORT, resolveDaemonUrl } from '../shared/daemon-discovery.js';

// =============================================================================
// Types
// =============================================================================

export interface WatchOptions {
  /** Shell command to run when a message arrives. Receives message via env vars. */
  exec: string;
  /** Exit after first message (default: false — run forever). */
  once?: boolean;
  /**
   * Maximum number of exec processes running concurrently.
   * Messages that arrive while at the limit are dropped with a warning.
   * Default: 3.
   */
  maxConcurrent?: number;
  /**
   * Per-exec timeout in milliseconds. The child process is killed if it
   * runs longer than this. Default: 30_000 (30s).
   */
  timeout?: number;
  /**
   * Minimum milliseconds between exec invocations (rate limiting).
   * Messages arriving faster than this are dropped. Default: 0 (no limit).
   */
  minInterval?: number;
}

export interface WatchHandle {
  stop(): void;
}

/**
 * Convert an HTTP Retry-After header into milliseconds.
 *
 * Sample input/output:
 *
 * ```ts
 * parseRetryAfterMs('5') // 5000
 * parseRetryAfterMs('Sun, 26 Apr 2026 18:00:00 GMT') // milliseconds until then
 * parseRetryAfterMs(undefined) // null
 * ```
 */
export function parseRetryAfterMs(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;

  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds * 1000), 60_000);
  }

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 60_000);
  }

  return null;
}

// =============================================================================
// Module factory
// =============================================================================

export function createWatch() {
  /**
   * Subscribe to a channel and run `exec` on each message.
   *
   * Uses Node.js `http` module for streaming SSE (no external deps).
   * Reconnects automatically after disconnect with exponential backoff.
   */
  function watch(channel: string, opts: WatchOptions): WatchHandle {
    const {
      exec,
      once = false,
      maxConcurrent = 3,
      timeout = 30_000,
      minInterval = 0,
    } = opts;

    let stopped = false;
    let fired = false;
    let reconnectAttempt = 0;
    let currentReq: http.ClientRequest | null = null;

    // Concurrency semaphore
    let running = 0;

    // Rate limiting — track last exec start time
    let lastFired = 0;

    const pdUrl = resolveDaemonUrl(process.env.PORT_DADDY_URL);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(pdUrl);
    } catch {
      parsedUrl = new URL(resolveDaemonUrl());
    }

    // ─── Reconnect with exponential backoff ──────────────────────────────────

    function scheduleReconnect(delayOverrideMs?: number | null): void {
      if (stopped) return;
      if (once && fired) return;
      // 1s → 2s → 4s → 8s → 16s → 30s (max)
      const delay = delayOverrideMs ?? Math.min(1000 * 2 ** reconnectAttempt, 30_000);
      reconnectAttempt++;
      setTimeout(connect, delay);
    }

    // ─── Exec a message ─────────────────────────────────────────────────────

    function fireExec(dataStr: string, messageContent: string): void {
      // Rate limiting
      if (minInterval > 0) {
        const now = Date.now();
        if (now - lastFired < minInterval) {
          process.stderr.write(
            `[pd watch] rate limit (${minInterval}ms between execs), dropping message\n`
          );
          return;
        }
        lastFired = now;
      } else {
        lastFired = Date.now();
      }

      // Concurrency limit
      if (running >= maxConcurrent) {
        process.stderr.write(
          `[pd watch] concurrency limit (${maxConcurrent}) reached, dropping message\n`
        );
        return;
      }

      fired = true;
      running++;

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PD_MESSAGE: dataStr,           // Full SSE JSON string
        PD_MESSAGE_CONTENT: messageContent, // Extracted content field
        PD_CHANNEL: channel,
        PD_TIMESTAMP: new Date().toISOString(),
      };

      // AbortController for exec timeout
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        process.stderr.write(
          `[pd watch] exec timed out after ${timeout}ms\n`
        );
      }, timeout);

      // SECURITY: exec command runs in a shell. PD_MESSAGE and PD_MESSAGE_CONTENT
      // are set as environment variables — exec scripts should not eval them directly.
      const child = spawn('/bin/sh', ['-c', exec], {
        shell: false,
        stdio: 'inherit',
        env,
        signal: controller.signal,
      });

      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ERR_ABORT') return; // timeout-killed
        process.stderr.write(`[pd watch] exec error: ${err.message}\n`);
      });

      child.on('exit', () => {
        clearTimeout(timer);
        running--;

        if (once) {
          stopped = true;
          if (currentReq) {
            try { currentReq.destroy(); } catch {}
            currentReq = null;
          }
        }
      });
    }

    // ─── SSE connection ──────────────────────────────────────────────────────

    function connect(): void {
      if (stopped) return;
      if (once && fired) return;

      const path = `/msg/${encodeURIComponent(channel)}/subscribe`;

      const reqOpts: http.RequestOptions = {
        method: 'GET',
        path,
        headers: { Accept: 'text/event-stream' },
        host: parsedUrl.hostname,
        port: parseInt(parsedUrl.port, 10) || DEFAULT_DAEMON_PORT,
      };

      const req = http.request(reqOpts, (res) => {
        const statusCode = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '');
        if (statusCode !== 200 || !contentType.includes('text/event-stream')) {
          const retryAfterMs = parseRetryAfterMs(res.headers['retry-after']);
          res.resume();
          res.on('end', () => scheduleReconnect(retryAfterMs));
          res.on('error', () => scheduleReconnect(retryAfterMs));
          return;
        }

        // A real SSE connection resets the backoff counter. Rejected responses
        // keep their backoff pressure so denied watchers cannot hammer the daemon.
        reconnectAttempt = 0;

        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // Process complete SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep incomplete last line

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;

            const dataStr = trimmed.slice('data:'.length).trim();
            if (!dataStr || dataStr === '[HEARTBEAT]') continue;

            // Parse message to extract content field
            let messageContent = dataStr;
            try {
              const parsed = JSON.parse(dataStr) as Record<string, unknown>;
              const payload = parsed.payload;
              if (typeof payload === 'string') {
                messageContent = payload;
              } else if (payload !== null && payload !== undefined) {
                messageContent = JSON.stringify(payload);
              }
            } catch {
              // Use raw string as content
            }

            fireExec(dataStr, messageContent);

            // Stop accepting more messages if once and already fired
            if (once && fired) break;
          }
        });

        res.on('end', () => scheduleReconnect());
        res.on('error', () => scheduleReconnect());
      });

      req.on('error', () => scheduleReconnect());

      req.end();
      currentReq = req;
    }

    // Start the first connection
    connect();

    return {
      stop(): void {
        stopped = true;
        if (currentReq) {
          try { currentReq.destroy(); } catch {}
          currentReq = null;
        }
      },
    };
  }

  return { watch };
}
