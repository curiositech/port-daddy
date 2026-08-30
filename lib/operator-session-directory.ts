import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isProcessRunning,
  listDaemonProfiles,
  readDaemonProfileState,
  readNumberFile,
  type DaemonProfilePaths,
} from './daemon-profiles.js';
import type { DaemonBerthIdentity } from '../shared/daemon-berths.js';
import { DEFAULT_DAEMON_PORT } from '../shared/daemon-discovery.js';

export type SessionDirectoryLocationState = 'online' | 'degraded' | 'offline';

export interface SessionDirectoryLocation {
  id: string;
  label: string;
  tier: string;
  canonical: boolean;
  current: boolean;
  url: string | null;
  port: number | null;
  pid: number | null;
  state: SessionDirectoryLocationState;
  ledgerPreserved: boolean;
  sourceDir: string | null;
  gitBranch: string | null;
  gitRev: string | null;
  error: string | null;
}

export interface SessionDirectoryProvider {
  adapterFamily: string | null;
  label: string;
  backend: string | null;
  model: string | null;
  confidence: string;
}

export interface SessionDirectorySession {
  id: string;
  purpose: string;
  status: string;
  phase: string;
  agentId: string | null;
  identityProject: string | null;
  durable: boolean;
  fileCount: number;
  noteCount: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  worktree: {
    id: string | null;
    root: string | null;
    name: string | null;
    branch: string | null;
  };
  provider: SessionDirectoryProvider;
  liveness: string;
  locations: SessionDirectoryLocation[];
  primaryLocationId: string;
  notes: Array<{ id?: number; content: string; type?: string; createdAt?: number }>;
}

export interface OperatorSessionDirectory {
  schema: 'pd.operator.session-directory.v0';
  generatedAt: number;
  sessions: SessionDirectorySession[];
  locations: SessionDirectoryLocation[];
  summary: {
    sessions: number;
    active: number;
    onlineLocations: number;
    offlineLocations: number;
    unknownProviders: number;
  };
}

interface RawSession {
  id?: unknown;
  purpose?: unknown;
  status?: unknown;
  phase?: unknown;
  agentId?: unknown;
  identityProject?: unknown;
  durable?: unknown;
  fileCount?: unknown;
  noteCount?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
  metadata?: unknown;
  notes?: unknown;
}

interface RawRosterAgent {
  id?: unknown;
  liveness?: unknown;
  harness?: unknown;
}

interface DirectoryTarget {
  id: string;
  label: string;
  canonical: boolean;
  current: boolean;
  url: string | null;
  port: number | null;
  pid: number | null;
  ledgerPreserved: boolean;
  profile: DaemonProfilePaths | null;
}

interface LocatedSession {
  session: SessionDirectorySession;
  location: SessionDirectoryLocation;
}

