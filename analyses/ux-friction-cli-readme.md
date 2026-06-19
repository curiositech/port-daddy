

I'll start by reading all four files thoroughly.
Now let me read the CLI file in chunks since it's large.
I now have a thorough understanding of all four files. Let me read the final section of the CLI to complete the picture.
Now I have a complete picture of all four files. Here is the full friction analysis.

---

# Port Daddy UX Friction Analysis

## PART 1: Human Persona Journey Maps

---

### 1. Technical Interviewer (reviewing code quality and DX)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Opens README.md on GitHub                 "Let me see what this person       Low
        -> Sees cover art, badges, tagline         built."
        -> Immediately sees npm badge, test count

0:15    Reads hero code block                    "Claim, up, pub/sub -- ok, this    Low
        -> claim/up/pub/sub shown in 6 lines      is a coordination daemon."

0:30    Reads "The Problem" section              "Good -- they identified a real     Low
        -> Comparison table vs get-port/etc.       gap and positioned against it."

1:00    Scans Quick Start                        "Two commands. That's clean."       Low
        -> npm install -g, port-daddy start

1:30    Notices codebase architecture             "TypeScript, SQLite, Express,      Low
        -> CLAUDE.md has clean file tree           Unix sockets. Reasonable stack."

2:00    Opens CLI source (port-daddy-cli.ts)     "3200 lines for one CLI file --    Med
        -> 3235 lines, monolithic                  why isn't this broken into
        -> PROBLEM: No command framework           modules? But hand-rolled CLI
          (Commander, yargs, etc.)                 parser is a design choice."

3:00    Reads the option parser                  "Custom arg parser at line 489.    Med
        -> Hand-rolled flag parsing                Levenshtein for 'did you mean'.
        -> editDistance function                   Impressive but fragile."

4:00    Notices error handling                   "ECONNREFUSED triggers auto-       Low
        -> Auto-start daemon on first use          start. Smart DX choice."
        -> Code hash freshness checking

5:00    Reads handleDoctor()                     "10-point diagnostic. Checks       Low
        -> Checks Node, deps, DB, network,         dead PIDs, code hash, system
          system service, stale services            service. Thorough."

6:00    Reads completions                        "Dynamic completions that query    Low
        -> Full zsh/bash/fish support              the live daemon. That's
        -> Dynamic service/lock/agent IDs          actually excellent."

7:00    Looks at test count                      "1169 passing tests? That's       Low
        -> 17 unit suites, integration tests       genuinely impressive for a
        -> PROBLEM: Badge is hardcoded,            personal project."
          not CI-generated

VERDICT: Impressed by depth and polish. Main concern: CLI file is monolithic.
```

---

### 2. Solo Side-Project Dev (wants to stop fighting port conflicts)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Googles "port conflict manager"          "Another tool that claims to       Med
        -> Finds Port Daddy README somehow         solve my problem..."

0:10    Reads tagline                            "Your ports. My rules. Zero        Low
        -> "Zero conflicts" is the promise         conflicts. Ok, what does it do?"

0:20    Reads hero code block                    "claim myapp:frontend?             Med
        -> port-daddy claim myapp:frontend         What's this colon syntax?
        -> port-daddy up                           Why can't I just say 'myapp'?"
        -> PROBLEM: Semantic identity syntax
          introduced before it's explained

0:40    Reads Quick Start                        "npm install -g, start. Fine.      Low
        -> 2 commands to get running               I can do that."

1:00    Tries it                                 "Ok, daemon started. Now what?"    Med
        -> port-daddy start
        -> port-daddy claim myproject
        -> Gets port 3100
        -> PROBLEM: "Why 3100? I wanted 3000."
          Has to discover --port flag

1:30    Reads Examples section                   "PORT=$(port-daddy claim           Med
        -> PORT=$(port-daddy claim x -q)           myproject -q) npm run dev
        -> PROBLEM: Why do I need -q?              -- --port $PORT"
          Why doesn't the default output         "That's 3 flags and a subshell.
          work in a subshell?                      Kind of verbose for 'solve my
                                                   port problem'."

2:00    Reads about pub/sub, locks, agents       "I don't need any of this.         High
        -> 70% of README is agent features         I just want stable ports."
        -> PROBLEM: Feature overload.            "Is this tool for me or for
          Solo dev feels like they've              AI agents?"
          wandered into enterprise territory

3:00    Considers alternatives                   "Maybe I'll just hardcode ports    High
        -> package.json scripts with ports         in my scripts..."
        -> PROBLEM: README doesn't have a
          "Just Fix My Ports" minimal path

VERDICT: Finds the tool, gets intimidated by agent-coordination scope.
         Would benefit from a "Solo Dev Quick Start" that ignores 80% of features.
```

