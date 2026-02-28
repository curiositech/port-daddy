#!/usr/bin/env bash

# Bash completion for Port Daddy v2 CLI
#
# INSTALLATION:
#   Option 1 — Source from your shell config:
#     echo 'source /path/to/port-daddy/completions/port-daddy.bash' >> ~/.bashrc
#
#   Option 2 — System-wide (Linux):
#     sudo cp port-daddy.bash /etc/bash_completion.d/port-daddy
#
#   Option 3 — System-wide (macOS with bash-completion@2 via Homebrew):
#     cp port-daddy.bash "$(brew --prefix)/etc/bash_completion.d/port-daddy"
#
# REQUIREMENTS:
#   - Bash 4.1+ (macOS ships Bash 3.2; install a newer one via Homebrew)
#   - curl (for dynamic completions from the running daemon)
#
# DYNAMIC COMPLETIONS:
#   When the daemon is running on localhost:9876, completions for service
#   identities, channels, locks, and agent IDs are fetched live.
#   If the daemon is not running, dynamic completions are silently skipped.

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Query the daemon with a 1-second timeout; print nothing on failure.
_pd_query() {
  local path="$1"
  curl -s --max-time 1 "http://localhost:9876${path}" 2>/dev/null
}

# Return a newline-separated list of active service IDs from the daemon.
_pd_service_ids() {
  _pd_query '/services' | \
    grep -o '"id":"[^"]*"' | \
    sed 's/"id":"//;s/"//' | \
    sort -u
}

# Return a newline-separated list of known channel names.
_pd_channels() {
  _pd_query '/channels' | \
    grep -o '"name":"[^"]*"' | \
    sed 's/"name":"//;s/"//' | \
    sort -u
}

# Return a newline-separated list of active lock names.
_pd_lock_names() {
  _pd_query '/locks' | \
    grep -o '"name":"[^"]*"' | \
    sed 's/"name":"//;s/"//' | \
    sort -u
}

# Return a newline-separated list of registered agent IDs.
_pd_agent_ids() {
  _pd_query '/agents' | \
    grep -o '"id":"[^"]*"' | \
    sed 's/"id":"//;s/"//' | \
    sort -u
}

# ---------------------------------------------------------------------------
# Main completion function
# ---------------------------------------------------------------------------

