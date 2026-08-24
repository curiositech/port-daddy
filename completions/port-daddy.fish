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
    'pub' 'publish' 'broadcast' 'sub' 'subscribe' 'listen' 'tube' 'wait' 'lock' 'unlock' 'locks' \
    'agent' 'agents' 'actor' 'actors' 'roster' 'swarm' 'log' 'activity' \
    'session' 'sessions' 'takeover' 'note' 'notes' \
    'salvage' 'resurrection' 'changelog' 'dns' 'files' 'add' 'who-owns' 'integration' 'briefing' 'history' 'inbox' 'send' 'sent' \
    'begin' 'b' 'done' 'whoami' 'w' 'account' 'attention' 'nudge' 'with-lock' 'n' 'u' 'd' 'learn' 'tutorial' 'spawn' 'spawned' 'work' 'sortie' 'transcripts' 'transcript' 'relay' 'dispatch' 'nightshift' 'review' 'morning' 'periscope' 'sight' 'scope' 'coast-guard' 'cg' 'safe' 'cockpit' 'popper' 'secret' 'secrets' 'watch' 'harbormaster' 'hm' 'harbor' 'harbors' 'harbor-ledger' 'tuple' 'graph' 'booty' 'embed' 'skill-graft' 'skillgraft' 'memory' 'ideas' 'roadmap' 'quorum' 'parley' 'feedback' 'commit' 'obligations' 'suggest' 'seamanship' 'skills' \
    'say' 'look' 'sitrep' 'whois' 'advise' 'preflight' 'compass' 'guard' 'snapshots' 'snapshot' 'backup' 'restore' 'attest' 'shipwright' 'pheromone' 'ph' \
    'wallet' 'bond' \
    'up' 'down' \
    'bench' 'benchmark' 'demo' 'fleet' 'backend' 'squid' 'relay' \
    'dashboard' 'channels' 'webhook' 'webhooks' 'metrics' 'config' 'health' 'ports' \
    'scan' 's' 'projects' 'p' 'doctor' 'diagnose' 'hints' \
    'start' 'stop' 'restart' 'status' 'install' 'install-bosun' 'uninstall' 'dev' 'use' 'daemon' 'ci-gate' 'self-update' 'upgrade' 'mcp' \
    'setup' 'init' 'cut' 'batten' 'hooks' \
    'plan' 'interruptions' 'version' 'help'

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
    complete -c $prog -n __pd_needs_command -a broadcast -d 'Publish a message (alias)'
    complete -c $prog -n __pd_needs_command -a sub -d 'Subscribe to a channel'
    complete -c $prog -n __pd_needs_command -a subscribe -d 'Subscribe to a channel (alias)'
    complete -c $prog -n __pd_needs_command -a listen -d 'Subscribe to a channel (alias)'
    complete -c $prog -n __pd_needs_command -a tube -d 'Conversational pipe over a channel (listen/send/reply)'
    complete -c $prog -n __pd_needs_command -a wait -d 'Wait until a service is claimed'
    complete -c $prog -n __pd_needs_command -a lock -d 'Acquire a distributed lock'
    complete -c $prog -n __pd_needs_command -a unlock -d 'Release a distributed lock'
    complete -c $prog -n __pd_needs_command -a locks -d 'List all active locks'

    # Agent registry
    complete -c $prog -n __pd_needs_command -a agent -d 'Manage an agent'
    complete -c $prog -n __pd_needs_command -a agents -d 'List registered agents'
    complete -c $prog -n __pd_needs_command -a swarm -d 'List registered agents (alias)'
    complete -c $prog -n __pd_needs_command -a roster -d 'Manage durable named AgentNode experts'
    complete -c $prog -n "__pd_using_command roster" -a 'list show search create promote update attach continue retire help'
    complete -c $prog -n "__pd_using_command roster" -l repo -x -d 'Repository root'
    complete -c $prog -n "__pd_using_command roster" -l scope -x -a 'system repo' -d 'Identity scope'
    complete -c $prog -n "__pd_using_command roster" -l slug -x -d 'Meaningful human alias'
    complete -c $prog -n "__pd_using_command roster" -l remit -x -d 'Bounded responsibility'
    complete -c $prog -n "__pd_using_command roster" -l instructions -x -d 'Durable operating prompt'
    complete -c $prog -n "__pd_using_command roster" -l backend -x -d 'Target backend'
    complete -c $prog -n "__pd_using_command roster" -l episode -x -d 'Sanitized handoff episode id'
    complete -c $prog -n "__pd_using_command roster" -l mode -x -a 'auto native handoff' -d 'Continuation mode'

    # Activity
    complete -c $prog -n __pd_needs_command -a log -d 'Tail the activity log'
    complete -c $prog -n __pd_needs_command -a activity -d 'Activity summary or stats'

    # Sessions & Notes
    complete -c $prog -n __pd_needs_command -a session -d 'Manage a session'
    complete -c $prog -n __pd_needs_command -a sessions -d 'List sessions'
    complete -c $prog -n __pd_needs_command -a takeover -d 'Create successor session; preserve notes'
    complete -c $prog -n __pd_needs_command -a note -d 'Add a quick note'
    complete -c $prog -n __pd_needs_command -a notes -d 'List recent notes'

    # Agent Resurrection
    complete -c $prog -n __pd_needs_command -a salvage -d 'Check for dead agents with recoverable work'
    complete -c $prog -n __pd_needs_command -a resurrection -d 'Check for dead agents (alias for salvage)'

    # Changelog
    complete -c $prog -n __pd_needs_command -a changelog -d 'Hierarchical changelog with identity-based rollup'

    # File Claims & Integration
    complete -c $prog -n __pd_needs_command -a files -d 'List all active file claims across sessions'
    complete -c $prog -n __pd_needs_command -a add -d 'Claim-aware git add wrapper'
    complete -c $prog -n __pd_needs_command -a who-owns -d 'Check who has claimed a specific file path'
    complete -c $prog -n __pd_needs_command -a integration -d 'Manage integration signals (ready/needs/list)'

    # Briefing & History
    complete -c $prog -n __pd_needs_command -a briefing -d 'Generate .portdaddy/ project briefing'
    complete -c $prog -n __pd_needs_command -a history -d 'View recent project activity'
    complete -c $prog -n __pd_needs_command -a graph -d 'Inspect semantic graph edges and stats'
    complete -c $prog -n __pd_needs_command -a embed -d 'Shared local embedding model: status, prefetch, embed text'
    complete -c $prog -n __pd_needs_command -a skill-graft -d 'Query and warm the native local skill-graft index'
    complete -c $prog -n __pd_needs_command -a skillgraft -d 'Alias for skill-graft'
    complete -c $prog -n __pd_needs_command -a booty -d 'Harvest artifacts into the blob store with provenance'
    complete -c $prog -n __pd_needs_command -a memory -d 'Inspect episodic memory entries and stats'
    complete -c $prog -n __pd_needs_command -a ideas -d 'Search ideas, notes, tuples, and repo markdown'
    complete -c $prog -n __pd_needs_command -a roadmap -d 'Show and write the roadmap_items DB-of-record'
    complete -c $prog -n __pd_needs_command -a quorum -d 'Propose, vote, list, or inspect swarm proposals'
    complete -c $prog -n __pd_needs_command -a parley -d 'Call, respond, resolve, list, show, or fit swarm parleys'
    complete -c $prog -n __pd_needs_command -a feedback -d 'Drop, list, show, or harvest structured agentic feedback'
    complete -c $prog -n __pd_needs_command -a commit -d 'Create a durable commitment (or close one against an oracle)'
    complete -c $prog -n __pd_needs_command -a obligations -d 'List commitments, or sweep for overdue ones with --overdue'

    # Agent Inbox
    complete -c $prog -n __pd_needs_command -a inbox -d 'Agent-to-agent direct messaging inbox'
    complete -c $prog -n __pd_needs_command -a send -d 'Send a durable direct message to one agent'
    complete -c $prog -n __pd_needs_command -a sent -d 'Read receipts for messages you sent'

    # AI Agent Spawner + Watch
    complete -c $prog -n __pd_needs_command -a spawn -d 'Launch an AI agent (Ollama/Claude/Gemini/Aider/custom)'
    complete -c $prog -n __pd_needs_command -a spawned -d 'List active spawned agents'
    complete -c $prog -n __pd_needs_command -a work -d 'Work Intent family: adapter conformance probes (ADR-0095, ch18 C2)'
    complete -c $prog -n '__pd_using_command work' -a 'probe matrix help' -d 'work subcommand'
    complete -c $prog -n '__pd_using_command work; and __fish_seen_subcommand_from probe' -l adapter -d 'Adapter kind (claude-code codex-cli cloudflare ollama lmstudio custom-stdio custom-http)'
    complete -c $prog -n '__pd_using_command work; and __fish_seen_subcommand_from probe' -l profile -d 'Fixture profile (compliant weak broken malicious)'
    complete -c $prog -n '__pd_using_command work' -l json -d 'JSON output'
    complete -c $prog -n __pd_needs_command -a sortie -d 'Launch and inspect tracked mission records'
    complete -c $prog -n __pd_needs_command -a transcripts -d 'Browse fleet ship-run transcripts (list/show/watch/cost)'
    complete -c $prog -n __pd_needs_command -a transcript -d 'Alias for transcripts — view a single ship-run record'
    complete -c $prog -n __pd_needs_command -a relay -d 'Cloud relay management — configure, exchange, status (ADR-0049)'
    complete -c $prog -n "__pd_using_command relay" -x -a 'url status exchange' -d 'Relay subcommand'
    complete -c $prog -n "__pd_using_command safe" -x -a 'scan baseline fix corral guard' -d 'Safe subcommand (ADR-0088)'
    complete -c $prog -n "__pd_using_command safe; and __fish_seen_subcommand_from scan" -l json -d 'Structured posture report'
    complete -c $prog -n "__pd_using_command safe; and __fish_seen_subcommand_from baseline" -x -a 'accept' -d 'Triage a finding into the baseline'
    complete -c $prog -n "__pd_using_command safe; and __fish_seen_subcommand_from fix" -l auto -d 'Apply the opt-in reversible chmod'
    complete -c $prog -n "__pd_using_command safe; and __fish_seen_subcommand_from corral" -l all -d 'Corral every detected secret'
    complete -c $prog -n "__pd_using_command safe; and __fish_seen_subcommand_from corral" -l apply -d 'Write the corral (default is dry-run)'
    complete -c $prog -n "__pd_using_command safe; and __fish_seen_subcommand_from guard" -l staged -d 'Scan the staged diff for secrets'
    complete -c $prog -n "__pd_needs_command" -a 'relay url' -d 'Show the configured relay worker URL'
    complete -c $prog -n "__pd_needs_command" -a 'relay status' -d 'Check relay connectivity and latency'
    complete -c $prog -n "__pd_needs_command" -a 'relay exchange' -d 'Publish/subscribe events via the relay worker'
    complete -c $prog -n __pd_needs_command -a dispatch -d 'Queue and run autonomous feature dev (ADR-0035; renames nightshift)'
    complete -c $prog -n __pd_needs_command -a whois -d 'Semantic skill-router — rank agents by capability x freshness'
    complete -c $prog -n "__pd_using_command dispatch" -x -a 'propose queue list show run review cancel help' -d 'Dispatch subcommand'
    complete -c $prog -n "__pd_using_command dispatch; and __fish_seen_subcommand_from run" -l really-run -d 'Actually spawn the autonomous agent (default is dry-run)'
    complete -c $prog -n "__pd_using_command dispatch; and __fish_seen_subcommand_from run" -l next -d 'Pop and run the next proposed dispatch'
    complete -c $prog -n "__pd_using_command dispatch" -l backend -x -a 'cli:claude-code cli:codex' -d 'Backend override'
    complete -c $prog -n "__pd_using_command dispatch" -l base-branch -x -d 'Branch the worktree is carved from (default: main)'
    complete -c $prog -n "__pd_using_command dispatch" -l merge-policy -x -a 'review never' -d 'Merge policy (auto requires PR #141)'
    complete -c $prog -n "__pd_using_command dispatch" -l budget -x -d 'Per-dispatch USD ceiling'
    complete -c $prog -n "__pd_using_command dispatch" -l timeout -x -d 'Per-dispatch timeout (seconds)'
    complete -c $prog -n "__pd_using_command dispatch" -l tags -x -d 'Comma-separated tags'
    complete -c $prog -n "__pd_using_command dispatch" -l to -x -d 'Target actor for dispatch'
    complete -c $prog -n "__pd_using_command dispatch" -l reviewer -x -d 'Reviewer actor (default: operator)'
    complete -c $prog -n "__pd_using_command dispatch" -l state -x -a 'proposed claimed in_progress produced review_pending accepted rejected settled failed salvage open terminal awaiting_review all' -d 'State filter'
    complete -c $prog -n __pd_needs_command -a nightshift -d '(deprecated alias) Use pd dispatch'
    complete -c $prog -n "__pd_using_command nightshift" -x -a 'propose queue list show run review cancel help' -d 'Nightshift subcommand (alias for dispatch)'
    complete -c $prog -n __pd_needs_command -a hooks -d 'Per-project daemon-gated coordination hooks for agent CLIs'
    complete -c $prog -n "__pd_using_command hooks" -x -a 'install list uninstall' -d 'Hooks subcommand'
    complete -c $prog -n "__pd_using_command hooks" -l user -d 'Also write user-level config for claude/gemini'
    complete -c $prog -n "__pd_using_command hooks" -l yes -d 'Skip the confirmation prompt'
    complete -c $prog -n __pd_needs_command -a squid -d 'Run an unofficial Anthropic-compatible bridge backed by Codex CLI'
    complete -c $prog -n "__pd_using_command squid" -x -a 'bridge serve codex pro on off arm disarm status tap hooks' -d 'Squid subcommand'
    complete -c $prog -n "__pd_using_command squid" -l port -x -d 'Local bridge port'
    complete -c $prog -n "__pd_using_command squid" -l host -x -d 'Local bind host'
    complete -c $prog -n "__pd_using_command squid" -l cwd -x -d 'Working directory for Codex and launched client'
    complete -c $prog -n "__pd_using_command squid" -l max-request-bytes -x -d 'Maximum JSON request body size'
    complete -c $prog -n "__pd_using_command squid" -l token -x -d 'Local bridge token'
    complete -c $prog -n "__pd_using_command squid" -l codex-model -x -d 'Actual Codex CLI model'
    complete -c $prog -n "__pd_using_command squid" -l codex-model-alias -x -d 'Client-to-backend model alias'
    complete -c $prog -n "__pd_using_command squid" -l codex-effort -x -a 'minimal low medium high' -d 'Codex reasoning effort'
    complete -c $prog -n "__pd_using_command squid" -l codex-config -x -d 'Extra Codex -c override'
    complete -c $prog -n "__pd_using_command squid" -l client -x -d 'Client binary to launch'
    complete -c $prog -n "__pd_using_command squid" -l client-arg -x -d 'Client argument'
    complete -c $prog -n "__pd_using_command squid" -l serve-only -d 'Start bridge without launching a client'
    complete -c $prog -n __pd_needs_command -a review -d 'pd review <id> --accept|--reject: operator review contract'
    complete -c $prog -n "__pd_using_command review" -l accept -d 'Accept the produced work'
    complete -c $prog -n "__pd_using_command review" -l reject -x -d 'Reject with reason'
    complete -c $prog -n "__pd_using_command review" -l retry -x -d '(not yet implemented; see ADR-0035)'
    complete -c $prog -n __pd_needs_command -a morning -d 'Start-of-day summary of dispatch state machine'
    complete -c $prog -n "__pd_using_command morning" -l since -x -d 'Lookback start (ISO or epoch ms)'
    complete -c $prog -n "__pd_using_command morning" -l json -d 'JSON output'
    complete -c $prog -n __pd_needs_command -a periscope -d 'Operator loop SIGHT stage — raise the periscope (state + next cut)'
    complete -c $prog -n __pd_needs_command -a sight -d 'Alias for periscope — operator loop SIGHT stage'
    complete -c $prog -n __pd_needs_command -a scope -d 'Alias for periscope — operator loop SIGHT stage'
    complete -c $prog -n __pd_needs_command -a coast-guard -d 'Coast Guard read path — whether spawns are confined + what they cannot read'
    complete -c $prog -n __pd_needs_command -a cg -d 'Alias for coast-guard — the Coast Guard read path'
    complete -c $prog -n __pd_needs_command -a suggest -d 'Tender suggestion queue — list, approve, dismiss operator suggestions'
    complete -c $prog -n "__pd_using_command suggest" -x -a 'approve dismiss' -d 'Approve or dismiss a suggestion by ID'
    complete -c $prog -n __pd_needs_command -a seamanship -d 'Skill registry — search, show, sync, outcomes, index'
    complete -c $prog -n "__pd_using_command seamanship" -x -a 'list search show sync outcomes index' -d 'Seamanship subcommand'
    complete -c $prog -n __pd_needs_command -a skills -d 'Alias for seamanship — skill registry'
    complete -c $prog -n __pd_needs_command -a cockpit -d 'App-Native Development Cockpit — read roadmap into mission cards'
    complete -c $prog -n "__pd_using_command cockpit" -x -a 'missions' -d 'List mission cards parsed from the project roadmap'
    complete -c $prog -n "__pd_using_command cockpit; and __fish_seen_subcommand_from missions" -l project -x -d 'Project directory to read'
    complete -c $prog -n "__pd_using_command cockpit; and __fish_seen_subcommand_from missions" -l status -x -d 'Comma-separated status filter'
    complete -c $prog -n __pd_needs_command -a popper -d 'Autonomous roadmap-to-dispatch task puller'
    complete -c $prog -n "__pd_using_command popper" -x -a 'status next pop enable disable' -d 'popper subcommand'
    complete -c $prog -n "__pd_using_command popper" -l harbor -x -d 'Scope to a harbor'
    complete -c $prog -n "__pd_using_command popper" -l json -d 'Emit raw JSON'
    complete -c $prog -n __pd_needs_command -a secret -d 'Manage keychain-backed provider credentials'
    complete -c $prog -n __pd_needs_command -a secrets -d 'Manage keychain-backed provider credentials (alias)'
    complete -c $prog -n "__pd_using_command cockpit; and __fish_seen_subcommand_from missions" -l limit -x -d 'Cap returned missions'
    complete -c $prog -n "__pd_using_command cockpit; and __fish_seen_subcommand_from missions" -l json -d 'Emit raw intake envelope'
    complete -c $prog -n __pd_needs_command -a harbormaster -d 'Harbormaster body — serialize merges of operator-accepted dispatches (ADR-0037)'
    complete -c $prog -n __pd_needs_command -a hm -d 'Alias for harbormaster'
    complete -c $prog -n "__pd_using_command harbormaster" -x -a 'start' -d 'Launch the harbormaster body'
    complete -c $prog -n "__pd_using_command harbormaster" -x -a 'stop' -d 'Graceful SIGTERM'
    complete -c $prog -n "__pd_using_command harbormaster" -x -a 'status' -d 'Queue + body status'
    complete -c $prog -n "__pd_using_command harbormaster" -x -a 'queue' -d 'Pretty-print the merge queue'
    complete -c $prog -n "__pd_using_command harbormaster; and __fish_seen_subcommand_from start" -l foreground -d 'Run attached (no detach)'
    complete -c $prog -n "__pd_using_command harbormaster; and __fish_seen_subcommand_from status queue" -l json -d 'Emit JSON'
    complete -c $prog -n __pd_needs_command -a watch -d 'Subscribe to a channel and run a script on each message'
    complete -c $prog -n "__pd_using_command sortie" -x -a 'run' -d 'Launch a tracked sortie mission'
    complete -c $prog -n "__pd_using_command sortie" -x -a 'list' -d 'List recent sorties'
    complete -c $prog -n "__pd_using_command sortie" -x -a 'status' -d 'Show one sortie status'
    complete -c $prog -n "__pd_using_command sortie" -x -a 'logs' -d 'Show one sortie event log'
    complete -c $prog -n "__pd_using_command sortie" -x -a 'help' -d 'Show sortie help'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l backend -x -a 'ollama claude claude-cli gemini codex aider custom' -d 'Backend to use for the coordinating agent'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l model -x -d 'Model override'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l tier -x -a 'low mid high' -d 'Model tier'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l budget -x -d 'Budget ceiling in USD'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l dir -r -d 'Project directory'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l recipe -x -d 'Mission recipe'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l expected -x -d 'Expected output'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l context -x -d 'Extra context'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l identity -x -d 'Identity override'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l purpose -x -d 'Purpose string'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l allowedTools -x -d 'Comma-separated tool allowlist'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l timeout -x -d 'Timeout in milliseconds'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from run" -l maxTokens -x -d 'Max tokens'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from list" -l all -d 'List sorties across all projects'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from list" -l limit -x -d 'Limit results'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from list" -l dir -r -d 'Project directory'
    complete -c $prog -n "__pd_using_command sortie; and __fish_seen_subcommand_from status logs" -l limit -x -d 'Limit log entries'

    # Harbors (named permission namespaces)
    complete -c $prog -n __pd_needs_command -a harbor -d 'Create, enter, leave, show, or destroy a harbor'
    complete -c $prog -n __pd_needs_command -a harbors -d 'List all active harbors'
    complete -c $prog -n __pd_needs_command -a harbor-ledger -d 'Agent Harbor event ledger projections (status, project, rebuild)'

    # Tuple space
    complete -c $prog -n __pd_needs_command -a tuple -d 'Linda-style tuple space (out, rd, in, scan, count)'

    # Maritime actors
    complete -c $prog -n __pd_needs_command -a actor -d 'Show one durable maritime actor'
    complete -c $prog -n __pd_needs_command -a actors -d 'List durable maritime actors'

    # Consolidated read/write (3.8.4)
    complete -c $prog -n __pd_needs_command -a say -d 'Write a finding (note + optional tuple/pheromone/broadcast)'
    complete -c $prog -n __pd_needs_command -a look -d 'Situation report (sitrep default; --heat for file heat map)'
    complete -c $prog -n __pd_needs_command -a sitrep -d 'Alias for look (the maritime canonical name)'
    complete -c $prog -n __pd_needs_command -a advise -d 'Suggest coordination moves before editing'
    complete -c $prog -n __pd_needs_command -a preflight -d 'Alias for advise before risky work'
    complete -c $prog -n __pd_needs_command -a compass -d 'Maritime alias for advise'
    complete -c $prog -n __pd_needs_command -a guard -d 'Enforce Port Daddy session and file-claim discipline'
    complete -c $prog -n __pd_needs_command -a snapshots -d 'List/show/restore/prune claim-watcher snapshots'
    complete -c $prog -n __pd_needs_command -a snapshot -d 'Alias for snapshots'
    complete -c $prog -n __pd_needs_command -a backup -d 'Durable snapshots of port-registry.db (ADR-0037)'
    complete -c $prog -n __pd_needs_command -a restore -d 'Restore a port-registry.db snapshot (ADR-0037)'
    complete -c $prog -n __pd_needs_command -a attest -d 'Honest self-report — loud-fail invariants (ADR-0045)'
    complete -c $prog -n __pd_needs_command -a safe -d 'Host-safety posture audit — scan|baseline|fix (ADR-0088)'
    complete -c $prog -n __pd_needs_command -a shipwright -d 'Survey + propose + apply for fleet authoring'
    complete -c $prog -n __pd_needs_command -a pheromone -d 'Stigmergic coordination (spray, files, show, ls)'
    complete -c $prog -n __pd_needs_command -a ph -d 'Alias for pheromone'

    # FleetControl hardening — wallets + bonds
    complete -c $prog -n __pd_needs_command -a wallet -d 'Manage project USD wallets (show/top-up/history)'
    complete -c $prog -n __pd_needs_command -a bond -d 'Inspect and manually slash agent bond escrows'

    # wallet subcommands + flags
    complete -c $prog -n "__pd_using_command wallet" -x -a 'show' -d 'Show wallet balance + commons pool'
    complete -c $prog -n "__pd_using_command wallet" -x -a 'top-up' -d 'Deposit virtual USD'
    complete -c $prog -n "__pd_using_command wallet" -x -a 'history' -d 'Show wallet.topup and bond.slash activity'
    complete -c $prog -n "__pd_using_command wallet; and __fish_seen_subcommand_from top-up topup" -l usd -x -d 'USD amount to deposit'
    complete -c $prog -n "__pd_using_command wallet; and __fish_seen_subcommand_from top-up topup" -l yes -d 'Skip confirmation prompt'
    complete -c $prog -n "__pd_using_command wallet; and __fish_seen_subcommand_from history" -l since -x -d 'Lookback window (e.g. 7d, 24h, 30m)'
    complete -c $prog -n "__pd_using_command wallet; and __fish_seen_subcommand_from history" -l limit -x -d 'Max entries'
    complete -c $prog -n "__pd_using_command wallet" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command wallet" -s q -l quiet -d 'Suppress output'

    # bond subcommands + flags
    complete -c $prog -n "__pd_using_command bond" -x -a 'list' -d 'List bond escrow rows'
    complete -c $prog -n "__pd_using_command bond" -x -a 'slash' -d 'Manually slash a bond (audited)'
    complete -c $prog -n "__pd_using_command bond; and __fish_seen_subcommand_from list" -l project -x -d 'Filter by project'
    complete -c $prog -n "__pd_using_command bond; and __fish_seen_subcommand_from list" -l state -x -a 'escrowed running exiting refunded slashed' -d 'Filter by state'
    complete -c $prog -n "__pd_using_command bond; and __fish_seen_subcommand_from list" -l limit -x -d 'Max rows'
    complete -c $prog -n "__pd_using_command bond; and __fish_seen_subcommand_from slash" -l portion -x -d 'Portion to slash (0..1)'
    complete -c $prog -n "__pd_using_command bond; and __fish_seen_subcommand_from slash" -l reason -x -d 'Audited reason text (required)'
    complete -c $prog -n "__pd_using_command bond; and __fish_seen_subcommand_from slash" -l yes -d 'Skip confirmation prompt'
    complete -c $prog -n "__pd_using_command bond" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command bond" -s q -l quiet -d 'Suppress output'

    # fleet panic / unpanic
    complete -c $prog -n "__pd_using_command fleet" -x -a 'panic' -d 'SIGTERM every running fleet agent (confirmation required)'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'unpanic' -d 'Disarm a previous panic state'
    complete -c $prog -n "__pd_using_command fleet; and __fish_seen_subcommand_from panic" -l reason -x -d 'Reason for arming panic (required)'
    complete -c $prog -n "__pd_using_command fleet; and __fish_seen_subcommand_from panic" -l yes -d 'Skip interactive YES confirmation'
    complete -c $prog -n "__pd_using_command fleet; and __fish_seen_subcommand_from unpanic" -l reason -x -d 'Reason for disarming panic (required)'

    # fleet conductor control (ADR-0060)
    complete -c $prog -n "__pd_using_command fleet" -x -a 'halt' -d 'Total stop a conductor scope — SIGKILL + refund bonds'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'pause' -d 'Soft stop a conductor scope — stop admitting, leave agents alive'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'resume' -d 'Reopen a halted/paused conductor scope'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'inspect' -d 'Render a conductor lineage tree for a rootId'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'tree' -d 'Render a conductor lineage tree for a rootId'
    complete -c $prog -n "__pd_using_command fleet; and __fish_seen_subcommand_from halt pause resume inspect tree" -l root -x -d 'Target one lineage subtree (rootId)'
    complete -c $prog -n "__pd_using_command fleet; and __fish_seen_subcommand_from halt" -l yes -d 'Skip interactive confirmation'

    # pd say flags
    complete -c $prog -n "__pd_using_command say" -l pin -d 'Also write a tuple to the fleet harbor'
    complete -c $prog -n "__pd_using_command say" -l heat -x -d 'Also spray pheromone on a file (<path>[=0..1])'
    complete -c $prog -n "__pd_using_command say" -l broadcast -x -d 'Also publish to a pub/sub channel'
    complete -c $prog -n "__pd_using_command say" -l kind -x -d 'Tuple kind prefix (default: finding)'
    complete -c $prog -n "__pd_using_command say" -l harbor -x -d 'Tuple harbor (default: fleet)'
    complete -c $prog -n "__pd_using_command say" -l as -x -d 'Agent ID to associate with the write'
    # pd look flags
    complete -c $prog -n "__pd_using_command look" -x -a 'heat hot' -d 'Subcommand'
    complete -c $prog -n "__pd_using_command look" -l since -x -d 'Lookback window in minutes (default: 60)'
    complete -c $prog -n "__pd_using_command look" -l heat -d 'Show file heat map instead of sitrep'
    complete -c $prog -n "__pd_using_command look" -l project -x -d 'Scope salvage queue to a project'
    complete -c $prog -n "__pd_using_command look" -l stack -x -d 'Scope salvage queue to a stack'
    # pd sitrep flags
    complete -c $prog -n "__pd_using_command sitrep" -l since -x -d 'Lookback window in minutes (default: 60)'
    complete -c $prog -n "__pd_using_command sitrep" -l project -x -d 'Scope salvage queue to a project'
    complete -c $prog -n "__pd_using_command sitrep" -l stack -x -d 'Scope salvage queue to a stack'
    # pd advise/preflight/compass flags
    complete -c $prog -n "__pd_using_command advise preflight compass" -l task -x -d 'Intended work description'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l session -x -d 'Explicit session ID'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l sessionId -x -d 'Explicit session ID'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l agent -x -d 'Explicit agent ID'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l agentId -x -d 'Explicit agent ID'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l dir -r -d 'Project root'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l projectRoot -r -d 'Project root'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l channels -d 'Include channel suggestions'
    complete -c $prog -n "__pd_using_command advise preflight compass" -l tuples -d 'Include tuple suggestions'
    # pd guard subcommands and flags
    complete -c $prog -n "__pd_using_command guard" -x -a 'status check enable disable install' -d 'Subcommand'
    complete -c $prog -n "__pd_using_command guard; and __fish_seen_subcommand_from check enable install" -l mode -x -a 'warn enforce off' -d 'Override guard mode'
    complete -c $prog -n "__pd_using_command guard; and __fish_seen_subcommand_from check enable install" -l warn -d 'Warn instead of blocking'
    complete -c $prog -n "__pd_using_command guard; and __fish_seen_subcommand_from check enable install" -l enforce -d 'Block on violations'
    complete -c $prog -n "__pd_using_command guard; and __fish_seen_subcommand_from check" -l off -d 'Disable this check'
    complete -c $prog -n "__pd_using_command guard; and __fish_seen_subcommand_from check" -l staged -d 'Check staged files'
    complete -c $prog -n "__pd_using_command guard; and __fish_seen_subcommand_from check" -l hook -d 'Format output for a git hook'

    # pd actor/actors flags
    complete -c $prog -n "__pd_using_command actor actors" -l project -x -d 'Project filter'
    complete -c $prog -n "__pd_using_command actor actors" -l limit -x -d 'Evidence result limit'
    complete -c $prog -n "__pd_using_command actor" -l message -x -d 'Queue a message to the actor mailbox'
    complete -c $prog -n "__pd_using_command actor" -l from -x -d 'Message sender'
    complete -c $prog -n "__pd_using_command actor" -l type -x -d 'Message type'
    complete -c $prog -n "__pd_using_command actor" -l wake -d 'Try to hail compatibility fleet body'
    # pd pheromone subcommands
    complete -c $prog -n "__pd_using_command pheromone ph" -x -a 'spray file files show ls read list' -d 'Subcommand'
    complete -c $prog -n "__pd_using_command pheromone ph; and __fish_seen_subcommand_from files" -l path -x -d 'Path prefix filter'
    complete -c $prog -n "__pd_using_command pheromone ph; and __fish_seen_subcommand_from files" -l depth -x -d 'Max path depth'
    complete -c $prog -n "__pd_using_command pheromone ph; and __fish_seen_subcommand_from files" -l limit -x -d 'Max rows'

    # System & Monitoring
    complete -c $prog -n __pd_needs_command -a dashboard -d 'Open the terminal UI dashboard'
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
    complete -c $prog -n __pd_needs_command -a benchmark -d 'Multi-backend LLM diversity experiment runner'
    complete -c $prog -n "__pd_using_command benchmark" -x -a 'run' -d 'Run the diversity experiment'
    complete -c $prog -n "__pd_using_command benchmark" -x -a 'list-models' -d 'List available benchmark model ids'
    complete -c $prog -n "__pd_using_command benchmark" -x -a 'list-conditions' -d 'List fleet condition presets'
    complete -c $prog -n "__pd_using_command benchmark" -x -a 'report' -d 'Re-render a saved results JSON'
    complete -c $prog -n __pd_needs_command -a demo -d 'Interactive demos of Port Daddy features'
    complete -c $prog -n "__pd_using_command demo" -x -a 'port-conflict' -d 'Demo port conflict resolution'
    complete -c $prog -n "__pd_using_command demo" -x -a 'coordination' -d 'Demo agent coordination'
    complete -c $prog -n __pd_needs_command -a fleet -d 'Manage background agent fleet'
    complete -c $prog -n __pd_needs_command -a backend -d 'List/use/cost — fleet backend route, framing, and spend'
    complete -c $prog -n __pd_needs_command -a relay -d 'Manage cloud relay URL, status, and OIDC token exchange'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'init' -d 'Create pd-fleet.yml + git hook in current project'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'up' -d 'Start all fleet agents (CLI mode, terminal-attached)'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'down' -d 'Stop all fleet agents'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'status' -d 'Show fleet health'
    complete -c $prog -n "__pd_using_command fleet" -x -a 'run' -d 'Run a specific agent from pd-fleet.yml once'
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
    complete -c $prog -n __pd_needs_command -a install-bosun -d 'Wire only the Bosun watchdog (brew-managed daemon)'
    complete -c $prog -n __pd_needs_command -a uninstall -d 'Uninstall system service'
    complete -c $prog -n __pd_needs_command -a dev -d 'Daemon berths: up/down/list (ADR-0055)'
    complete -c $prog -n __pd_needs_command -a use -d 'Target this shell at a daemon berth (eval "$(pd use dev)")'
    complete -c $prog -n '__pd_is_cmd dev' -a 'up down list' -d 'Berth lifecycle'
    complete -c $prog -n '__pd_is_cmd use' -a 'stable dev dev-latest' -d 'Berth target'
    complete -c $prog -n __pd_needs_command -a daemon -d 'Daemon lifecycle subcommands (status, log, doctor)'
    complete -c $prog -n __pd_needs_command -a ci-gate -d 'Exit non-zero if daemon is stale'
    complete -c $prog -n __pd_needs_command -a self-update -d 'Brew-upgrade + restart daemon and FleetBar onto the current release'
    complete -c $prog -n __pd_needs_command -a upgrade -d 'Check the latest.json feed and report/perform an update (--apply)'
    complete -c $prog -n __pd_needs_command -a mcp -d 'Start MCP server for Claude Code'
    complete -c $prog -n '__fish_seen_subcommand_from upgrade' -l apply -d 'Perform the upgrade via brew'
    complete -c $prog -n '__fish_seen_subcommand_from upgrade' -l json -d 'Emit machine-readable JSON'
    complete -c $prog -n '__fish_seen_subcommand_from upgrade' -l feed -d 'Override the latest.json feed URL'
    complete -c $prog -n '__pd_is_cmd mcp' -a install -d 'Configure MCP for all detected AI editors'
    complete -c $prog -n __pd_needs_command -a setup -d 'Install daemon, MCP, FleetBar, and init a project'
    complete -c $prog -n __pd_needs_command -a init -d 'Set up Port Daddy for this project (scan, fleet, MCP, git hook)'
    complete -c $prog -n __pd_needs_command -a cut -d 'Cut a release — build daemon + Rust + FleetBar, hash, optionally sign'
    complete -c $prog -n __pd_needs_command -a batten -d 'Verify + imprint staged release artifacts against release-artifacts.json'

    # Sugar (compound commands)
    complete -c $prog -n __pd_needs_command -a begin -d 'Begin a work session (register + start)'
    complete -c $prog -n __pd_needs_command -a b -d 'Begin a work session (alias for begin)'
    complete -c $prog -n __pd_needs_command -a done -d 'End a work session (end + unregister)'
    complete -c $prog -n __pd_needs_command -a plan -d 'Manage session todo plans (show/set/check)'
    complete -c $prog -n __pd_needs_command -a whoami -d 'Show current agent/session context'
    complete -c $prog -n __pd_needs_command -a w -d 'Show current context (alias for whoami)'
    complete -c $prog -n __pd_needs_command -a account -d 'Sign in to your Port Daddy cloud account (device flow)'
    complete -c $prog -n __pd_needs_command -a interruptions -d 'List open HITL operator asks (answer/ack is web-only)'
    complete -c $prog -n __pd_needs_command -a attention -d 'Inbox + subscribed channels in one call (run first thing every session)'
    complete -c $prog -n __pd_needs_command -a nudge -d 'Suggestibility nudges — claim-overlap heads-up (list/accept/decline/scan)'
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
    complete -c $prog -n "__pd_using_command env" -x -a 'exec' -d 'Run a command with pd-secret:// refs resolved into its env'
    complete -c $prog -n "__pd_using_command env" -x -a '(__pd_service_ids)'

    # pub / publish / broadcast
    complete -c $prog -n "__pd_using_command pub publish broadcast" -s m -l message -d 'Message payload (JSON or text)' -x
    complete -c $prog -n "__pd_using_command pub publish broadcast" -l sender -d 'Sender agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command pub publish broadcast" -x -a '(__pd_channels)'

    # sub / subscribe / listen
    complete -c $prog -n "__pd_using_command sub subscribe listen" -x -a '(__pd_channels)'

    # tube — conversational pipe (listen/send/reply via stdin)
    complete -c $prog -n "__pd_using_command tube" -l send -d 'Read stdin and post a top-level message'
    complete -c $prog -n "__pd_using_command tube" -l reply -d 'Read stdin and post a reply' -x
    complete -c $prog -n "__pd_using_command tube" -l since -d 'Resume listening from a message id' -x
    complete -c $prog -n "__pd_using_command tube" -l limit -d 'Backfill cap when no cursor exists' -x
    complete -c $prog -n "__pd_using_command tube" -l once -d 'Do one poll-pass and exit'
    complete -c $prog -n "__pd_using_command tube" -l no-history -d 'Ignore the on-disk listen cursor'
    complete -c $prog -n "__pd_using_command tube" -l sender -d 'Sender agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command tube" -x -a '(__pd_channels)'

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
    complete -c $prog -n "__pd_using_command agent" -x -a 'register heartbeat unregister interrupt stream'
    complete -c $prog -n "__pd_using_command agent; and __fish_seen_subcommand_from interrupt stream" -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command agent; and __fish_seen_subcommand_from interrupt" -l reason -d 'Why the agent is being interrupted' -x

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
    complete -c $prog -n "__pd_using_command session" -x -a 'takeover' -d 'Create successor session; preserve notes'
    complete -c $prog -n "__pd_using_command session" -x -a 'rm' -d 'Archive a session; preserve notes'
    complete -c $prog -n "__pd_using_command session" -x -a 'files' -d 'Manage file claims for a session'
    complete -c $prog -n "__pd_using_command session" -x -a 'phase' -d 'Set session phase'
    complete -c $prog -n "__pd_using_command session" -s P -l purpose -d 'Session purpose' -x
    complete -c $prog -n "__pd_using_command session" -s n -l note -d 'Handoff note' -x
    complete -c $prog -n "__pd_using_command session" -s a -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command session" -l lifecycle -d 'Session lifecycle' -x -a 'durable ephemeral'
    complete -c $prog -n "__pd_using_command session" -l no-files -d 'Do not transfer takeover file claims'
    complete -c $prog -n "__pd_using_command session" -l no-claims -d 'Alias for --no-files'

    # takeover alias
    complete -c $prog -n "__pd_using_command takeover" -s P -l purpose -d 'Successor session purpose' -x
    complete -c $prog -n "__pd_using_command takeover" -s n -l note -d 'Takeover reason' -x
    complete -c $prog -n "__pd_using_command takeover" -s a -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command takeover" -l lifecycle -d 'Session lifecycle' -x -a 'durable ephemeral'
    complete -c $prog -n "__pd_using_command takeover" -l no-files -d 'Do not transfer predecessor file claims'
    complete -c $prog -n "__pd_using_command takeover" -l no-claims -d 'Alias for --no-files'

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
    complete -c $prog -n "__pd_using_command done" -l force-incomplete -d 'Force end session with incomplete tasks'
    complete -c $prog -n "__pd_using_command done" -l reason -d 'Reason for force incomplete' -x

    # plan
    complete -c $prog -n "__pd_using_command plan" -a 'show set check' -d 'Action'
    complete -c $prog -n "__pd_using_command plan" -l session -d 'Session ID' -x
    complete -c $prog -n "__pd_using_command plan" -l agent -d 'Agent ID' -x -a '(__pd_agent_ids)'

    # interruptions (HITL open-ask listing; answer/ack is web-only)
    complete -c $prog -n "__pd_using_command interruptions" -l json -d 'JSON output for scripts'
    complete -c $prog -n "__pd_using_command interruptions" -l quiet -d 'Suppress non-essential output'

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
    complete -c $prog -n "__pd_using_command spawn" -l budget -d 'Required spend ceiling in USD' -x
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

    # harbor-ledger  status|project|rebuild  [projection]  [--json]
    complete -c $prog -n "__pd_using_command harbor-ledger" -a 'status project rebuild' -d 'Harbor ledger projection command'
    complete -c $prog -n "__pd_using_command harbor-ledger" -a 'roster transcript-timeline files-touched costs compliance work-receipts' -d 'Projection'
    complete -c $prog -n "__pd_using_command harbor-ledger" -l json -d 'JSON output'

    # tuple
    complete -c $prog -n "__pd_using_command tuple" -x -a 'out rd in scan count'
    complete -c $prog -n "__pd_using_command tuple" -l harbor -d 'Scope to a harbor namespace' -x
    complete -c $prog -n "__pd_using_command tuple" -l ttl -d 'Time-to-live in milliseconds (out only)' -x
    complete -c $prog -n "__pd_using_command tuple" -l as -d 'Agent ID' -x -a '(__pd_agent_ids)'
    complete -c $prog -n "__pd_using_command tuple" -l limit -d 'Max results (rd/in only)' -x
    complete -c $prog -n "__pd_using_command tuple" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command tuple" -s q -l quiet -d 'Suppress output'

    # embed
    complete -c $prog -n "__pd_using_command embed" -x -a 'status prefetch text stdin'
    complete -c $prog -n "__pd_using_command embed" -l cache-dir -r -d 'Override the shared transformers cache'
    complete -c $prog -n "__pd_using_command embed; and __fish_seen_subcommand_from status" -s j -l json -d 'Output JSON'
    complete -c $prog -n "__pd_using_command embed; and __fish_seen_subcommand_from text stdin" -l offline -d 'Exit 3 instead of downloading when model not cached'

    # skill-graft
    complete -c $prog -n "__pd_using_command skill-graft; or __pd_using_command skillgraft" -x -a 'query warm reference'
    complete -c $prog -n "__pd_using_command skill-graft; or __pd_using_command skillgraft" -l root -r -d 'Override the skill root'
    complete -c $prog -n "__pd_using_command skill-graft; or __pd_using_command skillgraft" -s j -l json -d 'Output JSON'
    complete -c $prog -n "__pd_using_command skill-graft; or __pd_using_command skillgraft; and __fish_seen_subcommand_from query" -l shortlist-limit -x -d 'BM25 shortlist size'
    complete -c $prog -n "__pd_using_command skill-graft; or __pd_using_command skillgraft; and __fish_seen_subcommand_from query" -l top-limit -x -d 'Number of skills to return'
    complete -c $prog -n "__pd_using_command skill-graft; or __pd_using_command skillgraft; and __fish_seen_subcommand_from query" -l body-chars -x -d 'Maximum body chars per skill'

    # graph
    complete -c $prog -n "__pd_using_command graph" -x -a 'edges stats help'
    complete -c $prog -n "__pd_using_command graph" -l dir -r -d 'Project directory filter'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l scope -x -d 'Scope filter'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l source-type -x -d 'Source entity type'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l source-id -x -d 'Source entity id'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l edge-type -x -d 'Edge type'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l target-type -x -d 'Target entity type'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l target-id -x -d 'Target entity id'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l query -x -d 'Text search'
    complete -c $prog -n "__pd_using_command graph; and __fish_seen_subcommand_from edges" -l limit -x -d 'Max edges'
    complete -c $prog -n "__pd_using_command graph" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command graph" -s q -l quiet -d 'Suppress output'

    # booty
    complete -c $prog -n "__pd_using_command booty" -a 'add list help'
    complete -c $prog -n "__pd_using_command booty; and __fish_seen_subcommand_from add" -l roadmap -x -d 'Link the artifact to a roadmap item'
    complete -c $prog -n "__pd_using_command booty; and __fish_seen_subcommand_from add" -l note -x -d 'Freeform provenance note'
    complete -c $prog -n "__pd_using_command booty; and __fish_seen_subcommand_from list" -l branch -x -d 'Filter by branch'
    complete -c $prog -n "__pd_using_command booty; and __fish_seen_subcommand_from list" -l session -x -d 'Filter by session'
    complete -c $prog -n "__pd_using_command booty; and __fish_seen_subcommand_from list" -l limit -x -d 'Max rows (default 50)'
    complete -c $prog -n "__pd_using_command booty" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command booty" -s q -l quiet -d 'Suppress output'

    # memory
    complete -c $prog -n "__pd_using_command memory" -x -a 'episodes stats help'
    complete -c $prog -n "__pd_using_command memory" -l dir -r -d 'Project directory filter'
    complete -c $prog -n "__pd_using_command memory" -l project -x -d 'Logical project filter'
    complete -c $prog -n "__pd_using_command memory; and __fish_seen_subcommand_from episodes" -l harbor -x -d 'Harbor filter'
    complete -c $prog -n "__pd_using_command memory; and __fish_seen_subcommand_from episodes" -l agent -x -d 'Agent filter'
    complete -c $prog -n "__pd_using_command memory; and __fish_seen_subcommand_from episodes" -l type -x -d 'Episode type filter'
    complete -c $prog -n "__pd_using_command memory; and __fish_seen_subcommand_from episodes" -l query -x -d 'Text search'
    complete -c $prog -n "__pd_using_command memory; and __fish_seen_subcommand_from episodes" -l limit -x -d 'Max episodes'
    complete -c $prog -n "__pd_using_command memory" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command memory" -s q -l quiet -d 'Suppress output'

    # ideas
    complete -c $prog -n "__pd_using_command ideas" -x -a 'list search show help'
    complete -c $prog -n "__pd_using_command ideas" -l dir -r -d 'Project directory filter'
    complete -c $prog -n "__pd_using_command ideas; and __fish_seen_subcommand_from list search" -l status -x -a 'now backlog parked merge local' -d 'Status filter'
    complete -c $prog -n "__pd_using_command ideas; and __fish_seen_subcommand_from list search" -l limit -x -d 'Max results'
    complete -c $prog -n "__pd_using_command ideas; and __fish_seen_subcommand_from search" -l sources -x -a 'trove raw notes tuples markdown all' -d 'Search sources'
    complete -c $prog -n "__pd_using_command ideas; and __fish_seen_subcommand_from list search show" -l include-raw -d 'Include local .spark/.spider residue'
    complete -c $prog -n "__pd_using_command ideas" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command ideas" -s q -l quiet -d 'Suppress output'

    # secret (alias: secrets) — match both names so `pd secrets ...` completes too.
    complete -c $prog -n "__pd_using_command secret secrets; and not __fish_seen_subcommand_from set list ls reveal show rm remove delete" -a "set list reveal rm" -d 'secret subcommand'
    complete -c $prog -n "__pd_using_command secret secrets; and __fish_seen_subcommand_from set" -l backend -x -a 'claude gemini cloudflare codex ngrok voyage' -d 'Backend label'
    complete -c $prog -n "__pd_using_command secret secrets; and __fish_seen_subcommand_from reveal show" -l copy -d 'Copy to clipboard instead of printing'
    complete -c $prog -n "__pd_using_command secret secrets; and __fish_seen_subcommand_from list ls" -l quiet -d 'Machine-readable KEY<TAB>set/unset output'
    complete -c $prog -n "__pd_using_command secret secrets" -l json -d 'Output JSON'

    # roadmap
    complete -c $prog -n "__pd_using_command roadmap; and not __fish_seen_subcommand_from ack harvest promote upsert add touch render pop release claims delete rm chomp import-markdown" -a "ack harvest promote upsert add touch render pop release claims delete rm chomp import-markdown" -d 'roadmap subcommand'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from chomp" -l dry-run -d 'Explicit preview (the default without --emit-pr-plan)'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from chomp" -l emit-pr-plan -x -d 'Write via the daemon and emit snapshot + receipt + git-rm list + PR body'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from chomp" -l enrich -d 'Polish summaries through the configured LLM backend'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from render" -l write -d 'Write docs/ROADMAP.md to disk'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from render" -l rootDir -x -d 'Project directory whose docs/ROADMAP.md to update'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from render" -l status -x -a 'now backlog parked merge done all' -d 'Status filter'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from render" -l harbor -x -d 'Harbor scope'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from render" -l project -x -d 'Project name (harbor shorthand)'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from promote" -l from-feedback -x -d 'Feedback id to promote'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from promote" -l slug -x -d 'Override roadmap slug'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from promote" -l summary -x -d 'Markdown summary for promoted item'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from promote" -l status -x -a 'now backlog parked merge done' -d 'Roadmap item status'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from promote" -l as -x -d 'Promoter agent id'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from promote" -l harbor -x -d 'Harbor scope override'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from upsert add" -l summary -x -d 'Roadmap summary markdown'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from upsert add" -l status -x -a 'now backlog parked merge done' -d 'Roadmap item status'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from upsert add touch" -l note -x -d 'Roadmap receipt note'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from upsert add touch" -l receipt -x -d 'Roadmap receipt note'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from upsert add touch" -l as -x -d 'Actor id'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from upsert add touch" -l harbor -x -d 'Harbor scope'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from upsert add" -l dependencies -x -d 'Comma-separated dependency slugs'
    complete -c $prog -n "__pd_using_command roadmap" -l dir -r -d 'Project directory'
    complete -c $prog -n "__pd_using_command roadmap" -l root -r -d 'Project root'
    complete -c $prog -n "__pd_using_command roadmap" -l projectDir -r -d 'Project directory'
    complete -c $prog -n "__pd_using_command roadmap" -l limit -x -d 'Rows per section'
    complete -c $prog -n "__pd_using_command roadmap" -l feedback-status -x -a "open harvested wontfix all" -d 'Live tuple feedback status'
    complete -c $prog -n "__pd_using_command roadmap" -l feedback-harbor -x -d 'Harbor scope for live feedback'
    complete -c $prog -n "__pd_using_command roadmap" -l feedback-limit -x -d 'Max live feedback rows'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from ack harvest" -l as -x -d 'Harvester agent id'
    complete -c $prog -n "__pd_using_command roadmap; and __fish_seen_subcommand_from ack harvest" -l into -x -d 'Roadmap slug'
    complete -c $prog -n "__pd_using_command roadmap" -l no-excerpts -d 'Hide current-work and Cartographer excerpts'
    complete -c $prog -n "__pd_using_command roadmap" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command roadmap" -s q -l quiet -d 'Agent-readable section:slug output'

    # parley
    complete -c $prog -n "__pd_using_command parley; and not __fish_seen_subcommand_from call propose critique revise agree refuse say respond resolve list show fit" -a "call propose critique revise agree refuse say respond resolve list show fit" -d 'parley subcommand'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from call" -l surface -x -d 'Contested path, symbol, or surface'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from call" -l with -x -d 'Comma-separated parties'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from call" -l parties -x -d 'Comma-separated parties'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from call" -l reason -x -d 'Why the parley is being summoned'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from call" -l ttl-ms -x -d 'Response TTL in milliseconds'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from call" -l round-limit -x -d 'Non-terminal turns per party before escalation'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from call list" -l harbor -x -d 'Harbor scope'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from respond" -l performative -x -a 'propose critique revise agree refuse inform' -d 'Turn performative'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from respond" -l content -x -d 'Turn content'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from respond" -l proposal -x -d 'Proposal id'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from respond" -l evidence -x -d 'Comma-separated evidence refs'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from resolve" -l status -x -a 'COLLAPSED ESCALATED VOIDED' -d 'Outcome status'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from resolve" -l decision -x -d 'Outcome decision'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from resolve" -l reason -x -d 'Outcome reason'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from resolve" -l dissenters -x -d 'Comma-separated dissenters'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from respond propose critique revise agree refuse say resolve show" -l id -x -d 'Parley id'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from respond propose critique revise agree refuse say resolve show" -l parley -x -d 'Parley id'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from list" -l status -x -a 'SUMMONED CONVENED COLLAPSED ESCALATED VOIDED' -d 'Status filter'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from list" -l limit -x -d 'Max rows'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l shape -x -a 'breadth_first depth_first mixed' -d 'Reasoning shape'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l independence -x -a 'none partial high' -d 'Subtask independence'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l contention -x -a 'none low medium high' -d 'Write contention'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l baseline -x -d 'Single-agent baseline cost'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l value -x -d 'Task value multiplier'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l tokens -x -d 'Estimated token multiplier'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l writers -x -d 'Max concurrent writers'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l verify -d 'Verification is available'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l heterogeneous -d 'Heterogeneous agents are available'
    complete -c $prog -n "__pd_using_command parley; and __fish_seen_subcommand_from fit" -l fits-in-one-context -d 'Task fits one model context'
    complete -c $prog -n "__pd_using_command parley" -l as -x -d 'Actor id'
    complete -c $prog -n "__pd_using_command parley" -s j -l json -d 'JSON output'
    complete -c $prog -n "__pd_using_command parley" -s q -l quiet -d 'Machine-readable output'
end