---

### 3. Claude Code Power User (uses AI agents daily)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Sees Port Daddy in a CLAUDE.md           "Port Daddy -- the thing from      Low
        -> Reads: PORT=$(port-daddy claim           my global instructions."
          <project> -q)

0:10    Runs: port-daddy claim myapp -q          "Got port 3247. Clean."            Low
        -> Gets a number on stdout
        -> No daemon? Auto-starts.

0:20    Reads about agent skill                  "Oh, it has a Claude Code          Low
        -> /plugin install port-daddy               plugin. Let me install it."
        -> PROBLEM: Plugin marketplace
          URL/instructions may be stale

0:40    Explores pub/sub for multi-agent         "I can have my agents signal       Low
        -> port-daddy pub build:done '{}'           each other? This is exactly
        -> port-daddy sub build:*                   what I need."

1:00    Tries distributed locks                  "port-daddy lock db-migrations     Low
        -> port-daddy lock db-migrations             && npx prisma migrate"
        -> Uses in CLAUDE.md for agents          "Perfect for worktrees."

1:30    Wants to use SDK from agent code         "import { PortDaddy } from         Low
        -> Reads SDK section                        'port-daddy/client'"
        -> pd.claim(), pd.lock(), pd.publish()   "Clean API."

2:00    Wants --json for machine parsing         "Every command supports -j.        Low
        -> port-daddy find -j                       That's good design."
        -> port-daddy locks -j

2:30    Notices daemon freshness checking        "It auto-restarts if the code      Low
        -> Daemon auto-restarts on stale code       changed? That's slick."

3:00    Tries port-daddy up for full stack       "Scan found 4 services,            Low
        -> Auto-scans, generates .portdaddyrc       started them in dependency
        -> Topological sort, health checks          order. This is docker-compose
                                                    but lighter."

VERDICT: This is the target user and it shows. Near-zero friction.
         Everything is designed for this persona.
```

---

### 4. Developer Friend/Peer (evaluating if it's impressive)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Opens GitHub repo                        "Erich sent me this. Let me        Low
        -> Sees cover art, 1169 tests badge         take a look."

0:15    Reads tagline and hero code              "Port management + agent           Low
        -> Claim, up, pub/sub                       coordination. Interesting
                                                    scope."

0:30    Reads comparison table                   "Ok, this fills a real gap.        Low
        -> get-port vs portfinder vs Port Daddy     None of those others do
        -> PROBLEM: No user count / adoption        persistence or coordination."
          metric to validate "is this real?"

1:00    Scans architecture section               "SQLite backend, Express           Low
        -> ASCII art diagram                        daemon, Unix sockets.
        -> SQLite backing                           Clean architecture."

1:30    Reads CLI source                         "3200-line CLI with hand-rolled    Med
        -> No framework for CLI parsing             arg parser. Impressive depth
        -> 40+ commands                             but... why no Commander.js?"

2:00    Checks test count                        "1042+ unit tests, 17 suites.      Low
        -> Reads CLAUDE.md testing section          That's genuinely thorough."

2:30    Reads SDK section                        "Built-in client SDK, webhooks,    Low
        -> Webhooks with HMAC signing               HMAC signing, SSE
        -> SSE subscriptions                        subscriptions. This is
        -> Agent lifecycle                          production-quality infra."

3:00    Looks at agent skill                     "Works with 40+ AI agents.         Low
        -> Vercel Agent Skill format                Smart positioning for the
        -> Claude Code plugin                       current market."

3:30    PROBLEM: No demo video, no GIF           "I can see the code is solid      Med
        -> No animated terminal recording            but I can't SEE it working.
        -> Only static code blocks                  A 30-second asciinema would
                                                    close the deal."

VERDICT: Impressed by scope and quality. Wishes they could see it in action.
```

