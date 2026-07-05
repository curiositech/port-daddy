/**
 * cli/utils/harbor-facts.ts — effectful fact-gathering for the C8 Agent Harbor
 * readiness cards (binder ch18 Work Order C8).
 *
 * The judging lives in lib/agent-harbor/setup-doctor.ts (pure, unit-tested);
 * this file only OBSERVES: filesystem, keychain, backend binaries, and the
 * daemon's /relay/status. `pd doctor` passes in the facts it has already
 * computed (daemon reachability/version/supervision, hook diagnoses, MCP
 * wiring) so the two surfaces can never disagree about the same probe.
 */

import { accessSync, constants, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { SquidProviderHookDiagnosis } from '../../lib/squid/adapter.js';
import { keychain } from '../../lib/keychain.js';
import { assessBackendReadiness } from '../../lib/backend-readiness.js';
import { recommendedBackendIds } from '../../lib/backend-catalog.js';
import { resolveDbPath } from '../../lib/db.js';
import { pdFetch, PORT_DADDY_URL } from './fetch.js';
import type {
  HarborFacts,
  McpFacts,
  ProviderKeyFact,
  RelayFacts,
} from '../../lib/agent-harbor/setup-doctor.js';

/**
 * The durable root where agent worktrees belong. NEVER /tmp — macOS purges it
 * on a timer and on reboot (the exact guidance lib/spawner.ts gives when it
 * refuses an unisolated spawn). Overridable for non-default layouts.
 */
export function defaultWorktreeRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PORT_DADDY_WORKTREE_ROOT?.trim();
  return override || join(homedir(), 'coding', 'tmp');
}

/** FleetBar installs to ~/Applications/Port Daddy/FleetBar.app (install.sh). */
export function fleetBarAppPath(home: string = homedir()): string {
  return join(home, 'Applications', 'Port Daddy', 'FleetBar.app');
}

function pathIsWritable(p: string): boolean {
  try {
    accessSync(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function gatherRelayFacts(daemonReachable: boolean): Promise<RelayFacts> {
  if (!daemonReachable) return { relayUrl: null, connected: null };
  try {
    const res = await pdFetch(`${PORT_DADDY_URL}/relay/status`);
    if (!res.ok) return { relayUrl: null, connected: null };
    const data = await res.json() as { relay_url?: string | null; connected?: boolean };
    return { relayUrl: data.relay_url ?? null, connected: data.connected ?? null };
  } catch {
    return { relayUrl: null, connected: null };
  }
}

async function gatherProviderKeyFacts(): Promise<ProviderKeyFact[]> {
  const ids = recommendedBackendIds();
  const facts: ProviderKeyFact[] = [];
  for (const backend of ids) {
    try {
      const r = await assessBackendReadiness(backend);
      facts.push({
        backend: r.backend,
        status: r.status,
        launchableUnverified: r.launchableUnverified,
        nextStep: r.setupCommand ?? r.nextStep,
      });
    } catch {
      facts.push({ backend, status: 'unknown' });
    }
  }
  return facts;
}

export interface HarborFactSeed {
  daemonReachable: boolean;
  daemonVersion: string | null;
  /** From the supervision-integrity assessment; null = not assessed (non-darwin). */
  daemonSupervised: boolean | null;
  hookDiagnoses: SquidProviderHookDiagnosis[];
  mcp: McpFacts;
  cliVersion: string;
  latestVersion?: string | null;
}

export async function gatherHarborFacts(seed: HarborFactSeed): Promise<HarborFacts> {
  const dbPath = resolveDbPath();
  const dbExists = existsSync(dbPath);
  const worktreeRoot = defaultWorktreeRoot();
  const [relay, providerKeys] = await Promise.all([
    gatherRelayFacts(seed.daemonReachable),
    gatherProviderKeyFacts(),
  ]);

  return {
    daemon: {
      reachable: seed.daemonReachable,
      version: seed.daemonVersion,
      supervised: seed.daemonSupervised,
    },
    app: {
      platform: platform(),
      fleetBarInstalled: existsSync(fleetBarAppPath()),
    },
    hooks: seed.hookDiagnoses,
    mcp: seed.mcp,
    transcriptPath: {
      path: dbPath,
      exists: dbExists,
      // Before first daemon start the file does not exist; judge the parent
      // dir's writability so a fresh install is "missing" (repairable), not
      // a false "not writable" critical.
      writable: dbExists ? pathIsWritable(dbPath) : pathIsWritable(dirname(dbPath)),
    },
    keychain: {
      platform: platform(),
      available: keychain.available(),
    },
    providerKeys,
    worktreeRoot: {
      path: worktreeRoot,
      exists: existsSync(worktreeRoot),
      writable: existsSync(worktreeRoot) ? pathIsWritable(worktreeRoot) : false,
    },
    relay,
    versions: {
      cliVersion: seed.cliVersion,
      daemonVersion: seed.daemonVersion,
      latestVersion: seed.latestVersion ?? null,
    },
  };
}
