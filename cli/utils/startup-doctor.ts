/**
 * Startup Doctor — Shared diagnostics and auto-fix logic
 *
 * Used by `pd start` (auto-fix, no prompts) and `pd doctor` (interactive Y/n).
 * Diagnoses: stale sockets, zombie processes, port conflicts, and shell-idiom
 * `.env.local` files that crash bun's dotenv autoloader.
 */

import { existsSync, unlinkSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isStdinInteractive, isStdoutInteractive, openControllingTerminalInput } from './tty.js';

import { DEFAULT_SOCK } from '../../shared/paths.js';
import { resolveDaemonPort } from '../../shared/daemon-discovery.js';
const SOCK_PATH = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;

export interface Diagnosis {
  issue: string;
  detail: string;
  fixable: boolean;
  fix?: () => void;
}

export interface StartupDoctorOptions {
  healthyDaemonPid?: number | null;
}

/**
 * Prompt the user with Y/n. Returns true if they accept (or press Enter for default Y).
 */
export async function confirmFix(prompt: string): Promise<boolean> {
  // Non-interactive (CI, pipes, smoke harnesses): nobody can answer — blocking
  // on stdin here hangs the process until an external timeout kills it.
  // Decline the fix instead of hanging. Kernel-level helpers per the
  // no-raw-stdin-istty regiment (stream flags lie under the compiled binary).
  if (!isStdinInteractive() || !isStdoutInteractive()) return false;
  // Under the bun-compiled binary, process.stdin can look interactive yet feed
  // readline an immediate EOF — an empty answer would auto-accept the fix
  // without real consent. Read from the controlling terminal when available.
  const tty = openControllingTerminalInput();
  const input = tty ? tty.stream : process.stdin;
  const rl = createInterface({ input, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${prompt} [Y/n] `, (answer) => {
      rl.close();
      tty?.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
    rl.on('close', () => { tty?.close(); });
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
 * Find processes currently holding the daemon Unix socket.
 */
export function findProcessesUsingSocket(socketPath: string = SOCK_PATH): { pid: number; command: string }[] {
  const results: { pid: number; command: string }[] = [];

  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return results;
  }

  const lsof = spawnSync('lsof', [socketPath, '-Fp'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  });

  if (!lsof.stdout) return results;

  const pids = new Set<number>();
  for (const line of lsof.stdout.split('\n')) {
    if (!line.startsWith('p')) continue;
    const pid = parseInt(line.slice(1), 10);
    if (!isNaN(pid) && pid > 0) pids.add(pid);
  }

  for (const pid of pids) {
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
    const command = (ps.stdout || '').trim().split('\n')[0] || 'unknown';
    results.push({ pid, command });
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
 * A shell-idiom value inside `.env.local` that crashes bun's dotenv autoloader.
 */
export interface HostileEnvLocalFinding {
  path: string;
  lineNumber: number;
  line: string;
}

/**
 * Detect a shell-idiom `.env.local` in `dir` that will crash the bun-compiled
 * `pd` at startup.
 *
 * Why this matters: the Homebrew `pd` is a `bun build --compile` binary. Bun
 * auto-loads `.env.local` from the *current working directory* before any of
 * our code runs. A value that nests a command substitution inside a
 * default-expansion — `KEY="${KEY:-$(some command)}"` — segfaults bun 1.2.21
 * (exit 133) during that autoload. The binary is then totally MUTE: zero bytes
 * out, non-zero exit, before `main` ever executes. An operator with such an
 * `.env.local` in their repo gets silence from every `pd` invocation in that
 * directory — which is exactly how a "mute pd" looked in the field.
 *
 * We do NOT execute the file or shell out — we only read it and match the
 * dangerous idiom textually: an assignment whose value contains `${...:-$(`
 * (a command-substitution nested in a default-expansion). A plain `$(...)`
 * alone does not crash bun, so we deliberately do not flag it.
 *
 * Returns the offending findings (empty if the file is absent or clean).
 */
export function detectHostileEnvLocal(dir: string = process.cwd()): HostileEnvLocalFinding[] {
  const findings: HostileEnvLocalFinding[] = [];
  const envPath = join(dir, '.env.local');
  if (!existsSync(envPath)) return findings;

  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return findings;
  }

  // Match the crash idiom: `<KEY>=...${<anything-but-}>:-$(...`
  // i.e. a default-expansion `${VAR:-` immediately followed by a command
  // substitution `$(`. This is the precise shape that segfaults bun's
  // dotenv autoloader; a bare `$(...)` or a bare `${VAR:-literal}` does not.
  const hostile = /=.*\$\{[^}]*:-\s*\$\(/;
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    // Skip comments and blank lines.
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (hostile.test(raw)) {
      findings.push({ path: envPath, lineNumber: i + 1, line: raw.trim() });
    }
  }
  return findings;
}

/**
 * Run full startup diagnostics and return fixable issues.
 */
export function diagnoseStartupBlockers(
  port: number = resolveDaemonPort(),
  options: StartupDoctorOptions = {}
): Diagnosis[] {
  const issues: Diagnosis[] = [];

  // 1. Stale Unix socket
  if (existsSync(SOCK_PATH)) {
    // Check if anything is actually listening on it
    const socketListeners = findProcessesOnPort(port);
    const hasListener = socketListeners.length > 0;
    const socketOwners = findProcessesUsingSocket().filter((proc) => proc.pid !== options.healthyDaemonPid);

    if (socketOwners.length > 0) {
      for (const proc of socketOwners) {
        const isPd = isPortDaddyProcess(proc.command);
        issues.push({
          issue: isPd ? 'Zombie Port Daddy socket process' : 'Socket conflict',
          detail: isPd
            ? `PID ${proc.pid} still owns ${SOCK_PATH}`
            : `${SOCK_PATH} is in use by PID ${proc.pid}: ${proc.command.slice(0, 80)}`,
          fixable: isPd,
          fix: isPd
            ? () => {
                try {
                  process.kill(proc.pid, 'SIGTERM');
                } catch {
                  try {
                    process.kill(proc.pid, 'SIGKILL');
                  } catch {}
                }
                try {
                  unlinkSync(SOCK_PATH);
                } catch {}
              }
            : undefined,
        });
      }
    } else if (!hasListener) {
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

  // 2. The discovered daemon TCP port is occupied
  const portProcesses = findProcessesOnPort(port);
  if (portProcesses.length > 0) {
    for (const proc of portProcesses) {
      if (options.healthyDaemonPid && proc.pid === options.healthyDaemonPid) {
        continue;
      }
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
export function autoFixStartupBlockers(
  port: number = resolveDaemonPort(),
  options: StartupDoctorOptions = {}
): { fixed: boolean; issues: Diagnosis[] } {
  const issues = diagnoseStartupBlockers(port, options);
  let fixed = false;

  for (const issue of issues) {
    if (issue.fixable && issue.fix) {
      issue.fix();
      fixed = true;
    }
  }

  return { fixed, issues };
}
