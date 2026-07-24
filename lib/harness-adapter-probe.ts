import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  BACKEND_CATALOG,
  type BackendCatalogEntry,
  type HarnessAdapterCapabilities,
} from './backend-catalog.js';
import { resolveCliBinary, type CliBinaryResolution } from './cli-bin-dirs.js';

export type HarnessProbeStatus =
  | 'discovered'
  | 'unavailable'
  | 'unverified'
  | 'not-supported';

export interface HarnessProbeCheck {
  status: HarnessProbeStatus;
  detail: string;
  command?: string;
}

export interface HarnessAdapterProbeResult {
  family: string;
  backendIds: string[];
  executablePath: string | null;
  spawn: HarnessProbeCheck;
  resume: HarnessProbeCheck;
  transcript: HarnessProbeCheck;
}

export interface HarnessAdapterProbeReport {
  probedAt: string;
  sideEffectFree: true;
  evidenceLevel: 'discovery-only';
  provesCapabilities: false;
  adapters: HarnessAdapterProbeResult[];
  counts: Record<HarnessProbeStatus, number>;
}

export interface HarnessAdapterProbeOptions {
  resolveExecutable?: (executable: string) => CliBinaryResolution;
  runCommand?: (
    executable: string,
    args: readonly string[],
  ) => { status: number | null; stdout: string; stderr: string; error?: string };
  pathExists?: (path: string) => boolean;
  homeDir?: string;
  now?: () => Date;
}

function defaultRunCommand(
  executable: string,
  args: readonly string[],
): { status: number | null; stdout: string; stderr: string; error?: string } {
  const result = spawnSync(executable, [...args], {
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message,
  };
}

function displayCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].join(' ');
}

function helpCheck(
  executable: string,
  args: readonly string[],
  evidence: readonly string[],
  runCommand: NonNullable<HarnessAdapterProbeOptions['runCommand']>,
): HarnessProbeCheck {
  const command = displayCommand(executable, args);
  const result = runCommand(executable, args);
  if (result.status !== 0) {
    const detail = result.error || result.stderr.trim() || `help command exited ${String(result.status)}`;
    return { status: 'unverified', detail, command };
  }
  const output = `${result.stdout}\n${result.stderr}`;
  const missing = evidence.filter((needle) => !output.includes(needle));
  if (missing.length > 0) {
    return {
      status: 'unverified',
      detail: `help output is missing expected evidence: ${missing.join(', ')}`,
      command,
    };
  }
  return {
    status: 'discovered',
    detail: `help advertises ${evidence.join(', ')}; no spawn or model turn was executed`,
    command,
  };
}

function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir;
  if (path.startsWith('~/')) return join(homeDir, path.slice(2));
  return path;
}

function transcriptCheck(
  adapter: HarnessAdapterCapabilities,
  pathExists: NonNullable<HarnessAdapterProbeOptions['pathExists']>,
  homeDir: string,
): HarnessProbeCheck {
  if (adapter.transcript.owner === 'none' || adapter.transcript.format === 'none') {
    return {
      status: 'not-supported',
      detail: 'adapter exposes no stable transcript surface',
    };
  }
  if (!adapter.transcript.root) {
    return {
      status: 'unverified',
      detail: `${adapter.transcript.owner}:${adapter.transcript.format} has no local root that this discovery probe can inspect`,
    };
  }
  const root = expandHome(adapter.transcript.root, homeDir);
  if (!pathExists(root)) {
    return {
      status: 'unavailable',
      detail: `transcript root is absent: ${root}`,
    };
  }
  return {
    status: 'discovered',
    detail: `declared transcript root exists: ${root}; contents and format were not validated`,
  };
}

function groupCatalog(
  catalog: readonly BackendCatalogEntry[],
): Array<{ adapter: HarnessAdapterCapabilities; backendIds: string[] }> {
  const families = new Map<string, { adapter: HarnessAdapterCapabilities; backendIds: string[] }>();
  for (const backend of catalog) {
    const existing = families.get(backend.adapter.family);
    if (existing) {
      existing.backendIds.push(backend.id);
    } else {
      families.set(backend.adapter.family, {
        adapter: backend.adapter,
        backendIds: [backend.id],
      });
    }
  }
  return [...families.values()];
}

/**
 * Discover local advertisements and declared paths only. API credentials,
 * remote health, spawn/resume behavior, transcript semantics, and an actual
 * model turn belong to backend readiness/conformance probes and remain
 * explicitly unverified here. A discovery result is never capability proof.
 */
export function probeHarnessAdapters(
  catalog: readonly BackendCatalogEntry[] = BACKEND_CATALOG,
  options: HarnessAdapterProbeOptions = {},
): HarnessAdapterProbeReport {
  const resolveExecutable = options.resolveExecutable ?? ((executable) => resolveCliBinary(executable));
  const runCommand = options.runCommand ?? defaultRunCommand;
  const pathExists = options.pathExists ?? existsSync;
  const homeDir = options.homeDir ?? homedir();
  const adapters: HarnessAdapterProbeResult[] = [];

  for (const { adapter, backendIds } of groupCatalog(catalog)) {
    let executablePath: string | null = null;
    let spawn: HarnessProbeCheck;
    let resume: HarnessProbeCheck;

    if (!adapter.probe) {
      spawn = {
        status: 'unverified',
        detail: `${adapter.spawn.transport} mechanics require a backend readiness or conformance run`,
      };
      resume = adapter.resume.native
        ? { status: 'unverified', detail: `native ${adapter.resume.scope} resume has no side-effect-free help probe` }
        : { status: 'not-supported', detail: 'adapter requires handoff-capsule continuation' };
    } else {
      const resolution = resolveExecutable(adapter.probe.executable);
      if (!resolution.found) {
        spawn = {
          status: 'unavailable',
          detail: `${adapter.probe.executable} is not executable on this machine`,
        };
        resume = adapter.resume.native
          ? { status: 'unavailable', detail: `${adapter.probe.executable} is required for native resume` }
          : { status: 'not-supported', detail: 'adapter requires handoff-capsule continuation' };
      } else {
        executablePath = resolution.command;
        spawn = helpCheck(
          executablePath,
          adapter.probe.spawnHelpArgs,
          adapter.probe.spawnEvidence,
          runCommand,
        );
        if (!adapter.resume.native) {
          resume = { status: 'not-supported', detail: 'adapter requires handoff-capsule continuation' };
        } else if (!adapter.probe.resumeHelpArgs || !adapter.probe.resumeEvidence) {
          resume = { status: 'unverified', detail: `native ${adapter.resume.scope} resume lacks help evidence` };
        } else {
          resume = helpCheck(
            executablePath,
            adapter.probe.resumeHelpArgs,
            adapter.probe.resumeEvidence,
            runCommand,
          );
        }
      }
    }

    adapters.push({
      family: adapter.family,
      backendIds,
      executablePath,
      spawn,
      resume,
      transcript: transcriptCheck(adapter, pathExists, homeDir),
    });
  }

  const counts: Record<HarnessProbeStatus, number> = {
    discovered: 0,
    unavailable: 0,
    unverified: 0,
    'not-supported': 0,
  };
  for (const adapter of adapters) {
    counts[adapter.spawn.status] += 1;
    counts[adapter.resume.status] += 1;
    counts[adapter.transcript.status] += 1;
  }

  return {
    probedAt: (options.now ?? (() => new Date()))().toISOString(),
    sideEffectFree: true,
    evidenceLevel: 'discovery-only',
    provesCapabilities: false,
    adapters,
    counts,
  };
}
