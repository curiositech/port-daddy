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
  local -a subcmds
  subcmds=(
    'set:set URL for an environment'
    'rm:remove URL for an environment'
    'list:list all URLs for a service'
    'ls:list all URLs for a service (alias)'
  )

  # Check if first arg is a subcommand
  if (( CURRENT == 2 )); then
    _alternative \
      'subcommands:subcommand:_describe "subcommand" subcmds' \
      'identities:service identity:_pd_complete_services'
    return
  fi

  local subcmd="${words[2]}"
  case "$subcmd" in
    set)
      case $CURRENT in
        3) _pd_complete_services ;;
        4) _values 'environment' dev staging prod local tunnel ;;
        5) _message 'URL (e.g. https://example.com)' ;;
      esac
      ;;
    rm|remove)
      case $CURRENT in
        3) _pd_complete_services ;;
        4) _values 'environment' dev staging prod local tunnel ;;
      esac
      ;;
    list|ls)
      _pd_complete_services
      ;;
    *)
      # Original behavior: pd url <identity>
      _arguments \
        '(-e --env)'{-e,--env}'[environment name]:env name:(dev staging prod)' \
        '--open[open URL in browser]' \
        '(-j --json)'{-j,--json}'[JSON output]' \
        '(-q --quiet)'{-q,--quiet}'[suppress output]' \
        '(-h --help)'{-h,--help}'[show help]' \
        '1:service identity:_pd_complete_services'
      ;;
  esac
}

_pd_cmd_tunnel() {
  local -a subcmds
  subcmds=(
    'start:start a tunnel for a service'
    'stop:stop a tunnel'
    'status:get tunnel status'
    'list:list all active tunnels'
    'ls:list all active tunnels (alias)'
    'providers:check installed tunnel providers'
  )

  if (( CURRENT == 2 )); then
    _describe 'subcommand' subcmds
    return
  fi

  local subcmd="${words[2]}"
  case "$subcmd" in
    start)
      _arguments \
        '--provider[tunnel provider]:provider:(ngrok cloudflared localtunnel)' \
        '(-j --json)'{-j,--json}'[JSON output]' \
        '(-q --quiet)'{-q,--quiet}'[suppress output]' \
        '(-h --help)'{-h,--help}'[show help]' \
        '1:service identity:_pd_complete_services'
      ;;
    stop|status)
      _arguments \
        '(-j --json)'{-j,--json}'[JSON output]' \
        '(-q --quiet)'{-q,--quiet}'[suppress output]' \
        '(-h --help)'{-h,--help}'[show help]' \
        '1:service identity:_pd_complete_services'
      ;;
    list|ls|providers)
      _arguments \
        '(-j --json)'{-j,--json}'[JSON output]' \
        '(-q --quiet)'{-q,--quiet}'[suppress output]' \
        '(-h --help)'{-h,--help}'[show help]'
      ;;
  esac
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
  local -a lock_subcmds
  lock_subcmds=(
    'extend:extend a lock TTL'
  )

  local state
  _arguments -C \
    '--ttl[lock TTL in seconds]:seconds:' \
    '--owner[owner agent ID]:agent ID:_pd_complete_agents' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:lock name or subcommand:->first_arg' \
    && return

  case "$state" in
    first_arg)
      _alternative \
        'subcommands:subcommand:_describe "lock subcommand" lock_subcmds' \
        'locks:lock name:_pd_complete_locks'
      ;;
  esac
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
            '--identity[semantic identity (project:stack:context)]:identity:_pd_complete_services' \
            '--purpose[what the agent is working on]:purpose:' \
            '--worktree[git worktree identifier]:worktree:' \
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
    '--from[start of time range]:ISO timestamp or epoch:' \
    '--to[end of time range]:ISO timestamp or epoch:' \
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

