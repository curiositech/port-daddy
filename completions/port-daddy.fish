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
    'claim' 'c' 'release' 'r' 'find' 'f' 'list' 'l' 'ps' 'services' 'url' 'env' 'tunnel' \
    'pub' 'publish' 'sub' 'subscribe' 'wait' 'lock' 'unlock' 'locks' \
    'agent' 'agents' 'log' 'activity' \
    'session' 'sessions' 'note' 'notes' \
    'salvage' 'resurrection' 'changelog' 'dns' 'files' 'who-owns' 'integration' 'briefing' 'history' 'inbox' \
    'begin' 'b' 'done' 'whoami' 'w' 'with-lock' 'n' 'u' 'd' 'learn' 'tutorial' 'spawn' 'spawned' 'watch' 'harbor' 'harbors' \
    'up' 'down' \
    'bench' 'demo' 'fleet' \
    'dashboard' 'channels' 'webhook' 'webhooks' 'metrics' 'config' 'health' 'ports' \
    'scan' 's' 'projects' 'p' 'doctor' 'diagnose' 'hints' \
    'start' 'stop' 'restart' 'status' 'install' 'uninstall' 'dev' 'ci-gate' 'mcp' \
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
    complete -c $prog -n __pd_needs_command -a services -d 'List all active services (alias)'
    complete -c $prog -n __pd_needs_command -a url -d 'Manage service URLs (get/set/rm/list)'
    complete -c $prog -n __pd_needs_command -a env -d 'Get environment variables for a service'
    complete -c $prog -n __pd_needs_command -a tunnel -d 'Manage tunnels (start/stop/status/list)'
    complete -c $prog -n __pd_needs_command -a dns -d 'Local DNS records for services'

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
    complete -c $prog -n __pd_needs_command -a resurrection -d 'Check for dead agents (alias for salvage)'

    # Changelog
    complete -c $prog -n __pd_needs_command -a changelog -d 'Hierarchical changelog with identity-based rollup'

    # File Claims & Integration
    complete -c $prog -n __pd_needs_command -a files -d 'List all active file claims across sessions'
    complete -c $prog -n __pd_needs_command -a who-owns -d 'Check who has claimed a specific file path'
    complete -c $prog -n __pd_needs_command -a integration -d 'Manage integration signals (ready/needs/list)'

    # Briefing & History
    complete -c $prog -n __pd_needs_command -a briefing -d 'Generate .portdaddy/ project briefing'
    complete -c $prog -n __pd_needs_command -a history -d 'View recent project activity'

    # Agent Inbox
    complete -c $prog -n __pd_needs_command -a inbox -d 'Agent-to-agent direct messaging inbox'

    # AI Agent Spawner + Watch
    complete -c $prog -n __pd_needs_command -a spawn -d 'Launch an AI agent (Ollama/Claude/Gemini/Aider/custom)'
    complete -c $prog -n __pd_needs_command -a spawned -d 'List active spawned agents'
    complete -c $prog -n __pd_needs_command -a watch -d 'Subscribe to a channel and run a script on each message'

    # Harbors (named permission namespaces)
    complete -c $prog -n __pd_needs_command -a harbor -d 'Create, enter, leave, show, or destroy a harbor'
    complete -c $prog -n __pd_needs_command -a harbors -d 'List all active harbors'

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

    # Benchmarking & Demos
    complete -c $prog -n __pd_needs_command -a bench -d 'Run performance benchmarks'
    complete -c $prog -n __pd_needs_command -a demo -d 'Interactive demos of Port Daddy features'
    complete -c $prog -n "__pd_using_command demo" -x -a 'port-conflict' -d 'Demo port conflict resolution'
    complete -c $prog -n "__pd_using_command demo" -x -a 'coordination' -d 'Demo agent coordination'
    complete -c $prog -n __pd_needs_command -a fleet -d 'Manage background agent fleet'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'up' -d 'Start Dock Master and all watchers'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'down' -d 'Stop all fleet agents'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'status' -d 'Show fleet health'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'log' -d 'Show fleet log'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'gardener' -d 'Auto-commit uncommitted changes'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'qa' -d 'Adversarial code review'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'hunt' -d 'Find test coverage gaps'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'docs' -d 'Sync docs to code'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'simplify' -d 'Propose simplifications'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'research' -d 'Deep research on a topic'

    # Project
    complete -c $prog -n __pd_needs_command -a scan -d 'Deep-scan project for frameworks'
    complete -c $prog -n __pd_needs_command -a s -d 'Scan project (alias)'
    complete -c $prog -n __pd_needs_command -a projects -d 'List or manage registered projects'
    complete -c $prog -n __pd_needs_command -a p -d 'List projects (alias)'
    complete -c $prog -n __pd_needs_command -a doctor -d 'Run environment diagnostics'
    complete -c $prog -n __pd_needs_command -a diagnose -d 'Run diagnostics (alias for doctor)'
    complete -c $prog -n __pd_needs_command -a hints -d 'Show salvage queue and onboarding nudges for the current project'

    # Daemon lifecycle
    complete -c $prog -n __pd_needs_command -a start -d 'Start the daemon'
    complete -c $prog -n __pd_needs_command -a stop -d 'Stop the daemon'
    complete -c $prog -n __pd_needs_command -a restart -d 'Restart the daemon'
    complete -c $prog -n __pd_needs_command -a status -d 'Show daemon status'
    complete -c $prog -n __pd_needs_command -a install -d 'Install as system service'
    complete -c $prog -n __pd_needs_command -a uninstall -d 'Uninstall system service'
    complete -c $prog -n __pd_needs_command -a dev -d 'Start daemon in foreground'
    complete -c $prog -n __pd_needs_command -a ci-gate -d 'Exit non-zero if daemon is stale'
    complete -c $prog -n __pd_needs_command -a mcp -d 'Start MCP server for Claude Code'

    # Sugar (compound commands)
    complete -c $prog -n __pd_needs_command -a begin -d 'Begin a work session (register + start)'
    complete -c $prog -n __pd_needs_command -a b -d 'Begin a work session (alias for begin)'
    complete -c $prog -n __pd_needs_command -a done -d 'End a work session (end + unregister)'
    complete -c $prog -n __pd_needs_command -a whoami -d 'Show current agent/session context'
    complete -c $prog -n __pd_needs_command -a w -d 'Show current context (alias for whoami)'
    complete -c $prog -n __pd_needs_command -a with-lock -d 'Run a command while holding a lock'
    complete -c $prog -n __pd_needs_command -a n -d 'Add a quick note (alias for note)'
    complete -c $prog -n __pd_needs_command -a u -d 'Start all services (alias for up)'
    complete -c $prog -n __pd_needs_command -a d -d 'Stop all services (alias for down)'

    # Tutorial
    complete -c $prog -n __pd_needs_command -a learn -d 'Interactive tutorial — learn Port Daddy step by step'
    complete -c $prog -n __pd_needs_command -a tutorial -d 'Interactive tutorial (alias for learn)'

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

    # url subcommands
    complete -c $prog -n "__pd_using_command url" -x -a 'set' -d 'Set URL for environment'
    complete -c $prog -n "__pd_using_command url" -x -a 'rm' -d 'Remove URL for environment'
    complete -c $prog -n "__pd_using_command url" -x -a 'list' -d 'List all URLs'
    complete -c $prog -n "__pd_using_command url" -x -a 'ls' -d 'List all URLs (alias)'
    complete -c $prog -n "__pd_using_command url" -s e -l env -d 'Environment name' -x -a 'dev staging prod'
    complete -c $prog -n "__pd_using_command url" -l open -d 'Open URL in browser'
    complete -c $prog -n "__pd_using_command url" -x -a '(__pd_service_ids)'

    # tunnel subcommands
    complete -c $prog -n "__pd_using_command tunnel" -x -a 'start' -d 'Start a tunnel'
    complete -c $prog -n "__pd_using_command tunnel" -x -a 'stop' -d 'Stop a tunnel'
    complete -c $prog -n "__pd_using_command tunnel" -x -a 'status' -d 'Get tunnel status'
    complete -c $prog -n "__pd_using_command tunnel" -x -a 'list' -d 'List active tunnels'
    complete -c $prog -n "__pd_using_command tunnel" -x -a 'ls' -d 'List active tunnels (alias)'
    complete -c $prog -n "__pd_using_command tunnel" -x -a 'providers' -d 'Check installed providers'
    complete -c $prog -n "__pd_using_command tunnel" -l provider -d 'Tunnel provider' -x -a 'ngrok cloudflared localtunnel'
    complete -c $prog -n "__pd_using_command tunnel" -x -a '(__pd_service_ids)'

    # dns subcommands
    complete -c $prog -n "__pd_using_command dns" -x -a 'list' -d 'List DNS records'
    complete -c $prog -n "__pd_using_command dns" -x -a 'ls' -d 'List DNS records (alias)'
    complete -c $prog -n "__pd_using_command dns" -x -a 'register' -d 'Register a DNS record'
    complete -c $prog -n "__pd_using_command dns" -x -a 'add' -d 'Register a DNS record (alias)'
    complete -c $prog -n "__pd_using_command dns" -x -a 'unregister' -d 'Remove a DNS record'
    complete -c $prog -n "__pd_using_command dns" -x -a 'rm' -d 'Remove a DNS record (alias)'
    complete -c $prog -n "__pd_using_command dns" -x -a 'lookup' -d 'Lookup by hostname'
    complete -c $prog -n "__pd_using_command dns" -x -a 'cleanup' -d 'Remove stale DNS records'
    complete -c $prog -n "__pd_using_command dns" -x -a 'status' -d 'DNS system status'
    complete -c $prog -n "__pd_using_command dns" -x -a 'setup' -d 'Initialize /etc/hosts managed section'
    complete -c $prog -n "__pd_using_command dns" -x -a 'teardown' -d 'Remove /etc/hosts managed section'
    complete -c $prog -n "__pd_using_command dns" -x -a 'sync' -d 'Rebuild /etc/hosts from DNS registry'
    complete -c $prog -n "__pd_using_command dns" -l resolve -d 'Also add to /etc/hosts'
    complete -c $prog -n "__pd_using_command dns" -l port -d 'Port number' -x
    complete -c $prog -n "__pd_using_command dns" -l hostname -d 'Custom hostname (must end in .local)' -x
    complete -c $prog -n "__pd_using_command dns" -l pattern -d 'Filter by identity pattern' -x
    complete -c $prog -n "__pd_using_command dns" -l limit -d 'Max records to return' -x
    complete -c $prog -n "__pd_using_command dns" -x -a '(__pd_service_ids)'

    # env
    complete -c $prog -n "__pd_using_command env" -l file -d 'Write env vars to file' -r
    complete -c $prog -n "__pd_using_command env" -x -a '(__pd_service_ids)'

    # pub / publish
    complete -c $prog -n "__pd_using_command pub publish" -s m -l message -d 'Message payload (JSON or text)' -x
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
    complete -c $prog -n "__pd_using_command session" -x -a 'phase' -d 'Set session phase'
    complete -c $prog -n "__pd_using_command session" -s P -l purpose -d 'Session purpose' -x
    complete -c $prog -n "__pd_using_command session" -s n -l note -d 'Handoff note' -x
    complete -c $prog -n "__pd_using_command session" -s a -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'

    # sessions
    complete -c $prog -n "__pd_using_command sessions" -l all -d 'Show all sessions, not just active'
    complete -c $prog -n "__pd_using_command sessions" -l status -d 'Filter by status' -x -a 'active completed abandoned'
    complete -c $prog -n "__pd_using_command sessions" -l files -d 'Include file claims'

    # note
    complete -c $prog -n "__pd_using_command note" -s c -l content -d 'Note content' -x
    complete -c $prog -n "__pd_using_command note" -s t -l type -d 'Note type' -x -a 'note handoff commit warning'

    # notes
    complete -c $prog -n "__pd_using_command notes" -l limit -d 'Max entries' -x
    complete -c $prog -n "__pd_using_command notes" -l type -d 'Filter by note type' -x -a 'note handoff commit warning'

    # resurrection (alias for salvage)
    complete -c $prog -n "__pd_using_command resurrection" -x -a 'claim' -d 'Claim a dead agent\'s work for resurrection'
    complete -c $prog -n "__pd_using_command resurrection" -x -a 'complete' -d 'Mark resurrection as complete'
    complete -c $prog -n "__pd_using_command resurrection" -x -a 'abandon' -d 'Return agent to resurrection queue'
    complete -c $prog -n "__pd_using_command resurrection" -x -a 'dismiss' -d 'Remove agent from queue (reviewed, not resurrecting)'
    complete -c $prog -n "__pd_using_command resurrection" -l project -d 'Filter to agents in this project' -x
    complete -c $prog -n "__pd_using_command resurrection" -l stack -d 'Filter by stack (requires --project)' -x
    complete -c $prog -n "__pd_using_command resurrection" -l all -d 'Show ALL queue entries globally (use sparingly)'
    complete -c $prog -n "__pd_using_command resurrection" -l limit -d 'Max entries to return' -x
    complete -c $prog -n "__pd_using_command resurrection" -x -a '(__pd_agent_ids)'

    # services (alias for list/find)
    complete -c $prog -n "__pd_using_command services" -l status -d 'Filter by status' -x -a 'active expired all'
    complete -c $prog -n "__pd_using_command services" -l port -d 'Filter by port' -x
    complete -c $prog -n "__pd_using_command services" -l expired -d 'Include expired'
    complete -c $prog -n "__pd_using_command services" -x -a '(__pd_service_ids)'

    # salvage subcommands
    complete -c $prog -n "__pd_using_command salvage" -x -a 'claim' -d 'Claim a dead agent\'s work for resurrection'
    complete -c $prog -n "__pd_using_command salvage" -x -a 'complete' -d 'Mark resurrection as complete'
    complete -c $prog -n "__pd_using_command salvage" -x -a 'abandon' -d 'Return agent to resurrection queue'
    complete -c $prog -n "__pd_using_command salvage" -x -a 'dismiss' -d 'Remove agent from queue (reviewed, not resurrecting)'
    complete -c $prog -n "__pd_using_command salvage" -l project -d 'Filter to agents in this project' -x
    complete -c $prog -n "__pd_using_command salvage" -l stack -d 'Filter by stack (requires --project)' -x
    complete -c $prog -n "__pd_using_command salvage" -l all -d 'Show ALL queue entries globally (use sparingly)'
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

    # files
    complete -c $prog -n "__pd_using_command files" -l session -d 'Filter by session ID' -x

    # who-owns
    # (takes a file path as positional argument, no special options)

    # integration subcommands
    complete -c $prog -n "__pd_using_command integration" -x -a 'ready' -d 'Signal work is ready for integration'
    complete -c $prog -n "__pd_using_command integration" -x -a 'needs' -d 'Signal work needs something from another agent'
    complete -c $prog -n "__pd_using_command integration" -x -a 'list' -d 'List recent integration signals'
    complete -c $prog -n "__pd_using_command integration" -s d -l description -d 'Signal description' -x
    complete -c $prog -n "__pd_using_command integration" -l project -d 'Filter by project name' -x

    # briefing
    complete -c $prog -n "__pd_using_command briefing" -l full -d 'Full sync with archives and activity.log'
    complete -c $prog -n "__pd_using_command briefing" -l project -d 'Override project detection' -x
    complete -c $prog -n "__pd_using_command briefing" -l dir -d 'Target directory' -r

    # history
    complete -c $prog -n "__pd_using_command history" -l limit -d 'Max entries' -x
    complete -c $prog -n "__pd_using_command history" -l type -d 'Activity type' -x -a 'claim release lock unlock pub sub agent heartbeat'
    complete -c $prog -n "__pd_using_command history" -l agent -d 'Filter by agent ID' -x -a '(__pd_agent_ids)'

    # inbox subcommands
    complete -c $prog -n "__pd_using_command inbox" -x -a 'send' -d 'Send a message to an agent inbox'
    complete -c $prog -n "__pd_using_command inbox" -x -a 'stats' -d 'Get inbox stats for an agent'
    complete -c $prog -n "__pd_using_command inbox" -x -a 'clear' -d 'Clear all messages from an agent inbox'
    complete -c $prog -n "__pd_using_command inbox" -x -a 'read-all' -d 'Mark all messages as read'
    complete -c $prog -n "__pd_using_command inbox" -x -a 'list' -d 'List messages in an agent inbox'
    complete -c $prog -n "__pd_using_command inbox" -l message -d 'Message content' -x
    complete -c $prog -n "__pd_using_command inbox" -l from -d 'Sender agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command inbox" -x -a '(__pd_agent_ids)'

    # -----------------------------------------------------------------------
    # Fill parity gaps for existing commands
    # -----------------------------------------------------------------------

    # agent subcommand options
    complete -c $prog -n "__pd_using_command agent" -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command agent" -l type -d 'Agent type' -x -a 'worker orchestrator monitor generic'
    complete -c $prog -n "__pd_using_command agent" -l name -d 'Human-readable name' -x
    complete -c $prog -n "__pd_using_command agent" -l identity -d 'Semantic identity (project:stack:context)' -x
    complete -c $prog -n "__pd_using_command agent" -l purpose -d 'What the agent is working on' -x
    complete -c $prog -n "__pd_using_command agent" -l worktree -d 'Git worktree identifier' -x
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

    # begin / b
    complete -c $prog -n "__pd_using_command begin" -s P -l purpose -d 'What you are working on' -x
    complete -c $prog -n "__pd_using_command begin" -s i -l identity -d 'Semantic identity (project:stack:context)' -x
    complete -c $prog -n "__pd_using_command begin" -s a -l agent -d 'Agent ID (auto-generated if omitted)' -x
    complete -c $prog -n "__pd_using_command begin" -s t -l type -d 'Agent type' -x -a 'worker orchestrator monitor'
    complete -c $prog -n "__pd_using_command begin" -l files -d 'Files to claim' -r
    complete -c $prog -n "__pd_using_command begin" -s f -l force -d 'Force file claims even if already claimed'
    complete -c $prog -n "__pd_using_command b" -s P -l purpose -d 'What you are working on' -x
    complete -c $prog -n "__pd_using_command b" -s i -l identity -d 'Semantic identity (project:stack:context)' -x
    complete -c $prog -n "__pd_using_command b" -s a -l agent -d 'Agent ID (auto-generated if omitted)' -x
    complete -c $prog -n "__pd_using_command b" -s t -l type -d 'Agent type' -x -a 'worker orchestrator monitor'
    complete -c $prog -n "__pd_using_command b" -l files -d 'Files to claim' -r
    complete -c $prog -n "__pd_using_command b" -s f -l force -d 'Force file claims even if already claimed'

    # done
    complete -c $prog -n "__pd_using_command done" -s n -l note -d 'Final note' -x
    complete -c $prog -n "__pd_using_command done" -s a -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command done" -l session -d 'Session ID' -x
    complete -c $prog -n "__pd_using_command done" -s s -l status -d 'Session end status' -x -a 'completed abandoned'

    # whoami / w
    complete -c $prog -n "__pd_using_command whoami" -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command w" -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'

    # with-lock
    complete -c $prog -n "__pd_using_command with-lock" -l ttl -d 'Lock TTL in milliseconds' -x
    complete -c $prog -n "__pd_using_command with-lock" -l owner -d 'Lock owner' -x
    complete -c $prog -n "__pd_using_command with-lock" -x -a '(__pd_lock_names)'

    # n (alias for note)
    complete -c $prog -n "__pd_using_command n" -s c -l content -d 'Note content' -x
    complete -c $prog -n "__pd_using_command n" -s t -l type -d 'Note type' -x -a 'note handoff commit warning'

    # spawn
    complete -c $prog -n "__pd_using_command spawn" -l backend -d 'AI backend' -x -a 'ollama claude claude-cli gemini aider custom'
    complete -c $prog -n "__pd_using_command spawn" -l model -d 'Model name override' -x
    complete -c $prog -n "__pd_using_command spawn" -l identity -d 'PD semantic identity (project:stack:context)' -x -a '(__pd_service_ids)'
    complete -c $prog -n "__pd_using_command spawn" -l purpose -d 'Human-readable task description' -x
    complete -c $prog -n "__pd_using_command spawn" -l allowedTools -d 'Tool permissions for claude-cli backend' -x
    complete -c $prog -n "__pd_using_command spawn" -l maxTokens -d 'Max tokens for claude/claude-cli' -x
    complete -c $prog -n "__pd_using_command spawn" -l files -d 'Files to pass to aider' -r
    complete -c $prog -n "__pd_using_command spawn" -l workdir -d 'Working directory' -r
    complete -c $prog -n "__pd_using_command spawn" -l timeout -d 'Timeout in milliseconds' -x

    # watch
    complete -c $prog -n "__pd_using_command watch" -l exec -d 'Shell command to run on each message' -x
    complete -c $prog -n "__pd_using_command watch" -l once -d 'Exit after first message'
    complete -c $prog -n "__pd_using_command watch" -l max-concurrent -d 'Max concurrent exec processes (default: 3)' -x
    complete -c $prog -n "__pd_using_command watch" -l timeout -d 'Per-exec timeout in ms (default: 30000)' -x
    complete -c $prog -n "__pd_using_command watch" -l min-interval -d 'Min ms between executions, rate limit (default: 0)' -x
    complete -c $prog -n "__pd_using_command watch" -x -a '(__pd_channels)'

    # harbor
    complete -c $prog -n "__pd_using_command harbor" -x -a 'create enter leave show destroy delete'
    complete -c $prog -n "__pd_using_command harbor" -l cap -d 'Capabilities (comma-separated)' -x
    complete -c $prog -n "__pd_using_command harbor" -l channels -d 'Channel names (comma-separated)' -x
    complete -c $prog -n "__pd_using_command harbor" -l expires -d 'Expiry duration (e.g. 2h, 30m)' -x
    complete -c $prog -n "__pd_using_command harbor" -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'

    # harbors
    complete -c $prog -n "__pd_using_command harbors" -l json -d 'JSON output'
end
