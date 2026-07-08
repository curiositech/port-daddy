/**
 * EventKit bridge — compiles and drives tools/pd-calendar-helper.swift so
 * the fleet calendar trigger/output can read and write the operator's
 * macOS calendars without Calendar.app running.
 *
 * Lifecycle: the helper binary lives at ~/.port-daddy/bin/pd-calendar-helper
 * and is (re)compiled with `swiftc -framework EventKit` whenever it is
 * missing or older than the shipped source. No Xcode project — one file,
 * one binary. Machines without the Swift toolchain report an honest
 * {available:false} instead of failing at fire time.
 *
 * TCC: `status` never prompts. The explicit `requestAccess()` runs the OS
 * consent dialog once; until the operator grants, the channel reports
 * {authorized:false} and the trigger/sink refuse to start (fail-closed,
 * never a silent hang).
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HELPER_BIN = join(homedir(), '.port-daddy', 'bin', 'pd-calendar-helper');

function helperSourcePath(): string {
  // tools/pd-calendar-helper.swift relative to the repo root (this file
  // lives at lib/fleet/, compiled or tsx-run alike).
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'tools', 'pd-calendar-helper.swift');
}

export interface EventKitStatus {
  /** Toolchain + binary present. */
  available: boolean;
  /** Operator has granted calendar access (TCC). */
  authorized: boolean;
  reason?: string;
}

export interface EventKitEvent {
  /** Instance-unique: eventIdentifier + "/" + startUTC. */
  id: string;
  seriesId: string;
  title: string;
  /** ISO-8601 UTC. */
  start: string;
  /** ISO-8601 UTC. */
  end: string;
  allDay: boolean;
  calendar: string;
  recurring: boolean;
  location?: string;
  /** Organizer address — used ONLY for trust-gate sender matching. */
  organizer?: string;
  conferenceUrl?: string;
}

export class EventKitClient {
  constructor(
    private readonly binPath: string = HELPER_BIN,
    private readonly sourcePath: string = helperSourcePath(),
  ) {}

  /** Compile the helper when missing or stale. Returns a reason on failure. */
  async ensureHelper(): Promise<{ ok: boolean; reason?: string }> {
    if (process.platform !== 'darwin') {
      return { ok: false, reason: 'EventKit backend is macOS-only' };
    }
    if (!existsSync(this.sourcePath)) {
      return { ok: false, reason: `helper source missing: ${this.sourcePath}` };
    }
    const fresh =
      existsSync(this.binPath) &&
      statSync(this.binPath).mtimeMs >= statSync(this.sourcePath).mtimeMs;
    if (fresh) return { ok: true };
    try {
      mkdirSync(dirname(this.binPath), { recursive: true });
      await execFileAsync('swiftc', ['-O', '-framework', 'EventKit', '-o', this.binPath, this.sourcePath], {
        timeout: 120_000,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: message.includes('ENOENT')
          ? 'swiftc not found — install Xcode Command Line Tools (xcode-select --install)'
          : `helper compile failed: ${message.slice(0, 300)}`,
      };
    }
  }

  private async run(args: string[], timeoutMs = 30_000): Promise<string> {
    const { stdout } = await execFileAsync(this.binPath, args, { timeout: timeoutMs });
    return stdout.trim();
  }

  async status(): Promise<EventKitStatus> {
    const ensured = await this.ensureHelper();
    if (!ensured.ok) return { available: false, authorized: false, reason: ensured.reason };
    try {
      const out = JSON.parse(await this.run(['status'])) as { authorized: boolean; state: string };
      return {
        available: true,
        authorized: out.authorized,
        reason: out.authorized ? undefined : `calendar access ${out.state} — run: pd fleet calendar grant`,
      };
    } catch (err) {
      return {
        available: false,
        authorized: false,
        reason: `helper status failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Runs the OS consent prompt (blocks until answered or 120s). */
  async requestAccess(): Promise<EventKitStatus> {
    const ensured = await this.ensureHelper();
    if (!ensured.ok) return { available: false, authorized: false, reason: ensured.reason };
    try {
      const out = JSON.parse(await this.run(['request-access'], 130_000)) as { authorized: boolean; state: string };
      return { available: true, authorized: out.authorized, reason: out.authorized ? undefined : `state: ${out.state}` };
    } catch (err) {
      return { available: true, authorized: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** List event INSTANCES (recurring already expanded) in [fromISO, toISO]. */
  async listEvents(fromISO: string, toISO: string, calendar?: string): Promise<EventKitEvent[]> {
    const args = ['list', fromISO, toISO];
    if (calendar) args.push(calendar);
    const out = await this.run(args);
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? (parsed as EventKitEvent[]) : [];
  }

  async createEvent(input: {
    title: string;
    start: string;
    end: string;
    calendar?: string;
    location?: string;
    notes?: string;
  }): Promise<{ id: string; calendar: string }> {
    const out = await this.run(['create', JSON.stringify(input)]);
    return JSON.parse(out) as { id: string; calendar: string };
  }
}

let shared: EventKitClient | null = null;
export function getSharedEventKitClient(): EventKitClient {
  if (!shared) shared = new EventKitClient();
  return shared;
}
export function setSharedEventKitClient(client: EventKitClient | null): void {
  shared = client;
}

/** Backend selection shared by the calendar trigger + output. */
export function chooseCalendarBackend(): 'macos-eventkit' | 'google' | 'none' {
  const env = (process.env.PD_CALENDAR_BACKEND ?? '').toLowerCase();
  if (env === 'macos') return 'macos-eventkit';
  if (env === 'google') return 'google';
  if (process.platform === 'darwin') return 'macos-eventkit';
  return 'none';
}
