/**
 * CLI Diagnostics Commands
 *
 * Handles: metrics, config, health, ports, dashboard, doctor, status, version commands
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, accessSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import { separator, tableHeader } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';

// __dirname equivalent for ESM
const __dirname = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

/**
 * Get local code hash — matches server.ts calculateCodeHash()
 */
function getLocalCodeHash(): string {
  const hash = createHash('sha256');
  const libDir: string = join(__dirname, '..', '..');

  const filesToHash: string[] = ['server.ts'];
  for (const dir of ['lib', 'routes', 'shared']) {
    const dirPath: string = join(libDir, dir);
    if (existsSync(dirPath)) {
      for (const f of readdirSync(dirPath)) {
        if (f.endsWith('.ts')) filesToHash.push(`${dir}/${f}`);
      }
    }
  }

  for (const file of filesToHash) {
    const filePath: string = join(libDir, file);
    if (existsSync(filePath)) {
      hash.update(readFileSync(filePath));
    }
  }

  return hash.digest('hex').slice(0, 8);
}

/**
 * Handle `pd metrics` command
 */
export async function handleMetrics(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/metrics`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to get metrics'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('');
  console.log('Port Daddy Metrics');
  separator(50);

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null) {
      console.log(`  ${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        console.log(`    ${k}: ${v}`);
      }
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }
  console.log('');
}

/**
 * Handle `pd config` command
 */
export async function handleConfigCmd(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.dir) params.append('dir', options.dir as string);

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/config${params.toString() ? '?' + params : ''}`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to get config'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('');
  console.log('Port Daddy Configuration');
  separator(50);

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }
  console.log('');
}

/**
 * Handle `pd health [service]` command
 */
export async function handleHealth(id: string | undefined, options: CLIOptions): Promise<void> {
  if (id) {
    // Single service health
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services/health/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || `Health check failed for '${id}'`));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const h = data as { id?: string; healthy?: boolean; port?: number; latencyMs?: number; error?: string };
      const status = h.healthy ? 'healthy' : 'unhealthy';
      console.log(`${h.id || id}: ${status}`);
      if (h.port) console.log(`  Port: ${h.port}`);
      if (h.latencyMs !== undefined) console.log(`  Latency: ${h.latencyMs}ms`);
      if (h.error) console.log(`  Error: ${h.error}`);
    }
    return;
  }

  // All services health
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services/health`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to get health'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const services = data.services as Array<{ id: string; healthy: boolean; port: number; latencyMs?: number }>;
  if (!services || services.length === 0) {
    console.log('No services to check');
    return;
  }

  console.log('');
  console.log(tableHeader(['SERVICE', 35], ['PORT', 8], ['STATUS', 12], ['LATENCY', 10]));
  separator(65);

  for (const svc of services) {
    console.log(
      (svc.id || '-').slice(0, 34).padEnd(35) +
      String(svc.port).padEnd(8) +
      (svc.healthy ? 'healthy' : 'unhealthy').padEnd(12) +
      (svc.latencyMs !== undefined ? `${svc.latencyMs}ms` : '-').padEnd(10)
    );
  }
  console.log('');
}

/**
 * Handle `pd dashboard` command
 */
