#compdef port-daddy pd

# Zsh completion for Port Daddy v2 CLI
#
# INSTALLATION:
#   Option 1 — Fpath (recommended):
#     Place this file in a directory listed in $fpath, e.g.:
#       mkdir -p ~/.zsh/completions
#       cp port-daddy.zsh ~/.zsh/completions/_port-daddy
#     Then add to ~/.zshrc (before compinit):
#       fpath=(~/.zsh/completions $fpath)
#       autoload -Uz compinit && compinit
#
#   Option 2 — Oh My Zsh:
#     cp port-daddy.zsh ~/.oh-my-zsh/completions/_port-daddy
#     Then restart your shell or run: omz reload
#
#   Option 3 — System-wide (macOS with Homebrew zsh):
#     cp port-daddy.zsh "$(brew --prefix)/share/zsh/site-functions/_port-daddy"
#
#   Option 4 — Direct source (quick test, no caching):
#     echo 'source /path/to/port-daddy/completions/port-daddy.zsh' >> ~/.zshrc
#     (Note: sourcing bypasses compdef; use fpath for proper registration)
#
# REQUIREMENTS:
#   - Zsh 5.1+
#   - curl (for dynamic completions from the running daemon)
#
# DYNAMIC COMPLETIONS:
#   When the daemon is running on localhost:9876, completions for service
#   identities, channels, locks, and agent IDs are fetched live.
#   If the daemon is not running, dynamic completions are silently skipped.

# ---------------------------------------------------------------------------
# Helpers — daemon queries
# ---------------------------------------------------------------------------

# Query the daemon with a 1-second timeout; emit nothing on failure.
_pd_query() {
  local path="$1"
  curl -s --max-time 1 "http://localhost:9876${path}" 2>/dev/null
}

# Populate $reply with active service IDs from the daemon.
_pd_service_ids() {
  local raw
  raw="$(_pd_query '/services')"
  reply=( ${(f)"$(printf '%s\n' "$raw" | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//')"} )
}

# Populate $reply with channel names from the daemon.
_pd_channels() {
  local raw
  raw="$(_pd_query '/channels')"
  reply=( ${(f)"$(printf '%s\n' "$raw" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//')"} )
}

# Populate $reply with active lock names from the daemon.
_pd_lock_names() {
  local raw
  raw="$(_pd_query '/locks')"
  reply=( ${(f)"$(printf '%s\n' "$raw" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//')"} )
}

# Populate $reply with registered agent IDs from the daemon.
_pd_agent_ids() {
  local raw
  raw="$(_pd_query '/agents')"
  reply=( ${(f)"$(printf '%s\n' "$raw" | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//')"} )
}

# ---------------------------------------------------------------------------
# Dynamic completion helpers (used with _arguments / _alternative)
# ---------------------------------------------------------------------------

