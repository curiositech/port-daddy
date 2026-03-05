/**
 * CLI Daemon Commands
 *
 * Handles: start, stop, restart, install, uninstall, dev commands
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { pdFetch, PORT_DADDY_URL, getDaemonUrl } from '../utils/fetch.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { status as maritimeStatus } from '../../lib/maritime.js';
import { printBanner, printCompactHeader, printFarewell, WHEEL, ANCHOR, ANSI } from '../../lib/banner.js';
import { autoFixStartupBlockers, diagnoseStartupBlockers } from '../utils/startup-doctor.js';

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
 * Attempt to spawn the daemon and wait for it to become healthy.
 * Returns true if the daemon started successfully, false otherwise.
 */
async function attemptDaemonStart(tsxBin: string, serverScript: string): Promise<boolean> {
  const child: ChildProcess = spawn(tsxBin, [serverScript], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  // Wait up to 3 seconds for health check
  for (let i = 0; i < 30; i++) {
    await new Promise<void>(r => setTimeout(r, 100));
    try {
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        const daemonUrl = getDaemonUrl();
        console.log(maritimeStatus('success', `Daemon running at ${daemonUrl} (PID ${data.pid})`));
        console.log('');
        console.log(`  ${ANSI.fgGray}Dashboard:${ANSI.reset} ${ANSI.fgCyan}${daemonUrl}${ANSI.reset}`);
        console.log(`  ${ANSI.fgGray}Try:${ANSI.reset}       pd claim myapp -q`);
        console.log('');
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Handle `pd start|stop|restart|install|uninstall` command
 */
export async function handleDaemon(action: string): Promise<void> {
  const libDir: string = join(__dirname, '..', '..');
  const tsxBin: string = join(libDir, 'node_modules', '.bin', 'tsx');
  const installScript: string = join(libDir, 'install-daemon.ts');
  const serverScript: string = join(libDir, 'server.ts');

  switch (action) {
    case 'start': {
      // Check if already running
      try {
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
        if (res.ok) {
          const data = await res.json();
          console.log(maritimeStatus('ready', `Port Daddy already running (PID ${data.pid})`));
          return;
        }
      } catch {}

      printBanner();
      console.log(`  ${WHEEL} Starting daemon...`);

      // Attempt 1: Try to start normally
      if (await attemptDaemonStart(tsxBin, serverScript)) return;

      // Attempt 1 failed — diagnose and auto-fix
      console.log(`  ${ANSI.fgYellow}First attempt failed, diagnosing...${ANSI.reset}`);

      const { fixed, issues } = autoFixStartupBlockers(9876);

      if (issues.length === 0) {
        // No obvious issues found — maybe it just needs a moment
        console.error(maritimeStatus('error', 'Failed to start daemon (no fixable issues found)'));
        console.log(`  ${ANSI.fgGray}Run: pd doctor${ANSI.reset}`);
        process.exit(1);
      }

      // Report what we found and fixed
      for (const issue of issues) {
        if (issue.fixable) {
          console.log(`  ${ANSI.fgYellow}Fixed:${ANSI.reset} ${issue.detail}`);
        } else {
          console.log(`  ${ANSI.fgRed}Blocker:${ANSI.reset} ${issue.detail}`);
        }
      }

      if (!fixed) {
        // Found issues but couldn't fix any of them
        const unfixable = issues.filter(i => !i.fixable);
        if (unfixable.length > 0) {
          console.error(maritimeStatus('error', `Cannot start: ${unfixable[0].detail}`));
        } else {
          console.error(maritimeStatus('error', 'Failed to start daemon'));
        }
        process.exit(1);
      }

      // Give killed processes time to release resources
      await new Promise<void>(r => setTimeout(r, 1500));

      // Attempt 2: Retry after fixes
      console.log(`  ${WHEEL} Retrying...`);

      if (await attemptDaemonStart(tsxBin, serverScript)) return;

      // Still failing — one more diagnostic pass in case socket needs cleanup
      const secondPass = autoFixStartupBlockers(9876);
      if (secondPass.fixed) {
        await new Promise<void>(r => setTimeout(r, 1000));
        console.log(`  ${WHEEL} Final retry...`);
        if (await attemptDaemonStart(tsxBin, serverScript)) return;
      }

      console.error(maritimeStatus('error', 'Failed to start daemon after auto-fix'));
      console.log(`  ${ANSI.fgGray}Run: pd doctor${ANSI.reset}`);
      process.exit(1);
      break;
    }

    case 'stop': {
      try {
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
        const data = await res.json();
        process.kill(data.pid as number, 'SIGTERM');
        printFarewell();
        console.log(maritimeStatus('success', 'Daemon stopped'));
      } catch {
        console.log(maritimeStatus('warning', 'Port Daddy is not running'));
      }
      break;
    }

    case 'restart': {
      await handleDaemon('stop');
      await new Promise<void>(r => setTimeout(r, 1000));
      await handleDaemon('start');
      break;
    }

    case 'install': {
      const result: SpawnSyncReturns<Buffer> = spawnSync(tsxBin, [installScript, 'install'], { stdio: 'inherit' });
      process.exit(result.status ?? 1);
      break;
    }

    case 'uninstall': {
      const result: SpawnSyncReturns<Buffer> = spawnSync(tsxBin, [installScript, 'uninstall'], { stdio: 'inherit' });
      process.exit(result.status ?? 1);
      break;
    }
  }
}

/**
 * Handle `pd dev` command — development mode with file watching
 */
export async function handleDev(): Promise<void> {
  const libDir: string = join(__dirname, '..', '..');

  // Dynamically discover files to watch — matches server.ts calculateCodeHash() approach
  const filesToWatch: string[] = ['server.ts'];
  for (const dir of ['lib', 'routes', 'shared']) {
    const dirPath: string = join(libDir, dir);
    if (existsSync(dirPath)) {
      for (const f of readdirSync(dirPath)) {
        if (f.endsWith('.ts')) filesToWatch.push(`${dir}/${f}`);
      }
    }
  }

  printCompactHeader('DEV MODE');
  console.log(`  ${ANCHOR} Watching source files for changes...`);
  console.log(`  ${ANSI.fgGray}Press Ctrl+C to exit${ANSI.reset}`);
  console.log('');

  // Start daemon first
  await handleDaemon('start');

  let restartTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastHash: string = getLocalCodeHash();

  // Debounced restart
  const scheduleRestart = (): void => {
    if (restartTimeout) clearTimeout(restartTimeout);
    restartTimeout = setTimeout(async () => {
      const newHash: string = getLocalCodeHash();
      if (newHash !== lastHash) {
        lastHash = newHash;
        console.log('');
        console.log(`[${new Date().toLocaleTimeString()}] File changed, restarting daemon...`);

        // Kill current daemon
        try {
          const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
          const data = await res.json();
          process.kill(data.pid as number, 'SIGTERM');
        } catch {}

        await new Promise<void>(r => setTimeout(r, 500));

        // Start new daemon
        const devServerScript: string = join(libDir, 'server.ts');
        const devTsxBin: string = join(libDir, 'node_modules', '.bin', 'tsx');
        const child: ChildProcess = spawn(devTsxBin, [devServerScript], {
          stdio: 'ignore',
          detached: true
        });
        child.unref();

        // Wait for ready
        for (let i = 0; i < 30; i++) {
          await new Promise<void>(r => setTimeout(r, 100));
          try {
            const healthRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
            if (healthRes.ok) {
              console.log(`[${new Date().toLocaleTimeString()}] \u2713 Daemon restarted (hash: ${newHash})`);
              return;
            }
          } catch {}
        }
        console.log(`[${new Date().toLocaleTimeString()}] \u2717 Failed to restart daemon`);
      }
    }, 300); // 300ms debounce
  };

  // Watch each file
  const watchers: FSWatcher[] = [];
  for (const file of filesToWatch) {
    const filePath: string = join(libDir, file);
    if (existsSync(filePath)) {
      try {
        const watcher: FSWatcher = watch(filePath, (eventType: string) => {
          if (eventType === 'change') {
            scheduleRestart();
          }
        });
        watchers.push(watcher);
        console.log(`  Watching: ${file}`);
      } catch (err: unknown) {
        console.error(`  Failed to watch ${file}: ${(err as Error).message}`);
      }
    }
  }

  // Also watch directories for new/deleted files
  for (const dir of ['lib', 'routes', 'shared']) {
    const dirPath: string = join(libDir, dir);
    if (existsSync(dirPath)) {
      try {
        const dirWatcher: FSWatcher = watch(dirPath, (eventType: string, filename: string | null) => {
          if (filename && filename.endsWith('.ts')) {
            scheduleRestart();
          }
        });
        watchers.push(dirWatcher);
        console.log(`  Watching: ${dir}/`);
      } catch {}
    }
  }

  console.log('');
  console.log(`Current hash: ${lastHash}`);
  console.log('');

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\nStopping dev mode...');
    watchers.forEach((w: FSWatcher) => w.close());
    process.exit(0);
  });

  // Keep alive
  await new Promise<void>(() => {});
}
