/**
 * CLI Orchestration Commands
 *
 * Handles: up, down commands for service orchestration
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync as fsWriteFileSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
// Orchestration types
import { normalizeServiceConfig, topologicalSort, createOrchestrator } from '../../lib/orchestrator.js';
import { discoverServices, mergeWithConfig, suggestNames } from '../../lib/discover.js';
import type { DiscoveredService, SuggestNamesOptions } from '../../lib/discover.js';
import { loadConfig } from '../../lib/config.js';
import type { PortDaddyRcConfig } from '../../lib/config.js';

import { createHash } from 'node:crypto';
import * as ui from '../utils/ui.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';

/**
 * Get a unique PID file path for the current project directory.
 * This allows multiple `pd up` sessions to run in parallel in different worktrees.
 */
function getPidFile(dir: string = process.cwd()): string {
  const hash = createHash('sha256').update(dir).digest('hex').substring(0, 12);
  return join(tmpdir(), `port-daddy-up-${hash}.pid`);
}

/**
 * Handle `pd up [service...]` command
 */
export async function handleUp(positional: string[], options: CLIOptions): Promise<void> {
  const dir: string = (options.dir as string) || process.cwd();

  // Ensure daemon is running
  try {
    const healthRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    if (!healthRes.ok) throw new Error('unhealthy');
  } catch {
    ui.error('Port Daddy daemon is not running.');
    console.error('  Start with: port-daddy start');
    process.exit(1);
  }

  // 1. Load config (if exists)
  let config: PortDaddyRcConfig | null = null;
  try {
    config = loadConfig(dir);
  } catch (err: unknown) {
    ui.error(`Config error: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Discover services
  const discovered = discoverServices(dir);
  const mergedServices = mergeWithConfig(discovered.services, config) as Record<string, DiscoveredService>;

  if (Object.keys(mergedServices).length === 0) {
    // Auto-scan: try deep scan before giving up
    console.error('  No config found. Scanning...');
    console.error('');
    try {
      const scanRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir, save: true, useBranch: options.branch === true })
      });
      const scanData = await scanRes.json();

      if (scanRes.ok && (scanData.serviceCount as number) > 0) {
        // Scan found services — reload config and continue
        ui.success(`Scan found ${scanData.serviceCount} service(s). Config saved.`);
        console.error('');
        config = loadConfig(dir);
        const rediscovered = discoverServices(dir);
        Object.assign(mergedServices, mergeWithConfig(rediscovered.services, config) as Record<string, DiscoveredService>);
      }
    } catch {
      // Scan failed silently, fall through to error below
    }

    if (Object.keys(mergedServices).length === 0) {
      ui.error('No services found.');
      console.error('  Port Daddy looked for known frameworks (Next.js, Express,');
      console.error('  FastAPI, Docker, Go, Rust, etc.) but found nothing.');
      console.error('');
      console.error('  Try: port-daddy scan --dry-run    (see what would be detected)');
      console.error('       port-daddy scan              (scan & save config)');
      process.exit(1);
    }
  }

  // 3. Suggest semantic identities
  const useGitBranch: boolean = options.branch === true;
  const nameOpts: SuggestNamesOptions = {
    ...(useGitBranch ? { useBranch: true } : {}),
    ...(config ? { project: config.project } : {}),
  };
  const identitySuggestions = suggestNames(mergedServices, dir, nameOpts);

  // Build identity map: service name -> full semantic ID
  // Deduplicate: if two services get the same identity, append service name
  const identities: Record<string, string> = {};
  const seenIds = new Map<string, string | null>(); // full id -> service name
  for (const [name, suggestion] of Object.entries(identitySuggestions)) {
    let id: string = suggestion.full;
    if (seenIds.has(id)) {
      // Conflict: rename the earlier one too (if not already renamed)
      const prevName: string | null | undefined = seenIds.get(id);
      if (prevName && identities[prevName] === id) {
        identities[prevName] = `${suggestion.project}:${prevName}:${suggestion.context}`;
      }
      // Use service name as the stack component for this one
      id = `${suggestion.project}:${name}:${suggestion.context}`;
      seenIds.set(id, null); // mark as resolved
    } else {
      seenIds.set(id, name);
    }
    identities[name] = id;
  }

  // 4. Normalize all service configs
  const normalizedServices: Record<string, ReturnType<typeof normalizeServiceConfig>> = {};
  for (const [name, svc] of Object.entries(mergedServices)) {
    normalizedServices[name] = normalizeServiceConfig(name, svc as unknown as Parameters<typeof normalizeServiceConfig>[1]);
  }

  // 5. Print preview
  const serviceEntries = Object.entries(normalizedServices);

  console.log('');
  if (config) {
    console.log(`  Config: ${(config as PortDaddyRcConfig & { _path?: string })._path}`);
  } else {
    console.log(`  Config: auto-detected (${discovered.type})`);
  }
  console.log(`  Detected ${serviceEntries.length} service(s):`);
  console.log('');

  const maxNameLen: number = Math.max(...serviceEntries.map(([n]) => n.length));
  for (const [name, svc] of serviceEntries) {
    const padded: string = name.padEnd(maxNameLen);
    const svcAny = svc as unknown as Record<string, unknown>;
    const stackObj = svcAny.stack as { name?: string } | undefined;
    const stackLabel: string = stackObj?.name || (svcAny.remote ? 'remote' : 'local');
    const identity: string = identities[name] || name;
    const marker: string = svcAny.remote ? '  (remote)' : '';
    console.log(`    ${padded}  ${stackLabel.padEnd(12)} \u2192 ${identity}${marker}`);
  }
  console.log('');

  // 6. Topological sort to validate dependency graph
  const { order, error: sortError } = topologicalSort(normalizedServices);
  if (sortError) {
    console.error(`  Error: ${sortError}`);
    process.exit(1);
  }

  // 7. Create orchestrator
  const orchestrator = createOrchestrator({
    services: normalizedServices,
    identities,
    config: {
      noHealth: options['no-health'] === true,
      healthTimeout: options.timeout ? parseInt(options.timeout as string, 10) : 30000,
      targetService: (options.service as string) || null
    }
  });

  // 8. Wire events
  orchestrator.on('portsReady', (data: unknown) => {
    const { portMap } = data as { portMap: Record<string, number> };
    console.log('  Claiming ports...');
    for (const [name, port] of Object.entries(portMap)) {
      console.log(`    ${name.padEnd(maxNameLen)}  \u2192 ${port}`);
    }
    console.log('');
  });

  orchestrator.on('healthy', (data: unknown) => {
    const { name, port } = data as { name: string; port: number };
    ui.success(`${name} healthy (port ${port})`);
  });

  orchestrator.on('healthTimeout', (data: unknown) => {
    const { name, port } = data as { name: string; port: number };
    ui.warn(`${name} did not become healthy (port ${port})`);
  });

  orchestrator.on('crash', (data: unknown) => {
    const { name } = data as { name: string };
    ui.error(`${name} crashed during startup`);
  });

  orchestrator.on('exit', (data: unknown) => {
    const { name, code, signal, early } = data as { name: string; code: number; signal: string; early: boolean };
    if (early) {
      ui.error(`${name} exited immediately (code ${code})`);
    } else {
      ui.warn(`${name} exited (code ${code}, signal ${signal})`);
    }
  });

  orchestrator.on('allStarted', (data: unknown) => {
    const { services } = data as { services: string[] };
    console.log('');
    ui.success(`All ${services.length} service(s) running. Press Ctrl+C to stop.`);
    console.log(`  Dashboard: ${PORT_DADDY_URL}/`);
    console.log('');
  });

  orchestrator.on('stopped', () => {
    console.log('');
    ui.warn('All services stopped.');
    removePidFile(dir);
  });

  orchestrator.on('error', (data: unknown) => {
    const { name, error } = data as { name: string; error: string };
    ui.error(`Error in ${name}: ${error}`);
  });

  // 9. Handle Ctrl+C / SIGTERM
  let shuttingDown: boolean = false;
  let keepAliveResolve: (() => void) | null = null;
  const gracefulShutdown = async (): Promise<void> => {
    if (shuttingDown) {
      // Double Ctrl+C: force kill
      console.error('');
      ui.warn('Force killing...');
      process.exit(1);
    }
    shuttingDown = true;
    console.log('');
    ui.warn('Shutting down...');
    await orchestrator.stop();
    removePidFile(dir);
    // Resolve the keep-alive promise so the process exits naturally
    // after all async work (port release HTTP calls) has completed.
    if (keepAliveResolve) keepAliveResolve();
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  // 10. Write PID file for `down` command
  writePidFile(dir);

  // 11. Start
  ui.info(`Starting: ${order.join(' → ')}`);
  console.log('');

  try {
    await orchestrator.start();
  } catch (err: unknown) {
    ui.error(`Failed to start: ${(err as Error).message}`);
    removePidFile(dir);
    process.exit(1);
  }

  // Keep alive until graceful shutdown resolves this promise
  await new Promise<void>((resolve) => { keepAliveResolve = resolve; });
}

/**
 * Handle `pd down` command
 */
export async function handleDown(options: CLIOptions): Promise<void> {
  const dir = (options.dir as string) || process.cwd();
  const pidFile = getPidFile(dir);

  if (!existsSync(pidFile)) {
    ui.error('No port-daddy up session found.');
    console.error('  (No PID file at ' + pidFile + ')');
    process.exit(1);
  }

  const pidStr: string = readFileSync(pidFile, 'utf-8').trim();
  const pid: number = parseInt(pidStr, 10);

  if (isNaN(pid)) {
    ui.error('Invalid PID file. Removing it.');
    removePidFile(dir);
    process.exit(1);
  }

  // Check if process is alive
  if (!isProcessAlive(pid)) {
    ui.warn(`Process ${pid} is not running. Cleaning up PID file.`);
    removePidFile(dir);
    process.exit(1);
  }

  const ok = await requireConfirmation({
    summary: `Down will SIGTERM the orchestrator (PID ${pid}) and stop every service it manages in ${dir}. Any unsaved in-process state is lost.`,
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  // Send SIGTERM to trigger graceful shutdown
  ui.warn(`Stopping port-daddy up (PID ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: unknown) {
    ui.error(`Failed to signal process: ${(err as Error).message}`);
    removePidFile(dir);
    process.exit(1);
  }

  // Wait for process to exit (poll every 200ms, up to 10s)
  const deadline: number = Date.now() + 10000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise(r => setTimeout(r, 200));
  }

  // If still alive after 10s, escalate to SIGKILL
  if (isProcessAlive(pid)) {
    ui.warn('Graceful shutdown timed out. Force killing...');
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
    await new Promise(r => setTimeout(r, 500));
  }

  // Force-release any services still registered to the killed PID.
  // The graceful shutdown in `up` tries to release ports via orchestrator.stop(),
  // but on slow CI or under load it may not complete before the process dies.
  // Query all services and release any that belong to this PID.
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services`);
    if (res.ok) {
      const data = await res.json();
      const svcs = (data as { services?: { id: string; pid?: number }[] }).services || [];
      const orphaned = svcs.filter((s: { pid?: number }) => s.pid === pid);
      for (const svc of orphaned) {
        try {
          await pdFetch(`${PORT_DADDY_URL}/release`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: (svc as { id: string }).id })
          });
        } catch { /* best effort */ }
      }
      if (orphaned.length > 0) {
        ui.success(`Released ${orphaned.length} orphaned service(s).`);
      }
    }
  } catch { /* daemon unreachable — nothing more we can do */ }

  // Clean up PID file
  removePidFile(dir);

  if (isProcessAlive(pid)) {
    ui.warn(`Process ${pid} may still be running.`);
  } else {
    ui.success('Stopped.');
  }
}

/** Check if a process is alive via signal 0 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePidFile(dir: string): void {
  try {
    const path = getPidFile(dir);
    fsWriteFileSync(path, String(process.pid));
  } catch (err) {
    // ignore
  }
}

function removePidFile(dir: string): void {
  try {
    const pidFile = getPidFile(dir);
    if (existsSync(pidFile)) unlinkSync(pidFile);
  } catch { /* best effort */ }
}
