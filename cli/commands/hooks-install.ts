/**
 * pd hooks install — Per-project, daemon-gated coordination hooks for agent CLIs
 *
 * Wires the Giant Squid Harness tentacles into the INTERACTIVE sessions of the
 * agent CLIs on this machine (Claude Code, Codex, Gemini, Antigravity/agy). The
 * hook SHAPES come from one shared source of truth — lib/squid/hook-shape.ts —
 * which the squid headless adapter uses too, so the interactive and headless
 * injectors can never drift.
 *
 * Two guarantees the user asked for:
 *   1. PER LOCAL REPOSITORY FAMILY. All four providers receive one dormant,
 *      user-level registration. Activation is a verified local common-dir/root
 *      authority, so existing and future linked worktrees inherit without
 *      per-worktree config; unrelated clones remain inert.
 *   2. INERT UNTIL PORT DADDY IS READY. Every hook command points at a gate
 *      wrapper, not the tentacle directly. The wrapper no-ops (allow / no
 *      context) unless (a) the pd daemon's ready lease matches its live PID,
 *      (b) its heartbeat is fresh, AND (c) the cwd is inside an explicitly
 *      armed pd project. Hooks therefore never pile onto a daemon that is down
 *      or still behind its database-integrity boot gate.
 *
 * Layout under ~/.port-daddy/bin/:
 *   squid/pd-hook-{prompt,pre-tool,post-tool}   <- the real tentacles (copied)
 *   pd-hook-{prompt,pre-tool,post-tool}         <- generated gate wrappers
 * Hook configs point at the gate wrappers.
 *
 * Usage:
 *   pd hooks install            # register four dormant adapters + arm this family
 *   pd hooks list               # detection + wiring status
 *   pd hooks uninstall          # global cleanup; refuses while another family is armed
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  lstatSync,
  statSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join, dirname, parse, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as ui from '../utils/ui.js';
import { PD_HOME } from '../../shared/paths.js';
import {
  TENTACLES,
  type TentacleName,
  type TentacleResolver,
  PD_HOOK_MARKER,
  CODEX_PD_MARKER,
  SQUID_HOOK_DEADLINE_MS,
  buildJsonHookMap,
  isPdEntry,
  codexHooksTomlBlock,
  upsertJsonHookMap,
  removeJsonHooks,
  stripCodexHooksTomlBlock,
} from '../../lib/squid/hook-shape.js';
import {
  SQUID_HOOK_BREAKER_COOLDOWN_MS,
  SQUID_HOOK_BREAKER_FAILURE_THRESHOLD,
  SQUID_HOOK_BREAKER_SLOW_MS,
  SQUID_HOOK_DEBUG_MAX_BYTES,
  SQUID_HOOK_DEBUG_TRIM_BYTES,
  resetSquidHookHealth,
} from '../../lib/squid/debug.js';
import { resolveSquidAsset } from '../../lib/squid/assets.js';
import {
  disarmSquidRepositoryFamily,
  assertAllSquidRepositoryFamiliesDisarmed,
  inspectSquidRepositoryFamily,
  isSquidRepositoryFamilyArmed,
  listVerifiedRepositoryFamilyWorktrees,
  SQUID_REPOSITORY_FAMILY_MARKER_FILENAME,
  SQUID_REPOSITORY_FAMILY_MAX_RECORD_BYTES,
  SQUID_REPOSITORY_FAMILY_RECORD_VERSION,
  transactSquidRepositoryFamilyArm,
  type PendingRepositoryFamilyArm,
  type PreparedRepositoryFamilyArm,
  type RepositoryFamilyFaultPoint,
} from '../../lib/squid/repository-family-authority.js';

const DEFAULT_HOME = process.env.HOME || process.env.USERPROFILE || '';
const SQUID_DAEMON_HEARTBEAT_STALE_SECONDS = 30;

/** ~/.port-daddy/bin — staged gate wrappers (what hook configs point at). */
export function tentacleBinDir(): string {
  return join(PD_HOME, 'bin');
}
/** ~/.port-daddy/bin/squid — the real tentacles the wrappers delegate to. */
function realTentacleDir(): string {
  return join(PD_HOME, 'bin', 'squid');
}
// ─── Gate wrapper (pd-ready + per-project) ───────────────────────────────────

interface GateWrapperOptions {
  /** Authority root resolved from the trusted wrapper staging destination. */
  pdHome: string;
  /** Fixed at staging; hook input/environment can never extend this budget. */
  authorityBudgetMs: number;
  /** Test-only stderr trace. Production wrappers make no pre-authority writes. */
  authorityTrace: boolean;
  /** One staged generation shared by every wrapper and committed manifest. */
  wrapperGeneration: string;
}