_pd_complete_services() {
  local -a ids
  _pd_service_ids
  ids=("${reply[@]}")
  if (( ${#ids[@]} > 0 )); then
    _describe 'service identity' ids
  fi
}

_pd_complete_channels() {
  local -a names
  _pd_channels
  names=("${reply[@]}")
  if (( ${#names[@]} > 0 )); then
    _describe 'channel' names
  fi
}

_pd_complete_locks() {
  local -a names
  _pd_lock_names
  names=("${reply[@]}")
  if (( ${#names[@]} > 0 )); then
    _describe 'lock name' names
  fi
}

_pd_complete_agents() {
  local -a ids
  _pd_agent_ids
  ids=("${reply[@]}")
  if (( ${#ids[@]} > 0 )); then
    _describe 'agent ID' ids
  fi
}

# ---------------------------------------------------------------------------
# Sub-completions
# ---------------------------------------------------------------------------

_pd_cmd_claim() {
  _arguments \
    '(-p --port)'{-p,--port}'[port number to request]:port number:' \
    '--range[port range (lo-hi)]:range (lo-hi):' \
    '--expires[TTL in seconds]:seconds:' \
    '--pair[paired service identity]:service:_pd_complete_services' \
    '--cmd[command to associate]:command:_command_names' \
    '--export[print export PORT=N for eval]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:service identity:_pd_complete_services'
}

_pd_cmd_release() {
  _arguments \
    '--expired[release all expired services]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:service identity:_pd_complete_services'
}

_pd_cmd_find() {
  _arguments \
    '--status[filter by status]:status:(active expired all)' \
    '--port[filter by port number]:port number:' \
    '--expired[include expired]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:service identity:_pd_complete_services'
}

_pd_cmd_list() {
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_url() {
  _arguments \
    '(-e --env)'{-e,--env}'[environment name]:env name:(dev staging prod)' \
    '--open[open URL in browser]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:service identity:_pd_complete_services'
}

_pd_cmd_env() {
  _arguments \
    '--file[write env vars to file]:file:_files' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:service identity:_pd_complete_services'
}

_pd_cmd_pub() {
  _arguments \
    '--sender[sender agent ID]:agent ID:_pd_complete_agents' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:channel:_pd_complete_channels' \
    '2:message:'
}

_pd_cmd_sub() {
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:channel:_pd_complete_channels'
}

_pd_cmd_wait() {
  _arguments \
    '--timeout[timeout in seconds]:seconds:' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:service identity:_pd_complete_services'
}

_pd_cmd_lock() {
  _arguments \
    '--ttl[lock TTL in seconds]:seconds:' \
    '--owner[owner agent ID]:agent ID:_pd_complete_agents' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:lock name:_pd_complete_locks'
}

_pd_cmd_unlock() {
  _arguments \
    '--force[force-release even if not owner]' \
    '--owner[owner agent ID]:agent ID:_pd_complete_agents' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:lock name:_pd_complete_locks'
}

_pd_cmd_locks() {
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_agent() {
  local -a agent_subcmds
  agent_subcmds=(
    'register:register a new agent'
    'heartbeat:send a heartbeat for an agent'
    'unregister:unregister an agent'
  )

  local state subcmd
  _arguments -C \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:subcommand:->subcommand' \
    '*::subcommand args:->args' \
    && return

  case "$state" in
    subcommand)
      _describe 'agent subcommand' agent_subcmds
      ;;
    args)
      subcmd="${words[1]}"
      case "$subcmd" in
        register)
          _arguments \
            '--agent[agent ID]:agent ID:' \
            '--type[agent type]:type:(worker orchestrator monitor generic)' \
            '--name[human-readable name]:name:' \
            '--maxServices[max services]:count:' \
            '--maxLocks[max locks]:count:' \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]'
          ;;
        heartbeat|unregister)
          _arguments \
            '--agent[agent ID]:agent ID:_pd_complete_agents' \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:agent ID:_pd_complete_agents'
          ;;
      esac
      ;;
  esac
}

_pd_cmd_agents() {
  _arguments \
    '--active[show only active agents]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_log() {
  _arguments \
    '--limit[max entries to return]:count:' \
    '--type[activity type]:type:(claim release lock unlock pub sub agent heartbeat)' \
    '--agent[filter by agent ID]:agent ID:_pd_complete_agents' \
    '--target[filter by target service ID]:service ID:_pd_complete_services' \
    '--since[only entries after timestamp]:ISO timestamp:' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_activity() {
  local -a activity_subcmds
  activity_subcmds=(
    'summary:show activity summary'
    'stats:show activity statistics'
  )

  local state
  _arguments -C \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:subcommand:->subcommand' \
    && return

  case "$state" in
    subcommand)
      _describe 'activity subcommand' activity_subcmds
      ;;
  esac
}

_pd_cmd_scan() {
  _arguments \
    '--dry-run[preview scan results without saving config]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_projects() {
  local -a projects_subcmds
  projects_subcmds=(
    'rm:remove a registered project'
  )

  local state
  _arguments -C \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:subcommand:->subcommand' \
    '*::subcommand args:->args' \
    && return

  case "$state" in
    subcommand)
      _describe 'projects subcommand' projects_subcmds
      ;;
    args)
      ;;
  esac
}

_pd_cmd_detect() {
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_init() {
  _arguments \
    '--dry-run[preview config without saving]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_doctor() {
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_daemon() {
  # Shared completion for daemon lifecycle commands: start stop restart status
  # install uninstall dev ci-gate
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

# ---------------------------------------------------------------------------
# Main completion entry point
# ---------------------------------------------------------------------------

_port_daddy() {
  local -a commands
  commands=(
    # Service management (+ single-letter aliases)
    'claim:claim a port for a service'
    'c:claim a port (alias for claim)'
    'release:release a service port'
    'r:release a service port (alias for release)'
    'find:find a service by identity or port'
    'f:find a service (alias for find)'
    'list:list all active services'
    'l:list all active services (alias for list)'
    'ps:list all active services (alias for list)'
    'url:get the URL for a service'
    'env:get environment variable block for a service'
    # Agent coordination
    'pub:publish a message to a channel'
    'publish:publish a message to a channel (alias for pub)'
    'sub:subscribe to a channel (streaming)'
    'subscribe:subscribe to a channel (alias for sub)'
    'wait:wait until a service is claimed'
    'lock:acquire a distributed lock'
    'unlock:release a distributed lock'
    'locks:list all active locks'
    # Agent registry
    'agent:manage an agent (register/heartbeat/unregister)'
    'agents:list registered agents'
    # Activity
    'log:tail the activity log'
    'activity:show activity summary or stats'
    # Project (+ aliases)
    'scan:deep-scan project for frameworks and register with daemon'
    's:deep-scan project (alias for scan)'
    'projects:list or manage registered projects'
    'p:list or manage projects (alias for projects)'
    'detect:detect framework (deprecated, use scan)'
    'init:initialise a project config (deprecated, use scan)'
    'doctor:run environment diagnostics'
    # Daemon lifecycle
    'start:start the Port Daddy daemon'
    'stop:stop the Port Daddy daemon'
    'restart:restart the Port Daddy daemon'
    'status:show daemon status'
    'install:install daemon as a system service'
    'uninstall:uninstall the system service'
    'dev:start daemon in development mode (foreground)'
    'ci-gate:exit non-zero if daemon is running stale code'
    # Info
    'version:print version information'
    'help:show help'
  )

  local -a global_opts
  global_opts=(
    '(-j --json)'{-j,--json}'[output JSON]'
    '(-q --quiet)'{-q,--quiet}'[suppress non-essential output]'
    '(-h --help)'{-h,--help}'[show help]'
    '(-V --version)'{-V,--version}'[print version]'
  )

  local state
  _arguments -C \
    "${global_opts[@]}" \
    '1:command:->command' \
    '*::command args:->args' \
    && return

  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      local cmd="${words[1]}"
      case "$cmd" in
        c|claim)            _pd_cmd_claim ;;
        r|release)          _pd_cmd_release ;;
        f|find)             _pd_cmd_find ;;
        l|list|ps)          _pd_cmd_list ;;
        url)                _pd_cmd_url ;;
        env)                _pd_cmd_env ;;
        pub|publish)        _pd_cmd_pub ;;
        sub|subscribe)      _pd_cmd_sub ;;
        wait)               _pd_cmd_wait ;;
        lock)               _pd_cmd_lock ;;
        unlock)             _pd_cmd_unlock ;;
        locks)              _pd_cmd_locks ;;
        agent)              _pd_cmd_agent ;;
        agents)             _pd_cmd_agents ;;
        log)                _pd_cmd_log ;;
        activity)           _pd_cmd_activity ;;
        s|scan)             _pd_cmd_scan ;;
        p|projects)         _pd_cmd_projects ;;
        detect)             _pd_cmd_detect ;;
        init)               _pd_cmd_init ;;
        doctor)             _pd_cmd_doctor ;;
        start|stop|restart|status|install|uninstall|dev|ci-gate)
                            _pd_cmd_daemon ;;
        version|help)       ;;
        *)                  ;;
      esac
      ;;
  esac
}

_port_daddy "$@"