export async function handleDashboard(): Promise<void> {
  const url = PORT_DADDY_URL.replace('http://', '').replace('https://', '');
  const dashUrl = `http://${url.includes(':') ? url : url + ':9876'}`;
  console.log(`Opening dashboard: ${dashUrl}`);
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(openCmd, [dashUrl], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Handle `pd status` command
 */
export async function handleStatus(): Promise<void> {
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    const data = await res.json();

    console.log(`Port Daddy is running`);
    console.log(`  Version: ${data.version}`);
    console.log(`  PID: ${data.pid}`);
    console.log(`  Uptime: ${Math.floor((data.uptime_seconds as number) / 60)}m ${(data.uptime_seconds as number) % 60}s`);
    console.log(`  Active ports: ${data.active_ports}`);
  } catch {
    console.log('Port Daddy is not running');
    console.log('  Start with: port-daddy start');
    console.log('  Or install: port-daddy install');
    console.log('  Diagnose:   port-daddy doctor');
    process.exit(1);
  }
}

/**
 * Handle `pd version` command
 */
export async function handleVersion(): Promise<void> {
  const libDir: string = join(__dirname, '..', '..');
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
    const data = await res.json();
    console.log(`Port Daddy ${data.version}`);
    console.log(`Code hash: ${data.codeHash}`);
    console.log(`Server PID: ${data.pid}`);
    console.log(`Uptime: ${Math.floor((data.uptime as number) / 60)}m`);
  } catch {
    const pkgFallback: string = join(libDir, 'package.json');
    const ver: string = existsSync(pkgFallback)
      ? (JSON.parse(readFileSync(pkgFallback, 'utf8')) as { version: string }).version
      : 'unknown';
    console.log(`Port Daddy v${ver} (server not running)`);
  }
}

/**
 * Handle `pd doctor` / `pd diagnose` command
 */