function repositoryFamilyGateShellLines(options: GateWrapperOptions): string[] {
  return [
    '# Repository-family authority runs before daemon/debug/input work. It is',
    '# direct, filesystem-only, bounded by fixed ascent/record limits, and never',
    '# invokes Git or scans the family registry.',
    'LC_ALL=C; export LC_ALL',
    `pd_authority_max_bytes=${SQUID_REPOSITORY_FAMILY_MAX_RECORD_BYTES}`,
    `pd_authority_budget_ms=${options.authorityBudgetMs}`,
    `pd_authority_trace=${options.authorityTrace ? 1 : 0}`,
    'pd_authority_now_ms() {',
    '  if [ -x /usr/bin/perl ]; then /usr/bin/perl -MTime::HiRes=time -e \'printf "%.0f", time * 1000\';',
    '  else printf "%s000" "$(date +%s)"; fi',
    '}',
    'pd_authority_started_ms=$(pd_authority_now_ms 2>/dev/null || printf 0)',
    'pd_authority_receipt() {',
    '  case "$1" in allow|boundary|verifier|marker|deny) ;; *) set -- boundary ;; esac',
    '  pd_authority_finished_ms=$(pd_authority_now_ms 2>/dev/null || printf 0)',
    '  pd_authority_duration_ms=$((pd_authority_finished_ms - pd_authority_started_ms))',
    '  [ "$pd_authority_duration_ms" -ge 0 ] 2>/dev/null || pd_authority_duration_ms=0',
    '  [ "$pd_authority_trace" -eq 1 ] || return 0',
    `  printf "${SQUID_REPOSITORY_FAMILY_RECORD_VERSION}\\t%s\\t%s\\n" "$1" "$pd_authority_duration_ms" >&2`,
    '}',
    'pd_authority_deny() { pd_authority_receipt "$1"; exit 0; }',
    'pd_path_no_symlink() {',
    '  pd_path=$1; case "$pd_path" in /*) ;; *) return 1 ;; esac',
    '  pd_path_steps=0',
    '  while [ "$pd_path" != / ]; do',
    '    [ ! -L "$pd_path" ] || return 1',
    '    pd_path=${pd_path%/*}; [ -n "$pd_path" ] || pd_path=/',
    '    pd_path_steps=$((pd_path_steps + 1)); [ "$pd_path_steps" -le 80 ] || return 1',
    '  done',
    '}',
    'pd_stat_devino() {',
    '  pd_stat_value=$(stat -f "%d %i" "$1" 2>/dev/null || true)',
    '  case "$pd_stat_value" in ""|*[!0-9\\ ]*) pd_stat_value=$(stat -c "%d %i" "$1" 2>/dev/null || true) ;; esac',
    '  case "$pd_stat_value" in ""|*[!0-9\\ ]*) return 1 ;; esac',
    '  set -- $pd_stat_value; [ "$#" -eq 2 ] || return 1',
    '  [ "$1" -gt 0 ] 2>/dev/null && [ "$2" -gt 0 ] 2>/dev/null || return 1',
    '  pd_stat_device=$1; pd_stat_inode=$2',
    '}',
    'pd_uid=$(id -u 2>/dev/null || true)',
    'case "$pd_uid" in ""|*[!0-9]*) pd_authority_deny boundary ;; esac',
    'pd_secure_directory() {',
    '  [ -d "$1" ] && [ ! -L "$1" ] && pd_path_no_symlink "$1" || return 1',
    '  pd_dir_shape=$(stat -f "%Lp %u" "$1" 2>/dev/null || true)',
    '  case "$pd_dir_shape" in ""|*[!0-9\\ ]*) pd_dir_shape=$(stat -c "%a %u" "$1" 2>/dev/null || true) ;; esac',
    '  set -- $pd_dir_shape; [ "$#" -eq 2 ] || return 1',
    '  [ "$1" = 700 ] && [ "$2" = "$pd_uid" ]',
    '}',
    'pd_owned_directory() {',
    '  [ -d "$1" ] && [ ! -L "$1" ] && pd_path_no_symlink "$1" || return 1',
    '  pd_dir_owner=$(stat -f "%u" "$1" 2>/dev/null || true)',
    '  case "$pd_dir_owner" in ""|*[!0-9]*) pd_dir_owner=$(stat -c "%u" "$1" 2>/dev/null || true) ;; esac',
    '  [ "$pd_dir_owner" = "$pd_uid" ]',
    '}',
    'pd_read_record() {',
    '  pd_record_path=$1; pd_record_mode=$2',
    '  [ -f "$pd_record_path" ] && [ ! -L "$pd_record_path" ] && pd_path_no_symlink "$pd_record_path" || return 1',
    '  pd_file_shape=$(stat -f "%Lp %l %u" "$pd_record_path" 2>/dev/null || true)',
    '  case "$pd_file_shape" in ""|*[!0-9\\ ]*) pd_file_shape=$(stat -c "%a %h %u" "$pd_record_path" 2>/dev/null || true) ;; esac',
    '  set -- $pd_file_shape; [ "$#" -eq 3 ] || return 1',
    '  if [ "$pd_record_mode" = secure ]; then [ "$1" = 600 ] || return 1; fi',
    '  [ "$2" = 1 ] && [ "$3" = "$pd_uid" ] || return 1',
    '  pd_record_bytes=$(wc -c < "$pd_record_path" 2>/dev/null | tr -d "[:space:]" || true)',
    '  case "$pd_record_bytes" in ""|*[!0-9]*) return 1 ;; esac',
    '  [ "$pd_record_bytes" -gt 0 ] && [ "$pd_record_bytes" -le "$pd_authority_max_bytes" ] || return 1',
    '  pd_record_lines=$(wc -l < "$pd_record_path" 2>/dev/null | tr -d "[:space:]" || true)',
    '  [ "$pd_record_lines" = 1 ] || return 1',
    '  IFS= read -r pd_record_line < "$pd_record_path" || return 1',
    '  [ $(( ${#pd_record_line} + 1 )) -eq "$pd_record_bytes" ] 2>/dev/null || return 1',
    '}',
    'pd_tab=$(printf "\\t")',
    'pd_field_count() {',
    '  pd_fields_line=$1; pd_fields=1; pd_fields_steps=0',
    '  while :; do',
    '    case "$pd_fields_line" in *"$pd_tab"*) pd_fields_line=${pd_fields_line#*"$pd_tab"}; pd_fields=$((pd_fields + 1)) ;; *) break ;; esac',
    '    pd_fields_steps=$((pd_fields_steps + 1)); [ "$pd_fields_steps" -le 8 ] || return 1',
    '  done',
    '  [ "$pd_fields" -eq "$2" ]',
    '}',
    'pd_valid_uuid() {',
    '  [ "${#1}" -eq 36 ] || return 1',
    '  case "$1" in ????????-????-4???-[89ab]???-????????????) ;; *) return 1 ;; esac',
    '  case "$1" in *[!0-9a-f-]*) return 1 ;; esac',
    '}',
    `pd_wrapper_generation=${shellQuote(options.wrapperGeneration)}`,
    'pd_generation_manifest="$PD_HOME/squid/hook-wrapper-generation.v1"',
    'pd_read_record "$pd_generation_manifest" secure || pd_authority_deny verifier',
    'pd_field_count "$pd_record_line" 2 || pd_authority_deny verifier',
    'IFS="$pd_tab" read -r pd_generation_version pd_generation_value < "$pd_generation_manifest" || pd_authority_deny verifier',
    `  [ "$pd_generation_version" = ${SQUID_REPOSITORY_FAMILY_RECORD_VERSION} ] || pd_authority_deny verifier`,
    '  [ "$pd_generation_value" = "$pd_wrapper_generation" ] || pd_authority_deny verifier',
    'pd_cwd=$(pwd -P 2>/dev/null || true)',
    '[ -n "$pd_cwd" ] || pd_authority_deny boundary',
    'pd_boundary=; pd_project_root=; pd_authority_root=; pd_kind=; pd_device=; pd_inode=; pd_worktree_device=; pd_worktree_inode=',
    'pd_d=$pd_cwd; pd_ascent=0',
    'while [ "$pd_ascent" -le 64 ]; do',
    '  pd_git="$pd_d/.git"',
    '  if [ -e "$pd_git" ] || [ -L "$pd_git" ]; then',
    '    [ ! -L "$pd_git" ] || pd_authority_deny boundary',
    '    pd_project_root=$pd_d; pd_kind=git',
    '    pd_stat_devino "$pd_project_root" || pd_authority_deny boundary',
    '    pd_worktree_device=$pd_stat_device; pd_worktree_inode=$pd_stat_inode',
    '    if [ -d "$pd_git" ]; then',
    '      pd_owned_directory "$pd_git" || pd_authority_deny boundary',
    '      pd_authority_root=$(cd "$pd_git" 2>/dev/null && pwd -P) || pd_authority_deny boundary',
    '    elif [ -f "$pd_git" ]; then',
    '      pd_read_record "$pd_git" metadata || pd_authority_deny boundary',
    '      case "$pd_record_line" in "gitdir: "/*) pd_admin_candidate=${pd_record_line#gitdir: } ;; *) pd_authority_deny boundary ;; esac',
    '      pd_path_no_symlink "$pd_admin_candidate" || pd_authority_deny boundary',
    '      pd_admin=$(cd "$pd_admin_candidate" 2>/dev/null && pwd -P) || pd_authority_deny boundary',
    '      pd_owned_directory "$pd_admin" || pd_authority_deny boundary',
    '      pd_read_record "$pd_admin/commondir" metadata || pd_authority_deny boundary',
    '      [ "$pd_record_line" = "../.." ] || pd_authority_deny boundary',
    '      pd_worktrees_candidate=${pd_admin%/*}',
    '      pd_common_candidate=${pd_worktrees_candidate%/*}',
    '      pd_path_no_symlink "$pd_common_candidate" || pd_authority_deny boundary',
    '      pd_authority_root=$(cd "$pd_common_candidate" 2>/dev/null && pwd -P) || pd_authority_deny boundary',
    '      pd_owned_directory "$pd_authority_root" || pd_authority_deny boundary',
    '      [ "${pd_admin%/*}" = "$pd_authority_root/worktrees" ] || pd_authority_deny boundary',
    '      pd_read_record "$pd_admin/gitdir" metadata || pd_authority_deny boundary',
    '      [ "$pd_record_line" = "$pd_project_root/.git" ] || pd_authority_deny boundary',
    '      pd_stat_devino "$pd_admin" || pd_authority_deny boundary',
    '      pd_worktree_device=$pd_stat_device; pd_worktree_inode=$pd_stat_inode',
    '    else pd_authority_deny boundary; fi',
    '    pd_stat_devino "$pd_authority_root" || pd_authority_deny boundary',
    '    pd_device=$pd_stat_device; pd_inode=$pd_stat_inode; pd_boundary=1; break',
    '  fi',
    '  pd_marker_dir="$pd_d/.portdaddy"',
    '  if [ -e "$pd_marker_dir" ] || [ -L "$pd_marker_dir" ]; then',
    '    pd_owned_directory "$pd_marker_dir" || pd_authority_deny boundary',
    '    pd_owned_directory "$pd_d" || pd_authority_deny boundary',
    '    pd_project_root=$pd_d; pd_authority_root=$pd_d; pd_kind=root',
    '    pd_stat_devino "$pd_d" || pd_authority_deny boundary',
    '    pd_device=$pd_stat_device; pd_inode=$pd_stat_inode; pd_worktree_device=$pd_device; pd_worktree_inode=$pd_inode',
    '    pd_boundary=1; break',
    '  fi',
    '  [ "$pd_d" != / ] || break',
    '  pd_d=${pd_d%/*}; [ -n "$pd_d" ] || pd_d=/',
    '  pd_ascent=$((pd_ascent + 1))',
    'done',
    '[ "$pd_boundary" = 1 ] || pd_authority_deny boundary',
    'pd_authority_lookup="$pd_kind-$pd_device-$pd_inode"',
    'pd_registry="$PD_HOME/squid/repository-families"',
    'pd_secure_directory "$pd_registry" || pd_authority_deny verifier',
    'pd_verifier="$pd_registry/$pd_authority_lookup.v1"',
    'pd_read_record "$pd_verifier" secure || pd_authority_deny verifier',
    'pd_field_count "$pd_record_line" 6 || pd_authority_deny verifier',
    'IFS="$pd_tab" read -r pd_v pd_record_kind pd_record_lookup pd_local_repository_id pd_record_device pd_record_inode < "$pd_verifier" || pd_authority_deny verifier',
    `  [ "$pd_v" = ${SQUID_REPOSITORY_FAMILY_RECORD_VERSION} ] || pd_authority_deny verifier`,
    '  [ "$pd_record_kind" = "$pd_kind" ] && [ "$pd_record_lookup" = "$pd_authority_lookup" ] || pd_authority_deny verifier',
    '  [ "$pd_record_device" = "$pd_device" ] && [ "$pd_record_inode" = "$pd_inode" ] || pd_authority_deny verifier',
    '  pd_valid_uuid "$pd_local_repository_id" || pd_authority_deny verifier',
    'pd_denies="$pd_registry/denies"; pd_deny_family="$pd_denies/$pd_authority_lookup"',
    'if [ -e "$pd_denies" ] || [ -L "$pd_denies" ]; then pd_secure_directory "$pd_denies" || pd_authority_deny deny; fi',
    'if [ -e "$pd_deny_family" ] || [ -L "$pd_deny_family" ]; then pd_secure_directory "$pd_deny_family" || pd_authority_deny deny; fi',
    'pd_worktree_deny="$pd_deny_family/$pd_worktree_device-$pd_worktree_inode.v1"',
    'if [ -e "$pd_worktree_deny" ] || [ -L "$pd_worktree_deny" ]; then',
    '  pd_read_record "$pd_worktree_deny" secure || pd_authority_deny deny',
    '  pd_field_count "$pd_record_line" 6 || pd_authority_deny deny',
    '  IFS="$pd_tab" read -r pd_dv pd_dtype pd_dlookup pd_did pd_ddev pd_dino < "$pd_worktree_deny" || pd_authority_deny deny',
    `  [ "$pd_dv" = ${SQUID_REPOSITORY_FAMILY_RECORD_VERSION} ] && [ "$pd_dtype" = deny ] || pd_authority_deny deny`,
    '  [ "$pd_dlookup" = "$pd_authority_lookup" ] && [ "$pd_did" = "$pd_local_repository_id" ] || pd_authority_deny deny',
    '  [ "$pd_ddev" = "$pd_worktree_device" ] && [ "$pd_dino" = "$pd_worktree_inode" ] || pd_authority_deny deny',
    '  pd_authority_deny deny',
    'fi',
    `if [ "$pd_kind" = git ]; then pd_marker="$pd_authority_root/port-daddy/${SQUID_REPOSITORY_FAMILY_MARKER_FILENAME}"; else pd_marker="$pd_authority_root/.portdaddy/${SQUID_REPOSITORY_FAMILY_MARKER_FILENAME}"; fi`,
    'pd_marker_parent=${pd_marker%/*}',
    'pd_owned_directory "$pd_marker_parent" || pd_authority_deny marker',
    'pd_read_record "$pd_marker" secure || pd_authority_deny marker',
    'pd_field_count "$pd_record_line" 3 || pd_authority_deny marker',
    'IFS="$pd_tab" read -r pd_mv pd_mlookup pd_mid < "$pd_marker" || pd_authority_deny marker',
    `  [ "$pd_mv" = ${SQUID_REPOSITORY_FAMILY_RECORD_VERSION} ] || pd_authority_deny marker`,
    '  [ "$pd_mlookup" = "$pd_authority_lookup" ] && [ "$pd_mid" = "$pd_local_repository_id" ] || pd_authority_deny marker',
    'pd_authority_finished_ms=$(pd_authority_now_ms 2>/dev/null || printf 0)',
    'pd_authority_duration_ms=$((pd_authority_finished_ms - pd_authority_started_ms))',
    'case "$pd_authority_duration_ms" in ""|*[!0-9]*) pd_authority_deny boundary ;; esac',
    '[ "$pd_authority_duration_ms" -le "$pd_authority_budget_ms" ] 2>/dev/null || pd_authority_deny boundary',
    '',
  ];
}

/**
 * The shell gate. It runs on every tool call, so it is filesystem-only and
 * spawns no `pd` process. It allows/no-ops (exit 0) unless the ready generation
 * matches the daemon PID, the heartbeat is fresh, and the cwd is inside an
 * explicitly armed pd project, then execs the real tentacle with stdin/argv
 * intact.
 *
 * Do not use `kill -0` or `ps` here. Codex's macOS Seatbelt profile denies both
 * against the Homebrew daemon even though it is owned by the same user, which
 * made every Codex hook silently fail open. The Bosun heartbeat is specifically
 * designed as the filesystem-only liveness contract for sandboxed observers.
 */
