#!/usr/bin/env bash

# Bash completion for Port Daddy v3.6 CLI
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
#   When the daemon has published a local endpoint, completions for service
#   identities, channels, locks, and agent IDs are fetched live.
#   If the daemon is not running, dynamic completions are silently skipped.

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Query the daemon with a 1-second timeout; print nothing on failure.
_pd_query() {
  local path="$1"
  local base port_file port
  port_file="${PORT_DADDY_PORT_FILE:-$HOME/.port-daddy/daemon.port}"
  if [[ -n "${PORT_DADDY_URL:-}" ]]; then
    base="${PORT_DADDY_URL%/}"
  elif [[ -r "$port_file" ]]; then
    port="$(tr -d '[:space:]' < "$port_file")"
    [[ "$port" =~ ^[0-9]+$ ]] || return 0
    base="http://127.0.0.1:${port}"
  else
    return 0
  fi
  curl -s --max-time 1 "${base}${path}" 2>/dev/null
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
    pub publish broadcast sub subscribe listen tube wait lock unlock locks
    # Agent registry
    agent agents actor actors roster swarm
    # Activity
    log activity
    # Sessions & Notes
    session sessions takeover note notes
    # Agent Resurrection & Changelog
    salvage resurrection changelog
    # DNS
    dns
    # File Claims & Integration
    files add who-owns integration
    # Sugar (compound commands)
    begin b done plan whoami w account attention nudge with-lock n u d learn tutorial
    # Briefing & History
    briefing history
    # Consolidated read/write (3.8.4)
    say look sitrep pheromone ph advise preflight compass guard snapshots snapshot backup restore attest shipwright
    # Host-safety posture audit (ADR-0088)
    safe
    # Agent Inbox
    inbox send sent
    # AI Agent Spawner + Watch
    spawn spawned work sortie watch
    # Fleet ship-run transcripts
    transcripts transcript
    # Cloud relay — zero-trust event fabric (ADR-0049)
    relay
    # Dispatch (renamed from nightshift per ADR-0035) + review + morning
    dispatch nightshift review morning
    # Operator loop · SIGHT stage — raise the periscope (state + next cut)
    periscope sight scope
    # Coast Guard read path — pd coast-guard status (see the guard)
    coast-guard cg
    # Relay v0 — zero-trust event fabric (ADR-0049)
    relay
    # Tender suggestion queue — list, approve, dismiss operator suggestions
    suggest
    # Skill registry — search, graft, sync, outcomes
    seamanship skills
    # App-Native Development Cockpit
    cockpit
    # Roadmap popper — autonomous roadmap-to-dispatch task puller
    popper
    # Managed provider secret store (keychain-backed)
    secret secrets
    # Harbormaster — canonical merge-owning actor body (ADR-0037)
    harbormaster hm
    # Harbors (named permission namespaces)
    harbor harbors whois
    # Agent Harbor event ledger + projections (binder ch18 C1, ADR-0095)
    harbor-ledger
    # Tuple space
    tuple
    # Semantic graph + episodic memory
    graph memory ideas skill-graft skillgraft
    # Artifact harvest provenance (slice S4a)
    booty
    # Shared local embedder (ADR-0061)
    embed
    # Cartographer roadmap projection
    roadmap
    # Quorum (swarm consensus primitive)
    quorum
    # Parley (forced reconciliation primitive)
    parley
    # Feedback (central agentic-feedback primitive)
    feedback
    # Durable commitments + obligation monitor (ADR-0041)
    commit obligations
    # System & Monitoring
    dashboard channels webhook webhooks metrics config health ports
    # Orchestration
    up down
    # Benchmarking, Demos & Fleet
    bench benchmark demo fleet backend squid hooks relay
    # Project (+ alias)
    scan s projects p doctor diagnose hints
    # Project onboarding
    setup init cut batten
    # Daemon lifecycle
    start stop restart install install-bosun uninstall dev use daemon ci-gate self-update upgrade mcp
    # Bonds / Wallets — FleetControl hardening
    wallet bond
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
        env)
          # `pd env <here>` — offer the `exec` subcommand alongside services.
          COMPREPLY=( $(compgen -W "exec" -- "$cur") )
          _pd_complete_service '--file'
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
    # dns  <subcommand> [identity] [options]
    # Subcommands: list, register, unregister, lookup, cleanup, status
    # -----------------------------------------------------------------------
    dns)
      local dns_subcmds="list ls register add unregister rm remove lookup cleanup status setup teardown sync help"
      case "$prev" in
        dns)
          # First arg: subcommand
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$dns_subcmds" -- "$cur") )
          ;;
        register|add)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--port --hostname --resolve'
          else
            local services; services="$(_pd_service_ids)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$services" -- "$cur") )
          fi
          ;;
        unregister|rm|remove|lookup)
          local services; services="$(_pd_service_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$services" -- "$cur") )
          ;;
        list|ls)
          _pd_opts '--pattern --limit --json --quiet'
          ;;
        cleanup|status|setup|teardown|sync|help)
          _pd_opts ''
          ;;
        --port|--hostname|--pattern|--limit)
          ;;
        *)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--port --hostname --pattern --limit --json --quiet'
          fi
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # pub / publish  <channel> <message> [--sender ID]
    # -----------------------------------------------------------------------
    pub|publish|broadcast)
      case "$prev" in
        pub|publish|broadcast)
          # First arg: channel name
          if [[ "$cur" == -* ]]; then
            _pd_opts '--message -m --sender'
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
          _pd_opts '--message -m --sender'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # sub / subscribe  <channel>
    # -----------------------------------------------------------------------
    sub|subscribe|listen)
      case "$prev" in
        sub|subscribe|listen)
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
    # tube  <channel>  [--send | --reply=<id> | --since=<id> | --once | --no-history]
    # -----------------------------------------------------------------------
    tube)
      case "$prev" in
        tube)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--send --reply --since --limit --once --no-history --json --quiet --sender'
          else
            local channels; channels="$(_pd_channels)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$channels" -- "$cur") )
          fi
          ;;
        *) _pd_opts '--send --reply --since --limit --once --no-history --json --quiet --sender' ;;
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
      local agent_subcommands='register heartbeat unregister interrupt stream'
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
        interrupt|stream)
          # interrupt <agent-id> [--reason TEXT] ; stream <agent-id>
          case "$prev" in
            interrupt|stream|--agent)
              local aids; aids="$(_pd_agent_ids)"
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
              ;;
            --reason)
              COMPREPLY=()  # Free-form string
              ;;
            *)
              if [[ "$subcmd" == "interrupt" ]]; then
                _pd_opts '--reason --agent'
              else
                _pd_opts '--agent'
              fi
              ;;
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
    agents|swarm)
      _pd_opts '--active'
      ;;

    # -----------------------------------------------------------------------
    # actor / actors  [id-or-alias]  [--project P]
    # -----------------------------------------------------------------------
    actor|actors)
      _pd_opts '--project --limit --message --from --type --wake --json --quiet'
      ;;

    roster)
      case "$prev" in
        roster) COMPREPLY=( $(compgen -W 'list show search create promote update attach continue retire help' -- "$cur") ) ;;
        --scope) COMPREPLY=( $(compgen -W 'system repo' -- "$cur") ) ;;
        --mode) COMPREPLY=( $(compgen -W 'auto native handoff' -- "$cur") ) ;;
        --filesystem) COMPREPLY=( $(compgen -W 'inherit repo workspace read-only' -- "$cur") ) ;;
        --network) COMPREPLY=( $(compgen -W 'inherit none restricted full' -- "$cur") ) ;;
        *) _pd_opts '--repo --all --limit --slug --name --remit --instructions --scope --system --skills --tools --backend --model --episode --mode --prompt --timeout --lifecycle --filesystem --network --allow-tools --deny-tools --file --json --quiet' ;;
      esac
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
      local session_subcommands='start end done abandon takeover rm files phase'
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
          _pd_opts '--purpose -P --agent -a --files --force'
          ;;
        end|done)
          _pd_opts '--note -n --status -s'
          ;;
        abandon|rm)
          _pd_opts ''
          ;;
        takeover)
          _pd_opts '--purpose -P --note -n --lifecycle --no-files --no-claims'
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
        phase)
          # session phase <session-id> <phase-name>
          case "$prev" in
            phase)
              # First arg after phase: session ID (free-form)
              COMPREPLY=()
              ;;
            *)
              # Second arg: phase name
              # shellcheck disable=SC2207
              COMPREPLY=( $(compgen -W "planning in_progress testing reviewing completed abandoned" -- "$cur") )
              ;;
          esac
          ;;
        *)
          _pd_opts ''
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # takeover <session-id> [note]  (alias for session takeover)
    # -----------------------------------------------------------------------
    takeover)
      case "$prev" in
        --lifecycle)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "durable ephemeral" -- "$cur") )
          ;;
        *)
          _pd_opts '--purpose -P --note -n --agent -a --lifecycle --no-files --no-claims'
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
          _pd_opts '--content -c --type -t'
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
    # bench (run performance benchmarks)
    # -----------------------------------------------------------------------
    bench)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # benchmark <subcommand>  (multi-backend LLM diversity experiment runner)
    # Subcommands: run, list-models, list-conditions, report
    # -----------------------------------------------------------------------
    benchmark)
      local benchmark_subcmds="run list-models list-conditions report"
      case "$prev" in
        benchmark)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$benchmark_subcmds" -- "$cur") )
          ;;
        *)
          _pd_opts ''
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # demo <subcommand>
    # Subcommands: port-conflict, coordination
    # -----------------------------------------------------------------------
    demo)
      local demo_subcmds="port-conflict coordination"
      case "$prev" in
        demo)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$demo_subcmds" -- "$cur") )
          ;;
        *)
          _pd_opts ''
          ;;
      esac
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
    # files  [--session ID] (global file claim view)
    # -----------------------------------------------------------------------
    files)
      _pd_opts '--session'
      ;;

    # -----------------------------------------------------------------------
    # who-owns  <path>
    # -----------------------------------------------------------------------
    who-owns)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # integration  <subcommand> [identity] [--project]
    # Subcommands: ready, needs, list
    # -----------------------------------------------------------------------
    integration)
      local integration_subcmds="ready needs list"
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "integration" ]]; then
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$subcmd" ]]; then
        if [[ "$cur" == -* ]]; then
          _pd_opts '--project'
        else
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$integration_subcmds" -- "$cur") )
        fi
        return 0
      fi

      case "$subcmd" in
        ready|needs)
          _pd_complete_service '--description -d'
          ;;
        list)
          _pd_opts '--project'
          ;;
        *)
          _pd_opts '--project'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # briefing  [--full] [--json] [--project NAME] [--dir PATH]
    # -----------------------------------------------------------------------
    briefing)
      case "$prev" in
        --project|--dir)
          COMPREPLY=()  # Free-form
          ;;
        *)
          _pd_opts '--full --project --dir'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # history  [--limit N] [--type TYPE] [--agent ID]
    # -----------------------------------------------------------------------
    history)
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
        --limit)
          COMPREPLY=()  # Numeric
          ;;
        *)
          _pd_opts '--limit --type --agent'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # begin  <purpose> [--identity ID] [--agent ID] [--files f1 f2...]
    #                  [--type TYPE] [--force]
    # -----------------------------------------------------------------------
    begin|b)
      case "$prev" in
        --identity|--agent)
          COMPREPLY=()  # Free-form
          ;;
        --type)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "worker orchestrator monitor" -- "$cur") )
          ;;
        --files)
          # File paths
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -f -- "$cur") )
          ;;
        *)
          _pd_opts '--purpose -P --identity -i --agent -a --type -t --files --force'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # done  ["note"] [--agent ID] [--session ID] [--status STATUS] [--force-incomplete] [--reason REASON]
    # -----------------------------------------------------------------------
    done)
      case "$prev" in
        --agent|--session|--reason)
          COMPREPLY=()  # Free-form
          ;;
        --status)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "completed abandoned" -- "$cur") )
          ;;
        *)
          _pd_opts '--note -n --agent -a --session --status -s --force-incomplete --reason'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # plan  [show|set|check] [--session ID] [--agent ID]
    # -----------------------------------------------------------------------
    plan)
      case "$prev" in
        --agent|--session)
          COMPREPLY=()  # Free-form
          ;;
        *)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--session --agent'
          else
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "show set check" -- "$cur") )
          fi
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # whoami  [--agent ID]
    # -----------------------------------------------------------------------
    whoami|w)
      case "$prev" in
        --agent)
          local aids; aids="$(_pd_agent_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
          ;;
        *)
          _pd_opts '--agent'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # with-lock  <name> <command...> [--ttl N] [--owner ID]
    # -----------------------------------------------------------------------
    with-lock)
      case "$prev" in
        with-lock)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--ttl --owner'
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
        *) _pd_opts '--ttl --owner' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # n (alias for note), u (alias for up), d (alias for down)
    # -----------------------------------------------------------------------
    n)
      case "$prev" in
        --type)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "note handoff commit warning" -- "$cur") )
          ;;
        *)
          _pd_opts '--content -c --type -t'
          ;;
      esac
      ;;

    u)
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

    d)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # -----------------------------------------------------------------------
    # learn / tutorial (interactive tutorial)
    # -----------------------------------------------------------------------
    learn|tutorial)
      _pd_opts ""
      ;;

    # -----------------------------------------------------------------------
    # inbox  <agent-id> [subcommand]
    # Subcommands: send, stats, clear, read-all, list
    # -----------------------------------------------------------------------
    inbox)
      local inbox_subcommands='send stats clear read-all list'
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "inbox" ]]; then
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$subcmd" ]]; then
        if [[ "$cur" == -* ]]; then
          _pd_opts ''
        else
          local aids; aids="$(_pd_agent_ids)"
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "$aids" -- "$cur") )
        fi
        return 0
      fi

      case "$subcmd" in
        send)
          _pd_opts '--message --from'
          ;;
        stats|list|read-all|clear)
          _pd_opts ''
          ;;
        *)
          _pd_opts ''
          ;;
      esac
      ;;

    # Unknown command: fall back to global options only.
    # -----------------------------------------------------------------------
    # spawn  [kill <id>] [--backend B] [--model M] [--identity ID]
    #        [--budget USD] [--purpose P] [--files f1 f2...] -- <task>
    # -----------------------------------------------------------------------
    spawn)
      case "$prev" in
        spawn)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--backend --model --identity --budget --purpose --files --workdir --timeout'
          else
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "kill" -- "$cur") )
          fi
          ;;
        kill)
          COMPREPLY=()  # agent IDs — no live lookup for spawned agents
          ;;
        --backend)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "ollama claude claude-cli gemini codex aider custom" -- "$cur") )
          ;;
        --model|--identity|--budget|--purpose|--workdir|--timeout|--allowedTools|--maxTokens)
          COMPREPLY=()  # Free-form
          ;;
        --files)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -f -- "$cur") )
          ;;
        *) _pd_opts '--backend --model --identity --budget --purpose --files --workdir --timeout --allowedTools --maxTokens' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # spawned  [--json] [--quiet]  — list spawned agents
    # -----------------------------------------------------------------------
    spawned)
      _pd_opts ''
      ;;

    # -----------------------------------------------------------------------
    # work  probe [--adapter K] [--profile P] | matrix  — conformance probes
    # (ADR-0095 Work Intent family; binder ch18 Work Order C2)
    # -----------------------------------------------------------------------
    work)
      local work_sub="${words[2]:-}"
      case "$prev" in
        work)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "probe matrix help" -- "$cur") )
          ;;
        --adapter)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "claude-code codex-cli cloudflare ollama lmstudio custom-stdio custom-http" -- "$cur") )
          ;;
        --profile)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -W "compliant weak broken malicious" -- "$cur") )
          ;;
        *)
          # --adapter/--profile are probe-only flags; matrix/help take only --json.
          if [[ "$work_sub" == probe ]]; then
            _pd_opts '--adapter --profile --json'
          else
            _pd_opts '--json'
          fi
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # cockpit  missions  [--project --status --limit --json]
    # -----------------------------------------------------------------------
    cockpit)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "missions help" -- "$cur") )
          ;;
        missions)
          _pd_opts '--project --status --limit --json'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # popper  status|next|pop|enable|disable  [slug]
    # -----------------------------------------------------------------------
    popper)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "status next pop enable disable" -- "$cur") )
          ;;
        *)
          _pd_opts '--harbor --json'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # harbormaster  start|stop|status|queue  [--foreground --json]
    # -----------------------------------------------------------------------
    harbormaster|hm)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "start stop status queue help" -- "$cur") )
          ;;
        start)
          _pd_opts '--foreground'
          ;;
        status|queue)
          _pd_opts '--json'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # sortie  run|list|status|logs  [args]
    # -----------------------------------------------------------------------
    sortie)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "run list status logs help" -- "$cur") )
          ;;
        run)
          case "$prev" in
            --backend)
              COMPREPLY=( $(compgen -W "ollama claude claude-cli gemini codex aider custom" -- "$cur") )
              ;;
            --model|--tier|--budget|--dir|--recipe|--expected|--context|--identity|--purpose|--allowedTools|--timeout|--maxTokens)
              COMPREPLY=()
              ;;
            *)
              _pd_opts '--backend --model --tier --budget --dir --recipe --expected --context --identity --purpose --allowedTools --timeout --maxTokens'
              ;;
          esac
          ;;
        list)
          _pd_opts '--all --limit --dir'
          ;;
        status|logs)
          _pd_opts '--limit'
          ;;
        *)
          _pd_opts ''
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # watch  <channel> --exec <script> [--once]
    # -----------------------------------------------------------------------
    watch)
      case "$prev" in
        watch)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--exec --once --max-concurrent --timeout --min-interval'
          else
            local channels; channels="$(_pd_channels)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$channels" -- "$cur") )
          fi
          ;;
        --exec)
          # shellcheck disable=SC2207
          COMPREPLY=( $(compgen -f -- "$cur") )
          ;;
        *) _pd_opts '--exec --once' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # harbor  create|enter|leave|show|destroy|delete  <name>  [options]
    # -----------------------------------------------------------------------
    harbor)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "create enter leave show destroy delete" -- "$cur") )
          ;;
        create)
          _pd_opts '--cap --channels --expires'
          ;;
        enter)
          _pd_opts '--agent --cap'
          ;;
        leave|show|destroy|delete)
          if [[ "$cur" != -* ]]; then
            local hnames; hnames="$(_pd_query '/harbors' | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//' | sort -u)"
            # shellcheck disable=SC2207
            COMPREPLY=( $(compgen -W "$hnames" -- "$cur") )
          fi
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # harbors  [--json]  — list all harbors
    # -----------------------------------------------------------------------
    harbors)
      _pd_opts '--json'
      ;;

    # -----------------------------------------------------------------------
    # harbor-ledger  status|project|rebuild  [projection]  [--json]
    # -----------------------------------------------------------------------
    harbor-ledger)
      local hl_subcmd="${words[2]:-}"
      case "$hl_subcmd" in
        '')
          COMPREPLY=( $(compgen -W "status project rebuild" -- "$cur") )
          ;;
        project|rebuild)
          COMPREPLY=( $(compgen -W "roster transcript-timeline files-touched costs compliance work-receipts --json" -- "$cur") )
          ;;
        status)
          _pd_opts '--json'
          ;;
        *) _pd_opts '--json' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # tuple  out|rd|in|scan|count  [args]  [options]
    # -----------------------------------------------------------------------
    tuple)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "out rd in scan count" -- "$cur") )
          ;;
        out)
          _pd_opts '--harbor --ttl --as --json --quiet'
          ;;
        rd|read)
          _pd_opts '--harbor --limit --json --quiet'
          ;;
        in|take)
          _pd_opts '--harbor --limit --json --quiet'
          ;;
        scan)
          _pd_opts '--harbor --json --quiet'
          ;;
        count)
          _pd_opts '--harbor --json --quiet'
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # say  "<text>"  [--pin] [--heat <path>[=N]] [--broadcast <channel>]
    # -----------------------------------------------------------------------
    say)
      _pd_opts '--pin --heat --broadcast --kind --harbor --as --json --quiet'
      ;;

    # -----------------------------------------------------------------------
    # look  [heat]  [--since N] [--heat] [--project P] [--stack S]
    # -----------------------------------------------------------------------
    look)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "heat hot" -- "$cur") )
          _pd_opts '--since --heat --project --stack --limit-activity --limit-notes --json --quiet'
          ;;
        *)
          _pd_opts '--since --heat --project --stack --limit-activity --limit-notes --json --quiet'
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # sitrep  [--since N] [--project P] [--stack S]
    # -----------------------------------------------------------------------
    sitrep)
      _pd_opts '--since --project --stack --limit-activity --limit-notes --json --quiet'
      ;;

    # -----------------------------------------------------------------------
    # advise / preflight / compass  [files...]  [--task TEXT] [--session ID]
    # -----------------------------------------------------------------------
    advise|preflight|compass)
      _pd_opts '--task --session --sessionId --agent --agentId --dir --projectRoot --channels --tuples --json --quiet'
      ;;

    # -----------------------------------------------------------------------
    # guard  status|check|enable|disable|install  [files...]  [options]
    # -----------------------------------------------------------------------
    guard)
      local guard_subcommands='status check enable disable install'
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "guard" ]]; then
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      case "$prev" in
        --mode)
          COMPREPLY=( $(compgen -W "warn enforce off" -- "$cur") )
          ;;
        *)
          if [[ -z "$subcmd" ]]; then
            COMPREPLY=( $(compgen -W "$guard_subcommands" -- "$cur") )
          else
            _pd_opts '--mode --warn --enforce --off --staged --hook --json --quiet'
          fi
          ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # safe  scan|baseline accept <id>|fix [--auto]  (ADR-0088 host-safety)
    # -----------------------------------------------------------------------
    safe)
      local safe_subcommands='scan baseline fix corral guard'
      local subcmd=""
      for (( i = 1; i < cword; i++ )); do
        local w="${words[$i]}"
        if [[ "$w" == "safe" ]]; then
          if (( i + 1 < cword )); then
            subcmd="${words[$((i+1))]}"
          fi
          break
        fi
      done

      if [[ -z "$subcmd" ]]; then
        COMPREPLY=( $(compgen -W "$safe_subcommands" -- "$cur") )
      elif [[ "$subcmd" == "baseline" ]]; then
        COMPREPLY=( $(compgen -W "accept" -- "$cur") )
      elif [[ "$subcmd" == "scan" ]]; then
        _pd_opts '--json --allow --quiet'
      elif [[ "$subcmd" == "fix" ]]; then
        _pd_opts '--auto --json'
      elif [[ "$subcmd" == "corral" ]]; then
        _pd_opts '--all --apply --json'
      elif [[ "$subcmd" == "guard" ]]; then
        _pd_opts '--staged --json --quiet'
      fi
      ;;

    # -----------------------------------------------------------------------
    # pheromone  spray|file|files|show|ls  [args]  [options]
    # -----------------------------------------------------------------------
    pheromone|ph)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "spray file files show ls read list" -- "$cur") )
          ;;
        spray)
          COMPREPLY=( $(compgen -W "files services projects sessions agents" -- "$cur") )
          ;;
        files)
          _pd_opts '--path --depth --limit --json --quiet'
          ;;
        show|read)
          COMPREPLY=( $(compgen -W "files services projects sessions agents" -- "$cur") )
          _pd_opts '--json --quiet'
          ;;
        ls|list)
          _pd_opts '--json --quiet'
          ;;
        *) _pd_opts '--json --quiet' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # embed  status|prefetch|text|stdin  [options]
    # -----------------------------------------------------------------------
    embed)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "status prefetch text stdin" -- "$cur") )
          ;;
        status)
          _pd_opts '--json --cache-dir'
          ;;
        prefetch)
          _pd_opts '--cache-dir'
          ;;
        text|stdin)
          _pd_opts '--offline --cache-dir'
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # skill-graft  query|warm|reference  [options]
    # -----------------------------------------------------------------------
    skill-graft|skillgraft)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "query warm reference" -- "$cur") )
          ;;
        query)
          _pd_opts '--root --shortlist-limit --top-limit --body-chars --json'
          ;;
        warm)
          _pd_opts '--root --json'
          ;;
        reference)
          _pd_opts '--root --json'
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # graph  edges|stats  [options]
    # -----------------------------------------------------------------------
    graph)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "edges stats help" -- "$cur") )
          ;;
        edges)
          _pd_opts '--dir --scope --source-type --source-id --edge-type --target-type --target-id --query --limit --json --quiet'
          ;;
        stats)
          _pd_opts '--dir --json --quiet'
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # booty  add|list  [options]  — artifact harvest provenance (slice S4a)
    # -----------------------------------------------------------------------
    booty)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "add list help" -- "$cur") )
          ;;
        add)
          _pd_opts '--roadmap --note --json --quiet'
          ;;
        list)
          _pd_opts '--branch --session --limit --json --quiet'
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # memory  episodes|stats  [options]
    # -----------------------------------------------------------------------
    memory)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "episodes stats help" -- "$cur") )
          ;;
        episodes)
          _pd_opts '--dir --project --harbor --agent --type --query --limit --json --quiet'
          ;;
        stats)
          _pd_opts '--dir --project --json --quiet'
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # -----------------------------------------------------------------------
    # ideas  list|search|show  [options]
    # -----------------------------------------------------------------------
    ideas)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "list search show help" -- "$cur") )
          ;;
        list)
          _pd_opts '--dir --status --limit --include-raw --json --quiet'
          ;;
        search)
          _pd_opts '--dir --status --limit --sources --include-raw --json --quiet'
          ;;
        show)
          _pd_opts '--dir --include-raw --json --quiet'
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # secret  <set|list|reveal|rm> [options]
    secret|secrets)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        set)
          _pd_opts '--backend --json'
          ;;
        reveal|show)
          _pd_opts '--copy --json'
          ;;
        list|ls)
          _pd_opts '--json --quiet'
          ;;
        rm|remove|delete)
          _pd_opts '--json'
          ;;
        *)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--backend --copy --json --quiet'
          else
            COMPREPLY=( $(compgen -W "set list reveal rm" -- "$cur") )
          fi
          ;;
      esac
      ;;

    # roadmap  [options]
    roadmap)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        ack|harvest)
          _pd_opts '--as --into --id --feedbackId --json --quiet'
          ;;
        promote)
          _pd_opts '--from-feedback --feedbackId --id --slug --summary --status --as --agent --harbor --json --quiet'
          ;;
        upsert|add)
          _pd_opts '--summary --status --as --agent --by --note --receipt --harbor --project --dependencies --json --quiet'
          ;;
        touch)
          _pd_opts '--note --receipt --as --agent --by --harbor --json --quiet'
          ;;
        render)
          _pd_opts '--write --dir --root --rootDir --projectDir --status --harbor --project --limit --json --quiet'
          ;;
        *)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--dir --root --projectDir --limit --feedback-status --feedback-harbor --feedback-limit --no-excerpts --json --quiet'
          else
            COMPREPLY=( $(compgen -W "ack harvest promote upsert add touch render pop release claims delete rm help" -- "$cur") )
          fi
          ;;
      esac
      ;;

    # parley call|propose|critique|revise|agree|refuse|say|respond|resolve|list|show|fit
    parley)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        call)
          _pd_opts '--surface --with --parties --reason --ttl-ms --round-limit --harbor --as --json --quiet'
          ;;
        respond|propose|critique|revise|agree|refuse|say)
          _pd_opts '--id --parley --performative --content --proposal --evidence --as --party --json --quiet'
          ;;
        resolve)
          _pd_opts '--id --parley --status --decision --reason --dissenters --as --json --quiet'
          ;;
        list|show)
          _pd_opts '--id --parley --status --harbor --limit --json --quiet'
          ;;
        fit)
          _pd_opts '--shape --reasoningShape --baseline --singleAgentBaseline --value --taskValueMultiplier --tokens --estimatedTokenMultiplier --independence --subtaskIndependence --contention --writeContention --writers --maxConcurrentWriters --verify --heterogeneous --fits-in-one-context --json --quiet'
          ;;
        *)
          if [[ "$cur" == -* ]]; then
            _pd_opts '--json --quiet'
          else
            COMPREPLY=( $(compgen -W "call propose critique revise agree refuse say respond resolve list show fit help" -- "$cur") )
          fi
          ;;
      esac
      ;;

    # fleet  init|up|down|status|run|panic|unpanic|halt|pause|resume|inspect|tree|validate|prompt|help  [agent-name|rootId]
    fleet)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "init up down status run panic unpanic halt pause resume inspect tree validate prompt help" -- "$cur") )
          ;;
        run)
          COMPREPLY=()  # agent names from pd-fleet.yml — no live lookup
          ;;
        panic)
          _pd_opts '--reason --yes --json --quiet'
          ;;
        unpanic)
          _pd_opts '--reason --json --quiet'
          ;;
        halt)
          _pd_opts '--root --yes --json --quiet'
          ;;
        pause|resume)
          _pd_opts '--root --json --quiet'
          ;;
        inspect|tree)
          _pd_opts '--root --json'  # rootId is positional; --root also accepted
          ;;
        *) _pd_opts '' ;;
      esac
      ;;

    # wallet  show|top-up|history  <project>  [options]
    wallet)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "show top-up history help" -- "$cur") )
          ;;
        show)           _pd_opts '--json --quiet' ;;
        top-up|topup)   _pd_opts '--usd --yes --json --quiet' ;;
        history)        _pd_opts '--since --limit --json --quiet' ;;
        *)              _pd_opts '' ;;
      esac
      ;;

    # bond  list|slash  [args]  [options]
    bond)
      local subcmd="${words[2]:-}"
      case "$subcmd" in
        '')
          COMPREPLY=( $(compgen -W "list slash help" -- "$cur") )
          ;;
        list|ls)
          case "$prev" in
            --state)
              COMPREPLY=( $(compgen -W "escrowed running exiting refunded slashed" -- "$cur") )
              ;;
            *)
              _pd_opts '--project --state --limit --json --quiet'
              ;;
          esac
          ;;
        slash)          _pd_opts '--portion --reason --yes --json --quiet' ;;
        *)              _pd_opts '' ;;
      esac
      ;;

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