export async function handleDoctor(): Promise<void> {
  interface CheckResult {
    ok: boolean;
    name: string;
    detail: string;
    hint?: string;
    critical?: boolean;
  }

  const results: CheckResult[] = [];
  let passed: number = 0;
  let total: number = 0;
  let hasCriticalFailure: boolean = false;

  const libDir: string = join(__dirname, '..', '..');

  function check(name: string, ok: boolean, detail: string, hint?: string): void {
    total++;
    if (ok) {
      passed++;
      results.push({ ok: true, name, detail });
    } else {
      results.push({ ok: false, name, detail, hint });
    }
  }

  function criticalFail(name: string, detail: string, hint: string): void {
    total++;
    hasCriticalFailure = true;
    results.push({ ok: false, name, detail, hint, critical: true });
  }

  // -------------------------------------------------------------------------
  // 1. Node.js version
  // -------------------------------------------------------------------------
  try {
    const nodeVersion: string = process.version;
    const major: number = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (major >= 18) {
      check('Node.js version', true, `${nodeVersion} (>= 18 required)`);
    } else {
      criticalFail('Node.js version', `${nodeVersion} (>= 18 required)`, 'Upgrade Node.js to version 18 or later');
    }
  } catch (err: unknown) {
    criticalFail('Node.js version', `Error: ${(err as Error).message}`, 'Ensure Node.js is installed');
  }

  // -------------------------------------------------------------------------
  // 2. Dependencies installed
  // -------------------------------------------------------------------------
  try {
    const nodeModulesPath: string = join(libDir, 'node_modules');
    const pkgPath: string = join(libDir, 'package.json');
    const pkg: { dependencies?: Record<string, string> } = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps: string[] = Object.keys(pkg.dependencies || {});
    const missing: string[] = [];

    for (const dep of deps) {
      const depPath: string = join(nodeModulesPath, dep);
      if (!existsSync(depPath)) {
        missing.push(dep);
      }
    }

    if (missing.length === 0) {
      check('Dependencies', true, `All ${deps.length} dependencies installed`);
    } else {
      criticalFail('Dependencies', `Missing: ${missing.join(', ')}`, 'Run: npm install');
    }
  } catch (err: unknown) {
    criticalFail('Dependencies', `Error: ${(err as Error).message}`, 'Run: npm install');
  }

  // -------------------------------------------------------------------------
  // 3. Database exists and is writable
  // -------------------------------------------------------------------------
  try {
    const dbPath: string = join(libDir, 'port-registry.db');
    if (existsSync(dbPath)) {
      // Check if writable by trying to open for writing
      try {
        accessSync(dbPath, constants.R_OK | constants.W_OK);
        check('Database', true, 'port-registry.db exists and is writable');
      } catch {
        criticalFail('Database', 'port-registry.db exists but is not writable', 'Check file permissions on port-registry.db');
      }
    } else {
      // Database not existing is fine if daemon hasn't started yet
      check('Database', true, 'port-registry.db will be created on first start');
    }
  } catch (err: unknown) {
    check('Database', false, `Error: ${(err as Error).message}`, 'Check port-registry.db permissions');
  }

  // -------------------------------------------------------------------------
  // 4. Network: Can we reach localhost:9876
  // -------------------------------------------------------------------------
  let daemonData: Record<string, unknown> | null = null;
  let daemonRunning: boolean = false;

  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    if (res.ok) {
      daemonData = await res.json();
      daemonRunning = true;
      check('Network', true, `localhost:9876 is reachable`);
    } else {
      check('Network', false, `localhost:9876 returned status ${res.status}`, 'Run: port-daddy start');
    }
  } catch {
    check('Network', false, 'Cannot connect to localhost:9876', 'Run: port-daddy start');
  }

  // -------------------------------------------------------------------------
  // 5. Daemon status
  // -------------------------------------------------------------------------
  if (daemonRunning && daemonData) {
    check('Daemon running', true, `PID ${daemonData.pid}, v${daemonData.version}`);
  } else {
    check('Daemon running', false, 'Daemon is not running', 'Run: port-daddy start');
  }

  // -------------------------------------------------------------------------
  // 6. Code hash freshness
  // -------------------------------------------------------------------------
  try {
    if (daemonRunning) {
      const versionRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
      if (versionRes.ok) {
        const versionData = await versionRes.json();
        const localHash: string = getLocalCodeHash();

        if (versionData.codeHash === localHash) {
          check('Code hash', true, `Matches (${localHash})`);
        } else {
          check('Code hash', false,
            `Mismatch: daemon=${versionData.codeHash} local=${localHash}`,
            'Run: port-daddy restart');
        }
      } else {
        check('Code hash', false, 'Could not query daemon version', 'Run: port-daddy restart');
      }
    } else {
      check('Code hash', false, 'Daemon not running, cannot verify', 'Run: port-daddy start');
    }
  } catch (err: unknown) {
    check('Code hash', false, `Error: ${(err as Error).message}`, 'Run: port-daddy restart');
  }

  // -------------------------------------------------------------------------
  // 7. Port 9876 availability
  // -------------------------------------------------------------------------
  try {
    if (daemonRunning) {
      check('Port 9876', true, 'Bound to Port Daddy daemon');
    } else {
      // Check if something else is using 9876
      const net = await import('node:net');
      const portInUse: boolean = await new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
          server.close();
          resolve(false);
        });
        server.listen(9876, '127.0.0.1');
      });

      if (portInUse) {
        check('Port 9876', false, 'In use by another process', 'Run: lsof -i :9876 to investigate');
      } else {
        check('Port 9876', true, 'Available (daemon not running)');
      }
    }
  } catch (err: unknown) {
    check('Port 9876', false, `Error: ${(err as Error).message}`, 'Run: lsof -i :9876 to investigate');
  }

  // -------------------------------------------------------------------------
  // 8. System service (LaunchAgent on macOS, systemd on Linux)
  // -------------------------------------------------------------------------
  try {
    if (process.platform === 'darwin') {
      const homedir = (await import('node:os')).homedir();
      const plistPath: string = join(homedir, 'Library', 'LaunchAgents', 'com.portdaddy.daemon.plist');

      if (existsSync(plistPath)) {
        const result: SpawnSyncReturns<Buffer> = spawnSync('launchctl', ['list', 'com.portdaddy.daemon'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        if (result.status === 0) {
          check('System service', true, 'LaunchAgent installed and loaded');
        } else {
          check('System service', false,
            'LaunchAgent plist exists but is not loaded',
            'Run: port-daddy install');
        }
      } else {
        // Check for legacy plist
        const legacyPath: string = join(homedir, 'Library', 'LaunchAgents', 'com.erichowens.port-daddy.plist');
        if (existsSync(legacyPath)) {
          check('System service', false,
            'Legacy LaunchAgent found (com.erichowens.port-daddy)',
            'Run: port-daddy install (will upgrade automatically)');
        } else {
          check('System service', false,
            'LaunchAgent not installed',
            'Run: port-daddy install');
        }
      }
    } else if (process.platform === 'linux') {
      const homedir = (await import('node:os')).homedir();
      const unitPath: string = join(homedir, '.config', 'systemd', 'user', 'port-daddy.service');

      if (existsSync(unitPath)) {
        const result: SpawnSyncReturns<string> = spawnSync('systemctl', ['--user', 'is-active', 'port-daddy.service'], {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        });
        const state: string = (result.stdout || '').trim();

        if (state === 'active') {
          check('System service', true, 'systemd user service active');
        } else if (state === 'failed') {
          check('System service', false,
            'systemd service failed',
            'Check: journalctl --user -u port-daddy.service');
        } else {
          check('System service', false,
            `systemd service installed but ${state}`,
            'Run: systemctl --user start port-daddy.service');
        }
      } else {
        check('System service', false,
          'systemd user service not installed',
          'Run: port-daddy install');
      }
    } else {
      check('System service', true, `N/A (${process.platform} \u2014 use: port-daddy start)`);
    }
  } catch (err: unknown) {
    check('System service', false, `Error: ${(err as Error).message}`, 'Run: port-daddy install');
  }

  // -------------------------------------------------------------------------
  // 9. Stale services (services with dead PIDs)
  // -------------------------------------------------------------------------
  try {
    if (daemonRunning) {
      const servicesRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services`);
      if (servicesRes.ok) {
        const servicesData = await servicesRes.json();
        let staleCount: number = 0;

        const svcList = (servicesData.services || []) as Array<{ pid?: number }>;
        for (const svc of svcList) {
          if (svc.pid) {
            try {
              process.kill(svc.pid, 0);
            } catch {
              staleCount++;
            }
          }
        }

        if (staleCount === 0) {
          check('Stale services', true, 'No stale services found');
        } else {
          check('Stale services', false,
            `${staleCount} service(s) with dead PIDs`,
            'Run: port-daddy release --expired');
        }
      } else {
        check('Stale services', false, 'Could not query services', 'Run: port-daddy find');
      }
    } else {
      check('Stale services', true, 'Daemon not running (no services to check)');
    }
  } catch (err: unknown) {
    check('Stale services', false, `Error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // Check 10: Shell completions
  // -------------------------------------------------------------------------
  const shell: string = process.env.SHELL || '';
  const completionsDir: string = join(libDir, 'completions');
  if (shell.includes('zsh')) {
    const zshFile: string = join(completionsDir, 'port-daddy.zsh');
    check('Shell completions', existsSync(zshFile),
      existsSync(zshFile) ? 'Zsh completions file found' : 'Zsh completions file missing',
      'See: completions/port-daddy.zsh');
  } else if (shell.includes('bash')) {
    const bashFile: string = join(completionsDir, 'port-daddy.bash');
    check('Shell completions', existsSync(bashFile),
      existsSync(bashFile) ? 'Bash completions file found' : 'Bash completions file missing',
      'See: completions/port-daddy.bash');
  } else if (shell.includes('fish')) {
    const fishFile: string = join(completionsDir, 'port-daddy.fish');
    check('Shell completions', existsSync(fishFile),
      existsSync(fishFile) ? 'Fish completions file found' : 'Fish completions file missing',
      'See: completions/port-daddy.fish');
  } else {
    check('Shell completions', true, `Shell "${shell || 'unknown'}" — completions available for bash/zsh/fish`);
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------
  console.log('');
  console.log('Port Daddy Doctor');
  console.log('\u2501'.repeat(38));

  for (const r of results) {
    if (r.ok) {
      console.log(`\u2713 ${r.name}: ${r.detail}`);
    } else {
      console.log(`\u2717 ${r.name}: ${r.detail}`);
      if (r.hint) {
        console.log(`  \u2192 ${r.hint}`);
      }
    }
  }

  console.log('\u2501'.repeat(38));
  console.log(`${passed}/${total} checks passed`);
  console.log('');

  if (hasCriticalFailure) {
    process.exit(1);
  }
  if (passed < total) {
    process.exit(1);
  }
}