_pd_cmd_dashboard() {
  _arguments \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_channels() {
  local -a channels_subcmds
  channels_subcmds=(
    'clear:clear messages from a channel'
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
      _alternative \
        'subcommands:subcommand:_describe "channels subcommand" channels_subcmds'
      ;;
  esac
}

_pd_cmd_webhook() {
  local -a webhook_subcmds
  webhook_subcmds=(
    'list:list all webhooks'
    'events:list available webhook events'
    'test:send test delivery to a webhook'
    'update:update a webhook'
    'rm:delete a webhook'
    'deliveries:list webhook deliveries'
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
      _describe 'webhook subcommand' webhook_subcmds
      ;;
  esac
}

_pd_cmd_metrics() {
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_config() {
  _arguments \
    '--dir[target directory]:directory:_directories' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_health() {
  _arguments \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:service ID:_pd_complete_services'
}

_pd_cmd_ports() {
  local -a ports_subcmds
  ports_subcmds=(
    'cleanup:release stale port assignments'
  )

  local state
  _arguments -C \
    '--system[show system/well-known ports]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:subcommand:->subcommand' \
    && return

  case "$state" in
    subcommand)
      _describe 'ports subcommand' ports_subcmds
      ;;
  esac
}

_pd_cmd_up() {
  _arguments \
    '--service[start only this service and its dependencies]:service name:' \
    '--no-health[skip health checks]' \
    '--branch[use git branch as context in identity]' \
    '--timeout[health check timeout in ms]:milliseconds:' \
    '--dir[target directory]:directory:_directories' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_down() {
  _arguments \
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

_pd_cmd_session() {
  local -a session_subcmds
  session_subcmds=(
    'start:start a new session'
    'end:end a session (completed)'
    'done:end a session (alias for end)'
    'abandon:abandon a session'
    'rm:delete a session and cascade notes/files'
    'files:manage file claims for a session'
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
      _describe 'session subcommand' session_subcmds
      ;;
    args)
      subcmd="${words[1]}"
      case "$subcmd" in
        start)
          _arguments \
            '--agent[agent ID]:agent ID:_pd_complete_agents' \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:purpose:'
          ;;
        end|done)
          _arguments \
            '--note[handoff note]:note:' \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:session ID:'
          ;;
        abandon|rm)
          _arguments \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:session ID:'
          ;;
        files)
          local -a files_subcmds
          files_subcmds=(
            'add:claim files for a session'
            'rm:release files from a session'
          )
          _arguments -C \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:subcommand:->files_sub' \
            && return
          case "$state" in
            files_sub)
              _describe 'files subcommand' files_subcmds
              ;;
          esac
          ;;
      esac
      ;;
  esac
}

_pd_cmd_sessions() {
  _arguments \
    '--all[show all sessions, not just active]' \
    '--status[filter by status]:status:(active completed abandoned)' \
    '--files[include file claims]' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]'
}

_pd_cmd_note() {
  _arguments \
    '--type[note type]:type:(note handoff commit warning)' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:content:'
}

_pd_cmd_notes() {
  _arguments \
    '--limit[max entries to return]:count:' \
    '--type[filter by note type]:type:(note handoff commit warning)' \
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

_pd_cmd_salvage() {
  local -a salvage_subcmds
  salvage_subcmds=(
    'claim:claim a dead agent'\''s work for resurrection'
    'complete:mark resurrection as complete'
    'abandon:return agent to resurrection queue'
    'dismiss:remove agent from queue (reviewed, not resurrecting)'
  )

  local state subcmd
  _arguments -C \
    '--project[filter to agents in this project]:project name:' \
    '--stack[filter by stack (requires --project)]:stack name:' \
    '--all[show ALL queue entries globally (use sparingly)]' \
    '--limit[max entries to return]:count:' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:subcommand:->subcommand' \
    '*::subcommand args:->args' \
    && return

  case "$state" in
    subcommand)
      _describe 'salvage subcommand' salvage_subcmds
      ;;
    args)
      subcmd="${words[1]}"
      case "$subcmd" in
        claim|abandon|dismiss)
          _arguments \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:agent ID:_pd_complete_agents'
          ;;
        complete)
          _arguments \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:old agent ID:_pd_complete_agents' \
            '2:new agent ID:'
          ;;
      esac
      ;;
  esac
}