---

### 5. Hiring Manager (non-technical, skimming README)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Opens GitHub link from resume             "Let me see what Erich built."    Low
        -> Sees professional cover art
        -> Sees badges: npm, tests, platform

0:10    Reads tagline                             "Your ports. My rules. Zero       Low
        -> "Semantic Port Management for              conflicts."
          Multi-Agent Development"                "I don't know what that means
                                                    but it sounds technical."

0:20    Sees comparison table                     "Ok, there are existing tools      Low
        -> get-port, portfinder, kill-port           and this one does more.
        -> PROBLEM: No "business impact"            Competitive analysis."
          framing. What problem does this
          solve in dollar terms?

0:40    Scans Quick Start                         "2 commands to start. 60           Low
        -> npm install, port-daddy start              seconds to try it."
        -> "Try it in 60 seconds"

1:00    Scrolls through feature sections          "There's a LOT here.              Med
        -> Pub/sub, locks, agents, webhooks         Dashboard, SDK, webhooks,
        -> PROBLEM: No "What I Learned"             agents... this is substantial."
          or "Architecture Decisions" section
          that shows thinking process

1:30    Sees test badge                           "1169 passing tests? On a         Low
        -> 1169 tests                                personal project? That shows
                                                     discipline."

2:00    Looks for contributors                    "Solo project? That makes the     Low
        -> Single author                             test count more impressive."

VERDICT: Gets the "this person builds real things" signal.
         Misses the "why should I care as a non-technical person" framing.
```

---

### 6. CS Student (trying to learn from the codebase)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Clones repo for a systems course         "I need to study a daemon +        Low
        -> git clone, npm install                    CLI architecture."

0:15    Opens CLAUDE.md                          "Oh, there's developer docs.       Low
        -> File tree with descriptions              This tells me what each file
        -> Dev commands                             does."

0:30    Opens port-daddy-cli.ts                  "3235 lines in one file?!          High
        -> 3235 lines, no imports of               Where do I start?"
          command modules                        "PROBLEM: No modular structure
        -> Everything in one file                   to navigate. Every command
                                                    handler is in this file."

1:00    Tries to understand arg parsing          "Oh, they wrote their own          Med
        -> Lines 489-542                            parser. Interesting but I
        -> Custom short flag handling               can't reuse this pattern
        -> PROBLEM: No comments explaining          easily."
          WHY it's hand-rolled

1:30    Reads handleClaim                        "This calls pdFetch which          Med
        -> Lines 800-858                            wraps http.request... the
        -> pdFetch is a custom fetch                Unix socket fallback is
        -> PROBLEM: pdFetch signature               clever but I have to read
          is complex, no JSDoc                      100 lines to understand it."

2:00    Reads handleUp (orchestration)           "topologicalSort, then             Med
        -> Lines 1358-1586                          createOrchestrator, then
        -> 230 lines for one command                events... this is complex
        -> PROBLEM: Event-driven flow              but well-structured."
          is hard to follow linearly

3:00    Opens tests                              "Tests are in separate files.       Low
        -> tests/unit/ has 17 suites                The test names tell me what
        -> PROBLEM: No tests for CLI                the code does."
          itself (only integration tests)

4:00    Reads zsh completions                    "This is useful -- I can see       Low
        -> All commands enumerated                  every command and its
        -> Dynamic daemon queries                   options in one place."

VERDICT: Learns a lot but fights the monolithic CLI file.
         Would benefit from extracted command modules.
```

