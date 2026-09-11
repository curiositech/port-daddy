/** Filesystem-only Off admission. Importing this module performs no I/O. */
import { accessSync, constants, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

export interface LocalRuntimeControlOptions {
  /** Fixture injection only; production always uses the OS account home. */
  canonicalRoot?: string;
  selectedRoot?: string;
  haltFile?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LocalRuntimeControlState {
  enabled: boolean;
  reason: 'enabled' | 'stop_marker' | 'control_unavailable';
  path?: string;
}

/**
 * Inspect a stop path without following symlinks or reading its contents.
 * The design treats unreadable parents as unknown, never as marker absence.
 * @param path Absolute marker path.
 * @returns Whether absence was proved, a marker exists, or inspection failed.
 */
export function inspectLocalStopPath(path: string): 'absent' | 'present' | 'unknown' {
  if (!isAbsolute(path)) return 'unknown';
  try {
    const parent = lstatSync(dirname(path));
    if (!parent.isDirectory() || parent.isSymbolicLink()) return 'unknown';
    accessSync(dirname(path), constants.R_OK | constants.X_OK);
    try {
      lstatSync(path);
      return 'present'; // Includes a dangling symlink or any unusual file type.
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unknown';
    }
  } catch {
    return 'unknown';
  }
}

/**
 * Read canonical and selected Off controls before local runtime work. The
 * selected root and custom sentinel may add denials, never override canonical
 * HALT/hooks.disabled. No directory, credential, daemon or network is opened.
 * @param options Explicit filesystem fixtures or the production environment.
 * @returns Enabled only after all applicable marker absences were observed.
 */
export function readLocalRuntimeControl(options: LocalRuntimeControlOptions = {}): LocalRuntimeControlState {
  const env = options.env ?? process.env;
  const canonical = options.canonicalRoot ?? join(homedir(), '.port-daddy');
  const selected = options.selectedRoot ?? env.PD_HOME ?? canonical;
  const checkedSentinels = new Set([join(canonical, 'HALT'), join(selected, 'HALT')]);
  for (const root of new Set([canonical, selected])) {
    if (!isAbsolute(root)) return { enabled: false, reason: 'control_unavailable', path: root };
    try {
      const stat = lstatSync(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return { enabled: false, reason: 'control_unavailable', path: root };
      }
      accessSync(root, constants.R_OK | constants.X_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || inspectLocalStopPath(root) !== 'absent') {
        return { enabled: false, reason: 'control_unavailable', path: root };
      }
      continue; // A genuinely absent root cannot contain a stop marker.
    }
    for (const name of ['HALT', 'hooks.disabled']) {
      const path = join(root, name);
      const state = inspectLocalStopPath(path);
      if (state !== 'absent') {
        return { enabled: false, reason: state === 'present' ? 'stop_marker' : 'control_unavailable', path };
      }
    }
  }
  const extra = options.haltFile ?? env.PD_HALT_FILE;
  if (extra !== undefined && !checkedSentinels.has(extra)) {
    const state = inspectLocalStopPath(extra);
    if (state !== 'absent') {
      return { enabled: false, reason: state === 'present' ? 'stop_marker' : 'control_unavailable', path: extra };
    }
  }
  return { enabled: true, reason: 'enabled' };
}

/**
 * Preserve Off for the lifetime of one worker. File removal is not ALL-CLEAR.
 * @param read Injectable inert observation, defaulting to canonical controls.
 * @returns A fail-closed, monotonically denying admission predicate.
 */
export function createLocalRuntimeGate(read: () => boolean = () => readLocalRuntimeControl().enabled): () => boolean {
  let denied = false;
  return () => {
    if (!denied) {
      try { denied = read() !== true; } catch { denied = true; }
    }
    return !denied;
  };
}

/**
 * Reject runtime entry before importing effectful dependencies. This guard is
 * intentionally filesystem-only and never attempts repair or automatic resume.
 * @returns Nothing when enabled; throws a precise Off refusal otherwise.
 */
export function assertLocalRuntimeEnabled(): void {
  const state = readLocalRuntimeControl();
  if (!state.enabled) throw new Error('Port Daddy is Off or its local control state is unavailable. No runtime was started. Only the operator may turn it back on.');
}
