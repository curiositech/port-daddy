# Fish completion for Port Daddy CLI
#
# INSTALLATION:
#   Option 1 — User config (recommended):
#     cp port-daddy.fish ~/.config/fish/completions/port-daddy.fish
#
#   Option 2 — System-wide (macOS with Homebrew):
#     cp port-daddy.fish "$(brew --prefix)/share/fish/vendor_completions.d/port-daddy.fish"
#
# REQUIREMENTS:
#   - Fish 3.0+
#   - curl (for dynamic completions from the running daemon)
#
# DYNAMIC COMPLETIONS:
#   When the daemon is running on localhost:9876, completions for service
#   identities, channels, locks, and agent IDs are fetched live.

# ---------------------------------------------------------------------------
# Helpers — daemon queries
# ---------------------------------------------------------------------------

function __pd_service_ids
    curl -s --max-time 1 'http://localhost:9876/services' 2>/dev/null \
        | string match -r '"id":"[^"]*"' | string replace -r '"id":"([^"]*)"' '$1'
end

function __pd_channels
    curl -s --max-time 1 'http://localhost:9876/channels' 2>/dev/null \
        | string match -r '"name":"[^"]*"' | string replace -r '"name":"([^"]*)"' '$1'
end

function __pd_lock_names
    curl -s --max-time 1 'http://localhost:9876/locks' 2>/dev/null \
        | string match -r '"name":"[^"]*"' | string replace -r '"name":"([^"]*)"' '$1'
end

function __pd_agent_ids
    curl -s --max-time 1 'http://localhost:9876/agents' 2>/dev/null \
        | string match -r '"id":"[^"]*"' | string replace -r '"id":"([^"]*)"' '$1'
end

# Check if a subcommand has been given yet.
function __pd_needs_command
    set -l cmd (commandline -opc)
    for word in $cmd[2..]
        switch $word
            case '-*'
                continue
            case '*'
                return 1
        end
    end
    return 0
end

# Check if the current subcommand matches.
function __pd_using_command
    set -l cmd (commandline -opc)
    for word in $cmd[2..]
        switch $word
            case '-*'
                continue
            case $argv
                return 0
            case '*'
                return 1
        end
    end
    return 1
end

# ---------------------------------------------------------------------------
# Disable file completions for port-daddy by default
# ---------------------------------------------------------------------------
complete -c port-daddy -f
complete -c pd -f

# ---------------------------------------------------------------------------
# Global options
# ---------------------------------------------------------------------------
complete -c port-daddy -s j -l json -d 'Output JSON'
complete -c port-daddy -s q -l quiet -d 'Suppress non-essential output'
complete -c port-daddy -s h -l help -d 'Show help'
complete -c port-daddy -s V -l version -d 'Print version'

complete -c pd -s j -l json -d 'Output JSON'
complete -c pd -s q -l quiet -d 'Suppress non-essential output'
complete -c pd -s h -l help -d 'Show help'
complete -c pd -s V -l version -d 'Print version'

# ---------------------------------------------------------------------------
# Commands (with single-letter aliases)
# ---------------------------------------------------------------------------
set -l __pd_commands \
    'claim' 'c' 'release' 'r' 'find' 'f' 'list' 'l' 'ps' 'url' 'env' \
    'pub' 'publish' 'sub' 'subscribe' 'wait' 'lock' 'unlock' 'locks' \
    'agent' 'agents' 'log' 'activity' \
    'session' 'sessions' 'note' 'notes' \
    'salvage' 'changelog' \
    'up' 'down' \
    'dashboard' 'channels' 'webhook' 'webhooks' 'metrics' 'config' 'health' 'ports' \
    'scan' 's' 'projects' 'p' 'doctor' 'diagnose' \
    'start' 'stop' 'restart' 'status' 'install' 'uninstall' 'dev' 'ci-gate' \
    'version' 'help'

