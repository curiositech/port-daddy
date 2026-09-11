/**
 * Filesystem-only admission for automatic hooks. Motivation: observing an off
 * runtime must never start its CLI, contact its transport, or execute a helper.
 * The canonical operator stop always outranks a selected development PD_HOME.
 * These functions are embedded, not sourced from a mutable checkout at runtime.
 */
export const HOOK_OFF_GATE = `pd_hook_runtime_enabled() (
  [ "$#" -eq 2 ] && [ -n "$1" ] && [ -n "$2" ] || exit 1
  pd_gate_home="$2"
  for pd_gate_root in "$1" "$pd_gate_home"; do
    if [ ! -e "$pd_gate_root" ] && [ ! -L "$pd_gate_root" ]; then
      [ -d "\${pd_gate_root%/*}" ] && [ -r "\${pd_gate_root%/*}" ] && [ -x "\${pd_gate_root%/*}" ] || exit 1
      continue
    fi
    [ -d "$pd_gate_root" ] && [ -r "$pd_gate_root" ] && [ -x "$pd_gate_root" ] && [ ! -L "$pd_gate_root" ] || exit 1
    for pd_gate_marker in "$pd_gate_root/hooks.disabled" "$pd_gate_root/HALT"; do
      [ ! -e "$pd_gate_marker" ] && [ ! -L "$pd_gate_marker" ] || exit 1
    done
  done
  pd_gate_halt="\${PD_HALT_FILE:-$pd_gate_home/HALT}"
  case "$pd_gate_halt" in /*) ;; *) exit 1 ;; esac
  pd_gate_parent="\${pd_gate_halt%/*}"
  [ -d "$pd_gate_parent" ] && [ -r "$pd_gate_parent" ] && [ -x "$pd_gate_parent" ] || exit 1
  [ ! -e "$pd_gate_halt" ] && [ ! -L "$pd_gate_halt" ]
)`;

/**
 * Local readiness is a further requirement, never permission to lift Off.
 * Purpose: a stopped, booting, stale or malformed daemon generation cannot be
 * summoned by a Git operation. This is liveness gating, not hostile isolation.
 */
export const HOOK_READY_GATE = `${HOOK_OFF_GATE}
pd_hook_read_pid() (
  # Read at most eleven bytes plus one overflow witness. Decode octets rather
  # than command-substituting raw bytes (shells discard NUL and final newlines).
  pd_pid_octets=$(od -An -tu1 -N12 "$1" 2>/dev/null) || exit 1
  pd_pid_value=
  pd_pid_newline=0
  for pd_pid_octet in $pd_pid_octets; do
    [ "$pd_pid_newline" -eq 0 ] || exit 1
    case "$pd_pid_octet" in
      48|49|50|51|52|53|54|55|56|57) pd_pid_value="$pd_pid_value$((pd_pid_octet - 48))" ;;
      10) pd_pid_newline=1 ;;
      *) exit 1 ;;
    esac
    [ "\${#pd_pid_value}" -le 10 ] || exit 1
  done
  case "$pd_pid_value" in ''|0*) exit 1 ;; esac
  printf '%s' "$pd_pid_value"
)
pd_hook_runtime_ready() (
  pd_hook_runtime_enabled "$@" || exit 1
  pd_gate_home="$2"
  pd_gate_ready="\${PORT_DADDY_READY_FILE:-$pd_gate_home/daemon.ready}"
  pd_gate_pid="\${PORT_DADDY_PID_FILE:-$pd_gate_home/daemon.pid}"
  pd_gate_heartbeat="\${PORT_DADDY_HEARTBEAT_FILE:-$pd_gate_home/heartbeat}"
  for pd_gate_file in "$pd_gate_ready" "$pd_gate_pid" "$pd_gate_heartbeat"; do
    [ -f "$pd_gate_file" ] && [ -r "$pd_gate_file" ] && [ ! -L "$pd_gate_file" ] || exit 1
  done
  pd_gate_ready_pid=$(pd_hook_read_pid "$pd_gate_ready") || exit 1
  pd_gate_daemon_pid=$(pd_hook_read_pid "$pd_gate_pid") || exit 1
  [ "$pd_gate_ready_pid" = "$pd_gate_daemon_pid" ] || exit 1
  pd_gate_mtime=$(stat -c %Y "$pd_gate_heartbeat" 2>/dev/null || true)
  case "$pd_gate_mtime" in ''|*[!0-9]*) pd_gate_mtime=$(stat -f %m "$pd_gate_heartbeat" 2>/dev/null || true) ;; esac
  pd_gate_now=$(date +%s 2>/dev/null || true)
  case "$pd_gate_mtime:$pd_gate_now" in *[!0-9:]*|:*|*:) exit 1 ;; esac
  pd_gate_age=$((pd_gate_now - pd_gate_mtime))
  [ "$pd_gate_age" -ge 0 ] && [ "$pd_gate_age" -le 30 ] || exit 1
  pd_hook_runtime_enabled "$@"
)`;

/**
 * Embed the same versioned gate into standalone assets; tests compare exact
 * bytes to prevent a repaired generator leaving shipped templates behind.
 * @param ready Whether this entry point requires a ready local generation.
 * @returns A self-contained, bounded, daemon-free shell preamble.
 */
export function hookRuntimePreamble(ready = true): string {
  return `# >>> Port Daddy automatic-hook runtime gate\n${ready ? HOOK_READY_GATE : HOOK_OFF_GATE}\n` +
    `pd_hook_runtime_${ready ? 'ready' : 'enabled'} "\${HOME:+$HOME/.port-daddy}" "\${PD_HOME:-\${HOME:+$HOME/.port-daddy}}" || exit 0\n# <<< Port Daddy automatic-hook runtime gate\n`;
}
