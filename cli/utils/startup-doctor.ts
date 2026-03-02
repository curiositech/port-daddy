/**
 * Startup Doctor — Shared diagnostics and auto-fix logic
 *
 * Used by `pd start` (auto-fix, no prompts) and `pd doctor` (interactive Y/n).
 * Diagnoses: stale sockets, zombie processes, port conflicts.
 */

import { existsSync, unlinkSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const SOCK_PATH = process.env.PORT_DADDY_SOCK || '/tmp/port-daddy.sock';

export interface Diagnosis {
  issue: string;
  detail: string;
  fixable: boolean;
  fix?: () => void;
}

/**
 * Prompt the user with Y/n. Returns true if they accept (or press Enter for default Y).
 */
export async function confirmFix(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${prompt} [Y/n] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

/**
 * Find processes listening on a given TCP port.
 * Returns array of { pid, command } objects.
 */
export function findProcessesOnPort(port: number): { pid: number; command: string }[] {
  const results: { pid: number; command: string }[] = [];

  if (process.platform === 'darwin' || process.platform === 'linux') {
    // Use lsof to find listeners
    const lsof = spawnSync('lsof', ['-i', `:${port}`, '-sTCP:LISTEN', '-Fp'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    if (lsof.stdout) {
      const pids = new Set<number>();
      for (const line of lsof.stdout.split('\n')) {
        if (line.startsWith('p')) {
          const pid = parseInt(line.slice(1), 10);
          if (!isNaN(pid) && pid > 0) pids.add(pid);
        }
      }

      for (const pid of pids) {
        // Get the command name for this PID
        const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 3000,
        });
        const command = (ps.stdout || '').trim().split('\n')[0] || 'unknown';
        results.push({ pid, command });
      }
    }
  }

  return results;
}

/**
 * Check if the Unix socket is stale (file exists but nothing is listening).
 */
export function isSocketStale(): boolean {
  if (!existsSync(SOCK_PATH)) return false;

  try {
    // Try connecting to the socket
    const net = require('node:net') as typeof import('node:net');
    const connected = new Promise<boolean>((resolve) => {
      const client = net.createConnection({ path: SOCK_PATH }, () => {
        client.destroy();
        resolve(true);
      });
      client.on('error', () => resolve(false));
      // Don't wait forever
      client.setTimeout(1000, () => {
        client.destroy();
        resolve(false);
      });
    });

    // Synchronous check: if the socket file exists but is very old, it's likely stale
    // This is a heuristic; the async check is more reliable but we need sync for the flow
    const stat = statSync(SOCK_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    // If the socket hasn't been touched in over 24 hours, it's very likely stale
    if (ageMs > 24 * 60 * 60 * 1000) return true;

    // For more recent sockets, we can't easily do a sync check,
    // so we'll rely on the caller handling this via the start retry flow
    return false;
  } catch {
    return true; // If we can't stat it, consider it stale
  }
}

/**
 * Check if a PID is a Port Daddy process (server.ts or port-daddy in the command).
 */
function isPortDaddyProcess(command: string): boolean {
  return command.includes('server.ts') ||
    command.includes('port-daddy') ||
    command.includes('port_daddy');
}

/**
 * Run full startup diagnostics and return fixable issues.
 */
export function diagnoseStartupBlockers(port: number = 9876): Diagnosis[] {
  const issues: Diagnosis[] = [];

  // 1. Stale Unix socket
  if (existsSync(SOCK_PATH)) {
    // Check if anything is actually listening on it
    const socketListeners = findProcessesOnPort(port);
    const hasListener = socketListeners.length > 0;

    if (!hasListener) {
      issues.push({
        issue: 'Stale Unix socket',
        detail: `${SOCK_PATH} exists but no daemon is listening`,
        fixable: true,
        fix: () => {
          try {
            unlinkSync(SOCK_PATH);
          } catch {
            // Already gone
          }
        },
      });
    }
  }

  // 2. Port 9876 occupied
  const portProcesses = findProcessesOnPort(port);
  if (portProcesses.length > 0) {
    for (const proc of portProcesses) {
      const isPd = isPortDaddyProcess(proc.command);
      issues.push({
        issue: isPd ? 'Zombie Port Daddy process' : 'Port conflict',
        detail: isPd
          ? `Old daemon (PID ${proc.pid}) still holding port ${port}`
          : `Port ${port} in use by PID ${proc.pid}: ${proc.command.slice(0, 80)}`,
        fixable: isPd, // Only auto-fix our own zombie processes
        fix: isPd
          ? () => {
              try {
                process.kill(proc.pid, 'SIGTERM');
              } catch {
                // Already dead, or permission denied
                try {
                  process.kill(proc.pid, 'SIGKILL');
                } catch {
                  // Give up
                }
              }
            }
          : undefined,
      });
    }
  }

  return issues;
}

/**
 * Auto-fix all fixable startup issues. Used by `pd start`.
 * Returns true if any fixes were applied.
 */
export function autoFixStartupBlockers(port: number = 9876): { fixed: boolean; issues: Diagnosis[] } {
  const issues = diagnoseStartupBlockers(port);
  let fixed = false;

  for (const issue of issues) {
    if (issue.fixable && issue.fix) {
      issue.fix();
      fixed = true;
    }
  }

  return { fixed, issues };
}