_port_daddy() {
  local cur prev words cword
  # Use _init_completion if available (bash-completion package); fall back
  # to manual setup so the file works without the package installed.
  if declare -f _init_completion &>/dev/null; then
    _init_completion || return
  else
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    words=("${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  fi

  # -------------------------------------------------------------------------
  # Top-level commands
  # -------------------------------------------------------------------------
  local commands=(
    # Service management (+ single-letter aliases)
    claim c release r find f list l services ps status url env tunnel
    # Agent coordination
    pub publish sub subscribe wait lock unlock locks
    # Agent registry
    agent agents
    # Activity
    log activity
    # Sessions & Notes
    session sessions note notes
    # Agent Resurrection & Changelog
    salvage resurrection changelog
    # System & Monitoring
    dashboard channels webhook webhooks metrics config health ports
    # Orchestration
    up down
    # Project (+ alias)
    scan s projects p doctor diagnose
    # Daemon lifecycle
    start stop restart install uninstall dev ci-gate
    # Info
    version help
  )

  # Global options (valid at any position)
  local global_opts='-j --json -q --quiet -h --help -V --version'

  # The first real argument (position 1) is the command.
  local cmd=""
  local i
  for (( i = 1; i < cword; i++ )); do
    local w="${words[$i]}"
    # Skip option words to find the command token.
    if [[ "$w" != -* ]]; then
      cmd="$w"
      break
    fi
  done

  # -------------------------------------------------------------------------
  # No command typed yet — complete commands or global options.
  # -------------------------------------------------------------------------
  if [[ -z "$cmd" ]]; then
    if [[ "$cur" == -* ]]; then
      # shellcheck disable=SC2207
      COMPREPLY=( $(compgen -W "$global_opts" -- "$cur") )
    else
      # shellcheck disable=SC2207
      COMPREPLY=( $(compgen -W "${commands[*]}" -- "$cur") )
    fi
    return 0
  fi

  # -------------------------------------------------------------------------
  # Command-specific completions
  # -------------------------------------------------------------------------

  # Helper: add global opts on top of per-command opts when cur starts with -.
  _pd_opts() {
    local cmd_opts="$1"
    # shellcheck disable=SC2207
    COMPREPLY=( $(compgen -W "$cmd_opts $global_opts" -- "$cur") )
  }

  # Helper: complete service identity from daemon (first positional arg).
  _pd_complete_service() {
    local cmd_opts="$1"
    if [[ "$cur" == -* ]]; then
      _pd_opts "$cmd_opts"
    else
      local ids
      ids="$(_pd_service_ids)"
      # shellcheck disable=SC2207
      COMPREPLY=( $(compgen -W "$ids" -- "$cur") )
    fi
  }

  case "$cmd" in

    # -----------------------------------------------------------------------
    # claim  [identity] [--port N] [--range lo-hi] [--expires N] [--pair id]
    #                   [--cmd "..."]
    # -----------------------------------------------------------------------
    c|claim)
      _pd_complete_service '--port -p --range --expires --pair --cmd --export'
      ;;

    # -----------------------------------------------------------------------
    # release  [identity] [--expired]
    # -----------------------------------------------------------------------
    r|release)
      case "$prev" in
        r|release)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--expired'
          else
            local ids; ids="$(_pd_service_ids)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$ids" -- "$cur") )
          fi
          ;;
        *) _pd_opts '--expired' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # find  [identity] [--status STATUS] [--port N] [--expired]
    # -----------------------------------------------------------------------
    f|find)
      case "$prev" in
        --status)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "active expired all" -- "$cur") )
          ;;
        --port)
          # Port numbers — no useful static list; leave blank.
          COMPREPLY=()
          ;;
        *)
          _pd_complete_service '--status --port --expired'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # list / l / ps  (no arguments)
    # -----------------------------------------------------------------------
    l|list|ps)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # url  [subcommand|identity] [-e/--env] [--open]
    # Subcommands: set, rm, list
    # -----------------------------------------------------------------------
    url)
      local url_subcmds="set rm remove list ls"
      case "$prev" in
        url)
          # First arg: subcommand or identity
          local services; services="$(_pd_service_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$url_subcmds $services" -- "$cur") )
          ;;
        set)
          # After set: identity, then env, then url
          case $cword in
            3)
              local services; services="$(_pd_service_ids)"
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "$services" -- "$cur") )
              ;;
            4)
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "dev staging prod local tunnel" -- "$cur") )
              ;;
            5)
              COMPREPLY=()  # URL is free-form
              ;;
          esac
          ;;
        rm|remove)
          # After rm: identity, then env
          case $cword in
            3)
              local services; services="$(_pd_service_ids)"
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "$services" -- "$cur") )
              ;;
            4)
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "dev staging prod local tunnel" -- "$cur") )
              ;;
          esac
          ;;
        list|ls)
          # After list: identity
          local services; services="$(_pd_service_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$services" -- "$cur") )
          ;;
        -e|--env)
          # VALUE for --env: environment name hint
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "dev staging prod" -- "$cur") )
          ;;
        *)
          _pd_complete_service '-e --env --open'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # env  [identity] [--file PATH]
    # -----------------------------------------------------------------------
    env)
      case "$prev" in
        --file)
          # Complete file paths
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -f -- "$cur") )
          ;;
        *)
          _pd_complete_service '--file'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # tunnel  <subcommand> [identity] [--provider]
    # Subcommands: start, stop, status, list, providers
    # -----------------------------------------------------------------------
    tunnel)
      local tunnel_subcmds="start stop status list ls providers"
      case "$prev" in
        tunnel)
          # First arg: subcommand
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$tunnel_subcmds" -- "$cur") )
          ;;
        start)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--provider'
          else
            local services; services="$(_pd_service_ids)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$services" -- "$cur") )
          fi
          ;;
        --provider)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "ngrok cloudflared localtunnel" -- "$cur") )
          ;;
        stop|status)
          local services; services="$(_pd_service_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$services" -- "$cur") )
          ;;
        list|ls|providers)
          _pd_opts ''
          ;;
        *)
          # Inside start with --provider already given
          local services; services="$(_pd_service_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$services" -- "$cur") )
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # pub / publish  <channel> <message> [--sender ID]
    # -----------------------------------------------------------------------
    pub|publish)
      case "$prev" in
        pub|publish)
          # First arg: channel name
          if [[ "$cur" == -* ]]; then
            _pd_opts '--sender'
          else
            local channels; channels="$(_pd_channels)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$channels" -- "$cur") )
          fi
          ;;
        --sender)
          local aids; aids="$(_pd_agent_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
          ;;
        *)
          _pd_opts '--sender'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # sub / subscribe  <channel>
    # -----------------------------------------------------------------------
    sub|subscribe)
      case "$prev" in
        sub|subscribe)
          if [[ "$cur" == -* ]]; then
            _pd_opts ''
          else
            local channels; channels="$(_pd_channels)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$channels" -- "$cur") )
          fi
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # wait  <identity> [--timeout N]
    # -----------------------------------------------------------------------
    wait)
      case "$prev" in
        --timeout)
          # Numeric timeout in seconds — no static completions.
          COMPREPLY=()
          ;;
        *)
          _pd_complete_service '--timeout'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # lock  <name> [--ttl N] [--owner ID]
    # -----------------------------------------------------------------------
    lock)
      case "$prev" in
        lock)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--ttl --owner'
          else
            local lnames; lnames="$(_pd_lock_names)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "extend $lnames" -- "$cur") )
          fi
          ;;
        extend)
          local lnames; lnames="$(_pd_lock_names)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$lnames" -- "$cur") )
          ;;
        --owner)
          local aids; aids="$(_pd_agent_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
          ;;
        *) _pd_opts '--ttl --owner' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # unlock  <name> [--force] [--owner ID]
    # -----------------------------------------------------------------------
    unlock)
      case "$prev" in
        unlock)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--force --owner'
          else
            local lnames; lnames="$(_pd_lock_names)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$lnames" -- "$cur") )
          fi
          ;;
        --owner)
          local aids; aids="$(_pd_agent_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
          ;;
        *) _pd_opts '--force --owner' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # locks  (list locks, no positional args)
    # -----------------------------------------------------------------------
    locks)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # agent  <subcommand> [id] [--agent ID] [--type TYPE] [--name NAME]
    #                         [--maxServices N] [--maxLocks N]
    # -----------------------------------------------------------------------
    agent)
      local agent_subcommands='register heartbeat unregister'
      # Find which subcommand (if any) has been typed after "agent".
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "agent" ]]; then
          # The token after "agent" is the subcommand.
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$subcmd" ]]; then
        # Complete the subcommand name.
        if [[ "$cur" == -* ]]; then
          _pd_opts ''
        else
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$agent_subcommands" -- "$cur") )
        fi
        return 0
      fi

      local agent_opts='--agent --type --name --identity --purpose --worktree --maxServices --maxLocks'
      case "$subcmd" in
        register)
          case "$prev" in
            --agent|--name|--identity|--purpose|--worktree)
              COMPREPLY=()  # Free-form string
              ;;
            --type)
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "worker orchestrator monitor generic" -- "$cur") )
              ;;
            --maxServices|--maxLocks)
              COMPREPLY=()  # Numeric
              ;;
            *)
              if [[ "$cur" == -* ]]; then
                _pd_opts "$agent_opts"
              else
                COMPREPLY=()
              fi
              ;;
          esac
          ;;
        heartbeat|unregister)
          case "$prev" in
            heartbeat|unregister)
              if [[ "$cur" == -* ]]; then
                _pd_opts '--agent'
              else
                local aids; aids="$(_pd_agent_ids)"
                # shellcheck disable=SC2207
                COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
              fi
              ;;
            --agent)
              local aids; aids="$(_pd_agent_ids)"
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
              ;;
            *) _pd_opts '--agent' ;;
          esac
          ;;
        *)
          _pd_opts "$agent_opts"
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # agents  [--active]
    # -----------------------------------------------------------------------
    agents)
      _pd_opts '--active'
      ;;

    # -----------------------------------------------------------------------
    # log  [--limit N] [--type TYPE] [--agent ID] [--target ID] [--since TS]
    # -----------------------------------------------------------------------
    log)
      case "$prev" in
        --type)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W \
            "claim release lock unlock pub sub agent heartbeat" -- "$cur") )
          ;;
        --agent)
          local aids; aids="$(_pd_agent_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
          ;;
        --target)
          local ids; ids="$(_pd_service_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$ids" -- "$cur") )
          ;;
        --limit|--since|--from|--to)
          COMPREPLY=()  # Free-form
          ;;
        *)
          _pd_opts '--limit --type --agent --target --since --from --to'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # activity  <subcommand>
    # -----------------------------------------------------------------------
    activity)
      local act_subcommands='summary stats'
      local act_sub=""
      for (( i = 1; i < cword; i++ )); do
        if [[ "${words[$i]}" == "activity" ]]; then
          if (( i + 1 < cword )); then
            act_sub="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$act_sub" ]]; then
        if [[ "$cur" == -* ]]; then
          _pd_opts ''
        else
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$act_subcommands" -- "$cur") )
        fi
      else
        _pd_opts ''
      fi
      ;;

    # -----------------------------------------------------------------------
    # session  <subcommand> [args]
    # -----------------------------------------------------------------------
    session)
      local session_subcommands='start end done abandon rm files'
      # Find which subcommand (if any) has been typed after "session".
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "session" ]]; then
          # The token after "session" is the subcommand.
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$subcmd" ]]; then
        # Complete the subcommand name.
        if [[ "$cur" == -* ]]; then
          _pd_opts ''
        else
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$session_subcommands" -- "$cur") )
        fi
        return 0
      fi

      case "$subcmd" in
        start)
          _pd_opts '--agent'
          ;;
        end|done)
          _pd_opts '--note'
          ;;
        abandon|rm)
          _pd_opts ''
          ;;
        files)
          # files has sub-subcommands: add, rm
          local files_subcmd=""
          for (( i = 1; i < cword; i++ )); do
            if [[ "${words[$i]}" == "files" ]]; then
              if (( i + 1 < cword )); then
                files_subcmd="${words[$((i+1))]}"
              fi
              break
            fi
          done
          if [[ -z "$files_subcmd" ]]; then
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "add rm" -- "$cur") )
          else
            _pd_opts ''
          fi
          ;;
        *)
          _pd_opts ''
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # sessions  [--all] [--status STATUS] [--files] [--json] [--quiet]
    # -----------------------------------------------------------------------
    sessions)
      case "$prev" in
        --status)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "active completed abandoned" -- "$cur") )
          ;;
        *)
          _pd_opts '--all --status --files'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # note  <content> [--type TYPE]
    # -----------------------------------------------------------------------
    note)
      case "$prev" in
        --type)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "note handoff commit warning" -- "$cur") )
          ;;
        *)
          _pd_opts '--type'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # notes  [--limit N] [--type TYPE] [--json] [--quiet]
    # -----------------------------------------------------------------------
    notes)
      case "$prev" in
        --type)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "note handoff commit warning" -- "$cur") )
          ;;
        --limit)
          COMPREPLY=()  # Numeric
          ;;
        *)
          _pd_opts '--limit --type'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # salvage / resurrection  [subcommand] [agent-id] [--project P] [--stack S] [--all] [--limit N]
    # -----------------------------------------------------------------------
    salvage|resurrection)
      local salvage_subcommands='claim complete abandon dismiss'
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "salvage" ]]; then
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$subcmd" ]]; then
        case "$prev" in
          --project|--stack|--limit)
            COMPREPLY=()  # Free-form
            ;;
          *)
            if [[ "$cur" == -* ]]; then
              _pd_opts '--project --stack --all --limit'
            else
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "$salvage_subcommands" -- "$cur") )
            fi
            ;;
        esac
        return 0
      fi

      case "$subcmd" in
        claim|abandon|dismiss)
          if [[ "$cur" == -* ]]; then
            _pd_opts ''
          else
            local aids; aids="$(_pd_agent_ids)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
          fi
          ;;
        complete)
          # complete takes old-agent-id and new-agent-id
          if [[ "$cur" == -* ]]; then
            _pd_opts ''
          else
            local aids; aids="$(_pd_agent_ids)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
          fi
          ;;
        *)
          _pd_opts '--project --stack --all --limit'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # changelog  [subcommand] [args] [--limit N] [--type TYPE] [--format FMT]
    # -----------------------------------------------------------------------
    changelog)
      local changelog_subcommands='add show tree export identities'
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "changelog" ]]; then
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$subcmd" ]]; then
        if [[ "$cur" == -* ]]; then
          _pd_opts '--limit'
        else
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$changelog_subcommands" -- "$cur") )
        fi
        return 0
      fi

      case "$subcmd" in
        add)
          case "$prev" in
            --type)
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "feature fix refactor docs chore breaking" -- "$cur") )
              ;;
            --agent)
              local aids; aids="$(_pd_agent_ids)"
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
              ;;
            --description|--session)
              COMPREPLY=()  # Free-form
              ;;
            *)
              if [[ "$cur" == -* ]]; then
                _pd_opts '--type --description --session --agent'
              else
                local ids; ids="$(_pd_service_ids)"
                # shellcheck disable=SC2207
                COMPREPLY=( $(compgen -W "$ids" -- "$cur") )
              fi
              ;;
          esac
          ;;
        show|tree)
          case "$prev" in
            --limit)
              COMPREPLY=()  # Numeric
              ;;
            *)
              if [[ "$cur" == -* ]]; then
                _pd_opts '--limit'
              else
                local ids; ids="$(_pd_service_ids)"
                # shellcheck disable=SC2207
                COMPREPLY=( $(compgen -W "$ids" -- "$cur") )
              fi
              ;;
          esac
          ;;
        export)
          case "$prev" in
            --format)
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "flat tree keep-a-changelog" -- "$cur") )
              ;;
            --limit|--since)
              COMPREPLY=()  # Free-form
              ;;
            *)
              if [[ "$cur" == -* ]]; then
                _pd_opts '--format --limit --since'
              else
                local ids; ids="$(_pd_service_ids)"
                # shellcheck disable=SC2207
                COMPREPLY=( $(compgen -W "$ids" -- "$cur") )
              fi
              ;;
          esac
          ;;
        identities)
          _pd_opts ''
          ;;
        *)
          _pd_opts '--limit'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # scan  [--dry-run] [--json] (deep recursive project scanner)
    # -----------------------------------------------------------------------
    s|scan)
      _pd_opts '--dry-run'
      ;;

    # -----------------------------------------------------------------------
    # projects  [rm <name>]
    # -----------------------------------------------------------------------
    p|projects)
      case "$prev" in
        p|projects)
          if [[ "$cur" == -* ]]; then
            _pd_opts ''
          else
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "rm" -- "$cur") )
          fi
          ;;
        rm)
          # Complete project names — no live lookup yet
          COMPREPLY=()
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # up  [--service NAME] [--no-health] [--branch] [--timeout N] [--dir PATH]
    # -----------------------------------------------------------------------
    up)
      case "$prev" in
        --service|--timeout)
          COMPREPLY=()  # Free-form
          ;;
        --dir)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -d -- "$cur") )
          ;;
        *)
          _pd_opts '--service --no-health --branch --timeout --dir'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # down  (stop all services)
    # -----------------------------------------------------------------------
    down)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # doctor / diagnose  (environment diagnostics)
    # -----------------------------------------------------------------------
    doctor|diagnose)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # Daemon lifecycle commands — no positional args
    # -----------------------------------------------------------------------
    start|stop|restart|status|install|uninstall|dev|ci-gate)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # dashboard (no arguments)
    # -----------------------------------------------------------------------
    dashboard)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # channels [clear <channel>]
    # -----------------------------------------------------------------------
    channels)
      case "$prev" in
        channels)
          if [[ "$cur" == -* ]]; then
            _pd_opts ''
          else
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "clear" -- "$cur") )
          fi
          ;;
        clear)
          local channels; channels="$(_pd_channels)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$channels" -- "$cur") )
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # webhook <subcommand> [id]
    # -----------------------------------------------------------------------
    webhook|webhooks)
      case "$prev" in
        webhook|webhooks)
          if [[ "$cur" == -* ]]; then
            _pd_opts ''
          else
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "list events test update rm deliveries" -- "$cur") )
          fi
          ;;
        test|update|rm|delete|deliveries)
          COMPREPLY=()  # webhook IDs — no live lookup
          ;;
        --url|--events)
          COMPREPLY=()  # free-form
          ;;
        *) _pd_opts '--url --events --active' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # metrics (no arguments)
    # -----------------------------------------------------------------------
    metrics)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # config [--dir path]
    # -----------------------------------------------------------------------
    config)
      case "$prev" in
        --dir)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -d -- "$cur") )
          ;;
        *)
          _pd_opts '--dir'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # health [id]
    # -----------------------------------------------------------------------
    health)
      _pd_complete_service ''
      ;;

    # -----------------------------------------------------------------------
    # ports [cleanup] [--system]
    # -----------------------------------------------------------------------
    ports)
      case "$prev" in
        ports)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--system'
          else
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "cleanup" -- "$cur") )
          fi
          ;;
        *) _pd_opts '--system' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # version / help — no arguments
    # -----------------------------------------------------------------------
    version|help)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # Unknown command: fall back to global options only.
    # -----------------------------------------------------------------------
    *)
      if [[ "$cur" == -* ]]; then
        _pd_opts ''
      else
        COMPREPLY=()
      fi
      ;;
  esac

  return 0
}

complete -F _port_daddy port-daddy
complete -F _port_daddy pd