---

### 7. Freelancer (running multiple client projects)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Google: "manage ports multiple projects"  "I have 4 client projects          Med
        -> Finds Port Daddy somehow                  all fighting over 3000."

0:15    Reads hero example                        "claim myapp:frontend gets         Low
        -> port-daddy claim myapp:frontend           port 3100 every time?
        -> "same port, every time"                   That's what I need."

0:30    Reads about .portdaddyrc                  "I can configure all my            Low
        -> Per-project config                         projects separately?"

0:45    Tries scan                                "port-daddy scan found my          Low
        -> port-daddy scan                            Next.js frontend and
        -> Auto-detects Next.js, Express              Express API."

1:00    Tries port-daddy up                       "Started both services with        Low
        -> Starts frontend + API                      one command. Nice."
        -> Color-coded logs

1:30    Switches to client project B              "Wait, do I need separate          Med
        -> port-daddy scan in new project             daemon instances per
        -> PROBLEM: Not obvious that one              project?"
          daemon serves all projects              "PROBLEM: README doesn't
                                                    explicitly say 'one daemon,
                                                    many projects'"

2:00    Checks if ports overlap                   "Project A has 3100-3103,          Low
        -> port-daddy find                            Project B got 3104-3106.
        -> All ports are unique                       No conflicts. Perfect."

2:30    Wants to see all projects                 "port-daddy projects shows         Low
        -> port-daddy projects                        all 4 clients. Dashboard
        -> Opens dashboard                            shows them visually."

3:00    Tries port-daddy install                  "Auto-starts on login.             Low
        -> LaunchAgent installed                      I never have to think
                                                      about this again."

VERDICT: Good fit once they find it. Slight confusion about daemon scope.
```

---

## PART 2: Agentic Persona Journey Maps

---

### 8. Single Claude Code Session (needs zero-friction claim/release)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Reads CLAUDE.md instruction:              [Agent parses instruction]         Low
        PORT=$(port-daddy claim <project> -q)

0:01    Runs: port-daddy claim myapp -q           Daemon not running.               Low
        -> ECONNREFUSED                           Auto-start kicks in.
        -> Auto-start daemon                      Retries command.
        -> Returns: 3100                          Gets port.

0:02    Uses PORT in npm run dev --port $PORT     [Agent spawns dev server]          Low

0:10    Needs to release on session end           [Agent may forget]                 Med
        -> PROBLEM: No automatic cleanup          Ports leak if agent crashes.
          on process exit. Agent must              PROBLEM: No --auto-release
          explicitly call release.                 or process-linked cleanup.
        -> Partial fix: PID-based stale
          detection exists but relies on
          daemon polling interval

VERDICT: Near-zero friction for claim. Slight leakage risk on abnormal exit.
```

---

### 9. Parallel Agent Swarm (burst of claims, locks, messaging)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    5 agents start simultaneously             [All agents claim ports]           Low
        -> port-daddy claim proj:svc1..5 -q
        -> SQLite serializes claims

0:01    All 5 get unique ports                    [Atomic. No conflicts.]            Low
        -> 3100, 3101, 3102, 3103, 3104

0:02    Agent A locks db-migrations               [Lock acquired]                   Low
        -> port-daddy lock db-migrations

0:02    Agent B tries same lock                    [Lock rejected]                   Low
        -> port-daddy lock db-migrations
        -> Exit code 1, "lock is held"
        -> PROBLEM: No --wait flag to
          block until lock is available.
          Agent must poll manually.
          README shows --wait but CLI
          help doesn't document it clearly.

0:05    Agent A publishes build complete           [Message delivered]               Low
        -> port-daddy pub build:api '{...}'

0:05    Agent C subscribes to build:*              [SSE stream connects]             Low
        -> port-daddy sub build:*
        -> Gets message

0:10    Rate limiting concern                      [100 req/min per IP]              Med
        -> 5 agents * 20 ops each = 100 ops
        -> PROBLEM: Rate limit of 100/min
          is tight for a swarm scenario.
          All agents share localhost IP.