export interface BuildOperatorSessionDirectoryOptions {
  currentBerth?: DaemonBerthIdentity | null;
  homeDir?: string;
  timeoutMs?: number;
  limitPerLocation?: number;
  fetchJson?: (url: string, timeoutMs: number) => Promise<unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | null {
  const result = text(value).trim();
  return result ? result : null;
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function defaultFetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalTarget(homeDir: string, berth: DaemonBerthIdentity | null | undefined): DirectoryTarget {
  const port = berth?.canonical && berth.port ? berth.port : DEFAULT_DAEMON_PORT;
  return {
    id: 'stable',
    label: 'stable',
    canonical: true,
    current: berth?.canonical === true || berth?.port === port,
    url: `http://127.0.0.1:${port}`,
    port,
    pid: berth?.canonical ? process.pid : null,
    ledgerPreserved: existsSync(join(homeDir, 'port-registry.db')),
    profile: null,
  };
}

function profileTarget(profile: DaemonProfilePaths, berth: DaemonBerthIdentity | null | undefined): DirectoryTarget {
  const state = readDaemonProfileState(profile);
  const port = state?.port ?? readNumberFile(profile.portFile);
  const pid = state?.pid ?? readNumberFile(profile.pidFile);
  return {
    id: `profile:${profile.name}`,
    label: profile.name,
    canonical: false,
    current: berth?.port === port || berth?.label === profile.name,
    url: port ? `http://127.0.0.1:${port}` : null,
    port,
    pid,
    ledgerPreserved: existsSync(profile.dbPath),
    profile,
  };
}

function discoverTargets(homeDir: string, berth: DaemonBerthIdentity | null | undefined): DirectoryTarget[] {
  const byPort = new Map<number | string, DirectoryTarget>();
  const canonical = canonicalTarget(homeDir, berth);
  byPort.set(canonical.port ?? canonical.id, canonical);
  for (const profile of listDaemonProfiles({ homeDir })) {
    const target = profileTarget(profile, berth);
    const key = target.port ?? target.id;
    const prior = byPort.get(key);
    if (!prior || target.current) byPort.set(key, target);
  }
  return [...byPort.values()].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    if (left.canonical !== right.canonical) return left.canonical ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

function unknownProvider(): SessionDirectoryProvider {
  return {
    adapterFamily: null,
    label: 'Provider not witnessed',
    backend: null,
    model: null,
    confidence: 'unknown',
  };
}

function providerFor(agent: RawRosterAgent | undefined): SessionDirectoryProvider {
  const harness = object(agent?.harness);
  const label = optionalText(harness.label);
  return {
    adapterFamily: optionalText(harness.family) ?? optionalText(harness.id),
    label: label ?? 'Provider not witnessed',
    backend: optionalText(harness.backend),
    model: optionalText(harness.model),
    confidence: optionalText(harness.confidence) ?? (label ? 'reported' : 'unknown'),
  };
}

function locationFromTarget(
  target: DirectoryTarget,
  state: SessionDirectoryLocationState,
  whoami: unknown,
  error: string | null,
): SessionDirectoryLocation {
  const daemon = object(object(whoami).daemon);
  return {
    id: target.id,
    label: optionalText(daemon.label) ?? target.label,
    tier: optionalText(daemon.tier) ?? (target.canonical ? 'stable' : 'codebase'),
    canonical: daemon.canonical === true || target.canonical,
    current: target.current,
    url: target.url,
    port: integer(daemon.port) || target.port,
    pid: integer(object(whoami).pid) || target.pid,
    state,
    ledgerPreserved: target.ledgerPreserved,
    sourceDir: optionalText(daemon.sourceDir),
    gitBranch: optionalText(daemon.gitBranch),
    gitRev: optionalText(daemon.gitRev),
    error,
  };
}

function normalizeSession(raw: RawSession, provider: SessionDirectoryProvider, liveness: string): SessionDirectorySession | null {
  const id = optionalText(raw.id);
  if (!id) return null;
  const metadata = object(raw.metadata);
  const worktree = object(metadata.worktree);
  const notes = list(raw.notes).map((entry) => object(entry)).flatMap((entry) => {
    const content = optionalText(entry.content);
    return content ? [{
      ...(integer(entry.id) ? { id: integer(entry.id) } : {}),
      content,
      ...(optionalText(entry.type) ? { type: optionalText(entry.type)! } : {}),
      ...(integer(entry.createdAt) ? { createdAt: integer(entry.createdAt) } : {}),
    }] : [];
  });
  return {
    id,
    purpose: optionalText(raw.purpose) ?? id,
    status: optionalText(raw.status) ?? 'unknown',
    phase: optionalText(raw.phase) ?? 'unknown',
    agentId: optionalText(raw.agentId),
    identityProject: optionalText(raw.identityProject),
    durable: raw.durable === true,
    fileCount: integer(raw.fileCount),
    noteCount: integer(raw.noteCount),
    createdAt: integer(raw.createdAt),
    updatedAt: integer(raw.updatedAt),
    completedAt: integer(raw.completedAt) || null,
    worktree: {
      id: optionalText(worktree.id),
      root: optionalText(worktree.root),
      name: optionalText(worktree.name),
      branch: optionalText(worktree.branch),
    },
    provider,
    liveness,
    locations: [],
    primaryLocationId: '',
    notes,
  };
}

function locationRank(location: SessionDirectoryLocation): number {
  if (location.state === 'online') return 2;
  if (location.state === 'degraded') return 1;
  return 0;
}

function isRoutable(candidate: LocatedSession): boolean {
  return candidate.session.status === 'active'
    && Boolean(candidate.session.agentId)
    && candidate.session.liveness === 'alive'
    && candidate.location.state !== 'offline';
}

/** Keep the projected record and its owning berth coupled during deduplication. */
function preferSession(current: LocatedSession, candidate: LocatedSession): LocatedSession {
  if (isRoutable(candidate) !== isRoutable(current)) return isRoutable(candidate) ? candidate : current;
  if (candidate.location.current !== current.location.current) return candidate.location.current ? candidate : current;
  const candidateLocationRank = locationRank(candidate.location);
  const currentLocationRank = locationRank(current.location);
  if (candidateLocationRank !== currentLocationRank) return candidateLocationRank > currentLocationRank ? candidate : current;
  if (candidate.session.updatedAt > current.session.updatedAt) return candidate;
  if (candidate.session.updatedAt < current.session.updatedAt) return current;
  if (current.session.provider.confidence === 'unknown' && candidate.session.provider.confidence !== 'unknown') return candidate;
  return current;
}

/**
 * Build one read-only session directory over every running local daemon berth.
 * Offline berth databases remain isolated: the directory reports that their
 * ledgers are preserved, but never opens or interprets another daemon's DB.
 */
export async function buildOperatorSessionDirectory(
  options: BuildOperatorSessionDirectoryOptions = {},
): Promise<OperatorSessionDirectory> {
  const homeDir = options.homeDir ?? join(homedir(), '.port-daddy');
  const timeoutMs = options.timeoutMs ?? 900;
  const recentLimit = Math.min(Math.max(options.limitPerLocation ?? 500, 1), 2_000);
  const activeLimit = 2_000;
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const targets = discoverTargets(homeDir, options.currentBerth);

  const snapshots = await Promise.all(targets.map(async (target) => {
    const processAppearsRunning = target.canonical || isProcessRunning(target.pid);
    if (!target.url || !processAppearsRunning) {
      return {
        location: locationFromTarget(target, 'offline', null, null),
        sessions: [] as RawSession[],
        roster: [] as RawRosterAgent[],
      };
    }
    try {
      const [activeResult, recentResult, rosterResult, whoamiResult] = await Promise.allSettled([
        fetchJson(`${target.url}/sessions?allWorktrees=true&status=active&notes=true&limit=${activeLimit}`, timeoutMs),
        fetchJson(`${target.url}/sessions?allWorktrees=true&notes=true&limit=${recentLimit}`, timeoutMs),
        fetchJson(`${target.url}/agent-roster?limit=${Math.min(activeLimit, 500)}`, timeoutMs),
        fetchJson(`${target.url}/whoami`, timeoutMs),
      ]);
      if (activeResult.status === 'rejected' && recentResult.status === 'rejected') {
        throw activeResult.reason;
      }
      const activeEnvelope = activeResult.status === 'fulfilled' ? object(activeResult.value) : {};
      const recentEnvelope = recentResult.status === 'fulfilled' ? object(recentResult.value) : {};
      const sessionsById = new Map<string, RawSession>();
      for (const raw of [...list(recentEnvelope.sessions), ...list(activeEnvelope.sessions)] as RawSession[]) {
        const id = optionalText(raw.id);
        if (id) sessionsById.set(id, raw);
      }
      const rosterEnvelope = rosterResult.status === 'fulfilled' ? object(rosterResult.value) : {};
      const whoami = whoamiResult.status === 'fulfilled' ? whoamiResult.value : null;
      const degraded = activeResult.status === 'rejected'
        || recentResult.status === 'rejected'
        || rosterResult.status === 'rejected'
        || whoamiResult.status === 'rejected';
      return {
        location: locationFromTarget(
          target,
          degraded ? 'degraded' : 'online',
          whoami,
          degraded ? 'Session ledger is online; provider or berth metadata is incomplete.' : null,
        ),
        sessions: [...sessionsById.values()],
        roster: list(rosterEnvelope.agents) as RawRosterAgent[],
      };
    } catch (error) {
      return {
        location: locationFromTarget(
          target,
          'offline',
          null,
          error instanceof Error ? error.message : 'daemon did not answer',
        ),
        sessions: [] as RawSession[],
        roster: [] as RawRosterAgent[],
      };
    }
  }));

  const locations = snapshots.map((snapshot) => snapshot.location);
  const merged = new Map<string, LocatedSession>();
  const sessionLocations = new Map<string, SessionDirectoryLocation[]>();
  for (const snapshot of snapshots) {
    const rosterById = new Map(snapshot.roster.map((agent) => [text(agent.id), agent]));
    for (const raw of snapshot.sessions) {
      const agent = rosterById.get(text(raw.agentId));
      const normalized = normalizeSession(
        raw,
        agent ? providerFor(agent) : unknownProvider(),
        optionalText(agent?.liveness) ?? (text(raw.status) === 'active' ? 'unknown' : 'historical'),
      );
      if (!normalized) continue;
      const located = { session: normalized, location: snapshot.location };
      const prior = merged.get(normalized.id);
      merged.set(normalized.id, prior ? preferSession(prior, located) : located);
      const entries = sessionLocations.get(normalized.id) ?? [];
      entries.push(snapshot.location);
      sessionLocations.set(normalized.id, entries);
    }
  }

  const sessions = [...merged.values()]
    .map(({ session, location: primaryLocation }) => {
      const entries = (sessionLocations.get(session.id) ?? []).sort((left, right) => {
        if (left.id === primaryLocation.id) return -1;
        if (right.id === primaryLocation.id) return 1;
        if (left.current !== right.current) return left.current ? -1 : 1;
        if (left.state !== right.state) return left.state === 'online' ? -1 : 1;
        return Number(right.canonical) - Number(left.canonical);
      });
      return {
        ...session,
        locations: entries,
        primaryLocationId: primaryLocation.id,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));

  return {
    schema: 'pd.operator.session-directory.v0',
    generatedAt: Date.now(),
    sessions,
    locations,
    summary: {
      sessions: sessions.length,
      active: sessions.filter((session) => session.status === 'active').length,
      onlineLocations: locations.filter((location) => location.state !== 'offline').length,
      offlineLocations: locations.filter((location) => location.state === 'offline').length,
      unknownProviders: sessions.filter((session) => session.provider.confidence === 'unknown').length,
    },
  };
}