# Register each command for both `port-daddy` and `pd`
for prog in port-daddy pd
    # Service management
    complete -c $prog -n __pd_needs_command -a claim -d 'Claim a port for a service'
    complete -c $prog -n __pd_needs_command -a c -d 'Claim a port (alias)'
    complete -c $prog -n __pd_needs_command -a release -d 'Release a service port'
    complete -c $prog -n __pd_needs_command -a r -d 'Release a port (alias)'
    complete -c $prog -n __pd_needs_command -a find -d 'Find a service by identity or port'
    complete -c $prog -n __pd_needs_command -a f -d 'Find a service (alias)'
    complete -c $prog -n __pd_needs_command -a list -d 'List all active services'
    complete -c $prog -n __pd_needs_command -a l -d 'List services (alias)'
    complete -c $prog -n __pd_needs_command -a ps -d 'List services (alias)'
    complete -c $prog -n __pd_needs_command -a url -d 'Get URL for a service'
    complete -c $prog -n __pd_needs_command -a env -d 'Get environment variables for a service'

    # Agent coordination
    complete -c $prog -n __pd_needs_command -a pub -d 'Publish a message to a channel'
    complete -c $prog -n __pd_needs_command -a publish -d 'Publish a message (alias)'
    complete -c $prog -n __pd_needs_command -a sub -d 'Subscribe to a channel'
    complete -c $prog -n __pd_needs_command -a subscribe -d 'Subscribe to a channel (alias)'
    complete -c $prog -n __pd_needs_command -a wait -d 'Wait until a service is claimed'
    complete -c $prog -n __pd_needs_command -a lock -d 'Acquire a distributed lock'
    complete -c $prog -n __pd_needs_command -a unlock -d 'Release a distributed lock'
    complete -c $prog -n __pd_needs_command -a locks -d 'List all active locks'

    # Agent registry
    complete -c $prog -n __pd_needs_command -a agent -d 'Manage an agent'
    complete -c $prog -n __pd_needs_command -a agents -d 'List registered agents'

    # Activity
    complete -c $prog -n __pd_needs_command -a log -d 'Tail the activity log'
    complete -c $prog -n __pd_needs_command -a activity -d 'Activity summary or stats'

    # Sessions & Notes
    complete -c $prog -n __pd_needs_command -a session -d 'Manage a session'
    complete -c $prog -n __pd_needs_command -a sessions -d 'List sessions'
    complete -c $prog -n __pd_needs_command -a note -d 'Add a quick note'
    complete -c $prog -n __pd_needs_command -a notes -d 'List recent notes'

    # Agent Resurrection
    complete -c $prog -n __pd_needs_command -a salvage -d 'Check for dead agents with recoverable work'

    # Changelog
    complete -c $prog -n __pd_needs_command -a changelog -d 'Hierarchical changelog with identity-based rollup'

    # System & Monitoring
    complete -c $prog -n __pd_needs_command -a dashboard -d 'Open web dashboard'
    complete -c $prog -n __pd_needs_command -a channels -d 'List pub/sub channels'
    complete -c $prog -n __pd_needs_command -a webhook -d 'Manage webhooks'
    complete -c $prog -n __pd_needs_command -a webhooks -d 'Manage webhooks (alias)'
    complete -c $prog -n __pd_needs_command -a metrics -d 'Show daemon metrics'
    complete -c $prog -n __pd_needs_command -a config -d 'Show resolved configuration'
    complete -c $prog -n __pd_needs_command -a health -d 'Check service health'
    complete -c $prog -n __pd_needs_command -a ports -d 'List active port assignments'

    # Orchestration
    complete -c $prog -n __pd_needs_command -a up -d 'Start all services'
    complete -c $prog -n __pd_needs_command -a down -d 'Stop all services started by up'

    # Project
    complete -c $prog -n __pd_needs_command -a scan -d 'Deep-scan project for frameworks'
    complete -c $prog -n __pd_needs_command -a s -d 'Scan project (alias)'
    complete -c $prog -n __pd_needs_command -a projects -d 'List or manage registered projects'
    complete -c $prog -n __pd_needs_command -a p -d 'List projects (alias)'
    complete -c $prog -n __pd_needs_command -a doctor -d 'Run environment diagnostics'
    complete -c $prog -n __pd_needs_command -a diagnose -d 'Run diagnostics (alias for doctor)'

    # Daemon lifecycle
    complete -c $prog -n __pd_needs_command -a start -d 'Start the daemon'
    complete -c $prog -n __pd_needs_command -a stop -d 'Stop the daemon'
    complete -c $prog -n __pd_needs_command -a restart -d 'Restart the daemon'
    complete -c $prog -n __pd_needs_command -a status -d 'Show daemon status'
    complete -c $prog -n __pd_needs_command -a install -d 'Install as system service'
    complete -c $prog -n __pd_needs_command -a uninstall -d 'Uninstall system service'
    complete -c $prog -n __pd_needs_command -a dev -d 'Start daemon in foreground'
    complete -c $prog -n __pd_needs_command -a ci-gate -d 'Exit non-zero if daemon is stale'

    # Info
    complete -c $prog -n __pd_needs_command -a version -d 'Print version information'
    complete -c $prog -n __pd_needs_command -a help -d 'Show help'

    # -----------------------------------------------------------------------
    # Command-specific options
    # -----------------------------------------------------------------------

    # claim / c
    complete -c $prog -n "__pd_using_command claim c" -s p -l port -d 'Port number' -x
    complete -c $prog -n "__pd_using_command claim c" -l range -d 'Port range (lo-hi)' -x
    complete -c $prog -n "__pd_using_command claim c" -l expires -d 'TTL in seconds' -x
    complete -c $prog -n "__pd_using_command claim c" -l pair -d 'Paired service identity' -x -a '(__pd_service_ids)'
    complete -c $prog -n "__pd_using_command claim c" -l cmd -d 'Command to associate' -x
    complete -c $prog -n "__pd_using_command claim c" -l export -d 'Print export PORT=N for eval'
    complete -c $prog -n "__pd_using_command claim c" -x -a '(__pd_service_ids)'

    # release / r
    complete -c $prog -n "__pd_using_command release r" -l expired -d 'Release all expired services'
    complete -c $prog -n "__pd_using_command release r" -x -a '(__pd_service_ids)'

    # find / f
    complete -c $prog -n "__pd_using_command find f" -l status -d 'Filter by status' -x -a 'active expired all'
    complete -c $prog -n "__pd_using_command find f" -l port -d 'Filter by port' -x
    complete -c $prog -n "__pd_using_command find f" -l expired -d 'Include expired'
    complete -c $prog -n "__pd_using_command find f" -x -a '(__pd_service_ids)'

    # url
    complete -c $prog -n "__pd_using_command url" -s e -l env -d 'Environment name' -x -a 'dev staging prod'
    complete -c $prog -n "__pd_using_command url" -l open -d 'Open URL in browser'
    complete -c $prog -n "__pd_using_command url" -x -a '(__pd_service_ids)'

    # env
    complete -c $prog -n "__pd_using_command env" -l file -d 'Write env vars to file' -r
    complete -c $prog -n "__pd_using_command env" -x -a '(__pd_service_ids)'

    # pub / publish
    complete -c $prog -n "__pd_using_command pub publish" -l sender -d 'Sender agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command pub publish" -x -a '(__pd_channels)'

    # sub / subscribe
    complete -c $prog -n "__pd_using_command sub subscribe" -x -a '(__pd_channels)'

    # wait
    complete -c $prog -n "__pd_using_command wait" -l timeout -d 'Timeout in seconds' -x
    complete -c $prog -n "__pd_using_command wait" -x -a '(__pd_service_ids)'

    # lock
    complete -c $prog -n "__pd_using_command lock" -l ttl -d 'Lock TTL in seconds' -x
    complete -c $prog -n "__pd_using_command lock" -l owner -d 'Owner agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command lock" -x -a '(__pd_lock_names)'
    complete -c $prog -n "__pd_using_command lock" -x -a 'extend'

    # unlock
    complete -c $prog -n "__pd_using_command unlock" -l force -d 'Force-release'
    complete -c $prog -n "__pd_using_command unlock" -l owner -d 'Owner agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command unlock" -x -a '(__pd_lock_names)'

    # agent subcommands
    complete -c $prog -n "__pd_using_command agent" -x -a 'register heartbeat unregister'

    # agents
    complete -c $prog -n "__pd_using_command agents" -l active -d 'Show only active agents'

    # log
    complete -c $prog -n "__pd_using_command log" -l limit -d 'Max entries' -x
    complete -c $prog -n "__pd_using_command log" -l type -d 'Activity type' -x -a 'claim release lock unlock pub sub agent heartbeat'
    complete -c $prog -n "__pd_using_command log" -l agent -d 'Filter by agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command log" -l target -d 'Filter by target' -x -a '(__pd_service_ids)'
    complete -c $prog -n "__pd_using_command log" -l since -d 'Entries after timestamp' -x
    complete -c $prog -n "__pd_using_command log" -l from -d 'Start of time range' -x
    complete -c $prog -n "__pd_using_command log" -l to -d 'End of time range' -x

    # activity
    complete -c $prog -n "__pd_using_command activity" -x -a 'summary stats'

    # channels
    complete -c $prog -n "__pd_using_command channels" -x -a 'clear'
    complete -c $prog -n "__pd_using_command channels" -x -a '(__pd_channels)'

    # webhook / webhooks
    complete -c $prog -n "__pd_using_command webhook webhooks" -x -a 'list events test update rm deliveries'

    # config
    complete -c $prog -n "__pd_using_command config" -l dir -d 'Target directory' -r

    # health
    complete -c $prog -n "__pd_using_command health" -x -a '(__pd_service_ids)'

    # ports
    complete -c $prog -n "__pd_using_command ports" -x -a 'cleanup'
    complete -c $prog -n "__pd_using_command ports" -l system -d 'Show system ports'

    # scan / s
    complete -c $prog -n "__pd_using_command scan s" -l dry-run -d 'Preview without saving'

    # up
    complete -c $prog -n "__pd_using_command up" -l service -d 'Start only this service + dependencies' -x
    complete -c $prog -n "__pd_using_command up" -l no-health -d 'Skip health checks'
    complete -c $prog -n "__pd_using_command up" -l branch -d 'Use git branch as context'
    complete -c $prog -n "__pd_using_command up" -l timeout -d 'Health check timeout in ms' -x
    complete -c $prog -n "__pd_using_command up" -l dir -d 'Target directory' -r

    # projects / p
    complete -c $prog -n "__pd_using_command projects p" -x -a 'rm'

    # session subcommands
    complete -c $prog -n "__pd_using_command session" -x -a 'start' -d 'Start a new session'
    complete -c $prog -n "__pd_using_command session" -x -a 'end' -d 'End a session (completed)'
    complete -c $prog -n "__pd_using_command session" -x -a 'done' -d 'End a session (alias for end)'
    complete -c $prog -n "__pd_using_command session" -x -a 'abandon' -d 'Abandon a session'
    complete -c $prog -n "__pd_using_command session" -x -a 'rm' -d 'Delete a session and cascade notes/files'
    complete -c $prog -n "__pd_using_command session" -x -a 'files' -d 'Manage file claims for a session'

    # sessions
    complete -c $prog -n "__pd_using_command sessions" -l all -d 'Show all sessions, not just active'
    complete -c $prog -n "__pd_using_command sessions" -l status -d 'Filter by status' -x -a 'active completed abandoned'
    complete -c $prog -n "__pd_using_command sessions" -l files -d 'Include file claims'

    # note
    complete -c $prog -n "__pd_using_command note" -l type -d 'Note type' -x -a 'note handoff commit warning'

    # notes
    complete -c $prog -n "__pd_using_command notes" -l limit -d 'Max entries' -x
    complete -c $prog -n "__pd_using_command notes" -l type -d 'Filter by note type' -x -a 'note handoff commit warning'

    # salvage subcommands
    complete -c $prog -n "__pd_using_command salvage" -x -a 'claim' -d 'Claim a dead agent\'s work for resurrection'
    complete -c $prog -n "__pd_using_command salvage" -x -a 'complete' -d 'Mark resurrection as complete'
    complete -c $prog -n "__pd_using_command salvage" -x -a 'abandon' -d 'Return agent to resurrection queue'
    complete -c $prog -n "__pd_using_command salvage" -x -a 'dismiss' -d 'Remove agent from queue (reviewed, not resurrecting)'
    complete -c $prog -n "__pd_using_command salvage" -l all -d 'Show all queue entries, not just pending'
    complete -c $prog -n "__pd_using_command salvage" -l limit -d 'Max entries to return' -x
    complete -c $prog -n "__pd_using_command salvage" -x -a '(__pd_agent_ids)'

    # changelog subcommands
    complete -c $prog -n "__pd_using_command changelog" -x -a 'add' -d 'Add a changelog entry'
    complete -c $prog -n "__pd_using_command changelog" -x -a 'show' -d 'Show changes for an identity'
    complete -c $prog -n "__pd_using_command changelog" -x -a 'tree' -d 'Show changes for identity and children'
    complete -c $prog -n "__pd_using_command changelog" -x -a 'export' -d 'Export changelog as markdown'
    complete -c $prog -n "__pd_using_command changelog" -x -a 'identities' -d 'List all identities with changelog entries'
    complete -c $prog -n "__pd_using_command changelog" -l limit -d 'Max entries to return' -x
    complete -c $prog -n "__pd_using_command changelog" -l type -d 'Entry type' -x -a 'feature fix refactor docs chore breaking'
    complete -c $prog -n "__pd_using_command changelog" -l description -d 'Detailed description' -x
    complete -c $prog -n "__pd_using_command changelog" -l session -d 'Link to session ID' -x
    complete -c $prog -n "__pd_using_command changelog" -l agent -d 'Link to agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command changelog" -l format -d 'Export format' -x -a 'flat tree keep-a-changelog'
    complete -c $prog -n "__pd_using_command changelog" -l since -d 'Filter by timestamp' -x
    complete -c $prog -n "__pd_using_command changelog" -x -a '(__pd_service_ids)'

    # -----------------------------------------------------------------------
    # Fill parity gaps for existing commands
    # -----------------------------------------------------------------------

    # agent subcommand options
    complete -c $prog -n "__pd_using_command agent" -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command agent" -l type -d 'Agent type' -x -a 'worker orchestrator monitor generic'
    complete -c $prog -n "__pd_using_command agent" -l name -d 'Human-readable name' -x
    complete -c $prog -n "__pd_using_command agent" -l maxServices -d 'Max services' -x
    complete -c $prog -n "__pd_using_command agent" -l maxLocks -d 'Max locks' -x

    # log missing options (--from, --to already exist in zsh/bash)
    complete -c $prog -n "__pd_using_command log" -l from -d 'Start of time range' -x
    complete -c $prog -n "__pd_using_command log" -l to -d 'End of time range' -x

    # webhook/webhooks options
    complete -c $prog -n "__pd_using_command webhook webhooks" -l url -d 'Webhook URL' -x
    complete -c $prog -n "__pd_using_command webhook webhooks" -l events -d 'Webhook events' -x
    complete -c $prog -n "__pd_using_command webhook webhooks" -l active -d 'Filter active webhooks'

    # down (no extra options but needs consistency)

    # doctor / diagnose (already handled by command registration)
end