0:15    Cleanup after swarm                        [Manual release needed]           Med
        -> Each agent must release its ports
        -> PROBLEM: If any agent crashes,
          ports are orphaned until
          stale threshold (2+ min)

VERDICT: SQLite atomicity handles the hard part. Rate limiting and lock
         waiting are the main friction points for swarms.
```

---

### 10. CI/CD Pipeline Agent (ephemeral, non-interactive)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    CI job starts                             [Pipeline initializes]             Med
        -> npm install -g port-daddy
        -> port-daddy start
        -> PROBLEM: Global install in CI is
          slow. No npx one-liner exists.
          "npx port-daddy claim" doesn't
          work because it's a daemon.

0:15    CI needs unique port for test suite        [Claim port]                      Low
        -> port-daddy claim ci-test-$RUN_ID -q
        -> Gets port

0:16    Run tests on that port                     [Tests run]                       Low

0:20    CI job ends                                [Port leaked]                     Med
        -> PROBLEM: Ephemeral CI container
          exits. Port stays claimed in
          daemon (if daemon is persistent).
        -> --expires flag helps but CI
          must remember to use it.

0:00    Alternative: ci-gate check                 [Hash check]                      Low
        -> port-daddy ci-gate
        -> Verifies daemon freshness

VERDICT: Viable but awkward. The daemon model doesn't map naturally to
         ephemeral CI. Would benefit from a stateless/in-process mode.
```

---

### 11. MCP Tool Server (wrapping API as MCP tools)

```
TIME    ACTION                                   COGNITIVE STATE                    FRICTION
-----------------------------------------------------------------------------------------------
0:00    Developer wraps Port Daddy as MCP          [Reading API docs]                Low
        -> HTTP API is clean REST
        -> /claim, /release, /locks, /msg

0:10    Maps to MCP tools                          [Tool definitions]                Low
        -> claim_port(id, port?)
        -> release_port(id)
        -> acquire_lock(name, ttl?)
        -> publish_message(channel, payload)

0:20    Implements health check                    [/health endpoint]                Low
        -> GET /health returns JSON

0:30    PROBLEM: No OpenAPI spec                   [Must reverse-engineer API]       Med
        -> No swagger.json or openapi.yaml
        -> Must read README tables manually
        -> Request/response schemas not
          formally documented

0:45    PROBLEM: SSE subscriptions                 [SSE is hard in MCP]              High
        -> /subscribe/:channel uses SSE
        -> MCP doesn't natively support
          long-lived SSE connections
        -> Must poll /msg/:channel instead

1:00    PROBLEM: Authentication                    [None exists]                     Med
        -> No API keys, no auth headers
        -> Fine for localhost but MCP
          servers might be remote
        -> PROBLEM: No way to restrict
          access if daemon is exposed

VERDICT: HTTP API is clean enough for wrapping. Missing OpenAPI spec and
         SSE-to-polling bridge are the main friction points.
```

---

## PART 3: Friction Matrix

