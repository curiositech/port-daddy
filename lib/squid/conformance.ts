/**
 * Authoritative Giant Squid conformance snapshot for operator surfaces.
 *
 * This module is deliberately read-only and filesystem-backed. The CLI,
 * daemon roster, FleetBar, and pd-console must describe the same real wiring:
 * an exact armed project root, all staged tentacles, provider-native config,
 * visible identity, and a fresh daemon heartbeat.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { PD_HOME } from '../../shared/paths.js';
import { resolveCliBinary } from '../cli-bin-dirs.js';
import { PD_HOOK_MARKER, REGISTERED_TENTACLES, TENTACLES } from './hook-shape.js';
import {
  SLASH_COMMAND_FILENAME,
  SQUID_DAEMON_HEARTBEAT_STALE_MS,
  STATUSLINE_MARKER,
} from './identity.js';

export type SquidConformanceLevel = 'LIVE' | 'READY' | 'PARTIAL' | 'UNPROTECTED';

export interface SquidProviderConformance {
  name: string;
  slug: 'claude' | 'codex' | 'gemini' | 'agy';
  detected: boolean;
  expectedScope: 'project' | 'user';
  configPath: string;
  configured: boolean;
  wired: boolean;
  missingTentacles: string[];
}

export interface SquidConformanceCapabilities {
  suggestibility: boolean;
  editProtection: boolean;
  trace: boolean;
  inbox: boolean;
  parleyDelivery: boolean;
  automatedParley: false;
  skillGrafting: false;
}

export interface SquidConformance {
  schemaVersion: 1;
  level: SquidConformanceLevel;
  score: number;
  projectRoot: string | null;
  projectArmed: boolean;
  daemonAlive: boolean;
  tentaclesStaged: boolean;
  detectedProviders: number;
  wiredProviders: number;
  identityReady: boolean;
  identity: {
    statuslineStaged: boolean;
    statuslineProject: boolean;
    statuslineUser: boolean;
    slashCommand: boolean;
    pilotSessionStart: boolean;
    daemonAlive: boolean;
  };
  providers: SquidProviderConformance[];
  capabilities: SquidConformanceCapabilities;
  missing: string[];
  repair: string | null;
  truth: {
    bufferProtection: string;
    parley: string;
    skillGrafting: string;
  };
}

export interface SquidConformanceFacts {
  projectRoot: string | null;
  projectArmed: boolean;
  daemonAlive: boolean;
  tentaclesStaged: boolean;
  statuslineStaged: boolean;
  statuslineVisible: boolean;
  statuslineUser: boolean;
  slashCommand: boolean;
  pilotSessionStart: boolean;
  inboxSessionStart: boolean;
  providers: SquidProviderConformance[];
}

export interface ReadSquidConformanceOptions {
  home?: string;
  pdHome?: string;
  now?: number;
  commandExists?: (binary: string) => boolean;
}

const SQUID_TRUTH = {
  bufferProtection: 'Pre-edit ownership and lock gate; it does not back up unsaved editor buffers.',
  parley: 'Parley turns can reach agent inboxes; convening is still explicit, not automatic.',
  skillGrafting: '`pd skill-graft` is adjacent guidance, not a Squid tentacle today.',
} as const;

export function canonicalSquidProjectRoot(projectDir: string): string {
  const absolute = resolve(projectDir);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function readArmedSquidProjectRoots(registryPath: string): string[] {
  if (!existsSync(registryPath)) return [];
  try {
    return [...new Set(readFileSync(registryPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

function defaultCommandExists(binary: string): boolean {
  // launchd intentionally starts with a sparse PATH. Use the shared resolver
  // that also checks Homebrew, user-local bins, and version-manager installs
  // so daemon-side conformance agrees with the operator's actual machine.
  return resolveCliBinary(binary).found;
}

function readText(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

function providerStatus(
  name: string,
  slug: SquidProviderConformance['slug'],
  binary: string,
  expectedScope: SquidProviderConformance['expectedScope'],
  configPath: string,
  commandExists: (binary: string) => boolean,
): SquidProviderConformance {
  const config = readText(configPath);
  const missingTentacles = REGISTERED_TENTACLES.filter((tentacle) => !config.includes(tentacle));
  return {
    name,
    slug,
    detected: commandExists(binary),
    expectedScope,
    configPath,
    configured: config.includes(PD_HOOK_MARKER) && missingTentacles.length === 0,
    wired: config.includes(PD_HOOK_MARKER) && missingTentacles.length === 0,
    missingTentacles,
  };
}

function heartbeatFresh(path: string, now: number): boolean {
  try {
    const age = now - statSync(path).mtimeMs;
    return age >= -SQUID_DAEMON_HEARTBEAT_STALE_MS && age <= SQUID_DAEMON_HEARTBEAT_STALE_MS;
  } catch {
    return false;
  }
}

function quoteCliPath(path: string): string {
  return JSON.stringify(path);
}

export function deriveSquidConformance(facts: SquidConformanceFacts): SquidConformance {
  const ephemeralProjectRoot = Boolean(facts.projectRoot && (
    facts.projectRoot === '/tmp'
    || facts.projectRoot.startsWith('/tmp/')
    || facts.projectRoot === '/private/tmp'
    || facts.projectRoot.startsWith('/private/tmp/')
  ));
  const detected = facts.providers.filter((provider) => provider.detected);
  const configured = detected.filter((provider) => provider.configured);
  const providers = facts.providers.map((provider) => ({
    ...provider,
    wired: facts.projectArmed && provider.configured,
  }));
  const wired = providers.filter((provider) => provider.detected && provider.wired);
  const identityReady = facts.statuslineVisible && facts.slashCommand && facts.pilotSessionStart;
  const completeWiring = Boolean(facts.projectRoot)
    && !ephemeralProjectRoot
    && facts.projectArmed
    && facts.tentaclesStaged
    && detected.length > 0
    && configured.length === detected.length
    && identityReady;
  const anyProtection = facts.projectArmed
    || facts.tentaclesStaged
    || facts.providers.some((provider) => provider.wired)
    || facts.statuslineVisible
    || facts.slashCommand
    || facts.pilotSessionStart;

  const level: SquidConformanceLevel = completeWiring
    ? (facts.daemonAlive ? 'LIVE' : 'READY')
    : anyProtection
      ? 'PARTIAL'
      : 'UNPROTECTED';

  const providerCoverage = detected.length === 0 ? 0 : configured.length / detected.length;
  const identityParts = [facts.statuslineVisible, facts.slashCommand, facts.pilotSessionStart].filter(Boolean).length;
  const score = Math.round(
    (facts.projectArmed ? 15 : 0)
      + (facts.daemonAlive ? 15 : 0)
      + (facts.tentaclesStaged ? 20 : 0)
      + (providerCoverage * 25)
      + ((identityParts / 3) * 25),
  );

  const missing: string[] = [];
  if (!facts.projectRoot) missing.push('agent has no local worktree root');
  if (ephemeralProjectRoot) missing.push('worktree is under an ephemeral system temp root; resume it under ~/coding/tmp');
  if (facts.projectRoot && !facts.projectArmed) missing.push('exact project root is not armed');
  if (!facts.daemonAlive) missing.push('daemon heartbeat is not fresh');
  if (!facts.tentaclesStaged) missing.push('prompt, pre-tool, or post-tool tentacles are not fully staged');
  if (detected.length === 0) missing.push('no supported interactive agent CLI detected');
  for (const provider of detected.filter((entry) => !entry.configured)) {
    missing.push(`${provider.name} ${provider.expectedScope} hook wiring is incomplete`);
  }
  if (!facts.statuslineVisible) missing.push('visible ◆ PD statusline is not wired');
  if (!facts.slashCommand) missing.push('/squid command is not installed');
  if (!facts.pilotSessionStart) missing.push('Pilot SessionStart hook is not installed');

  let repair: string | null = null;
  if (!facts.projectRoot) repair = 'Register or resume the agent from a linked worktree.';
  else if (ephemeralProjectRoot) repair = 'Resume this agent in a linked worktree under ~/coding/tmp before arming Squid.';
  else if (!facts.projectArmed || !facts.tentaclesStaged || !identityReady) repair = `pd squid on --cwd ${quoteCliPath(facts.projectRoot)}`;
  else if (configured.length < detected.length) repair = `pd hooks install --cwd ${quoteCliPath(facts.projectRoot)}`;
  else if (!facts.daemonAlive) repair = 'port-daddy start';

  const hooksActive = completeWiring && facts.daemonAlive;
  return {
    schemaVersion: 1,
    level,
    score,
    projectRoot: facts.projectRoot,
    projectArmed: facts.projectArmed,
    daemonAlive: facts.daemonAlive,
    tentaclesStaged: facts.tentaclesStaged,
    detectedProviders: detected.length,
    wiredProviders: wired.length,
    identityReady,
    identity: {
      statuslineStaged: facts.statuslineStaged,
      statuslineProject: facts.statuslineVisible,
      statuslineUser: facts.statuslineUser,
      slashCommand: facts.slashCommand,
      pilotSessionStart: facts.pilotSessionStart,
      daemonAlive: facts.daemonAlive,
    },
    providers,
    capabilities: {
      suggestibility: hooksActive,
      editProtection: hooksActive,
      // Per-tool observational hooks are intentionally retired. Claims, notes,
      // and the bounded TURN/EDIT debug projection are the cumulative record.
      trace: false,
      inbox: facts.daemonAlive && facts.inboxSessionStart,
      parleyDelivery: facts.daemonAlive,
      automatedParley: false,
      skillGrafting: false,
    },
    missing,
    repair,
    truth: { ...SQUID_TRUTH },
  };
}

export function unprotectedSquidConformance(reason = 'agent has no local worktree root'): SquidConformance {
  const snapshot = deriveSquidConformance({
    projectRoot: null,
    projectArmed: false,
    daemonAlive: false,
    tentaclesStaged: false,
    statuslineStaged: false,
    statuslineVisible: false,
    statuslineUser: false,
    slashCommand: false,
    pilotSessionStart: false,
    inboxSessionStart: false,
    providers: [],
  });
  snapshot.missing = [reason];
  return snapshot;
}

export function readSquidConformance(
  projectDir: string,
  options: ReadSquidConformanceOptions = {},
): SquidConformance {
  const home = options.home ?? process.env.HOME ?? homedir();
  const pdHome = options.pdHome ?? PD_HOME;
  const now = options.now ?? Date.now();
  const commandExists = options.commandExists ?? defaultCommandExists;
  const projectRoot = canonicalSquidProjectRoot(projectDir);
  const projectClaudeSettings = join(projectRoot, '.claude', 'settings.json');
  const projectSettingsText = readText(projectClaudeSettings);
  let projectSettings: Record<string, unknown> = {};
  try {
    projectSettings = projectSettingsText ? JSON.parse(projectSettingsText) as Record<string, unknown> : {};
  } catch {
    projectSettings = {};
  }
  const hooksText = JSON.stringify(projectSettings.hooks ?? {});
  const statusline = projectSettings.statusLine as { command?: unknown } | undefined;
  const userClaudeSettingsText = readText(join(home, '.claude', 'settings.json'));
  let userStatusline = false;
  try {
    const userSettings = userClaudeSettingsText
      ? JSON.parse(userClaudeSettingsText) as { statusLine?: { command?: unknown } }
      : {};
    userStatusline = typeof userSettings.statusLine?.command === 'string'
      && userSettings.statusLine.command.includes(STATUSLINE_MARKER);
  } catch {
    userStatusline = false;
  }
  const binDir = join(pdHome, 'bin');
  const tentaclesStaged = TENTACLES.every((tentacle) =>
    existsSync(join(binDir, tentacle)) && existsSync(join(binDir, 'squid', tentacle))
  );
  const providers: SquidProviderConformance[] = [
    providerStatus('Claude Code', 'claude', 'claude', 'project', projectClaudeSettings, commandExists),
    providerStatus('Codex CLI', 'codex', 'codex', 'user', join(home, '.codex', 'config.toml'), commandExists),
    providerStatus('Gemini CLI', 'gemini', 'gemini', 'project', join(projectRoot, '.gemini', 'settings.json'), commandExists),
    providerStatus('Antigravity (agy)', 'agy', 'agy', 'user', join(home, '.gemini', 'hooks.json'), commandExists),
  ];

  return deriveSquidConformance({
    projectRoot,
    projectArmed: readArmedSquidProjectRoots(join(pdHome, 'squid', 'projects')).includes(projectRoot),
    daemonAlive: heartbeatFresh(join(pdHome, 'heartbeat'), now),
    tentaclesStaged,
    statuslineStaged: existsSync(join(binDir, STATUSLINE_MARKER)),
    statuslineVisible: typeof statusline?.command === 'string' && statusline.command.includes(STATUSLINE_MARKER),
    statuslineUser: userStatusline,
    slashCommand: existsSync(join(projectRoot, '.claude', 'commands', SLASH_COMMAND_FILENAME)),
    pilotSessionStart: hooksText.includes('sessionstart-pilot.mjs'),
    inboxSessionStart: hooksText.includes('pd attention'),
    providers,
  });
}