function gateWrapperScript(options: GateWrapperOptions): string {
  return [
    '#!/bin/sh',
    '# Authority must not inherit a repository-controlled command search path.',
    'PATH=/usr/bin:/bin:/usr/sbin:/sbin; export PATH',
    'unset ENV BASH_ENV CDPATH GLOBIGNORE',
    '# Port Daddy hook gate — GENERATED by `pd hooks install`. Do not edit.',
    '# Makes coordination hooks per-project and inert until the daemon is ready.',
    `PD_HOME=${shellQuote(options.pdHome)}; export PD_HOME`,
    '# Operator emergency kill switch. It deliberately outranks debug capture,',
    '# stdin reads, project discovery, HALT listening, and daemon probes.',
    '[ -e "$PD_HOME/hooks.disabled" ] && exit 0',
    '',
    '# Opt-in, sanitized timing trace. The event format has no field for stdin,',
    '# argv, environment snapshots, prompt text, tool input/result, stdout, or stderr.',
    'pd_debug=0',
    'pd_debug_dir="$PD_HOME/squid"',
    'pd_debug_log="$pd_debug_dir/hook-events.log"',
    'pd_debug_lock="$pd_debug_dir/debug-write.lock"',
    'pd_hook="${0##*/}"',
    '# Interactive PostToolUse was retired. A running provider may retain its old',
    '# command until restart, so keep the stable shim as a zero-work tombstone.',
    '[ "$pd_hook" = "pd-hook-post-tool" ] && exit 0',
    'case "$pd_hook" in',
    '  pd-hook-prompt) pd_phase=turn ;;',
    '  pd-hook-pre-tool) pd_phase=edit ;;',
    '  pd-hook-post-tool) pd_phase=trace ;;',
    '  pd-hook-stop) pd_phase=close ;;',
    '  *) pd_phase=turn ;;',
    'esac',
    'pd_provider="${PD_HOOK_PROVIDER:-unknown}"',
    'case "$pd_provider" in claude|codex|gemini|agy) ;; *) pd_provider=unknown ;; esac',
    ...repositoryFamilyGateShellLines(options),
    `pd_deadline_ms="${'${PD_HOOK_DEADLINE_MS:-'}${SQUID_HOOK_DEADLINE_MS}}"`,
    `case "$pd_deadline_ms" in ""|*[!0-9]*) pd_deadline_ms=${SQUID_HOOK_DEADLINE_MS} ;; esac`,
    `pd_failure_threshold="${'${PD_HOOK_FAILURE_THRESHOLD:-'}${SQUID_HOOK_BREAKER_FAILURE_THRESHOLD}}"`,
    `case "$pd_failure_threshold" in ""|*[!0-9]*) pd_failure_threshold=${SQUID_HOOK_BREAKER_FAILURE_THRESHOLD} ;; esac`,
    `pd_slow_ms="${'${PD_HOOK_SLOW_MS:-'}${SQUID_HOOK_BREAKER_SLOW_MS}}"`,
    `case "$pd_slow_ms" in ""|*[!0-9]*) pd_slow_ms=${SQUID_HOOK_BREAKER_SLOW_MS} ;; esac`,
    `pd_cooldown_ms="${'${PD_HOOK_BREAKER_COOLDOWN_MS:-'}${SQUID_HOOK_BREAKER_COOLDOWN_MS}}"`,
    `case "$pd_cooldown_ms" in ""|*[!0-9]*) pd_cooldown_ms=${SQUID_HOOK_BREAKER_COOLDOWN_MS} ;; esac`,
    `[ "$pd_failure_threshold" -gt 0 ] 2>/dev/null || pd_failure_threshold=${SQUID_HOOK_BREAKER_FAILURE_THRESHOLD}`,
    `[ "$pd_slow_ms" -gt 0 ] 2>/dev/null || pd_slow_ms=${SQUID_HOOK_BREAKER_SLOW_MS}`,
    `[ "$pd_cooldown_ms" -gt 0 ] 2>/dev/null || pd_cooldown_ms=${SQUID_HOOK_BREAKER_COOLDOWN_MS}`,
    '# Hard byte budget on the debug-mode session-id probe (review finding 1,',
    '# 2026-08-24): debug mode used to capture the ENTIRE hook stdin into a shell',
    '# variable just to label the sanitized timing event with a session id, then',
    '# piped that whole captured copy into the real tentacle — which itself',
    '# captures it AGAIN. That is multiple full unbounded in-memory copies of a',
    '# payload that can carry a huge final-assistant-message. Only a BOUNDED',
    '# prefix is ever captured now; the remainder streams straight through to the',
    '# real hook via `cat`, never buffered here. 256 KiB comfortably contains any',
    '# realistic session/thread id (vendors emit it near the top of the JSON',
    '# object) — a payload larger than that simply falls back to $PPID for the',
    '# debug label (same fallback already used when the id field is absent or',
    '# unparsable), never to a second unbounded capture.',
    `pd_debug_probe_bytes="${'${PD_HOOK_DEBUG_INPUT_BUDGET_BYTES:-'}262144}"`,
    'case "$pd_debug_probe_bytes" in ""|*[!0-9]*) pd_debug_probe_bytes=262144 ;; esac',
    '',
    'pd_debug_now_ms() {',
    '  if [ -x /usr/bin/perl ]; then',
    '    /usr/bin/perl -MTime::HiRes=time -e \'printf "%.0f", time * 1000\'',
    '  else',
    '    printf "%s000" "$(date +%s)"',
    '  fi',
    '}',
    'pd_epoch_ms() {',
    '  printf "%s000" "$(date +%s)"',
    '}',
    'pd_debug_lock_acquire() {',
    '  pd_attempt=0',
    '  while ! mkdir "$pd_debug_lock" 2>/dev/null; do',
    '    pd_attempt=$((pd_attempt + 1))',
    '    pd_lock_now=$(date +%s 2>/dev/null || printf 0)',
    '    pd_lock_modified=$(stat -f %m "$pd_debug_lock" 2>/dev/null || true)',
    '    case "$pd_lock_modified" in ""|*[!0-9]*) pd_lock_modified=$(stat -c %Y "$pd_debug_lock" 2>/dev/null || true) ;; esac',
    '    case "$pd_lock_now:$pd_lock_modified" in *[!0-9:]*) ;; *) [ $((pd_lock_now - pd_lock_modified)) -gt 5 ] 2>/dev/null && rmdir "$pd_debug_lock" 2>/dev/null ;; esac',
    '    [ "$pd_attempt" -lt 20 ] || return 1',
    '    sleep 0.01',
    '  done',
    '}',
    'pd_debug_append() {',
    '  [ "$pd_debug" -eq 1 ] || return 0',
    '  umask 077',
    '  mkdir -p "$pd_debug_dir" 2>/dev/null || return 0',
    '  pd_debug_lock_acquire || return 0',
    '  printf "v1\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$1" "$pd_run_id" "$pd_session_id" "$pd_provider" "$pd_phase" "$pd_hook" "$2" "$pd_deadline_ms" "$3" "$4" "$pd_workspace_b64" >> "$pd_debug_log" 2>/dev/null || true',
    '  pd_size=$(wc -c < "$pd_debug_log" 2>/dev/null | tr -d "[:space:]" || printf 0)',
    `  case "$pd_size" in ""|*[!0-9]*) ;; *) [ "$pd_size" -le ${SQUID_HOOK_DEBUG_MAX_BYTES} ] || tail -c ${SQUID_HOOK_DEBUG_TRIM_BYTES} "$pd_debug_log" 2>/dev/null | sed "1d" > "$pd_debug_log.trim" 2>/dev/null ;; esac`,
    '  [ -f "$pd_debug_log.trim" ] && chmod 600 "$pd_debug_log.trim" 2>/dev/null && mv "$pd_debug_log.trim" "$pd_debug_log" 2>/dev/null',
    '  rm -f "$pd_debug_log.trim" 2>/dev/null || true',
    '  rmdir "$pd_debug_lock" 2>/dev/null || true',
    '}',
    'pd_debug_finish() {',
    '  [ "$pd_debug" -eq 1 ] || return 0',
    '  pd_finished_ms=$(pd_debug_now_ms 2>/dev/null) || return 0',
    '  pd_debug_append finish "$pd_finished_ms" "$1" "$2"',
    '}',
    'pd_debug_skip() {',
    '  pd_debug_finish "$1" 0',
    '  exit 0',
    '}',
    '',
    '# Fail-open circuit breaker. The state format is intentionally tiny and',
    '# sanitized: lifecycle state and timing only, never hook input or output.',
    'pd_health_dir="$PD_HOME/squid/health"',
    'pd_state_file="$pd_health_dir/$pd_hook.state"',
    'pd_probe_dir="$pd_health_dir/$pd_hook.probe"',
    'pd_state_lock="$pd_health_dir/$pd_hook.state.lock"',
    'pd_failure_receipt_dir="$pd_health_dir/$pd_hook.failures"',
    'pd_notice_file="$pd_health_dir/remediation.notice"',
    'pd_breaker_state=closed',
    'pd_failure_count=0',
    'pd_opened_ms=0',
    'pd_retry_ms=0',
    'pd_last_reason=none',
    'pd_last_duration_ms=0',
    'pd_last_exit=-',
    'pd_updated_ms=0',
    'pd_is_probe=0',
    'pd_timer_missing=0',
    'pd_receipt_seen=0',
    'pd_receipt_count=0',
    'pd_time_bin="${PD_HOOK_TIME_BIN:-/usr/bin/time}"',
    'case "$pd_time_bin" in /*) ;; *) pd_time_bin=/usr/bin/time ;; esac',
    'pd_time_file="$pd_health_dir/$pd_hook.time.$$"',
    'pd_child_done_file="$pd_health_dir/$pd_hook.child-done.$$"',
    'pd_child_pid_file="$pd_health_dir/$pd_hook.child-pid.$$"',
    'pd_health_receipt_count() {',
    '  pd_receipt_count=0',
    '  for pd_receipt in "$pd_failure_receipt_dir"/*.failure; do',
    '    [ -d "$pd_receipt" ] || continue',
    '    pd_receipt_count=$((pd_receipt_count + 1))',
    '  done',
    '}',
    'pd_health_receipt_write() {',
    '  umask 077',
    '  mkdir -p "$pd_failure_receipt_dir" 2>/dev/null || return 1',
    '  mkdir "$pd_failure_receipt_dir/$pd_health_now-$$.failure" 2>/dev/null',
    '}',
    'pd_health_receipt_clear() {',
    '  for pd_receipt in "$pd_failure_receipt_dir"/*.failure; do',
    '    [ -d "$pd_receipt" ] || continue',
    '    rmdir "$pd_receipt" 2>/dev/null || true',
    '  done',
    '  rmdir "$pd_failure_receipt_dir" 2>/dev/null || true',
    '}',
    'pd_health_load_state() {',
    '  [ -f "$pd_state_file" ] || return 0',
    '  IFS="$(printf "\\t")" read -r pd_version pd_loaded_state pd_loaded_failures pd_loaded_opened pd_loaded_retry pd_loaded_reason pd_loaded_duration pd_loaded_exit pd_loaded_updated pd_loaded_receipt_seen < "$pd_state_file" 2>/dev/null || return 0',
    '  case "$pd_version" in v1) pd_loaded_receipt_seen=0 ;; v2) ;; *) return 0 ;; esac',
    '  case "$pd_loaded_state" in closed|open) ;; *) return 0 ;; esac',
    '  case "$pd_loaded_failures:$pd_loaded_opened:$pd_loaded_retry:$pd_loaded_duration:$pd_loaded_updated:$pd_loaded_receipt_seen" in *[!0-9:]*) return 0 ;; esac',
    '  case "$pd_loaded_reason" in ""|*[!a-z0-9_-]*) return 0 ;; esac',
    '  case "$pd_loaded_exit" in -|[0-9]|[0-9][0-9]|[0-9][0-9][0-9]) ;; *) return 0 ;; esac',
    '  pd_breaker_state=$pd_loaded_state',
    '  pd_failure_count=$pd_loaded_failures',
    '  pd_opened_ms=$pd_loaded_opened',
    '  pd_retry_ms=$pd_loaded_retry',
    '  pd_last_reason=$pd_loaded_reason',
    '  pd_last_duration_ms=$pd_loaded_duration',
    '  pd_last_exit=$pd_loaded_exit',
    '  pd_updated_ms=$pd_loaded_updated',
    '  pd_receipt_seen=$pd_loaded_receipt_seen',
    '}',
    'pd_health_load() {',
    '  pd_breaker_state=closed',
    '  pd_failure_count=0',
    '  pd_opened_ms=0',
    '  pd_retry_ms=0',
    '  pd_last_reason=none',
    '  pd_last_duration_ms=0',
    '  pd_last_exit=-',
    '  pd_updated_ms=0',
    '  pd_receipt_seen=0',
    '  pd_health_load_state',
    '  pd_health_receipt_count',
    '  if [ "$pd_receipt_count" -gt "$pd_receipt_seen" ] 2>/dev/null; then',
    '    pd_failure_count=$((pd_failure_count + pd_receipt_count - pd_receipt_seen))',
    '  fi',
    '}',
    'pd_health_write() {',
    '  umask 077',
    '  mkdir -p "$pd_health_dir" 2>/dev/null || return 1',
    '  pd_state_tmp="$pd_state_file.$$"',
    '  printf "v2\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$pd_receipt_count" > "$pd_state_tmp" 2>/dev/null || return 1',
    '  chmod 600 "$pd_state_tmp" 2>/dev/null || true',
    '  mv "$pd_state_tmp" "$pd_state_file" 2>/dev/null || { rm -f "$pd_state_tmp" 2>/dev/null || true; return 1; }',
    '}',
    'pd_health_state_lock_acquire() {',
    '  pd_lock_attempt=0',
    '  while ! mkdir "$pd_state_lock" 2>/dev/null; do',
    '    pd_lock_attempt=$((pd_lock_attempt + 1))',
    '    pd_state_lock_now=$(date +%s 2>/dev/null || printf 0)',
    '    pd_state_lock_modified=$(stat -f %m "$pd_state_lock" 2>/dev/null || true)',
    '    case "$pd_state_lock_modified" in ""|*[!0-9]*) pd_state_lock_modified=$(stat -c %Y "$pd_state_lock" 2>/dev/null || true) ;; esac',
    '    case "$pd_state_lock_now:$pd_state_lock_modified" in *[!0-9:]*) ;; *) [ $((pd_state_lock_now - pd_state_lock_modified)) -gt 5 ] 2>/dev/null && rmdir "$pd_state_lock" 2>/dev/null ;; esac',
    '    [ "$pd_lock_attempt" -lt 20 ] || return 1',
    '    sleep 0.01',
    '  done',
    '}',
    'pd_health_state_lock_release() {',
    '  rmdir "$pd_state_lock" 2>/dev/null || true',
    '}',
    'pd_health_notice_open() {',
    '  case "$pd_hook" in pd-hook-prompt) pd_hook_label="PD TURN" ;; pd-hook-pre-tool) pd_hook_label="PD EDIT" ;; pd-hook-stop) pd_hook_label="PD CLOSE" ;; *) pd_hook_label="PD TRACE" ;; esac',
    '  umask 077',
    '  mkdir -p "$pd_health_dir" 2>/dev/null || return 0',
    '  pd_notice_tmp="$pd_notice_file.$$"',
    '  printf "◆ PD SAFE MODE · %s disabled after %s consecutive failed or slow calls. Open FleetBar > Giant Squid > Repair.\\n" "$pd_hook_label" "$pd_failure_count" > "$pd_notice_tmp" 2>/dev/null || return 0',
    '  chmod 600 "$pd_notice_tmp" 2>/dev/null || true',
    '  mv "$pd_notice_tmp" "$pd_notice_file" 2>/dev/null || rm -f "$pd_notice_tmp" 2>/dev/null || true',
    '}',
    'pd_health_notice_emit() {',
    '  [ "$pd_hook" = pd-hook-prompt ] || return 0',
    '  [ -f "$pd_notice_file" ] || return 0',
    '  pd_notice_claim="$pd_notice_file.emit.$$"',
    '  mv "$pd_notice_file" "$pd_notice_claim" 2>/dev/null || return 0',
    '  cat "$pd_notice_claim" 2>/dev/null || true',
    '  rm -f "$pd_notice_claim" 2>/dev/null || true',
    '}',
    'pd_health_record_unhealthy() {',
    '  pd_reason=$1',
    '  pd_exit_value=$2',
    '  pd_duration_value=$3',
    '  pd_health_now=$(pd_epoch_ms 2>/dev/null) || pd_health_now=0',
    '  pd_receipt_recorded=0',
    '  pd_health_receipt_write && pd_receipt_recorded=1',
    '  pd_health_state_lock_acquire || return 0',
    '  pd_health_load',
    '  pd_was_open=$pd_breaker_state',
    '  [ "$pd_receipt_recorded" -eq 1 ] || pd_failure_count=$((pd_failure_count + 1))',
    '  if [ "$pd_is_probe" -eq 1 ] || [ "$pd_failure_count" -ge "$pd_failure_threshold" ]; then',
    '    pd_breaker_state=open',
    '    pd_opened_ms=$pd_health_now',
    '    pd_retry_ms=$((pd_health_now + pd_cooldown_ms))',
    '    if pd_health_write open "$pd_failure_count" "$pd_opened_ms" "$pd_retry_ms" "$pd_reason" "$pd_duration_value" "$pd_exit_value" "$pd_health_now"; then',
    '      rmdir "$pd_probe_dir" 2>/dev/null || true',
    '      [ "$pd_was_open" = open ] || pd_health_notice_open',
    '    fi',
    '  else',
    '    pd_health_write closed "$pd_failure_count" 0 0 "$pd_reason" "$pd_duration_value" "$pd_exit_value" "$pd_health_now"',
    '  fi',
    '  pd_health_state_lock_release',
    '}',
    'pd_health_record_healthy() {',
    '  if [ -f "$pd_state_file" ] || [ -d "$pd_probe_dir" ] || [ -d "$pd_failure_receipt_dir" ]; then',
    '    pd_health_state_lock_acquire || return 0',
    '    rm -f "$pd_state_file" 2>/dev/null || true',
    '    rmdir "$pd_probe_dir" 2>/dev/null || true',
    '    pd_health_receipt_clear',
    '    rm -f "$pd_notice_file" 2>/dev/null || true',
    '    pd_health_state_lock_release',
    '  fi',
    '}',
    'pd_health_probe_acquire() {',
    '  mkdir "$pd_probe_dir" 2>/dev/null && return 0',
    '  pd_probe_now=$(date +%s 2>/dev/null || printf 0)',
    '  pd_probe_modified=$(stat -f %m "$pd_probe_dir" 2>/dev/null || true)',
    '  case "$pd_probe_modified" in ""|*[!0-9]*) pd_probe_modified=$(stat -c %Y "$pd_probe_dir" 2>/dev/null || true) ;; esac',
    '  case "$pd_probe_now:$pd_probe_modified" in *[!0-9:]*) return 1 ;; esac',
    '  [ $((pd_probe_now - pd_probe_modified)) -gt 5 ] 2>/dev/null || return 1',
    '  rmdir "$pd_probe_dir" 2>/dev/null || return 1',
    '  mkdir "$pd_probe_dir" 2>/dev/null',
    '}',
    'pd_health_duration_read() {',
    '  pd_duration_ms=0',
    '  pd_elapsed=',
    '  while IFS=" " read -r pd_time_kind pd_time_value; do',
    '    if [ "$pd_time_kind" = real ]; then pd_elapsed=$pd_time_value; break; fi',
    '  done < "$pd_time_file" 2>/dev/null || true',
    '  rm -f "$pd_time_file" 2>/dev/null || true',
    '  case "$pd_elapsed" in',
    '    [0-9]*.[0-9][0-9])',
    '      pd_seconds=${pd_elapsed%.*}',
    '      pd_hundredths=${pd_elapsed#*.}',
    '      case "$pd_seconds:$pd_hundredths" in *[!0-9:]*) return 0 ;; esac',
    '      pd_seconds=${pd_seconds#0}; [ -n "$pd_seconds" ] || pd_seconds=0',
    '      pd_hundredths=${pd_hundredths#0}; [ -n "$pd_hundredths" ] || pd_hundredths=0',
    '      pd_duration_ms=$((pd_seconds * 1000 + pd_hundredths * 10))',
    '      ;;',
    '  esac',
    '}',
    '# pd_health_signal (the wrapper-level signal trap) and pd_kill_child (the',
    '# child-cleanup helper it and the deadline watchdog share) are defined',
    '# further down, right beside the trap that installs them.',
    'if [ -f "$pd_debug_dir/debug.enabled" ]; then',
    '  pd_debug=1',
    '  pd_started_ms=$(pd_debug_now_ms 2>/dev/null) || pd_started_ms="$(date +%s)000"',
    '  # Debug mode buffers only a BOUNDED prefix of hook stdin in memory (review',
    '  # finding 1) — just enough to discover a session identifier for the',
    '  # sanitized timing label. head -c physically stops reading at the budget;',
    '  # the real tentacle below still receives the FULL original stream, because',
    '  # this prefix is streamed back out ahead of a `cat` continuation rather',
    '  # than re-captured. Only a validated session identifier ever leaves this',
    '  # bounded buffer.',
    '  pd_input_head=$(head -c "$pd_debug_probe_bytes" 2>/dev/null)',
    '  pd_session_candidate=""',
    '  if [ -x /usr/bin/perl ]; then',
    '    pd_session_candidate=$(printf "%s" "$pd_input_head" | /usr/bin/perl -MJSON::PP -0777 -e \'eval { my $d = decode_json(<>); my $v = $d->{session_id} // $d->{sessionId} // $d->{thread_id} // $d->{threadId} // $d->{conversationId}; print $v if defined($v) && !ref($v); };\' 2>/dev/null || true)',
    '  fi',
    '  case "$pd_session_candidate" in ""|*[!A-Za-z0-9._:-]*|?????????????????????????????????????????????????????????????????????????????????*) pd_session_candidate="$PPID" ;; esac',
    '  pd_session_id="${pd_provider}:${pd_session_candidate}"',
    '  pd_run_id="${pd_provider}-${pd_phase}-${PPID}-$$-${pd_started_ms}"',
    '  pd_workspace_b64=$(printf "%s" "$PWD" | base64 2>/dev/null | tr -d "\\r\\n")',
    '  pd_debug_append start "$pd_started_ms" - -',
    'fi',
    '',
    '# ADR-0132 listening watch: the halt sentinel is consulted BEFORE and',
    '# independently of every daemon probe below. A halt means the daemon is',
    '# down ON PURPOSE, and the tentacles are exactly what must still fire so',
    '# the agent hears SECURITE HALT, answers SEEN/COMPLIED, and has pd calls',
    '# blocked. `test -f` is the whole detector (Area A0); the tentacle itself',
    '# reads the sentinel text. The project-arming check (c) still applies.',
    '# TODO(ADR-0132 phase 0): switch to lib/distress.ts / bin/pd-distress.',
    'pd_halt_sentinel="${PD_HALT_FILE:-$PD_HOME/HALT}"',
    'if [ -f "$pd_halt_sentinel" ]; then',
    '  :',
    '# (a-b) prove the selected daemon is ready without coupling a remote peer',
    '# to this machine\'s ready/pid/heartbeat files. An explicit remote URL is',
    '# authoritative for transport selection, but only a bounded /health probe',
    '# makes hooks live; a failed probe remains a silent, fail-open no-op.',
    'elif [ -n "${PD_URL:-${PORT_DADDY_URL:-}}" ]; then',
    '  pd_remote_url="${PD_URL:-${PORT_DADDY_URL:-}}"',
    '  case "$pd_remote_url" in http://*|https://*) ;; *) pd_debug_skip remote_url_invalid ;; esac',
    '  pd_curl=$(command -v curl 2>/dev/null || true)',
    '  [ -n "$pd_curl" ] || pd_debug_skip remote_probe_unavailable',
    '  pd_remote_health="${pd_remote_url%/}/health"',
    '  "$pd_curl" --fail --silent --output /dev/null --connect-timeout 1 --max-time 1 "$pd_remote_health" 2>/dev/null || pd_debug_skip remote_unreachable',
    'else',
    '  # The heartbeat starts before the database-integrity boot gate, so',
    '  # liveness alone must never delegate hooks to a local daemon.',
    '  ready_file="${PORT_DADDY_READY_FILE:-$PD_HOME/daemon.ready}"',
    '  pid_file="${PORT_DADDY_PID_FILE:-$PD_HOME/daemon.pid}"',
    '  [ ! -L "$ready_file" ] || pd_debug_skip ready_symlink',
    '  [ ! -L "$pid_file" ] || pd_debug_skip pid_symlink',
    '  [ -f "$ready_file" ] || pd_debug_skip daemon_booting',
    '  [ -f "$pid_file" ] || pd_debug_skip pid_missing',
    '  ready_pid=',
    '  daemon_pid=',
    '  { IFS= read -r ready_pid || [ -n "$ready_pid" ]; } < "$ready_file" 2>/dev/null || pd_debug_skip ready_unreadable',
    '  { IFS= read -r daemon_pid || [ -n "$daemon_pid" ]; } < "$pid_file" 2>/dev/null || pd_debug_skip pid_unreadable',
    '  case "$ready_pid:$daemon_pid" in *[!0-9:]*) pd_debug_skip generation_invalid ;; esac',
    '  [ "$ready_pid" -gt 0 ] 2>/dev/null || pd_debug_skip generation_invalid',
    '  [ "$daemon_pid" -gt 0 ] 2>/dev/null || pd_debug_skip generation_invalid',
    '  [ "$ready_pid" = "$daemon_pid" ] || pd_debug_skip generation_mismatch',
    '  # Local liveness uses the Bosun heartbeat; process probes are sandbox-denied.',
    '  heartbeat="${PORT_DADDY_HEARTBEAT_FILE:-$PD_HOME/heartbeat}"',
    '  [ ! -L "$heartbeat" ] || pd_debug_skip heartbeat_symlink',
    '  [ -f "$heartbeat" ] || pd_debug_skip heartbeat_missing',
    '  now=$(date +%s 2>/dev/null) || pd_debug_skip heartbeat_unreadable',
    '  modified=$(stat -f %m "$heartbeat" 2>/dev/null || true)',
    '  case "$modified" in ""|*[!0-9]*) modified=$(stat -c %Y "$heartbeat" 2>/dev/null || true) ;; esac',
    '  case "$modified" in ""|*[!0-9]*) pd_debug_skip heartbeat_unreadable ;; esac',
    '  age=$((now - modified))',
    `  [ "$age" -ge -${SQUID_DAEMON_HEARTBEAT_STALE_SECONDS} ] 2>/dev/null || pd_debug_skip daemon_stale`,
    `  [ "$age" -le ${SQUID_DAEMON_HEARTBEAT_STALE_SECONDS} ] 2>/dev/null || pd_debug_skip daemon_stale`,
    'fi',
    '# Repository-family authority was already verified before any debug/input work.',
    '    pd_health_load',
    '    pd_health_notice_emit',
    '    if [ "$pd_breaker_state" = open ]; then',
    '      pd_health_now=$(pd_epoch_ms 2>/dev/null) || pd_health_now=0',
    '      [ "$pd_health_now" -ge "$pd_retry_ms" ] 2>/dev/null || pd_debug_skip circuit_open',
    '      mkdir -p "$pd_health_dir" 2>/dev/null || pd_debug_skip circuit_open',
    '      pd_health_probe_acquire || pd_debug_skip half_open_busy',
    '      pd_is_probe=1',
    '    fi',
    '    [ -d "$pd_health_dir" ] || mkdir -p "$pd_health_dir" 2>/dev/null || true',
    '    rm -f "$pd_child_done_file" "$pd_child_pid_file" 2>/dev/null || true',
    '    # Best-effort targeted kill of a backgrounded child (finding 2, review',
    '    # 2026-08-24). Detection and liveness are FILESYSTEM-ONLY throughout —',
    '    # never a bare signal-0 existence probe or a process listing — because',
    '    # Codex\'s macOS Seatbelt profile denies both against a process outside',
    '    # the sandboxed process\'s own creation, the same constraint the daemon',
    '    # heartbeat check above already works around. This signals the CHILD of',
    '    # the timer process ($1), not the timer itself: killing the timer',
    '    # directly reparents its child to init before we can ever reach it,',
    '    # orphaning a hung tentacle instead of stopping it. pkill -P keeps the',
    '    # timer alive so it can still notice its own child die and exit on its',
    '    # own, which is what actually makes the sentinel file ($2) appear. Falls',
    '    # back to signaling the timer pid directly when pkill is unavailable',
    '    # (degrades to the same best-effort',
    '    # behavior this wrapper always had, never worse).',
    '    pd_kill_child() {',
    '      pd_kt="$1"',
    '      pd_sentinel="$2"',
    '      [ -n "$pd_kt" ] || return 0',
    '      if command -v pkill >/dev/null 2>&1; then pkill -TERM -P "$pd_kt" 2>/dev/null || true',
    '      else kill -TERM "$pd_kt" 2>/dev/null || true; fi',
    '      pd_kw=0',
    '      while [ "$pd_kw" -lt 15 ] && [ ! -f "$pd_sentinel" ]; do sleep 0.02 2>/dev/null; pd_kw=$((pd_kw + 1)); done',
    '      if [ ! -f "$pd_sentinel" ]; then',
    '        if command -v pkill >/dev/null 2>&1; then pkill -KILL -P "$pd_kt" 2>/dev/null || true; fi',
    '        kill -KILL "$pd_kt" 2>/dev/null || true',
    '        pd_kw=0',
    '        while [ "$pd_kw" -lt 15 ] && [ ! -f "$pd_sentinel" ]; do sleep 0.02 2>/dev/null; pd_kw=$((pd_kw + 1)); done',
    '      fi',
    '    }',
    '    pd_child_pid_read() {',
    '      pd_read_pid=$(cat "$pd_child_pid_file" 2>/dev/null || true)',
    '      case "$pd_read_pid" in ""|*[!0-9]*) pd_read_pid="" ;; esac',
    '      printf "%s" "$pd_read_pid"',
    '    }',
    '    pd_health_signal() {',
    '      trap - HUP INT TERM',
    '      rm -f "$pd_time_file" 2>/dev/null || true',
    '      pd_health_record_unhealthy signal 124 "$pd_slow_ms"',
    '      pd_debug_finish interrupted 124',
    '      pd_kill_child "$(pd_child_pid_read)" "$pd_child_done_file"',
    '      rm -f "$pd_child_done_file" "$pd_child_pid_file" 2>/dev/null || true',
    '      exit 0',
    '    }',
    '    trap pd_health_signal HUP INT TERM',
    '    pd_real_hook="$PD_HOME/bin/squid/${0##*/}"',
    '    if [ ! -x "$pd_real_hook" ]; then',
    '      printf "real 0.00\\nuser 0.00\\nsys 0.00\\n" > "$pd_time_file" 2>/dev/null || true',
    '      pd_exit=127',
    '    elif [ ! -x "$pd_time_bin" ]; then',
    '      printf "real 0.00\\nuser 0.00\\nsys 0.00\\n" > "$pd_time_file" 2>/dev/null || true',
    '      pd_timer_missing=1',
    '      pd_exit=0',
    '    else',
    '      # The wrapper OWNS the deadline (finding 2): the child runs in the',
    '      # background so THIS process — the survivor even if the child is',
    '      # hard-killed or wedges forever — polls its OWN pd_deadline_ms rather',
    '      # than only ever measuring elapsed time after a synchronous child',
    '      # returns. Completion is detected via a sentinel FILE the launcher',
    '      # writes (never a signal-0 probe — see pd_kill_child above), and the',
    '      # timer\'s own pid is captured to a file too, so it can be targeted precisely',
    '      # once the deadline elapses.',
    '      if [ "$pd_debug" -eq 1 ]; then',
    '        (',
    '          # Use the external POSIX timer: dash emits reserved-word `time`',
    '          # diagnostics after shell redirections are restored. -o isolates',
    '          # only timing data while hook stderr still reaches the host. The',
    '          # bounded head is replayed first, then the rest of the original',
    '          # stream is piped straight through — never re-buffered.',
    '          { printf "%s" "$pd_input_head"; cat; } | "$pd_time_bin" -p -o "$pd_time_file" "$pd_real_hook" "$@" &',
    '          pd_inner_pid=$!',
    '          printf "%s" "$pd_inner_pid" > "$pd_child_pid_file" 2>/dev/null || true',
    '          wait "$pd_inner_pid" 2>/dev/null',
    '          printf "%s" "$?" > "$pd_child_done_file.$$" 2>/dev/null && mv "$pd_child_done_file.$$" "$pd_child_done_file" 2>/dev/null',
    '        ) &',
    '      else',
    '        (',
    '          "$pd_time_bin" -p -o "$pd_time_file" "$pd_real_hook" "$@" &',
    '          pd_inner_pid=$!',
    '          printf "%s" "$pd_inner_pid" > "$pd_child_pid_file" 2>/dev/null || true',
    '          wait "$pd_inner_pid" 2>/dev/null',
    '          printf "%s" "$?" > "$pd_child_done_file.$$" 2>/dev/null && mv "$pd_child_done_file.$$" "$pd_child_done_file" 2>/dev/null',
    '        ) &',
    '      fi',
    '      pd_waited_ms=0',
    '      pd_deadline_hit=0',
    '      while [ ! -f "$pd_child_done_file" ]; do',
    '        if [ "$pd_waited_ms" -ge "$pd_deadline_ms" ]; then pd_deadline_hit=1; break; fi',
    '        sleep 0.01 2>/dev/null',
    '        pd_waited_ms=$((pd_waited_ms + 10))',
    '      done',
    '      if [ "$pd_deadline_hit" -eq 1 ]; then',
    '        # Durability first: the timeout receipt is written BEFORE any attempt',
    '        # to reap or kill the child, so it survives even if this process',
    '        # never regains control afterward (e.g. the host kills everything a',
    '        # moment later). This is the exact gap review finding 2 named: a',
    '        # hard-killed/hung child must not be able to vanish without the',
    '        # breaker recording it.',
    '        trap - HUP INT TERM',
    '        pd_health_record_unhealthy timeout 124 "$pd_deadline_ms"',
    '        pd_debug_finish interrupted 124',
    '        pd_kill_child "$(pd_child_pid_read)" "$pd_child_done_file"',
    '        rm -f "$pd_time_file" "$pd_child_done_file" "$pd_child_pid_file" 2>/dev/null || true',
    '        exit 0',
    '      fi',
    '      pd_exit=$(cat "$pd_child_done_file" 2>/dev/null || printf 1)',
    '      case "$pd_exit" in ""|*[!0-9]*) pd_exit=1 ;; esac',
    '      rm -f "$pd_child_done_file" "$pd_child_pid_file" 2>/dev/null || true',
    '    fi',
    '    trap - HUP INT TERM',
    '    pd_health_duration_read',
    '    if [ "$pd_timer_missing" -eq 1 ]; then',
    '      pd_health_record_unhealthy timer_missing 126 0',
    '      pd_debug_finish failure_swallowed 126',
    '      exit 0',
    '    fi',
    '    if [ "$pd_exit" -eq 2 ]; then',
    '      pd_health_record_healthy',
    '      pd_debug_finish blocked 2',
    '      exit 2',
    '    fi',
    '    if [ "$pd_exit" -eq 0 ] && [ "$pd_duration_ms" -lt "$pd_slow_ms" ]; then',
    '      pd_health_record_healthy',
    '      pd_debug_finish executed 0',
    '      exit 0',
    '    fi',
    '    if [ "$pd_exit" -eq 0 ]; then',
    '      pd_health_record_unhealthy slow 0 "$pd_duration_ms"',
    '      pd_debug_finish slow 0',
    '      exit 0',
    '    fi',
    '    pd_health_record_unhealthy "exit_$pd_exit" "$pd_exit" "$pd_duration_ms"',
    '    pd_debug_finish failure_swallowed "$pd_exit"',
    '    exit 0',
    '',
  ].join('\n');
}