| # | Friction Point | Users Affected | Severity (1-10) | Fix Difficulty | Priority Score |
|---|---------------|----------------|-----------------|----------------|---------------|
| 1 | No demo GIF/video showing the tool in action | 80% (all skimmers) | 6 | Easy | **48** |
| 2 | README front-loads agent features; solo devs feel overwhelmed | 40% (solo/freelancer) | 7 | Easy | **28** |
| 3 | Semantic identity syntax (colon notation) introduced before explained | 50% (newcomers) | 5 | Easy | **25** |
| 4 | CLI is one 3235-line monolithic file | 30% (code reviewers, students) | 5 | Hard | **15** |
| 5 | No OpenAPI/Swagger spec for HTTP API | 20% (MCP, integrators) | 6 | Med | **12** |
| 6 | Rate limit (100/min per IP) too tight for agent swarms | 15% (swarm agents) | 7 | Easy | **10.5** |
| 7 | No `--wait` flag for locks (must poll) | 25% (agents, CI) | 6 | Med | **15** |
| 8 | No auto-release on process exit (port leakage) | 30% (all agents) | 5 | Med | **15** |
| 9 | `npx port-daddy` doesn't work (daemon model) | 20% (CI, quick-try users) | 5 | Hard | **10** |
| 10 | Shell completions require manual copy to fpath | 40% (CLI users) | 3 | Easy | **12** |
| 11 | Test badge is hardcoded, not CI-generated | 15% (interviewers) | 2 | Easy | **3** |
| 12 | No "what I learned" / architecture decisions section | 15% (hiring, students) | 4 | Easy | **6** |
| 13 | `port-daddy claim myapp` defaults to 3100, not 3000 -- no explanation | 30% (newcomers) | 4 | Easy | **12** |
| 14 | `--export` mode requires `eval $(...)` which is unfamiliar to many | 20% (shell users) | 3 | Easy | **6** |
| 15 | SSE subscriptions can't be wrapped in MCP | 10% (MCP integrators) | 7 | Hard | **7** |
| 16 | README doesn't say "one daemon, many projects" explicitly | 30% (freelancers, new users) | 4 | Easy | **12** |
| 17 | `port-daddy up` auto-scans silently if no config, which can surprise | 20% (careful users) | 3 | Easy | **6** |
| 18 | No `--no-daemon` or in-process mode for CI | 15% (CI pipelines) | 6 | Hard | **9** |
| 19 | Help text is 137 lines -- hard to scan at a glance | 30% (CLI users) | 4 | Med | **12** |
| 20 | No `man` page | 10% (Unix purists) | 2 | Med | **2** |

Priority Score = Users Affected % * Severity / 10, then sorted by impact.

---

## PART 4: CLI-Specific Issues

### Error Messages

**Good:**
- `Lock 'foo' is held by agent-42` with remaining TTL -- very actionable.
- `Did you mean: port-daddy claim?` -- Levenshtein suggestion is a nice touch.
- `Auto-detected identity: myapp` -- informs user of implicit behavior.

**Problems:**
- `Failed to claim port` -- when the daemon returns a non-ok response without error details, this is the fallback. Unhelpful.
- `Error: Request timed out` -- no hint about what to do. Should say "Daemon may be overloaded. Try: port-daddy status".
- Silent failure on port collision within range -- if you request `--port 3000` and it's taken, the behavior is unclear from error output.

### Missing Flags

- `lock --wait [timeout]` -- blocks until lock is available. README shows `--wait` in an example (line 1159) but the CLI doesn't document or implement it as a first-class flag.
- `claim --auto-release` -- release when the calling process exits (trap SIGINT/SIGTERM).
- `find --format` -- custom output format (e.g., `{id}:{port}` for scripting).
- `--verbose` / `-v` -- no debug/trace mode for diagnosing connection issues.
- `up --detach` / `-d` -- run services in background (like `docker-compose up -d`).

### Confusing Output

- `port-daddy claim myapp` in a TTY prints the port to both stderr (as `myapp -> port 3100`) AND stdout (as `3100`). This is intentional for subshell capture but confusing when running interactively -- the user sees the port number printed twice in different formats.
- `port-daddy find` with no services prints to stderr but returns exit code 0. Should probably exit 0 (it successfully found nothing) but the UX feels like an error.
- `port-daddy version` tries to contact the daemon first. If the daemon is down, it still prints the version but appends "(server not running)" which is noise when you just wanted the version number.

### Discoverability

- The `--export` flag is powerful (`eval $(port-daddy claim myapp --export)`) but buried in the options list. Should be featured more prominently.
- `port-daddy ps` is an alias for `find` but `ps` traditionally shows processes, not services. Mental model mismatch.
- The `pd` alias from zsh completions (`#compdef port-daddy pd`) is never mentioned in README or help text.
- `port-daddy diagnose` works as an alias for `doctor` but is undocumented.
- `port-daddy dev` (file-watch mode) is a developer-of-port-daddy feature but appears in the help text next to user-facing commands.

