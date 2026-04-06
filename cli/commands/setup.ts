/**
 * pd setup — One-command local onboarding
 *
 * Installs the daemon, MCP integration, FleetBar (macOS), and initializes the
 * current project when it looks like a real project directory.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ui from '../utils/ui.js';
import { isDaemonRunning } from '../utils/fetch.js';
import { detectStack } from '../../lib/detect.js';
import { handleDaemon } from './daemon.js';
import { handleInit } from './init.js';
import { handleMcpInstall } from './mcp-install.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const TSX_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const INSTALL_DAEMON_SCRIPT = join(PROJECT_ROOT, 'install-daemon.ts');
const FLEETBAR_INSTALL_SCRIPT = join(PROJECT_ROOT, 'apps', 'FleetBar', 'install.sh');

const PROJECT_MARKERS = [
  '.git',
  '.portdaddy',
  'pd-fleet.yml',
  'pd-fleet.yaml',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'mix.exs',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
];

function looksLikeProjectDir(dir: string): boolean {
  if (!dir || resolve(dir) === resolve(homedir())) {
    return false;
  }

  if (PROJECT_MARKERS.some(marker => existsSync(join(dir, marker)))) {
    return true;
  }

  try {
    return !!detectStack(dir);
  } catch {
    return false;
  }
}

function inferProjectDir(explicitProject: string | undefined): string | null {
  if (explicitProject) {
    const resolved = resolve(explicitProject);
    return existsSync(resolved) ? resolved : null;
  }

  try {
    const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).stdout.trim();
    if (gitRoot && looksLikeProjectDir(gitRoot)) {
      return gitRoot;
    }
  } catch {
    // Fall through to cwd detection.
  }

  return looksLikeProjectDir(process.cwd()) ? process.cwd() : null;
}

async function ensureDaemonInstalledAndRunning(): Promise<boolean> {
  if (await isDaemonRunning()) {
    ui.success('Daemon already running');
    return true;
  }

  ui.step('Installing Port Daddy daemon');
  const install = spawnSync(TSX_BIN, [INSTALL_DAEMON_SCRIPT, 'install'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  if ((install.status ?? 1) !== 0) {
    ui.error('Daemon install failed');
    return false;
  }

  if (!(await isDaemonRunning())) {
    ui.step('Starting Port Daddy daemon');
    await handleDaemon('start');
  }

  if (await isDaemonRunning()) {
    ui.success('Daemon ready');
    return true;
  }

  ui.error('Daemon did not come up');
  return false;
}

function installFleetBarIfEnabled(skipFleetBar: boolean): boolean {
  if (skipFleetBar) {
    ui.info('Skipping FleetBar (--no-fleetbar)');
    return true;
  }

  if (platform() !== 'darwin') {
    ui.info('FleetBar install skipped (macOS only)');
    return true;
  }

  if (!existsSync(FLEETBAR_INSTALL_SCRIPT)) {
    ui.warn('FleetBar install script not found');
    return false;
  }

  ui.step('Installing FleetBar');
  const install = spawnSync('/bin/bash', [FLEETBAR_INSTALL_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  if ((install.status ?? 1) !== 0) {
    ui.warn('FleetBar install failed');
    return false;
  }

  ui.success('FleetBar installed');
  return true;
}

async function maybeInitProject(projectDir: string | null, options: Record<string, unknown>): Promise<void> {
  if (!projectDir) {
    ui.info('No project directory detected — skipping pd init');
    ui.info('Run `cd your-project && pd init` when you are ready.');
    return;
  }

  if (options['no-init']) {
    ui.info('Skipping project init (--no-init)');
    return;
  }

  const shouldInit = await ui.confirm(`Initialize Port Daddy in ${projectDir}?`, true);
  if (!shouldInit) {
    ui.info('Skipping project init');
    return;
  }

  const previousCwd = process.cwd();
  process.chdir(projectDir);
  try {
    await handleInit({
      'no-mcp': true,
      'no-fleet': options['no-fleet'],
      'no-hook': options['no-hook'],
    });
  } finally {
    process.chdir(previousCwd);
  }
}

export async function handleSetup(options: Record<string, unknown>): Promise<void> {
  console.log('');
  ui.info('Port Daddy setup');
  console.log('');

  if (!options['no-daemon']) {
    const daemonOk = await ensureDaemonInstalledAndRunning();
    if (!daemonOk) {
      process.exit(1);
    }
  } else {
    ui.info('Skipping daemon install (--no-daemon)');
  }

  if (!options['no-mcp']) {
    await handleMcpInstall({});
  } else {
    ui.info('Skipping MCP install (--no-mcp)');
  }

  installFleetBarIfEnabled(!!options['no-fleetbar']);

  const explicitProject = typeof options.project === 'string' ? options.project : undefined;
  if (explicitProject && !existsSync(resolve(explicitProject))) {
    ui.error(`Project path not found: ${explicitProject}`);
    process.exit(1);
  }

  const projectDir = inferProjectDir(explicitProject);
  await maybeInitProject(projectDir, options);

  console.log('');
  ui.info('Setup complete');
  console.log('  Next steps:');
  if (projectDir) {
    console.log(`    cd ${projectDir}`);
    console.log('    pd fleet up');
  }
  console.log('    pd fleet status');
  console.log('    pd begin "your next task"');
  console.log('');
}