// ─── Tentacle staging ────────────────────────────────────────────────────────

export interface StageResult {
  staged: string[];
  missing: TentacleName[];
  sourceDir: string;
  /** Immutable authority root embedded in every staged wrapper. */
  pdHome: string;
  /** Exact directory provider configs must invoke. */
  binDir: string;
  /** Shared wrapper generation committed by the manifest last. */
  wrapperGeneration: string;
  generationManifestPath: string;
  /** Fixed generator inputs used for complete wrapper-byte verification. */
  authorityBudgetMs: number;
  authorityTrace: boolean;
  /** Exact staged artifact digests, captured from bounded source bytes. */
  artifactDigests: Partial<Record<TentacleName, { wrapperSha256: string; realSha256: string }>>;
}

export interface StageTentaclesOptions {
  /** Fixed verifier deadline embedded in wrapper bytes. */
  authorityBudgetMs?: number;
  /** Test-only sanitized denial classes on stderr; never enabled in production. */
  authorityTrace?: boolean;
  /** Test-only interruption seam for generation-commit conformance. */
  fault?: (point: `after-wrapper:${TentacleName}` | 'before-generation-commit') => void;
}

const SQUID_STAGED_ARTIFACT_MAX_BYTES = 8 * 1024 * 1024;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isContainedBy(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !parse(rel).root);
}