---

## PART 5: README-Specific Issues

### Information Architecture

**Current structure:**
1. Hero + badges
2. Tagline + hero code
3. The Problem + comparison table
4. Quick Start
5. Service Orchestration
6. Semantic Identities
7. Agent Coordination (pub/sub, locks)
8. Agent Registry
9. JavaScript SDK (very long)
10. Webhooks
11. Activity Log
12. Dashboard
13. AI Agent Skill
14. CLI Reference
15. API Reference
16. Architecture
17. Configuration
18. Examples

**Problems:**
- The SDK section (lines 336-539) is 200+ lines of API docs inline in the README. This should be a separate doc or a generated reference.
- "Semantic Identities" is section 6 but the syntax is used in section 4 (Quick Start). Explain it earlier.
- "Agent Coordination" starts at line 250. A solo dev has already scrolled past 250 lines of content they don't need.
- No "FAQ" or "Troubleshooting" section.
- No "Contributing" section.

### Time-to-Value by Persona

| Persona | Time to First Success | Acceptable? |
|---------|----------------------|-------------|
| Power User (knows the tool) | 5 seconds | Yes |
| Developer with README open | 60 seconds | Yes |
| Solo dev finding it fresh | 3-5 minutes | Borderline |
| Non-technical reviewer | 30 seconds (can't try it) | N/A |
| CS Student | 10+ minutes (code structure) | No |
| CI Pipeline | 2+ minutes (daemon setup) | No |

### Missing Sections

1. **"When NOT to use Port Daddy"** -- helps users self-select. Example: "If you're running one dev server, you don't need this."
2. **Troubleshooting / FAQ** -- "Daemon won't start", "Port 9876 is taken", "Services show as stale"
3. **Architecture Decisions** -- WHY SQLite? WHY a daemon instead of a library? WHY semantic identities instead of just names?
4. **Changelog / What's New** -- no version history visible
5. **Performance / Benchmarks** -- how fast is a claim? How many concurrent agents?
6. **Contributing** -- no guide for external contributors

### Persona Blind Spots

The README is written for one persona: **the Claude Code power user who runs multi-agent development**. It works brilliantly for that person. But it fails to:

- Give the solo dev a fast path that ignores 80% of features
- Give the hiring manager a "what this demonstrates" section
- Give the student an architecture walkthrough
- Give the CI pipeline a stateless alternative
- Give the MCP integrator a machine-readable API spec

---

## PART 6: Onboarding Gap Analysis

### Shortest Path: "Never heard of it" to "Using it successfully"

| Persona | Ideal Path | Current Path | Gap |
|---------|-----------|-------------|-----|
| **Solo Dev** | `npm i -g port-daddy && port-daddy start && port-daddy claim myapp` (3 commands, done) | Same, but confused by colon syntax and where 3100 came from | Needs: "Your first port always starts at 3100. Use `--port 3000` to request a specific one." |
| **Claude Code User** | Install plugin, agent uses `port-daddy claim` automatically | Must know about plugin, read CLAUDE.md for `PORT=$(port-daddy claim x -q)` pattern | Needs: Plugin auto-adds the CLAUDE.md snippet on install |
| **Agent Swarm** | Each agent: `port-daddy claim proj:svc -q` | Same, works well | Gap: Lock waiting, rate limiting |
| **CI Pipeline** | `npx port-daddy claim ci-run-$ID -q --expires 30m` | Must `npm i -g`, start daemon, then claim | Needs: Ephemeral/stateless mode or Docker image |
| **CS Student** | Clone, read CLAUDE.md, open a module, understand flow | Clone, read CLAUDE.md, open 3235-line CLI file, get lost | Needs: CLI split into modules or architectural README |
| **Freelancer** | Install once, `port-daddy scan` in each project, `port-daddy up` daily | Same, but unclear that one daemon handles everything | Needs: Explicit "one daemon, many projects" in Quick Start |
| **MCP Integrator** | Download openapi.yaml, generate client | Must read README tables manually | Needs: OpenAPI spec |

---

## PART 7: Quick Wins (Highest Impact, Lowest Effort)

### 1. Add a terminal recording / demo GIF to README (Impact: High, Effort: 30 min)
Record an asciinema of: install, claim, scan, up, dashboard. Embed after the hero tagline. This alone closes the "show don't tell" gap for 80% of visitors.

### 2. Add a "Just Want Stable Ports?" callout box near the top (Impact: High, Effort: 15 min)
```markdown
> **Just want stable ports?** Skip the agent features.
> `port-daddy claim myapp` gives you port 3100 every time.
> `PORT=$(port-daddy claim myapp -q) npm run dev -- --port $PORT`
> That's it. The rest is optional.
```

### 3. Explain the colon syntax inline in Quick Start (Impact: Med, Effort: 10 min)
Add one line after the first `claim` example:
```markdown
# The colon separates project:component -- "myapp:api" means "the API for myapp"
# You can also just use "myapp" if you only have one service.
```

### 4. Explicitly state "one daemon, many projects" (Impact: Med, Effort: 5 min)
In Quick Start, after `port-daddy start`:
```markdown
The daemon runs once and manages ports for ALL your projects. You never need to start it again.
```

### 5. Move SDK API docs to a separate file (Impact: Med, Effort: 30 min)
The SDK section is 200+ lines of reference docs. Move to `docs/sdk.md` and link from README:
```markdown
See [SDK Reference](docs/sdk.md) for the full API.
```
This cuts the README by ~15% and makes it scannable.

### 6. Add `lock --wait` flag (Impact: Med for agents, Effort: 2 hours)
Poll the daemon for lock availability with exponential backoff, honoring `--timeout`. This removes a real friction point for multi-agent coordination.

### 7. Add `claim --expires` default for agent use (Impact: Med, Effort: 30 min)
Document a pattern: `port-daddy claim myapp -q --expires 2h`. Consider making `--expires 2h` the default when `PORT_DADDY_AGENT` is set, so agent-claimed ports auto-release.

### 8. Increase rate limit or make it configurable (Impact: Med for swarms, Effort: 30 min)
100/min per IP is tight when 5 agents share localhost. Either increase the default to 500/min or add a `PORT_DADDY_RATE_LIMIT` env var.

### 9. Mention `pd` alias in README (Impact: Low, Effort: 5 min)
The zsh completions register `pd` as an alias. Document this:
```markdown
**Tip:** If you install shell completions, `pd` works as a shorthand for `port-daddy`.
```

### 10. Explain why port 3100 (not 3000) (Impact: Low, Effort: 5 min)
In Quick Start or Configuration, add:
```markdown
Port Daddy assigns from range 3100-9999 by default to avoid conflicting with
standard framework defaults (3000, 5173, 8080, etc.).
```

---

## Summary Assessment

Port Daddy is a well-engineered tool that solves a genuine problem. The codebase has impressive depth: 1169 tests, 10-point doctor checks, dynamic shell completions, Unix socket transport, auto-daemon-restart on code hash mismatch, Levenshtein command suggestions, and a topological-sort orchestrator. The SDK is clean and the HTTP API is well-designed.

The core friction is **audience mismatch in the README**. The tool is positioned as the "coordination layer for multi-agent development" but also wants to serve solo devs who just hate port 3000 conflicts. These are different audiences with different attention spans and different tolerance for complexity. The README currently serves the power user well and everybody else poorly.

The CLI itself is solid but would benefit from modularization (the 3235-line monolith is a code review concern, not a usability one) and a few missing flags (`--wait` for locks, `--auto-release` for claims) that would smooth the agent experience.

The highest-leverage fix is non-code: add a demo GIF and a "just want stable ports?" callout. Those two changes, totaling about 45 minutes of work, would halve the bounce rate for new visitors.