_pd_cmd_changelog() {
  local -a changelog_subcmds
  changelog_subcmds=(
    'add:add a changelog entry'
    'show:show changes for an identity'
    'tree:show changes for identity and children'
    'export:export changelog as markdown'
    'identities:list all identities with changelog entries'
  )

  local state subcmd
  _arguments -C \
    '--limit[max entries to return]:count:' \
    '(-j --json)'{-j,--json}'[JSON output]' \
    '(-q --quiet)'{-q,--quiet}'[suppress output]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1:subcommand:->subcommand' \
    '*::subcommand args:->args' \
    && return

  case "$state" in
    subcommand)
      _describe 'changelog subcommand' changelog_subcmds
      ;;
    args)
      subcmd="${words[1]}"
      case "$subcmd" in
        add)
          _arguments \
            '--type[change type]:type:(feature fix refactor docs chore breaking)' \
            '--description[detailed description]:description:' \
            '--session[link to session ID]:session ID:' \
            '--agent[link to agent ID]:agent ID:_pd_complete_agents' \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:identity (project:service:feature):_pd_complete_services' \
            '2:summary:'
          ;;
        show|tree)
          _arguments \
            '--limit[max entries to return]:count:' \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:identity:_pd_complete_services'
          ;;
        export)
          _arguments \
            '--format[output format]:format:(flat tree keep-a-changelog)' \
            '--limit[max entries to return]:count:' \
            '--since[filter by timestamp]:timestamp:' \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]' \
            '1:identity:_pd_complete_services'
          ;;
        identities)
          _arguments \
            '(-j --json)'{-j,--json}'[JSON output]' \
            '(-q --quiet)'{-q,--quiet}'[suppress output]'
          ;;
      esac
      ;;
  esac
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
    'services:list all active services (alias for list)'
    'url:manage service URLs (get/set/rm/list)'
    'env:get environment variable block for a service'
    'tunnel:manage tunnels (start/stop/status/list)'
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
    # Sessions & Notes
    'session:manage a session (start/end/abandon/rm/files)'
    'sessions:list sessions'
    'note:add a quick note'
    'notes:list recent notes'
    # Agent Resurrection
    'salvage:check for dead agents with recoverable work'
    'resurrection:check for dead agents (alias for salvage)'
    # Changelog
    'changelog:hierarchical changelog with identity-based rollup'
    # System & Monitoring
    'dashboard:open web dashboard in browser'
    'channels:list pub/sub channels'
    'webhook:manage webhooks'
    'webhooks:manage webhooks (alias for webhook)'
    'metrics:show daemon metrics'
    'config:show resolved configuration'
    'health:check service health'
    'ports:list active port assignments'
    # Orchestration
    'up:start all services (auto-detect or from .portdaddyrc)'
    'down:stop all services started by up'
    # Project (+ aliases)
    'scan:deep-scan project for frameworks and register with daemon'
    's:deep-scan project (alias for scan)'
    'projects:list or manage registered projects'
    'p:list or manage projects (alias for projects)'
    'doctor:run environment diagnostics'
    'diagnose:run environment diagnostics (alias for doctor)'
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
        l|list|ps|services)  _pd_cmd_list ;;
        url)                _pd_cmd_url ;;
        env)                _pd_cmd_env ;;
        tunnel)             _pd_cmd_tunnel ;;
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
        session)            _pd_cmd_session ;;
        sessions)           _pd_cmd_sessions ;;
        note)               _pd_cmd_note ;;
        notes)              _pd_cmd_notes ;;
        salvage|resurrection) _pd_cmd_salvage ;;
        changelog)          _pd_cmd_changelog ;;
        up)                 _pd_cmd_up ;;
        down)               _pd_cmd_down ;;
        s|scan)             _pd_cmd_scan ;;
        p|projects)         _pd_cmd_projects ;;
        doctor|diagnose)    _pd_cmd_doctor ;;
        start|stop|restart|status|install|uninstall|dev|ci-gate)
                            _pd_cmd_daemon ;;
        dashboard)              _pd_cmd_dashboard ;;
        channels)               _pd_cmd_channels ;;
        webhook|webhooks)       _pd_cmd_webhook ;;
        metrics)                _pd_cmd_metrics ;;
        config)                 _pd_cmd_config ;;
        health)                 _pd_cmd_health ;;
        ports)                  _pd_cmd_ports ;;
        version|help)       ;;
        *)                  ;;
      esac
      ;;
  esac
}

_port_daddy "$@"