function preflightDestinationEntry(path: string, type: 'directory' | 'file', ownedFrom: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  for (const component of absolute.slice(root.length).split('/').filter(Boolean)) {
    cursor = join(cursor, component);
    let stats;
    try {
      stats = lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error(`Cannot inspect Squid staging destination ${cursor}: ${(error as Error).message}`);
    }
    if (stats.isSymbolicLink()) throw new Error(`Symlinked Squid staging destination rejected: ${cursor}`);
    const isFinal = cursor === absolute;
    if (!isFinal && !stats.isDirectory()) throw new Error(`Non-directory Squid staging ancestry rejected: ${cursor}`);
    if (isFinal) {
      if (type === 'directory' && !stats.isDirectory()) throw new Error(`Squid staging directory is not a directory: ${cursor}`);
      if (type === 'file' && (!stats.isFile() || stats.nlink !== 1)) {
        throw new Error(`Unsafe existing Squid staged file rejected: ${cursor}`);
      }
    }
    if (
      isContainedBy(ownedFrom, cursor)
      && typeof process.getuid === 'function'
      && stats.uid !== process.getuid()
    ) throw new Error(`Squid staging destination is not owned by the current user: ${cursor}`);
  }
}

interface StagingDirectoryIdentity {
  path: string;
  device: number;
  inode: number;
}

function ensureStagingDirectory(path: string, authorityRoot: string, mode: number): StagingDirectoryIdentity {
  const absolute = resolve(path);
  if (!existsSync(absolute)) mkdirSync(absolute, { mode });
  const before = lstatSync(absolute);
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || (typeof process.getuid === 'function' && before.uid !== process.getuid())
    || (before.mode & 0o022) !== 0
  ) throw new Error(`Squid staging directory failed private ownership checks: ${absolute}`);
  const canonical = realpathSync(absolute);
  const canonicalRoot = realpathSync(authorityRoot);
  if (canonical !== absolute || !isContainedBy(canonicalRoot, canonical)) {
    throw new Error(`Squid staging directory escaped its authority root: ${absolute}`);
  }
  chmodSync(absolute, mode);
  const after = lstatSync(absolute);
  if (
    after.dev !== before.dev
    || after.ino !== before.ino
    || after.isSymbolicLink()
    || !after.isDirectory()
    || (after.mode & 0o777) !== mode
  ) throw new Error(`Squid staging directory changed during exact readback: ${absolute}`);
  return { path: canonical, device: after.dev, inode: after.ino };
}

