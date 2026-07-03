/**
 * lib/safe/perms-audit.ts — A3, the crown-jewel permission audit (ADR-0088
 * Phase A).
 *
 * For each crown-jewel path: `stat` the mode and flag world/group-readable
 * secrets (`~/.ssh`, `~/.aws`, `~/.gnupg`, and the explicit secret files), and
 * call `coastGuardStatus()` (lib/coast-guard.ts) to report whether the deny-list
 * is actually in force on this machine.
 *
 * READ-ONLY. No file CONTENT is read — only `stat` metadata (mode/owner). The
 * opt-in, reversible `chmod` is A9's `pd safe fix --auto`; this module only
 * MEASURES and records the prior mode (`recommendedMode` + the current `mode`)
 * so that fix can be rolled back. Two facts both matter and are reported
 * together: a path can be `0600` and still readable by a same-UID agent if the
 * Coast Guard is off.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultCrownJewels, coastGuardStatus } from '../coast-guard.js';
import type {
  PermFinding,
  PermSeverity,
  PermsAuditResult,
} from './types.js';

/** Injectable deps so the audit is pure + testable (no real fs in unit tests). */
export interface PermsAuditDeps {
  /** stat → { mode, isDir } or null when the path does not exist / errors. */
  stat?: (path: string) => { mode: number; isDir: boolean } | null;
  /** Coast Guard status reader (defaults to the real coastGuardStatus). */
  coastGuard?: (home: string) => {
    onByDefault: boolean;
    confinementAvailable: boolean;
    mechanism: string;
  };
}

/** A secret path to audit, with the mode `fix --auto` would tighten it to. */
interface JewelTarget {
  path: string;
  isDirTarget: boolean;
  /** The mode `fix --auto` should set when this path is loose/exposed. */
  recommendedMode: string;
}

/**
 * Build the list of secret paths to audit: the crown-jewel directories (each
 * should be `0700`) plus the explicit secret FILES inside them (each `0600`).
 * Seeded from `defaultCrownJewels()`, then extended with the well-known key/cred
 * files the scanner also reads.
 */
export function jewelTargets(home: string): JewelTarget[] {
  const jewels = defaultCrownJewels(home);
  const targets: JewelTarget[] = [];
  const seen = new Set<string>();
  const add = (path: string, isDirTarget: boolean, recommendedMode: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    targets.push({ path, isDirTarget, recommendedMode });
  };

  // Crown-jewel dirs: should be 0700 (owner-only). `.docker/config.json` and
  // `.netrc`/`.npmrc` in the jewel list are files, not dirs — split them out.
  for (const p of jewels.deniedDirs) {
    const base = p.split('/').pop() ?? '';
    const looksFile =
      base.endsWith('.json') || base === '.netrc' || base === '.npmrc' ||
      base === '.port-daddy-env';
    if (looksFile) add(p, false, '0600');
    else add(p, true, '0700');
  }

  // Explicit secret FILES (each should be 0600 — owner read/write only).
  const files = [
    join(home, '.ssh', 'id_rsa'),
    join(home, '.ssh', 'id_ed25519'),
    join(home, '.ssh', 'id_ecdsa'),
    join(home, '.ssh', 'id_dsa'),
    join(home, '.aws', 'credentials'),
    join(home, '.config', 'gh', 'hosts.yml'),
    join(home, '.netrc'),
    join(home, '.npmrc'),
    join(home, '.pip', 'pip.conf'),
    join(home, '.docker', 'config.json'),
    join(home, '.claude', '.credentials.json'),
    join(home, '.port-daddy-env'),
  ];
  for (const f of files) add(f, false, '0600');

  return targets;
}

/** Real-fs stat adapter: mode bits + isDir, null on any error. */
function realStat(path: string): { mode: number; isDir: boolean } | null {
  try {
    const s = statSync(path);
    return { mode: s.mode & 0o777, isDir: s.isDirectory() };
  } catch {
    return null;
  }
}

/** Octal string (e.g. `0600`) for a permission-bits number. */
export function octal(mode: number): string {
  return '0' + (mode & 0o777).toString(8).padStart(3, '0');
}

/**
 * Classify a single path's mode into a finding. Pure over (target, statResult).
 * A secret path is `exposed` when group/world can READ it, `loose` when
 * group/world have write/exec but not read, `ok` otherwise.
 */
export function classifyMode(
  target: JewelTarget,
  stat: { mode: number; isDir: boolean } | null,
): PermFinding {
  if (!stat) {
    return {
      path: target.path,
      exists: false,
      isDir: target.isDirTarget,
      mode: '',
      groupReadable: false,
      worldReadable: false,
      groupOrWorldWritable: false,
      severity: 'ok',
      recommendedMode: null,
    };
  }
  const m = stat.mode & 0o777;
  const groupReadable = (m & 0o040) !== 0;
  const worldReadable = (m & 0o004) !== 0;
  // group/world write or exec bits.
  const groupOrWorldWritable = (m & 0o033) !== 0;

  let severity: PermSeverity = 'ok';
  if (groupReadable || worldReadable) severity = 'exposed';
  else if (groupOrWorldWritable) severity = 'loose';

  return {
    path: target.path,
    exists: true,
    isDir: stat.isDir,
    mode: octal(m),
    groupReadable,
    worldReadable,
    groupOrWorldWritable,
    severity,
    recommendedMode: severity === 'ok' ? null : target.recommendedMode,
  };
}

/**
 * Audit crown-jewel permissions + report the Coast Guard posture. Read-only.
 * Injectable `stat` / `coastGuard` for tests; defaults to the real fs +
 * `coastGuardStatus()`.
 */
export function auditPerms(
  home: string = process.env.HOME ?? '',
  deps: PermsAuditDeps = {},
): PermsAuditResult {
  const stat = deps.stat ?? realStat;
  const cgRead =
    deps.coastGuard ??
    ((h: string) => {
      const r = coastGuardStatus(h);
      return {
        onByDefault: r.onByDefault,
        confinementAvailable: r.confinementAvailable,
        mechanism: String(r.mechanism),
      };
    });

  const findings: PermFinding[] = [];
  for (const target of jewelTargets(home)) {
    findings.push(classifyMode(target, stat(target.path)));
  }

  const cg = cgRead(home);
  return {
    findings,
    coastGuard: {
      onByDefault: cg.onByDefault,
      confinementAvailable: cg.confinementAvailable,
      mechanism: cg.mechanism,
    },
  };
}