function readStagedSource(path: string): { bytes: Buffer; digest: string } {
  const stats = lstatSync(path);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.size <= 0
    || stats.size > SQUID_STAGED_ARTIFACT_MAX_BYTES
  ) throw new Error(`Unsafe Squid tentacle source rejected: ${path}`);
  const bytes = readFileSync(path);
  if (bytes.byteLength !== stats.size) throw new Error(`Squid tentacle source changed while being read: ${path}`);
  return { bytes, digest: sha256(bytes) };
}

/**
 * Copy the real tentacles to ~/.port-daddy/bin/squid/ and (re)write the gate
 * wrappers to ~/.port-daddy/bin/. The tentacles are owned by the squid program;
 * this installer only consumes them. If they are absent on this build, nothing
 * is staged and the caller surfaces guidance.
 */
export function stageTentacles(
  sourceDir?: string,
  destBinDir = tentacleBinDir(),
  options: StageTentaclesOptions = {},
): StageResult {
  const requestedBinDir = resolve(destBinDir);
  const requestedPdHome = dirname(requestedBinDir);
  const wrapperGeneration = randomUUID();
  const requestedManifestPath = join(requestedPdHome, 'squid', 'hook-wrapper-generation.v1');
  const resolved = TENTACLES.map((name) => {
    const explicit = sourceDir ? join(sourceDir, name) : null;
    const source = explicit ? (existsSync(explicit) ? explicit : null) : resolveSquidAsset(join('bin', name));
    return { name, source };
  });
  const missing = resolved.filter((candidate) => candidate.source === null).map((candidate) => candidate.name);
  if (missing.length > 0) {
    return {
      staged: [],
      missing,
      sourceDir: sourceDir ?? 'runtime asset resolver',
      pdHome: requestedPdHome,
      binDir: requestedBinDir,
      wrapperGeneration,
      generationManifestPath: requestedManifestPath,
      authorityBudgetMs: options.authorityBudgetMs ?? 250,
      authorityTrace: options.authorityTrace === true,
      artifactDigests: {},
    };
  }

  const realDir = join(requestedBinDir, 'squid');
  const binDir = requestedBinDir;
  const configuredPdHome = dirname(resolve(binDir));
  // Fixed into the generated wrapper. Real macOS cold starts regularly spend
  // more than 75ms in the strict stat/read checks; 250ms remains bounded while
  // leaving enough headroom for the measured p99 process-startup path.
  const authorityBudgetMs = options.authorityBudgetMs ?? 250;
  if (!Number.isSafeInteger(authorityBudgetMs) || authorityBudgetMs < 1 || authorityBudgetMs > 1_000) {
    throw new Error('Squid authority budget must be a fixed integer from 1 to 1000ms');
  }
  const stateDir = join(configuredPdHome, 'squid');
  const healthDir = join(stateDir, 'health');
  const generationManifestPath = join(configuredPdHome, 'squid', 'hook-wrapper-generation.v1');

  // Preflight every existing destination and source before the first mkdir,
  // copy, rename, or chmod. A repo/tool-controlled symlink must have zero
  // ability to redirect even a partial stage outside this authority root.
  for (const path of [configuredPdHome, binDir, realDir, stateDir, healthDir]) {
    preflightDestinationEntry(path, 'directory', configuredPdHome);
  }
  for (const { name } of resolved) {
    preflightDestinationEntry(join(realDir, name), 'file', configuredPdHome);
    preflightDestinationEntry(join(binDir, name), 'file', configuredPdHome);
  }
  preflightDestinationEntry(generationManifestPath, 'file', configuredPdHome);
  const sourceArtifacts = new Map(
    resolved.map(({ name, source }) => [name, readStagedSource(source as string)]),
  );

  // Creation is one level at a time after the complete preflight. Exact
  // dev/inode readback prevents a swapped directory from silently becoming the
  // authority root between validation and staging.
  const pdHomeIdentity = ensureStagingDirectory(configuredPdHome, configuredPdHome, 0o700);
  const binIdentity = ensureStagingDirectory(binDir, pdHomeIdentity.path, 0o700);
  const realIdentity = ensureStagingDirectory(realDir, pdHomeIdentity.path, 0o700);
  const stateIdentity = ensureStagingDirectory(stateDir, pdHomeIdentity.path, 0o700);
  const healthIdentity = ensureStagingDirectory(healthDir, pdHomeIdentity.path, 0o700);
  const stagedBin = binIdentity.path;
  const stagedPdHome = pdHomeIdentity.path;
  for (const identity of [realIdentity, stateIdentity, healthIdentity]) {
    if (!isContainedBy(stagedPdHome, identity.path)) {
      throw new Error(`Squid staging directory escaped exact authority readback: ${identity.path}`);
    }
  }
  const wrapperOptions: GateWrapperOptions = {
    pdHome: stagedPdHome,
    authorityBudgetMs,
    authorityTrace: options.authorityTrace === true,
    wrapperGeneration,
  };
  if (generationManifestPath !== join(stagedPdHome, 'squid', 'hook-wrapper-generation.v1')) {
    throw new Error('Squid generation manifest escaped its staged authority root');
  }

  const staged: string[] = [];
  const artifactDigests: Partial<Record<TentacleName, { wrapperSha256: string; realSha256: string }>> = {};
  const suffix = `.stage-${process.pid}-${Date.now()}`;
  const temporary: string[] = [];
  try {
    for (const { name } of resolved) {
      const realDst = join(realDir, name);
      const realTmp = `${realDst}${suffix}`;
      const wrapper = join(binDir, name);
      const wrapperTmp = `${wrapper}${suffix}`;
      const sourceArtifact = sourceArtifacts.get(name)!;
      const wrapperBytes = gateWrapperScript(wrapperOptions);
      writeFileSync(realTmp, sourceArtifact.bytes, { mode: 0o755, flag: 'wx' });
      chmodSync(realTmp, 0o755);
      writeFileSync(wrapperTmp, wrapperBytes, { mode: 0o755, flag: 'wx' });
      chmodSync(wrapperTmp, 0o755);
      artifactDigests[name] = {
        wrapperSha256: sha256(wrapperBytes),
        realSha256: sourceArtifact.digest,
      };
      temporary.push(realTmp, wrapperTmp);
    }
    const generationTemporary = `${generationManifestPath}${suffix}`;
    writeFileSync(
      generationTemporary,
      `${SQUID_REPOSITORY_FAMILY_RECORD_VERSION}\t${wrapperGeneration}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    chmodSync(generationTemporary, 0o600);
    temporary.push(generationTemporary);

    for (const { name } of resolved) {
      const realDst = join(realDir, name);
      const wrapper = join(binDir, name);
      renameSync(`${realDst}${suffix}`, realDst);
      renameSync(`${wrapper}${suffix}`, wrapper);
      staged.push(wrapper);
      options.fault?.(`after-wrapper:${name}`);
    }
    // Completion receipt last. Mixed old/new wrappers are inert unless their
    // embedded generation matches this exact committed record.
    options.fault?.('before-generation-commit');
    renameSync(generationTemporary, generationManifestPath);
    chmodSync(generationManifestPath, 0o600);
  } finally {
    for (const path of temporary) rmSync(path, { force: true });
  }
  return {
    staged,
    missing,
    sourceDir: sourceDir ?? 'runtime asset resolver',
    pdHome: stagedPdHome,
    binDir: stagedBin,
    wrapperGeneration,
    generationManifestPath,
    authorityBudgetMs,
    authorityTrace: options.authorityTrace === true,
    artifactDigests,
  };
}

function verifyStagedTentacles(stage: StageResult, requestedPdHome: string): string | null {
  try {
    const pdHome = realpathSync(resolve(requestedPdHome));
    if (stage.pdHome !== pdHome || stage.binDir !== join(pdHome, 'bin')) return 'staged authority root mismatch';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stage.wrapperGeneration)) {
      return 'staged wrapper generation is malformed';
    }
    if (stage.generationManifestPath !== join(pdHome, 'squid', 'hook-wrapper-generation.v1')) {
      return 'staged generation receipt path mismatch';
    }
    const manifestStats = lstatSync(stage.generationManifestPath);
    if (
      !manifestStats.isFile()
      || manifestStats.isSymbolicLink()
      || manifestStats.nlink !== 1
      || (manifestStats.mode & 0o777) !== 0o600
      || readFileSync(stage.generationManifestPath, 'utf8')
        !== `${SQUID_REPOSITORY_FAMILY_RECORD_VERSION}\t${stage.wrapperGeneration}\n`
    ) return 'staged generation receipt failed exact readback';
    const stagedSet = new Set(stage.staged);
    const expectedWrapper = gateWrapperScript({
      pdHome,
      authorityBudgetMs: stage.authorityBudgetMs,
      authorityTrace: stage.authorityTrace,
      wrapperGeneration: stage.wrapperGeneration,
    });
    for (const name of TENTACLES) {
      const wrapper = join(stage.binDir, name);
      const real = join(stage.binDir, 'squid', name);
      if (!stagedSet.has(wrapper)) return `staged wrapper list omitted ${name}`;
      for (const path of [wrapper, real]) {
        const stats = lstatSync(path);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (stats.mode & 0o100) === 0) {
          return `staged executable is unsafe: ${path}`;
        }
      }
      const expectedDigests = stage.artifactDigests[name];
      if (!expectedDigests) return `staged artifact digest omitted ${name}`;
      const wrapperBytes = readFileSync(wrapper, 'utf8');
      const realBytes = readFileSync(real);
      if (
        wrapperBytes !== expectedWrapper
        || sha256(wrapperBytes) !== expectedDigests.wrapperSha256
        || sha256(realBytes) !== expectedDigests.realSha256
      ) return `staged artifact failed exact byte/digest readback: ${name}`;
    }
    return null;
  } catch (error) {
    return `staged wrapper verification failed: ${(error as Error).message}`;
  }
}

// ─── Target definitions ──────────────────────────────────────────────────────

type HookFormat = 'json' | 'codex-toml';
type Vendor = 'claude' | 'gemini' | 'agy';

export interface AgentCliTarget {
  name: string;
  slug: string;
  bin: string;
  format: HookFormat;
  vendor?: Vendor; // JSON vendors only
  userConfigPath: string;
  /** Project-level config, or null when the CLI has no useful project-interactive surface. */
  projectConfigPath: ((cwd: string) => string) | null;
  detect(): boolean;
  note?: string;
}

function commandExists(bin: string): boolean {
  try {
    execFileSync('command', ['-v', bin], { stdio: ['pipe', 'pipe', 'pipe'], shell: '/bin/sh' });
    return true;
  } catch {
    try {
      execFileSync('which', [bin], { stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch {
      return false;
    }
  }
}

export function buildTargets(home: string): AgentCliTarget[] {
  return [
    {
      name: 'Claude Code',
      slug: 'claude',
      bin: 'claude',
      format: 'json',
      vendor: 'claude',
      userConfigPath: join(home, '.claude', 'settings.json'),
      projectConfigPath: (cwd) => join(cwd, '.claude', 'settings.json'),
      detect: () => commandExists('claude'),
    },
    {
      name: 'Codex CLI',
      slug: 'codex',
      bin: 'codex',
      format: 'codex-toml',
      userConfigPath: join(home, '.codex', 'config.toml'),
      // repo-local hooks don't fire interactively (openai/codex#17532) — user-level
      // only; the runtime gate keeps it per-project.
      projectConfigPath: null,
      detect: () => commandExists('codex'),
      note: 'user-level ~/.codex (repo-local does not fire interactively, openai/codex#17532); trust once via /hooks',
    },
    {
      name: 'Gemini CLI',
      slug: 'gemini',
      bin: 'gemini',
      format: 'json',
      vendor: 'gemini',
      userConfigPath: join(home, '.gemini', 'settings.json'),
      projectConfigPath: (cwd) => join(cwd, '.gemini', 'settings.json'),
      detect: () => commandExists('gemini'),
    },
    {
      name: 'Antigravity (agy)',
      slug: 'agy',
      bin: 'agy',
      format: 'json',
      vendor: 'agy',
      userConfigPath: join(home, '.gemini', 'hooks.json'), // home-scoped engine file
      projectConfigPath: null,
      detect: () => commandExists('agy'),
      note: 'home-scoped ~/.gemini/hooks.json; runtime gate keeps it per-project',
    },
  ];
}

// ─── Configure a single target ───────────────────────────────────────────────

export interface ConfigureResult {
  success: boolean;
  created?: boolean;
  path: string;
  error?: string;
  skipped?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Resolver pointing hook commands at the gate and attaching only static metadata. */
function gateResolverFor(provider: string, binDir = tentacleBinDir()): TentacleResolver {
  return (name) => [
    `PD_HOOK_PROVIDER=${provider}`,
    `PD_HOOK_DEADLINE_MS=${SQUID_HOOK_DEADLINE_MS}`,
    shellQuote(join(binDir, name)),
  ].join(' ');
}

function configCarriesExpectedTargetHooks(target: AgentCliTarget, path: string, binDir: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const text = readFileSync(path, 'utf8');
    const resolver = gateResolverFor(target.slug, binDir);
    if (target.format === 'codex-toml') {
      const expected = codexHooksTomlBlock(resolver);
      const pdCommands = (value: string) => value
        .split('\n')
        .filter((line) => /^command\s*=.*pd-hook-/.test(line));
      return text.split(CODEX_PD_MARKER).length === 2
        && text.includes(expected)
        && JSON.stringify(pdCommands(text)) === JSON.stringify(pdCommands(expected));
    }
    const config = JSON.parse(text) as { hooks?: Record<string, unknown> };
    if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) return false;
    const expected = buildJsonHookMap(target.vendor!, resolver);
    for (const [event, value] of Object.entries(config.hooks)) {
      const actual = Array.isArray(value) ? value : [];
      const pdEntries = actual.filter(isPdEntry);
      const expectedEntries = expected[event] ?? [];
      if (JSON.stringify(pdEntries) !== JSON.stringify(expectedEntries)) return false;
    }
    return Object.keys(expected).every((event) => Object.hasOwn(config.hooks!, event));
  } catch {
    return false;
  }
}

function atomicWriteConfig(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.pd-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Codex once loaded ~/.codex/hooks.json; current Codex uses config.toml. Remove
 * only Port Daddy entries from that legacy surface when present so an upgrade
 * cannot fire both generations of synchronous hooks. User hooks survive.
 */
function migratedLegacyCodexHooksJson(configPath: string): { path: string; content: string } | null {
  const path = join(dirname(configPath), 'hooks.json');
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8').trim();
  let config: Record<string, unknown>;
  try {
    config = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // A malformed retired surface cannot be active, and must not prevent the
    // current TOML hook registration from being repaired. Preserve it exactly.
    return null;
  }
  if (!removeJsonHooks(config)) return null;
  return { path, content: JSON.stringify(config, null, 2) + '\n' };
}

/**
 * Install the current Codex TOML before retiring the legacy JSON registration.
 * Each write is atomic on its own. This order means an interrupted first write
 * leaves the still-working legacy hooks untouched; an interrupted cleanup may
 * briefly leave duplicates, but can never leave Codex with no Port Daddy hook.
 */
export function commitCodexConfigMigration(
  configPath: string,
  configContent: string,
  legacy: { path: string; content: string } | null,
  writeConfig: (path: string, content: string) => void = atomicWriteConfig,
): void {
  writeConfig(configPath, configContent);
  if (legacy) writeConfig(legacy.path, legacy.content);
}

export function configureTarget(
  target: AgentCliTarget,
  opts: { scope: 'user' | 'project'; cwd?: string; gateBinDir?: string },
): ConfigureResult {
  let configPath: string;
  if (opts.scope === 'user') {
    configPath = target.userConfigPath;
  } else {
    if (!target.projectConfigPath) {
      return { success: true, path: '', skipped: 'no interactive project surface' };
    }
    configPath = target.projectConfigPath(opts.cwd ?? process.cwd());
  }

  try {
    const existed = existsSync(configPath);
    mkdirSync(dirname(configPath), { recursive: true });

    if (target.format === 'codex-toml') {
      const existing = existed ? readFileSync(configPath, 'utf-8') : '';
      const base = stripCodexHooksTomlBlock(existing).replace(/\s*$/, '');
      const sep = base.length ? '\n\n' : '';
      const legacy = migratedLegacyCodexHooksJson(configPath);
      commitCodexConfigMigration(
        configPath,
        `${base}${sep}${codexHooksTomlBlock(gateResolverFor(target.slug, opts.gateBinDir))}\n`,
        legacy,
      );
      return { success: true, created: !existed, path: configPath };
    }

    let config: Record<string, unknown> = {};
    if (existed) {
      const raw = readFileSync(configPath, 'utf-8').trim();
      if (raw) config = JSON.parse(raw) as Record<string, unknown>;
    }
    upsertJsonHookMap(config, buildJsonHookMap(target.vendor!, gateResolverFor(target.slug, opts.gateBinDir)));
    atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
    return { success: true, created: !existed, path: configPath };
  } catch (err) {
    return { success: false, path: configPath, error: (err as Error).message };
  }
}

export function uninstallTarget(
  target: AgentCliTarget,
  opts: { scope: 'user' | 'project'; cwd?: string },
): ConfigureResult {
  let configPath: string;
  if (opts.scope === 'user') configPath = target.userConfigPath;
  else if (target.projectConfigPath) configPath = target.projectConfigPath(opts.cwd ?? process.cwd());
  else if (target.format === 'codex-toml') {
    // Current Codex reads user config, but releases before 3.30 also wrote a
    // project-local TOML block. Sweep that retired surface so a cached or future
    // project loader cannot keep calling a deleted Homebrew Cellar path.
    configPath = join(opts.cwd ?? process.cwd(), '.codex', 'config.toml');
  } else return { success: true, path: '', skipped: 'no project surface' };

  if (!existsSync(configPath)) return { success: true, path: configPath, skipped: 'no config' };

  try {
    if (target.format === 'codex-toml') {
      const legacy = migratedLegacyCodexHooksJson(configPath);
      commitCodexConfigMigration(
        configPath,
        stripCodexHooksTomlBlock(readFileSync(configPath, 'utf-8')),
        legacy,
      );
      return { success: true, path: configPath };
    }
    const raw = readFileSync(configPath, 'utf-8').trim();
    const config = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    removeJsonHooks(config);
    atomicWriteConfig(configPath, JSON.stringify(config, null, 2) + '\n');
    return { success: true, path: configPath };
  } catch (err) {
    return { success: false, path: configPath, error: (err as Error).message };
  }
}

interface ConfigSnapshot {
  path: string;
  existed: boolean;
  content: string;
  mode: number;
  device: number | null;
  inode: number | null;
}

const SQUID_PROVIDER_CONFIG_MAX_BYTES = 4 * 1024 * 1024;

type ProviderSlug = AgentCliTarget['slug'];
export type HooksInstallFaultPoint = `after-provider:${ProviderSlug}` | 'before-marker-commit';

function assertProviderConfigPath(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  for (const component of absolute.slice(root.length).split('/').filter(Boolean)) {
    cursor = join(cursor, component);
    try {
      const stats = lstatSync(cursor);
      if (stats.isSymbolicLink()) throw new Error(`Provider config path traverses a symlink: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function targetConfigPaths(
  target: AgentCliTarget,
  scope: 'user' | 'project',
  cwd?: string,
): string[] {
  let primary: string | null = null;
  if (scope === 'user') primary = target.userConfigPath;
  else if (target.projectConfigPath) primary = target.projectConfigPath(cwd ?? process.cwd());
  else if (target.format === 'codex-toml') primary = join(cwd ?? process.cwd(), '.codex', 'config.toml');
  if (!primary) return [];
  return target.format === 'codex-toml'
    ? [primary, join(dirname(primary), 'hooks.json')]
    : [primary];
}

function configPathsForTransaction(targets: AgentCliTarget[], worktrees: string[]): string[] {
  const paths: string[] = [];
  for (const target of targets) {
    paths.push(...targetConfigPaths(target, 'user'));
    for (const root of worktrees) {
      paths.push(...targetConfigPaths(target, 'project', root));
    }
  }
  return [...new Set(paths)];
}

function strictConfigState(path: string): ConfigSnapshot {
  assertProviderConfigPath(path);
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, existed: false, content: '', mode: 0o600, device: null, inode: null };
    }
    throw new Error(`Cannot inspect provider config ${path}: ${(error as Error).message}`);
  }
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.nlink !== 1
    || stats.size > SQUID_PROVIDER_CONFIG_MAX_BYTES
    || (typeof process.getuid === 'function' && stats.uid !== process.getuid())
  ) throw new Error(`Unsafe provider config rejected: ${path}`);
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read provider config ${path}: ${(error as Error).message}`);
  }
  if (Buffer.byteLength(content) !== stats.size || content.includes('\0')) {
    throw new Error(`Provider config changed while being read or contains NUL: ${path}`);
  }
  return {
    path,
    existed: true,
    content,
    mode: stats.mode & 0o777,
    device: stats.dev,
    inode: stats.ino,
  };
}

function snapshotConfigs(paths: string[]): ConfigSnapshot[] {
  return paths.map(strictConfigState);
}

function sameConfigState(left: ConfigSnapshot, right: ConfigSnapshot): boolean {
  return left.existed === right.existed
    && left.content === right.content
    && left.mode === right.mode
    && left.device === right.device
    && left.inode === right.inode;
}

function assertConfigPreimages(
  paths: string[],
  snapshots: Map<string, ConfigSnapshot>,
  postimages: Map<string, ConfigSnapshot>,
): void {
  for (const path of paths) {
    const expected = postimages.get(path) ?? snapshots.get(path);
    if (!expected || !sameConfigState(strictConfigState(path), expected)) {
      throw new Error(`Provider config changed concurrently before mutation: ${path}`);
    }
  }
}

function captureConfigPostimages(
  paths: string[],
  snapshots: Map<string, ConfigSnapshot>,
  postimages: Map<string, ConfigSnapshot>,
): void {
  for (const path of paths) {
    const current = strictConfigState(path);
    const before = snapshots.get(path);
    if (before && !sameConfigState(current, before)) postimages.set(path, current);
  }
}

function restoreConfigSnapshots(
  snapshots: Map<string, ConfigSnapshot>,
  postimages: Map<string, ConfigSnapshot>,
): string[] {
  const failures: string[] = [];
  for (const [path, postimage] of [...postimages.entries()].reverse()) {
    const snapshot = snapshots.get(path);
    if (!snapshot) continue;
    try {
      const live = strictConfigState(path);
      if (!sameConfigState(live, postimage)) {
        failures.push(`${path}: concurrent user edit preserved; rollback CAS refused`);
        continue;
      }
      if (!snapshot.existed) rmSync(path, { force: true });
      else {
        atomicWriteConfig(path, snapshot.content);
        chmodSync(path, snapshot.mode);
      }
    } catch (error) {
      failures.push(`${path}: ${(error as Error).message}`);
    }
  }
  return failures;
}

export interface SharedProviderInstallReceipt {
  configured: number;
  partialProviders: ProviderSlug[];
  changedPaths: string[];
  rolledBack: boolean;
  rollbackFailures: string[];
}

class SharedProviderInstallError extends Error {
  constructor(message: string, readonly receipt: SharedProviderInstallReceipt) {
    super(message);
    this.name = 'SharedProviderInstallError';
  }
}

/**
 * Install all four PD-owned user registrations, then sweep only PD project
 * blocks from every verified member worktree. Any error restores exact prior
 * file bytes before the family marker can be published.
 */
function installSharedProviderHooksTransaction(
  targets: AgentCliTarget[],
  worktrees: string[],
  gateBinDir: string,
  fault?: (point: HooksInstallFaultPoint) => void,
): PreparedRepositoryFamilyArm<SharedProviderInstallReceipt> {
  const snapshotList = snapshotConfigs(configPathsForTransaction(targets, worktrees));
  const snapshots = new Map(snapshotList.map((snapshot) => [snapshot.path, snapshot]));
  const postimages = new Map<string, ConfigSnapshot>();
  const partialProviders: ProviderSlug[] = [];
  try {
    for (const target of targets) {
      const userPaths = targetConfigPaths(target, 'user');
      assertConfigPreimages(userPaths, snapshots, postimages);
      const configured = configureTarget(target, { scope: 'user', gateBinDir });
      captureConfigPostimages(userPaths, snapshots, postimages);
      if (
        !configured.success
        || configured.skipped
        || !configCarriesExpectedTargetHooks(target, target.userConfigPath, gateBinDir)
      ) {
        throw new Error(`${target.slug}: ${configured.error ?? configured.skipped ?? 'user hook verification failed'}`);
      }
      for (const root of worktrees) {
        const projectPaths = targetConfigPaths(target, 'project', root);
        assertConfigPreimages(projectPaths, snapshots, postimages);
        const cleanup = uninstallTarget(target, { scope: 'project', cwd: root });
        captureConfigPostimages(projectPaths, snapshots, postimages);
        if (!cleanup.success) throw new Error(`${target.slug} project cleanup: ${cleanup.error ?? 'failed'}`);
      }
      partialProviders.push(target.slug);
      fault?.(`after-provider:${target.slug}`);
    }
    const receipt: SharedProviderInstallReceipt = {
      configured: targets.length,
      partialProviders,
      changedPaths: [...postimages.keys()],
      rolledBack: false,
      rollbackFailures: [],
    };
    return {
      value: receipt,
      rollback: () => {
        const failures = restoreConfigSnapshots(snapshots, postimages);
        receipt.rolledBack = true;
        receipt.rollbackFailures = failures;
        return failures;
      },
    };
  } catch (error) {
    const rollbackFailures = restoreConfigSnapshots(snapshots, postimages);
    throw new SharedProviderInstallError((error as Error).message, {
      configured: 0,
      partialProviders,
      changedPaths: [...postimages.keys()],
      rolledBack: true,
      rollbackFailures,
    });
  }
}

export interface SharedProviderUninstallReceipt {
  changed: number;
  failures: string[];
}

/** Explicit machine-wide cleanup. Family off never calls this. */
export function uninstallSharedProviderHooks(
  targets = buildTargets(DEFAULT_HOME),
  options: { pdHome?: string } = {},
): SharedProviderUninstallReceipt {
  let changed = 0;
  const failures: string[] = [];
  try {
    assertAllSquidRepositoryFamiliesDisarmed(options.pdHome ?? PD_HOME);
  } catch (error) {
    return { changed: 0, failures: [(error as Error).message] };
  }
  for (const target of targets) {
    const carried = configCarriesPdHook(target.userConfigPath);
    const result = uninstallTarget(target, { scope: 'user' });
    if (!result.success) failures.push(`${target.slug}: ${result.error ?? 'uninstall failed'}`);
    else if (carried && !configCarriesPdHook(target.userConfigPath)) changed++;
  }
  return { changed, failures };
}

// ─── Silent install (pd init) ────────────────────────────────────────────────

export interface SilentHooksResult {
  configured: number;
  detected: string[];
  tentaclesMissing: boolean;
  failures: string[];
  activated: boolean;
  rolledBack: boolean;
  rollbackFailures: string[];
  partialProviders: ProviderSlug[];
  commitReadBack: boolean;
}

export interface HookTargetStatus {
  name: string;
  slug: string;
  detected: boolean;
  projectPath: string | null;
  userPath: string;
  projectWired: boolean;
  userWired: boolean;
  expectedScope: 'project' | 'user';
  wired: boolean;
  note?: string;
  projectArmed: boolean;
}

function configCarriesPdHook(path: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, 'utf8').includes(PD_HOOK_MARKER);
  } catch {
    return false;
  }
}

/** Read-only truth used by `pd squid status --json` and operator surfaces. */
export function inspectHookTargets(
  home = DEFAULT_HOME,
  cwd = process.cwd(),
  options: { pdHome?: string; targets?: AgentCliTarget[] } = {},
): HookTargetStatus[] {
  const pdHome = options.pdHome ?? PD_HOME;
  const projectArmed = isSquidRepositoryFamilyArmed(cwd, pdHome);
  return (options.targets ?? buildTargets(home)).map((target) => {
    const projectPath = target.projectConfigPath?.(cwd) ?? null;
    const projectWired = projectPath ? configCarriesPdHook(projectPath) : false;
    const userWired = configCarriesExpectedTargetHooks(target, target.userConfigPath, join(pdHome, 'bin'));
    const expectedScope = 'user' as const;
    return {
      name: target.name,
      slug: target.slug,
      detected: target.detect(),
      projectPath,
      userPath: target.userConfigPath,
      projectWired,
      userWired,
      expectedScope,
      wired: projectArmed && userWired,
      note: target.note,
      projectArmed,
    };
  });
}

/**
 * Stage one dormant user registration for every supported provider, sweep old
 * project-local PD blocks, then publish this repository family's marker last.
 */
export function silentHooksInstall(
  home = DEFAULT_HOME,
  opts: {
    cwd?: string;
    stage?: StageResult;
    resetHealthOnSuccess?: boolean;
    targets?: AgentCliTarget[];
    pdHome?: string;
    fault?: (point: HooksInstallFaultPoint) => void;
    authorityFault?: (point: RepositoryFamilyFaultPoint) => void;
  } = {},
): SilentHooksResult {
  const cwd = opts.cwd ?? process.cwd();
  const pdHome = opts.pdHome ?? PD_HOME;
  // `pd squid on` already stages once for the whole arm transaction. Reuse
  // that fulfilled result instead of repeating release-asset discovery/copies.
  const stage = opts.stage ?? stageTentacles();
  const targets = opts.targets ?? buildTargets(home);
  const detected = targets.filter((t) => t.detect());
  const result: SilentHooksResult = {
    configured: 0,
    detected: detected.map((t) => t.slug),
    tentaclesMissing: stage.missing.length > 0,
    failures: [],
    activated: false,
    rolledBack: false,
    rollbackFailures: [],
    partialProviders: [],
    commitReadBack: false,
  };
  if (result.tentaclesMissing) return result;
  const stageError = verifyStagedTentacles(stage, pdHome);
  if (stageError) {
    result.failures.push(stageError);
    return result;
  }
  let preparedReceipt: SharedProviderInstallReceipt | null = null;
  try {
    const transaction = transactSquidRepositoryFamilyArm(cwd, {
      pdHome,
      fault: (point) => {
        if (point === 'before-marker-commit') opts.fault?.('before-marker-commit');
        opts.authorityFault?.(point);
      },
    }, (_pending: PendingRepositoryFamilyArm) => {
      const worktrees = listVerifiedRepositoryFamilyWorktrees(cwd);
      const prepared = installSharedProviderHooksTransaction(targets, worktrees, stage.binDir, opts.fault);
      preparedReceipt = prepared.value;
      return prepared;
    });
    result.configured = transaction.value.configured;
    result.partialProviders = transaction.value.partialProviders;
    result.activated = true;
    result.commitReadBack = transaction.arm.commitReadBack;
  } catch (error) {
    result.failures.push((error as Error).message);
    if (error instanceof SharedProviderInstallError) {
      result.partialProviders = error.receipt.partialProviders;
      result.rolledBack = error.receipt.rolledBack;
      result.rollbackFailures = error.receipt.rollbackFailures;
    } else {
      const rollbackReceipt = preparedReceipt as SharedProviderInstallReceipt | null;
      if (rollbackReceipt?.rolledBack) {
        result.partialProviders = rollbackReceipt.partialProviders;
        result.rolledBack = true;
        result.rollbackFailures = rollbackReceipt.rollbackFailures;
      }
    }
  }
  if (result.activated && opts.resetHealthOnSuccess !== false) {
    resetSquidHookHealth();
  }
  return result;
}

// ─── Interactive command (pd hooks ...) ──────────────────────────────────────

export async function handleHooks(
  positional: string[],
  options: Record<string, unknown>,
  home = DEFAULT_HOME,
): Promise<void> {
  const sub = positional[0] ?? 'install';
  const targets = buildTargets(home);

  if (isHooksStatusRequest(sub, options)) {
    console.log('');
    ui.info('Port Daddy agent-CLI hooks (repository-family + daemon gated)');
    console.log('');
    const cwd = process.cwd();
    const family = inspectSquidRepositoryFamily(cwd);
    console.log(`  This repository family: ${family.armed ? '\x1b[32mARMED\x1b[0m' : '\x1b[2mnot armed\x1b[0m'} (${family.projectRoot ?? cwd})`);
    console.log('');
    for (const t of targets) {
      const present = t.detect();
      const status = present ? '\x1b[32m✓ installed\x1b[0m' : '\x1b[2m- not found\x1b[0m';
      const wired =
        existsSync(t.userConfigPath) && readFileSync(t.userConfigPath, 'utf-8').includes(PD_HOOK_MARKER)
          ? ' \x1b[32m(user-wired)\x1b[0m'
          : '';
      console.log(`    ${t.name.padEnd(22)} ${status}${wired}`);
      if (present && t.note) console.log(`      \x1b[2m${t.note}\x1b[0m`);
    }
    console.log('');
    return;
  }

  if (sub === 'uninstall' || sub === 'remove') {
    console.log('');
    ui.info('Removing Port Daddy-owned global hook registrations');
    const cwd = process.cwd();
    const roots = listVerifiedRepositoryFamilyWorktrees(cwd);
    // Revoke authority before mutating any provider config. A failed cleanup
    // must already be inert.
    const family = disarmSquidRepositoryFamily(cwd);
    for (const root of roots) {
      for (const target of targets) {
        const cleanup = uninstallTarget(target, { scope: 'project', cwd: root });
        if (!cleanup.success) ui.warn(`${target.name} legacy project cleanup: ${cleanup.error}`);
      }
    }
    const global = uninstallSharedProviderHooks(targets);
    if (global.failures.length > 0) {
      for (const failure of global.failures) ui.warn(failure);
      process.exitCode = 1;
    } else {
      ui.success(`Cleared ${global.changed} Port Daddy-owned user registration(s); user hooks were preserved.`);
    }
    if (family.revoked) ui.success('Revoked this repository family.');
    console.log('');
    return;
  }

  // install
  console.log('');
  ui.info('Port Daddy — agent-CLI interactive hooks (this local repository family)');
  console.log('');

  const detected = targets.filter((t) => t.detect());
  if (detected.length === 0) {
    ui.info('No agent CLIs are installed yet; staging dormant adapters for claude, codex, gemini, and agy.');
  }

  const cwd = process.cwd();
  console.log('  Detected: ' + (detected.length > 0 ? detected.map((t) => t.name).join(', ') : 'none yet'));
  console.log(`  One dormant user registration per provider; activation is this local repository family (${cwd}).`);
  console.log('  Unrelated clones and unarmed projects remain inert.');
  console.log('');

  const assumeYes = !!options.yes || !!options.y || !ui.canPrompt();
  const proceed = assumeYes ? true : await ui.confirm('Wire coordination hooks for this project?', true);
  if (!proceed) {
    ui.info('Skipped. Run `pd hooks install` any time.');
    return;
  }

  const stage = stageTentacles();
  if (stage.missing.length > 0) {
    ui.warn(`Squid tentacles not found on this build (${stage.missing.join(', ')}).`);
    console.log('  The hook scripts (bin/pd-hook-*) ship with the Giant Squid Harness.');
    console.log('  Update Port Daddy, then re-run `pd hooks install`.');
    console.log('');
    process.exitCode = 1;
    return;
  }
  ui.success(`Staged tentacles + family gate → ${tentacleBinDir()}`);
  const install = silentHooksInstall(home, { cwd, stage, targets });

  console.log('');
  if (!install.activated) {
    ui.warn(`Hook installation failed closed; this repository family remains inert (${install.failures.join('; ')}).`);
    if (install.rolledBack) ui.info(`Rolled back provider writes (${install.partialProviders.join(', ') || 'none'} reached).`);
    process.exitCode = 1;
  } else {
    ui.success('Coordination hooks registered once and armed for this repository family.');
  }
  if (detected.some((t) => t.slug === 'codex')) {
    console.log('  Codex: run `codex` → `/hooks` once to trust the pd hooks (persisted thereafter).');
  }
  console.log('  Verify:  pd hooks list   ·   Remove:  pd hooks uninstall');
  console.log('');
}

export function isHooksStatusRequest(sub: string, options: Record<string, unknown>): boolean {
  return sub === 'list' || sub === 'status' || !!options.list || !!options.status;
}
