export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  date: string;
  author: string;
  excerpt: string;
  content: string;
  tags: string[];
}

export const blogPosts: BlogPost[] = [
  {
    id: 'zero-to-multi-agent',
    slug: 'zero-to-multi-agent-in-5-minutes',
    title: 'Zero to Multi-Agent in 5 Minutes',
    date: '2026-04-07',
    author: 'Port Daddy Engineering',
    excerpt: 'Two commands. That is the entire coordination protocol. pd begin, pd done, and everything between is tracked, recoverable, and queryable.',
    tags: ['Getting Started', 'CLI', 'Multi-Agent', 'Quickstart'],
    content: `
# Zero to Multi-Agent in 5 Minutes

Multi-agent coordination sounds like a PhD thesis topic. It isn't. It's two commands.

I used to start every AI agent session the same way: spawn agent, hope it doesn't collide with the other three agents I have running, manually track what it's doing in a markdown file I'll forget about in 20 minutes. When it crashed, I'd start over from scratch because I had no idea what it had finished. The notes file? Gone with the terminal tab.

Port Daddy fixes all of that with two commands and zero configuration. Let me show you.

## The 2-Command Workflow

\`\`\`bash
brew install port-daddy
pd begin --identity myapp:api --purpose "Add user CRUD endpoints"
\`\`\`

That single \`pd begin\` just did six things atomically:

1. **Registered your agent** with the daemon (heartbeat tracking starts)
2. **Started a session** with your purpose attached
3. **Wrote a context file** to \`.portdaddy/current.json\` so any script can discover you
4. **Checked the salvage queue** for dead agents in \`myapp:*\` (more on this in a future post)
5. **Claimed a port** for \`myapp:api\` — deterministic, collision-free
6. **Logged the activity** to the immutable audit trail

When you're done:

\`\`\`bash
pd done
\`\`\`

That's it. Session closed, agent unregistered, activity logged. Everything you did between \`begin\` and \`done\` — every note, every file claim, every heartbeat — is preserved in SQLite and queryable forever.

## What pd whoami Gives You

Here's where it gets useful. Any script, hook, pre-commit check, or spawned sub-agent can ask the daemon a simple question: *who am I?*

\`\`\`bash
pd whoami
\`\`\`

Returns your full context:

\`\`\`json
{
  "agent": "claude-a1b2c3",
  "identity": "myapp:api:main",
  "session": "sess-7f3a...",
  "purpose": "Add user CRUD endpoints",
  "files": ["src/routes/users.ts", "src/models/user.ts"],
  "uptime": "12m 34s"
}
\`\`\`

This means your CI scripts can adapt to who's running them. Your pre-commit hook can check if the agent has claimed the files it's modifying. Your test runner can report results back to the right session. Identity is no longer a mystery — it's a first-class API.

## Shell Integration

The real power move is making coordination invisible. Add this to your \`.zshrc\`:

\`\`\`bash
alias codestart='pd begin --identity $(basename $PWD):dev --purpose'
alias codestop='pd done'
\`\`\`

Now starting a coordinated session is:

\`\`\`bash
codestart "Refactoring the auth module"
# ... work ...
codestop
\`\`\`

For AI agents, you can wire it into the spawn command directly:

\`\`\`bash
pd spawn --backend claude-cli \\
  --identity myapp:api \\
  --purpose "Add user CRUD endpoints" \\
  -- "Build the user model and REST routes"
\`\`\`

The spawned agent gets a \`pd begin\` automatically. It starts with identity, purpose, and a heartbeat. If it dies, the daemon knows.

## What You Get for Free

Here's what's running in the background without you lifting a finger:

- **Heartbeats every 5 minutes** — The daemon knows your agent is alive. If it stops beating, the reaper notices.
- **Salvage eligibility** — If your agent crashes, its session notes and file claims survive in the salvage queue. The next agent can pick up where you left off.
- **Session notes** — Drop breadcrumbs as you work: \`pd note "Users table migrated, starting routes"\`. Immutable. Append-only. Your future self will thank you.
- **File claims** — Announce what files you're touching: \`pd session files claim $SESSION src/auth.ts\`. Advisory, not enforced — but invaluable when four agents are editing the same repo.
- **Activity logging** — Every claim, release, note, and session event is logged with timestamps. Full audit trail, no configuration required.

None of these are mandatory. \`pd begin\` and \`pd done\` work perfectly without notes or file claims. But when you need to debug why Agent C overwrote Agent A's work at 3 AM, you'll be glad the data is there.

The whole philosophy is opt-in depth. Two commands to start. Add notes when you want. Claim files when you need to. The daemon is always watching, always logging, never in your way.

\`\`\`bash
# The minimum viable workflow
pd begin --identity myapp:dev --purpose "Ship the feature"
pd note "Started. Database schema looks clean."
# ... 45 minutes of work ...
pd note "Done. Added 3 routes, 2 models, 14 tests."
pd done
\`\`\`

Five minutes to install, five seconds to start a session, and zero seconds wasted on coordination overhead. That's the pitch.

---

### Next Up

Port collisions. You know the one — Next.js on 3000, FastAPI on 3000, 90 minutes debugging CORS errors that don't exist. [Read about it here](/blog/the-port-collision-that-ate-my-saturday).
    `
  },
  {
    id: 'port-collision-saturday',
    slug: 'the-port-collision-that-ate-my-saturday',
    title: 'The Port Collision That Ate My Saturday',
    date: '2026-04-14',
    author: 'Port Daddy Engineering',
    excerpt: 'Next.js on 3000, FastAPI on 3000, a second AI agent on 3000. Ninety minutes debugging phantom CORS errors before realizing the port was just taken.',
    tags: ['Ports', 'DevEx', 'Getting Started', 'Orchestration'],
    content: `
# The Port Collision That Ate My Saturday

Let me paint you a picture. It's Saturday afternoon. You've got a Next.js frontend, a FastAPI backend, Postgres running locally, and you just spun up a second AI agent to handle the test suite. Everything was working 10 minutes ago. Now your frontend is throwing CORS errors, your API returns HTML instead of JSON, and \`curl localhost:3000/api/users\` gives you the Next.js 404 page.

Ninety minutes later, you discover that FastAPI silently fell back to port 3000 when its preferred port was taken. Your frontend was talking to... itself. Through the backend URL.

I've lost entire afternoons to this. You probably have too.

## The Anatomy of a Port Collision

Port collisions are insidious because they don't throw errors. The second process just picks a different port, or worse, the first process dies silently and the second takes its place. Your service discovery breaks, your environment variables are wrong, and every debugging tool tells you "everything is fine."

The standard fixes are all terrible:

- **Hardcoded ports** — Works until your coworker (or your second agent) uses the same ones
- **Random ports** — Works until anything needs to discover a service
- **.env files** — Works until two agents read different .env states
- **\`lsof -i :3000 | kill\`** — The "turn it off and on again" of port management

What you actually want is deterministic, collision-free port assignment that survives restarts and works across multiple agents. That's what \`pd claim\` does.

## Atomic Port Claims in 30 Seconds

\`\`\`bash
PORT=$(pd claim myapp:api -q)
echo $PORT  # 3146 — deterministic, always the same for this identity
\`\`\`

That's the whole API. Give it a semantic identity, get back a port. Same identity always maps to the same port — deterministic hashing. If you crash and restart, you get the same port. If another agent tries to claim the same identity, they get the same port (idempotent). If they use a different identity, they get a different port. No collisions. No randomness. No .env files.

Wire it into your dev scripts:

\`\`\`bash
# package.json
{
  "scripts": {
    "dev": "PORT=$(pd claim myapp:frontend -q) next dev -p $PORT",
    "api": "PORT=$(pd claim myapp:api -q) uvicorn main:app --port $PORT"
  }
}
\`\`\`

Now your frontend and API will never collide, even if you start them in any order, restart them, or run multiple instances across branches.

## Semantic Identities

The identity string \`myapp:api:main\` isn't just a label — it's a queryable coordinate in a three-part namespace:

\`\`\`
project : stack : context
myapp   : api   : main
myapp   : api   : feature-auth
myapp   : frontend : main
\`\`\`

This means you can:

\`\`\`bash
# Find all services for a project
pd services --filter myapp

# Find who's running on what port
pd services
# NAME                 PORT    PID    IDENTITY
# myapp-api            3146    8823   myapp:api:main
# myapp-frontend       3147    8901   myapp:frontend:main
# myapp-api-auth       3291    9102   myapp:api:feature-auth
\`\`\`

Compare that to "it's on localhost:8432." Which one tells you what's running and who owns it?

When you're juggling four services across two branches with three AI agents, semantic identities aren't a nice-to-have. They're the difference between knowing what's running and praying nothing collides.

## Multi-Service Orchestration

For projects with multiple services, Port Daddy can start everything in the right order with health checks and dependency resolution. Create a \`.portdaddyrc\` in your project root:

\`\`\`json
{
  "services": {
    "db": {
      "cmd": "docker compose up postgres",
      "identity": "myapp:db",
      "health": "pg_isready -h localhost -p $PORT"
    },
    "api": {
      "cmd": "npm run api",
      "identity": "myapp:api",
      "depends_on": ["db"]
    },
    "frontend": {
      "cmd": "npm run dev",
      "identity": "myapp:frontend",
      "depends_on": ["api"]
    }
  }
}
\`\`\`

Then:

\`\`\`bash
pd up
\`\`\`

Port Daddy starts services in dependency order — db first, then api (after db is healthy), then frontend (after api is healthy). Each gets a deterministic port. Each gets color-coded log output. If api crashes, frontend knows. No port collisions. No startup race conditions.

\`\`\`bash
pd down  # Graceful shutdown, reverse order
\`\`\`

It's \`docker-compose\` for your local dev environment, except it works with bare processes, doesn't require Docker, and assigns ports intelligently instead of hoping for the best.

Stop debugging phantom CORS errors on Saturdays. Claim your ports.

---

### Further Reading
- [Zero to Multi-Agent in 5 Minutes](/blog/zero-to-multi-agent-in-5-minutes) — The two-command workflow
- [Dead Agents Tell Tales](/blog/dead-agents-tell-tales) — What happens when your agent crashes mid-task
    `
  },
  {
    id: 'dead-agents-tell-tales',
    slug: 'dead-agents-tell-tales',
    title: 'Dead Agents Tell Tales: Resurrecting Crashed AI Work',
    date: '2026-04-21',
    author: 'Port Daddy Engineering',
    excerpt: 'Your AI agent was 80% through a massive refactor when it hit the context window limit. All that work, all those decisions, all that context — gone. Unless you have a salvage queue.',
    tags: ['Salvage', 'Agent Lifecycle', 'Resilience', 'Advanced'],
    content: `
# Dead Agents Tell Tales

Your AI agent has been working for 45 minutes. It's refactored the auth module, migrated two database tables, written 14 tests, and left detailed notes about a race condition it found in the connection pool. Then it hits the context window limit. Terminal closes. Session over.

All that context — the decisions it made, the bugs it found, the files it was about to touch next — vanished. You re-read the diff, try to reconstruct its mental model, and spawn a new agent. The new agent doesn't know about the race condition. It doesn't know which tests pass. It starts from scratch.

This has happened to every developer running AI agents. And it's not just annoying — it's expensive.

## The $50 Context Window Problem

Let's do the math. A 45-minute Claude session running against a large codebase burns through real money — API calls, token processing, tool invocations. Call it $15-30 in direct costs, more for complex tasks. But the real expense is your time. You spent 20 minutes setting up the task. You'll spend another 20 re-explaining it to the replacement agent. The replacement will re-read files the first agent already understood, re-discover bugs the first agent already found, and probably make different decisions that conflict with what was already committed.

The total cost of one crashed agent isn't $15. It's $50+ when you factor in wasted human time, redundant API calls, and the debugging you'll do when the replacement agent contradicts the original.

What if the dead agent's context survived the crash?

## How Agent Resurrection Works

Port Daddy's agent resurrection system (we call it "salvage" — this is a harbor, after all) works on a simple principle: agents that register with the daemon have heartbeats, and heartbeats that stop tell a story.

Here's the lifecycle:

\`\`\`mermaid
stateDiagram-v2
    [*] --> Active: pd begin
    Active --> Active: heartbeat (5 min)
    Active --> Stale: no heartbeat (10 min)
    Stale --> Dead: no heartbeat (20 min)
    Dead --> SalvageQueue: reaper moves
    SalvageQueue --> Claimed: new agent claims
    Claimed --> [*]: work completed
\`\`\`

1. **Active** — Agent is registered and heartbeating every 5 minutes. Everything is normal.
2. **Stale** — No heartbeat for 10 minutes. Maybe the agent is thinking hard. Maybe it's dying. The daemon watches.
3. **Dead** — No heartbeat for 20 minutes. The agent is gone. The daemon's reaper process moves it to the salvage queue.
4. **Salvage Queue** — The dead agent's session, notes, and file claims are preserved. Another agent can claim the work and continue.

The critical insight: agents that use \`pd begin\` get heartbeats automatically. No extra setup. If you're using the two-command workflow from [the quickstart](/blog/zero-to-multi-agent-in-5-minutes), your agents are already resurrection-eligible.

## The Salvage Workflow

When you start a new agent, the first thing it should do is check for dead agents in the same project:

\`\`\`bash
pd salvage --project myapp
\`\`\`

Output:

\`\`\`
SALVAGE QUEUE — myapp

  Agent         Identity         Dead Since    Notes   Files
  claude-a1     myapp:api:main   14 min ago    7       3
  claude-b2     myapp:tests      22 min ago    3       5
\`\`\`

Seven notes. Three claimed files. That's not a dead agent — that's a treasure map.

Read the dead agent's notes:

\`\`\`bash
pd notes --session $DEAD_SESSION_ID
\`\`\`

\`\`\`
[14:23] Started auth module refactor. Moving from JWT to session tokens.
[14:31] Users table migrated. Added session_tokens table.
[14:38] Found race condition in lib/db/pool.ts — concurrent connections
        exceed pool max under load. Needs mutex or queue.
[14:45] Routes done: POST /auth/login, POST /auth/logout, GET /auth/me
[14:51] 14 tests written, all passing. Integration tests need db fixtures.
[14:58] Starting connection pool fix. Will add semaphore to acquire().
[15:02] Pool fix 60% done. Semaphore added but release() path untested.
\`\`\`

Now you know exactly where the agent stopped, what it discovered, and what's left. Claim the work:

\`\`\`bash
pd salvage claim claude-a1
\`\`\`

The dead agent's session is transferred to you. Its notes are now in your session history. Its file claims are yours. You continue from note 7, not from scratch.

For AI agents, you can pass this context directly:

\`\`\`bash
NOTES=$(pd notes --session $DEAD_SESSION_ID --json)
pd spawn --backend claude-cli \\
  --identity myapp:api \\
  --purpose "Continue auth refactor (salvaged from claude-a1)" \\
  -- "Previous agent crashed. Here are its notes: $NOTES. Continue from where it left off."
\`\`\`

## The Phoenix Pattern

Manual salvage is good. Automatic salvage is better. The Phoenix Pattern is a wrapper that detects agent death, checks the salvage queue, and spawns a replacement with full context — zero human intervention.

\`\`\`bash
#!/bin/bash
# phoenix.sh — auto-respawn with salvage context
PROJECT="myapp"
IDENTITY="myapp:api"
TASK="$1"

while true; do
  # Check for salvageable work from a previous run
  SALVAGE=$(pd salvage --project $PROJECT --json 2>/dev/null)
  DEAD_AGENT=$(echo "$SALVAGE" | jq -r '.[0].agentId // empty')

  CONTEXT=""
  if [ -n "$DEAD_AGENT" ]; then
    # Claim the dead agent's work
    pd salvage claim "$DEAD_AGENT" 2>/dev/null
    NOTES=$(pd notes --agent "$DEAD_AGENT" --json 2>/dev/null)
    CONTEXT="Previous agent ($DEAD_AGENT) crashed. Its notes: $NOTES. Continue from where it stopped."
  fi

  # Spawn new agent with salvage context
  pd spawn --backend claude-cli \\
    --identity "$IDENTITY" \\
    --purpose "$TASK" \\
    -- "\${CONTEXT:+\$CONTEXT }\$TASK"

  echo "Agent exited. Checking salvage queue in 10s..."
  sleep 10
done
\`\`\`

Run it:

\`\`\`bash
./phoenix.sh "Refactor the auth module to use session tokens"
\`\`\`

The first agent works until it crashes. The phoenix loop detects the crash, finds the dead agent in the salvage queue, reads its notes, and spawns a replacement with full context. The replacement picks up mid-sentence. If it crashes too, the cycle repeats.

Each generation is smarter than the last because it inherits the accumulated notes of every agent that came before it. The race condition in \`pool.ts\`? The first agent found it. The second agent will know about it from line one.

## What Gets Preserved (and What Doesn't... Yet)

**What survives death:**

- **Session notes** — Every \`pd note\` call creates an immutable record. These are the most valuable artifact. Agents that write good notes leave excellent salvage material.
- **File claims** — Which files the agent was working on. Tells the replacement exactly where to look.
- **Activity log** — Every port claim, lock acquisition, and message published. Full timeline of what happened.
- **Session metadata** — Identity, purpose, start time, file list. The "who, what, when" of the dead agent's mission.

**What doesn't survive (yet):**

- **Mental model** — The agent's internal understanding of the codebase. It read 47 files and built a mental map of how the auth system connects to the database. That map exists only in the context window and dies with it.
- **Decision rationale** — *Why* the agent chose session tokens over JWTs. If it wrote a note about it, great. If not, the reasoning is lost.
- **Uncommitted code** — If the agent was editing files but hadn't committed, those changes exist on disk but aren't tracked by Port Daddy. (Use \`pd session files claim\` to at least record which files were in flight.)

We're working on mental model snapshots — a structured summary that agents write periodically, capturing their understanding of the architecture, their decision log, and their planned next steps. Think of it as a "save game" for AI reasoning. It's not ready yet, but it's coming.

For now, the single best thing you can do is **teach your agents to write notes**. An agent that drops a \`pd note\` every few minutes is an agent whose death is a minor inconvenience, not a catastrophe.

\`\`\`bash
# Teach your agents this pattern
pd note "Starting: will refactor auth module. Plan: 1) migrate table, 2) new routes, 3) tests"
# ... work ...
pd note "Table migrated. Found race condition in pool.ts. Will fix after routes."
# ... work ...
pd note "Routes done. 14 tests passing. Starting pool fix next."
\`\`\`

Three notes. Thirty seconds of agent time. The difference between losing 45 minutes of work and losing zero.

---

### The Bottom Line

Agent crashes aren't failures — they're handoffs. The salvage queue turns a catastrophic loss of context into a smooth relay. The phoenix pattern automates the relay entirely. And good notes make the handoff seamless.

Dead agents tell tales. You just have to listen.

---

### Further Reading
- [Zero to Multi-Agent in 5 Minutes](/blog/zero-to-multi-agent-in-5-minutes) — The two-command workflow that makes agents salvage-eligible
- [The Port Collision That Ate My Saturday](/blog/the-port-collision-that-ate-my-saturday) — Deterministic port assignment for multi-agent setups
    `
  },
  {
    id: 'formal-verification-anchor-v3',
    slug: 'formal-verification-anchor-protocol',
    title: 'Math vs Chaos: How We Proved the Anchor Protocol Is Indestructible',
    date: '2026-03-12',
    author: 'Port Daddy Engineering',
    excerpt: 'We used ProVerif to mathematically prove the secrecy and authentication properties of our new multi-hop identity protocol. Here is how we did it.',
    tags: ['Security', 'Formal Methods', 'ProVerif', 'Anchor Protocol'],
    content: `
# Proving the Anchor Protocol

I've spent way too many late nights staring at my terminal, wondering why my agent swarm suddenly turned into a bunch of zombies fighting over port 3000. It's usually a ghost process—some dead agent that didn't actually die, still squatting on a resource and wrecking the whole workflow.

When we're building autonomous swarms that move fast, we can't just hope the identity logic works. We have to know. Not unit test know, but mathematical proof know.

That is why we built the Anchor Protocol and ran it through the ProVerif prover. We basically wanted to prove that no matter how chaotic the environment gets, the protocol itself is solid.

## The Handshake: Establishing Trust

Anchor manages your Harbor Card—that little piece of cryptographically signed ID that tells other agents what you're allowed to do.

We modeled this using symbolic analysis. Instead of looking at individual bits, we look at the pure logic. We asked the prover: Can an attacker ever trick a Harbor into accepting a card that the Daemon didn't issue?

ProVerif explored every possible path, including attackers sniffing the network and trying to replay old tokens. The result? It's impossible. Trust is anchored.

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant D as Daemon
    participant H as Harbor

    A->>D: Give me a card
    D->>D: Sign with Master Key
    D->>A: Here's your card (Ed25519)

    A->>H: I'm here
    H->>H: Pin Alg: EdDSA
    H->>H: Check Signature
    H->>A: Access Granted
\`\`\`

## Killing the None Attack

You might have heard of JWT algorithm confusion. It's when a verifier is tricked into skipping the signature check because the attacker says the algorithm is none.

We verified that our implementation is immune to this. The verifier doesn't care what the token says it is. It forces an Ed25519 check every single time. It's like a bouncer who doesn't care if your ID says you're the owner; they're checking the holographic seal no matter what.

\`\`\`proverif
(* The SECURE Harbor logic we proved *)
let SecureHarbor(k: key) =
  in(c, (alg_header: alg_type, msg: bitstring, signature: bitstring));
  if check_ed25519(msg, k, signature) = true then
    event Accepted().
\`\`\`

## Multi-hop Delegation: Passing the Torch

This is the nerdier part of v4. If Agent A spawns Agent B, it can pass a restricted version of its ID without needing to talk to the Daemon. We call this offline attenuation.

The math proves that Agent B can never have more power than Agent A. If Agent A can only read files, it can't give Agent B the power to delete them. Trust flows down, but it never escalates.

## What We Learned

Running these proofs gave us the confidence to ship v3.8.0. We verified three critical layers:
1. **Design Soundness**: The protocol logic is tight.
2. **Memory Safety**: The Rust core doesn't crash or leak.
3. **Side-Channel Mitigation**: Equality checks are constant-time to prevent timing attacks.

If you want to geek out on the actual proof files, they're sitting in the /analyses directory of the repo. Check them out and let's build something indestructible.

---

### Further Reading
* [Official ProVerif Documentation](https://proverif.inria.fr/)
* [RFC 8032: EdDSA signatures](https://tools.ietf.org/html/rfc8032)
* [The Anchor Formal Report](https://github.com/curiositech/port-daddy/blob/main/docs/reports/FORMAL_VERIFICATION_ANCHOR_V3.md)
    `
  },
  {
    id: 'distributed-locks',
    slug: 'distributed-locks-two-agents-one-migration',
    title: 'Distributed Locks: How I Stopped Two Agents From Running Migrations at the Same Time',
    date: '2026-04-28',
    author: 'Port Daddy Engineering',
    excerpt: 'Two agents. One database. Half a migration applied. The other half? Syntax error from a partially-applied schema. Distributed locks would have prevented the whole thing.',
    tags: ['Locks', 'DevEx', 'Getting Started', 'Safety'],
    content: `
# Distributed Locks: How I Stopped Two Agents From Running Migrations at the Same Time

## The Dual-Migration Horror Story

Here is exactly what happened. I had two Claude agents working on the same project. Agent A was adding a \`session_tokens\` table. Agent B was refactoring the \`users\` table to add a \`last_login\` column. Both agents decided, independently and within 30 seconds of each other, that it was time to run \`npm run migrate\`.

Agent A's migration started first. It created the \`session_tokens\` table, added a foreign key to \`users\`, and was halfway through creating an index when Agent B's migration kicked off. Agent B's migration tried to alter \`users\` while Agent A still had a lock on it. SQLite threw a \`SQLITE_BUSY\` error. Agent B's migration partially applied -- the column was added but the index wasn't. Agent A's migration completed, but now the foreign key references a table with a schema it doesn't expect.

The database was in a state that no single migration file described. Rolling back was manual surgery. I spent two hours fixing it.

The fix? One line.

## \`pd with-lock\`: The One-Line Fix

\`\`\`bash
pd with-lock db-migrations npm run migrate
\`\`\`

That's the entire solution. Here's what happens:

1. Port Daddy acquires a distributed lock named \`db-migrations\`
2. Your command (\`npm run migrate\`) runs
3. When the command finishes -- success or failure -- the lock is released
4. If the agent crashes mid-migration, the lock's TTL expires automatically (default: 5 minutes)

If Agent B tries to run \`pd with-lock db-migrations npm run migrate\` while Agent A holds the lock, it waits. Not crashes. Not fails. Waits. When Agent A's migration completes and the lock is released, Agent B's migration runs against a clean, fully-migrated schema.

\`\`\`mermaid
sequenceDiagram
    participant A as Agent A
    participant PD as Port Daddy
    participant B as Agent B
    participant DB as Database

    A->>PD: pd with-lock db-migrations
    PD->>A: Lock acquired
    A->>DB: npm run migrate (session_tokens)
    B->>PD: pd with-lock db-migrations
    PD-->>B: Queued (waiting...)
    A->>DB: Migration complete
    A->>PD: Lock released
    PD->>B: Lock acquired
    B->>DB: npm run migrate (last_login)
    B->>PD: Lock released
\`\`\`

No coordination between agents. No shared state. No "please don't run migrations right now" notes in a markdown file. Just a lock name that both agents agree on.

The TTL is the safety net. If Agent A's terminal gets killed, the process gets OOM'd, or the machine loses power, the lock expires after 5 minutes. No orphaned locks. No deadlocks. No human intervention.

## Explicit Lock Control

\`pd with-lock\` is syntactic sugar for the common case. When you need finer control, the raw lock API gives you everything:

\`\`\`bash
# Acquire a lock (waits in queue if taken)
pd lock db-migrations

# Acquire with a custom TTL (10 minutes)
pd lock db-migrations --ttl 600000

# Try once, fail immediately if taken
pd lock db-migrations --try

# Extend a lock you already hold
pd lock extend db-migrations --ttl 300000

# Release explicitly
pd unlock db-migrations

# See all active locks
pd locks
pd locks --json
\`\`\`

The queued behavior is the default and usually what you want. When Agent B calls \`pd lock db-migrations\` and Agent A holds it, Agent B's request blocks until the lock is available. The daemon manages the queue -- first come, first served.

The \`--try\` flag is for cases where waiting doesn't make sense. A CI pipeline that should skip if another deploy is running. A health check that should report "busy" instead of blocking. A cron job that should silently exit if the previous run hasn't finished.

TTL tuning depends on your use case. Migrations against a large database? Set it to 10 minutes. A quick file write? 30 seconds is plenty. The default of 5 minutes is conservative enough for most operations. If your operation takes longer than the TTL, the lock will expire while you're still working -- so err on the side of too long, not too short.

## Three Recipes

These are copy-paste ready. Adjust the lock names and commands for your project.

**Recipe 1: Migration Lock**

\`\`\`bash
# In your package.json scripts or Makefile
pd with-lock db-migrations -- npm run migrate
\`\`\`

Prevents concurrent schema changes. Works with any migration tool -- Prisma, Drizzle, Alembic, Flyway, raw SQL files. The lock doesn't care what the command does; it just guarantees mutual exclusion.

**Recipe 2: Build Lock**

\`\`\`bash
# Prevent concurrent builds from clobbering dist/
pd with-lock build:myapp -- npm run build
\`\`\`

Two agents running \`next build\` at the same time will fight over the \`.next\` directory. The second build reads half-written files from the first. The result is a corrupt build artifact that deploys and crashes in production. A build lock makes this impossible.

**Recipe 3: Deploy Lock**

\`\`\`bash
# Only one deploy at a time, 10 minute TTL
pd with-lock deploy --ttl 600000 -- ./deploy.sh
\`\`\`

Deployments are the most dangerous operation to run concurrently. Two deploys overlapping can leave your infrastructure in a half-old, half-new state that neither deployment script knows how to handle. This is especially critical with blue-green or rolling deploys where the orchestrator assumes it's the only one running.

**Bonus: Lock in the SDK**

If you're building automation in JavaScript/TypeScript, the [SDK](/docs) has a \`withLock\` method that handles acquire, execute, and release with automatic TTL extension:

\`\`\`typescript
import { PortDaddy } from 'port-daddy';
const pd = new PortDaddy();

await pd.withLock('db-migrations', async () => {
  await runMigrations();
  await seedTestData();
}, { ttl: 600000 });
\`\`\`

The SDK auto-extends the TTL while your function is running, so you don't have to guess how long the operation will take. If your function throws, the lock is released immediately. If the process crashes, the TTL expires on schedule.

---

### Further Reading
- [Locks API documentation](/docs) -- Full endpoint reference for lock acquire, release, extend, and list
- [pd with-lock tutorial](/tutorials) -- Step-by-step walkthrough with examples
- [Dead Agents Tell Tales](/blog/dead-agents-tell-tales) -- What happens when your agent dies holding a lock (spoiler: TTL saves you)
    `
  },
  {
    id: 'multi-agent-file-claims',
    slug: 'four-agents-zero-clobber',
    title: "I Let 4 AI Agents Edit My Codebase Simultaneously. Here's How None of Them Clobbered Each Other.",
    date: '2026-05-05',
    author: 'Port Daddy Engineering',
    excerpt: "Four agents, one repo, zero merge conflicts. File claims don't enforce locks -- they broadcast intent. And that turns out to be exactly right.",
    tags: ['File Claims', 'Multi-Agent', 'Coordination', 'Worktrees'],
    content: `
# I Let 4 AI Agents Edit My Codebase Simultaneously

## The Multi-Agent Collision Is Worse Than Merge Conflicts

Merge conflicts are annoying but recoverable. Git shows you both versions, you pick one, you move on. The collision I'm talking about is worse: **semantic conflicts**.

Agent A deletes a helper function. Agent B writes new code that calls that function. Both agents commit. Git merges cleanly -- there's no textual overlap. The code compiles. The tests? They crash at runtime with \`TypeError: formatDate is not a function\`.

Or worse: Agent A refactors the return type of \`getUser()\` from \`{name, email}\` to \`{name, email, role}\`. Agent B writes a component that destructures \`{name, email}\` and renders them. No conflict. No compiler error. But Agent B's code silently ignores the \`role\` field that Agent A added specifically because every component needs to display it.

These aren't merge conflicts. They're **intention conflicts**. Two agents with incompatible plans, working in isolation, producing code that's individually correct and collectively broken.

Git can't detect this. Your test suite might not catch it until the integration tests run (if you have them). The only thing that can prevent it is coordination -- agents knowing what other agents are doing *before* they start.

## File Claims: Advisory Locks for Your Codebase

Port Daddy's file claims are deliberately advisory, not enforced. When Agent A claims \`src/models/user.ts\`, the daemon records it but doesn't prevent Agent B from editing that file. It just makes sure Agent B *knows* Agent A is working there.

Why advisory instead of enforced? Three reasons:

1. **Enforced locks on files would deadlock constantly.** Agent A needs to edit \`user.ts\` and \`auth.ts\`. Agent B needs \`auth.ts\` and \`user.ts\`. With enforced locks, one of them waits forever.
2. **Agents need to read files they don't own.** Agent B might need to read \`user.ts\` to understand the schema, even though Agent A is editing it. Read access should never be blocked.
3. **Sometimes the overlap is fine.** Two agents editing different functions in the same file can merge cleanly. Enforcement would serialize work that can safely run in parallel.

Advisory claims give you the information to make smart decisions without the rigidity that makes multi-agent work impossible.

## Setting Up a 4-Agent Session

Here's the real workflow I used to run 4 agents against the Port Daddy codebase simultaneously. Each agent got a clear domain and claimed its files upfront.

**Agent 1: API routes**

\`\`\`bash
pd begin --identity portdaddy:api --purpose "Add tunnel endpoints"
# Session started: sess-a1b2c3
pd session files claim sess-a1b2c3 routes/tunnel.ts lib/tunnel.ts tests/unit/tunnel.test.ts
pd note "Working on tunnel CRUD: create, delete, list, status"
\`\`\`

**Agent 2: CLI commands**

\`\`\`bash
pd begin --identity portdaddy:cli --purpose "Add tunnel CLI commands"
pd session files claim sess-d4e5f6 cli/commands/tunnel.ts completions/port-daddy.bash completions/port-daddy.zsh completions/port-daddy.fish
pd note "Adding pd tunnel start/stop/list to all CLI surfaces"
\`\`\`

**Agent 3: SDK methods**

\`\`\`bash
pd begin --identity portdaddy:sdk --purpose "Add tunnel SDK methods"
pd session files claim sess-g7h8i9 lib/client.ts docs/sdk.md
pd note "Adding startTunnel, stopTunnel, listTunnels to SDK"
\`\`\`

**Agent 4: Tests**

\`\`\`bash
pd begin --identity portdaddy:tests --purpose "Write tunnel integration tests"
pd session files claim sess-j0k1l2 tests/integration/tunnel.test.ts tests/unit/tunnel-cli.test.ts
pd note "Writing integration tests against live daemon"
\`\`\`

Now check the map:

\`\`\`bash
pd files
\`\`\`

Output:

\`\`\`
FILE CLAIMS

  File                              Owner              Session
  routes/tunnel.ts                  portdaddy:api      sess-a1b2c3
  lib/tunnel.ts                     portdaddy:api      sess-a1b2c3
  tests/unit/tunnel.test.ts         portdaddy:api      sess-a1b2c3
  cli/commands/tunnel.ts            portdaddy:cli      sess-d4e5f6
  completions/port-daddy.bash       portdaddy:cli      sess-d4e5f6
  completions/port-daddy.zsh        portdaddy:cli      sess-d4e5f6
  completions/port-daddy.fish       portdaddy:cli      sess-d4e5f6
  lib/client.ts                     portdaddy:sdk      sess-g7h8i9
  docs/sdk.md                       portdaddy:sdk      sess-g7h8i9
  tests/integration/tunnel.test.ts  portdaddy:tests    sess-j0k1l2
  tests/unit/tunnel-cli.test.ts     portdaddy:tests    sess-j0k1l2
\`\`\`

Zero overlap. Every agent has a clear territory. Every file has exactly one owner. This isn't accidental -- it's the result of thinking about the partition *before* spawning agents.

## The Conflict Detection Flow

What happens when Agent B tries to claim a file that Agent A already owns?

\`\`\`bash
# Agent 3 (SDK) decides it also needs to touch lib/tunnel.ts
pd session files claim sess-g7h8i9 lib/tunnel.ts
\`\`\`

The response:

\`\`\`json
{
  "claimed": ["lib/tunnel.ts"],
  "conflicts": [
    {
      "file": "lib/tunnel.ts",
      "owner": "portdaddy:api",
      "session": "sess-a1b2c3",
      "agent": "claude-a1"
    }
  ]
}
\`\`\`

The claim succeeds (advisory, remember), but the \`conflicts\` array tells Agent 3 exactly who else is working on that file. Now Agent 3 has a decision tree:

1. **Wait** -- Don't touch \`lib/tunnel.ts\` until Agent 1 is done. Use \`pd notes --session sess-a1b2c3\` to monitor progress.
2. **Coordinate** -- Publish a message on a shared channel: \`pd pub tunnel:handoff '{"file":"lib/tunnel.ts","need":"add SDK method signatures"}'\`. Agent 1 can add the exports that Agent 3 needs.
3. **Proceed carefully** -- If the changes are to different functions, go ahead but run a merge check afterward.
4. **Yield** -- Release the claim and refactor the approach to avoid touching that file entirely.

The point is: Agent 3 can't accidentally clobber Agent 1's work because it *knows* Agent 1 is there. The conflict information is available before a single line of code is written.

You can also check ownership for a specific file:

\`\`\`bash
pd who-owns lib/tunnel.ts
\`\`\`

\`\`\`
lib/tunnel.ts is claimed by portdaddy:api (session sess-a1b2c3)
\`\`\`

## Worktree Parallelization

The advanced pattern uses git worktrees to give each agent its own branch. This eliminates even the *possibility* of file-level conflicts during development -- each agent has a full copy of the repo.

\`\`\`bash
# Create worktrees for each agent
git worktree add ../pd-agent-api    -b feat/tunnel-api
git worktree add ../pd-agent-cli    -b feat/tunnel-cli
git worktree add ../pd-agent-sdk    -b feat/tunnel-sdk
git worktree add ../pd-agent-tests  -b feat/tunnel-tests
\`\`\`

Each agent works in its own directory on its own branch. File claims still matter because they document the *intended* partition for merge time.

\`\`\`mermaid
graph TD
    A[main branch] --> B[feat/tunnel-api]
    A --> C[feat/tunnel-cli]
    A --> D[feat/tunnel-sdk]
    A --> E[feat/tunnel-tests]
    B --> F[merge 1st: most files]
    F --> G[merge 2nd: CLI]
    G --> H[merge 3rd: SDK]
    H --> I[merge 4th: tests]
\`\`\`

**Merge order matters.** Merge the branch with the most file changes first -- it has the most potential for conflicts, and you want to resolve those against a clean \`main\`. Then merge subsequent branches in decreasing order of file overlap. The test branch always merges last because it needs the final versions of everything it's testing.

The file claims table from \`pd files\` gives you the merge order for free. Count files per session, sort descending, merge in that order.

Rules I've learned the hard way:

1. **Always commit before launching worktree agents.** They branch from HEAD. Stale HEAD means merge conflict city.
2. **Never have two agents touch the same file.** Partition by file, not by "phase" or "layer."
3. **If agents must share a file** -- make them sequential, not parallel. One finishes, the other starts.
4. **Use \`pd notes\` aggressively.** Each agent should log what it changed and why. These notes become the merge commit messages.

Four agents, four branches, one repo, zero clobber. The file claims are the map. The worktrees are the territory. Together they let you parallelize work that would otherwise be serial.

---

### Further Reading
- [Sessions & Notes documentation](/docs) -- Full reference for sessions, notes, and file claims
- [File Claims API](/docs) -- POST/DELETE endpoints for claiming and releasing files
- [Zero to Multi-Agent in 5 Minutes](/blog/zero-to-multi-agent-in-5-minutes) -- The basics before you scale to 4 agents
    `
  },
  {
    id: 'pubsub-self-healing-pipeline',
    slug: 'pubsub-self-healing-test-pipeline',
    title: "Pub/Sub for Your Dev Environment: How I Built a Self-Healing Test Pipeline",
    date: '2026-05-12',
    author: 'Port Daddy Engineering',
    excerpt: "You are not a message bus. Stop manually telling Agent B that Agent A finished. Port Daddy's pub/sub turns your dev environment into an event-driven system.",
    tags: ['Pub/Sub', 'Event-Driven', 'Automation', 'Watch'],
    content: `
# Pub/Sub for Your Dev Environment: How I Built a Self-Healing Test Pipeline

## You Are Not a Message Bus

Here's a workflow I used to run every day:

1. Agent A finishes the migration. I read the output.
2. I tell Agent B: "Migration is done, run the tests."
3. Agent B finishes the tests. I read the output.
4. I tell Agent C: "Tests passed, start the deploy."
5. Agent C deploys. I watch the logs.
6. I tell Agent D: "Deploy is up, run the smoke tests."

I am the message bus. Every handoff between agents goes through my eyeballs and my keyboard. I'm the bottleneck in my own pipeline. If I step away for coffee, the whole chain stalls.

This is the anti-pattern. You are not a message bus. You are a human being who should be thinking about architecture, not relaying "it's done" messages between processes.

Port Daddy's pub/sub eliminates you from the loop entirely.

## Channels, Messages, and Subscribers

The mental model is simple: channels are named pipes. Anyone can publish. Anyone can subscribe. Messages are JSON. The daemon routes them.

\`\`\`bash
# Publish a message to a channel
pd pub build:done '{"status":"success","commit":"a1b2c3"}'

# Subscribe to a channel (SSE stream -- stays open)
pd sub build:done

# List active channels
pd channels

# Clear a channel
pd channels clear build:done
\`\`\`

When Agent A publishes to \`build:done\`, every subscriber on that channel gets the message immediately via Server-Sent Events. No polling. No files. No databases to query. Real-time push.

You can also long-poll if SSE doesn't fit your use case:

\`\`\`bash
# Block until a message arrives (or timeout)
curl http://localhost:9876/msg/build:done/poll?timeout=30000
\`\`\`

The channel namespace is flat and convention-based. I use \`project:event\` naming -- \`myapp:tests:passed\`, \`myapp:deploy:started\`, \`myapp:migration:done\`. Pick a convention and stick with it.

## Event-Driven Agent Coordination

Here's the migration-to-tests handoff, automated:

**Agent A (migrator):**

\`\`\`bash
pd begin --identity myapp:migrator --purpose "Run schema migrations"
pd with-lock db-migrations -- npm run migrate
pd pub migration:done '{"tables":["users","session_tokens"],"status":"success"}'
pd done
\`\`\`

**Agent B (tester) -- launched with a subscription:**

\`\`\`bash
pd watch migration:done --exec './run-tests.sh'
\`\`\`

When Agent A publishes to \`migration:done\`, Agent B's \`run-tests.sh\` fires automatically. No human in the loop. The \`pd watch\` command keeps an SSE connection open and runs the script on every message.

\`\`\`mermaid
graph LR
    A[Agent A: Migrator] -->|pd pub migration:done| PD((Port Daddy))
    PD -->|SSE| B[Agent B: pd watch]
    B -->|exec| T[run-tests.sh]
    T -->|pd pub tests:done| PD
    PD -->|SSE| C[Agent C: pd watch]
    C -->|exec| D[deploy.sh]
\`\`\`

Each agent only knows about its own input channel and its own output channel. Agent A doesn't know Agent B exists. Agent B doesn't know Agent C exists. The pub/sub topology is the coordination layer, and you define it once.

## \`pd watch --exec\`: Ambient Triggers

\`pd watch\` is the command that makes pub/sub practical. It subscribes to a channel and runs a script every time a message arrives. The message content is available as environment variables:

\`\`\`bash
pd watch deployments --exec ./handle-deploy.sh
\`\`\`

Inside \`handle-deploy.sh\`, you get:

| Variable | Contents |
|----------|----------|
| \`PD_MESSAGE\` | Full SSE JSON string |
| \`PD_MESSAGE_CONTENT\` | Extracted content field |
| \`PD_CHANNEL\` | Channel name (e.g., \`deployments\`) |
| \`PD_TIMESTAMP\` | ISO 8601 timestamp |

\`\`\`bash
#!/bin/bash
# handle-deploy.sh
echo "Deploy event on $PD_CHANNEL at $PD_TIMESTAMP"
echo "Payload: $PD_MESSAGE_CONTENT"

COMMIT=$(echo "$PD_MESSAGE_CONTENT" | jq -r '.commit')
STATUS=$(echo "$PD_MESSAGE_CONTENT" | jq -r '.status')

if [ "$STATUS" = "success" ]; then
  echo "Running smoke tests for $COMMIT..."
  npm run test:smoke
  pd pub smoke:done "{\\"commit\\":\\"$COMMIT\\",\\"status\\":\\"passed\\"}"
fi
\`\`\`

\`pd watch\` has built-in safety guards:

\`\`\`bash
# Limit concurrent executions (default: 5)
pd watch alerts --exec ./alert.sh --max-concurrent 1

# Minimum interval between executions (debounce)
pd watch builds --exec ./build.sh --min-interval 5000

# Execution timeout
pd watch deploys --exec ./deploy.sh --timeout 60000
\`\`\`

The \`--max-concurrent 1\` flag is critical for operations that must not overlap -- deploys, migrations, anything that touches shared state. Messages that arrive while the script is running are dropped (not queued), and a rate-limit warning is logged.

\`pd watch\` also auto-reconnects if the daemon restarts. It's designed to run forever in the background.

## The Self-Healing Pipeline

Here's the complete system: code commit triggers tests, test failure spawns a fix agent, fix agent commits, tests run again. The loop closes automatically.

\`\`\`bash
#!/bin/bash
# self-healing-pipeline.sh -- run each watcher in the background

# Step 1: On every commit, run tests
pd watch git:committed --exec './scripts/run-tests.sh' &

# Step 2: On test failure, spawn a fix agent
pd watch tests:failed --exec './scripts/spawn-fixer.sh' &

# Step 3: On fix committed, re-run tests
pd watch fix:committed --exec './scripts/run-tests.sh' &

# Step 4: On tests passing after a fix, log and celebrate
pd watch tests:passed --exec './scripts/notify-success.sh' &

echo "Pipeline running. Watchers: $(jobs -p | wc -l)"
wait
\`\`\`

The key scripts:

**\`run-tests.sh\`:**

\`\`\`bash
#!/bin/bash
pd begin --identity myapp:tester --purpose "Automated test run"
npm test 2>&1 | tee /tmp/test-output.log
EXIT_CODE=\${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 0 ]; then
  pd pub tests:passed '{"status":"success"}'
  pd note "All tests passed"
else
  FAILURES=$(tail -20 /tmp/test-output.log)
  pd pub tests:failed "{\\\"status\\\":\\\"failed\\\",\\\"output\\\":\\\"$FAILURES\\\"}"
  pd note "Tests failed -- spawning fix agent"
fi
pd done
\`\`\`

**\`spawn-fixer.sh\`:**

\`\`\`bash
#!/bin/bash
FAILURES=$(echo "$PD_MESSAGE_CONTENT" | jq -r '.output')

pd spawn --backend claude-cli \\
  --identity myapp:fixer \\
  --purpose "Fix failing tests" \\
  -- "These tests are failing: $FAILURES. Read the test files, read the source code, fix the bug. Run the tests to verify. Then commit with a descriptive message."

# The spawned agent commits -> git post-commit hook publishes to fix:committed
# -> run-tests.sh fires again -> loop continues or breaks on success
\`\`\`

The pipeline is self-correcting. Test failure triggers a fix attempt. The fix triggers a re-test. If the fix works, the pipeline moves forward. If it doesn't, the fixer gets another shot (you'd add a retry counter in production to avoid infinite loops).

The entire coordination layer is pub/sub messages. No shared files. No polling. No human relay. Every step is independent, testable, and replaceable.

You can inspect the pipeline state at any time:

\`\`\`bash
# What channels are active?
pd channels

# What messages have been published?
pd msg tests:failed

# Who's running right now?
pd agents
\`\`\`

The [MCP integration](/mcp) also exposes pub/sub, so AI agents with MCP tool access can publish and subscribe without shelling out to the CLI.

---

### Further Reading
- [Messaging API](/docs) -- Full reference for publish, subscribe, poll, and channel management
- [pd watch documentation](/docs) -- Ambient triggers with exec, reconnect, and safety guards
- [MCP tools for pub/sub](/mcp) -- Using pub/sub from AI agents via MCP
- [The Port Collision That Ate My Saturday](/blog/the-port-collision-that-ate-my-saturday) -- Deterministic ports for the services your pipeline manages
    `
  },
  {
    id: 'fleet-management',
    slug: 'fleet-agents-as-infrastructure',
    title: "Fleet Management: Declare Your AI Agents Like Infrastructure",
    date: '2026-05-19',
    author: 'Port Daddy Engineering',
    excerpt: "441 orphaned sessions. That's what I found after a weekend of manually managing AI agents. Fleet YAML turns agent swarms into declarative infrastructure -- like docker-compose for your AI workforce.",
    tags: ['Fleet', 'Infrastructure', 'Automation', 'YAML'],
    content: `
# Fleet Management: Declare Your AI Agents Like Infrastructure

## The "I Forgot to Start the Gardener" Incident

I had 8 background agents running for Port Daddy's development. A gardener that monitors git status. A QA agent that reviews commits. A test-gap-hunter that finds untested code. A documentarian that keeps docs in sync. A simplifier that removes unnecessary complexity. A cartographer that tracks the roadmap. A spark that proposes ideas. A spider that finds connections between features.

I managed them with shell scripts. Each agent had a startup command I'd run in a terminal tab. When I rebooted, I'd re-launch them manually. When one crashed, I might not notice for hours.

One weekend, the Spark agent went haywire. It was starting sessions but never closing them. By Monday morning, there were **441 orphaned sessions** in the database. I hadn't noticed because I forgot to start the Gardener -- the very agent that would have detected the leak.

The irony was thick. I was building coordination infrastructure while manually coordinating my own agents. That week, I built Fleet.

## \`pd-fleet.yml\`: Agents as Infrastructure

Fleet is a YAML file that declares your agent swarm. You describe what each agent does, when it runs, what tools it's allowed to use, and how agents connect to each other. Port Daddy handles the rest -- spawning, heartbeats, coordination, resurrection.

Here's the minimum viable fleet:

\`\`\`yaml
fleet:
  name: my-project
  harbor: "{project}:fleet"

  agents:
    qa:
      trigger: git:committed
      backend: claude-cli
      allowedTools: "Read,Grep,Glob,Bash(npm test*)"
      prompt: |
        Review the most recent commit. Read every changed file.
        For each change, identify inputs that would break it.
        If you find bugs, write a test that exposes each one.
      identity: "{project}:fleet:qa"
\`\`\`

That's one agent. It triggers on \`git:committed\` (published by a post-commit hook), uses the Claude CLI backend, and has its tools restricted to read-only plus test execution. The identity is templated -- \`{project}\` resolves to the current project name from \`package.json\` or the directory name.

The \`pd-fleet.yml\` lives in your repo root, version-controlled alongside your code. When you change an agent's prompt or schedule, you commit it. The agent definition and the code it operates on evolve together.

## \`pd fleet up/down/status\`

\`\`\`bash
# Initialize a fleet config (creates pd-fleet.yml + post-commit hook)
pd fleet init

# Start all agents
pd fleet up

# Check what's running
pd fleet status

# Stop everything
pd fleet down

# Run a specific agent once (for testing)
pd fleet run qa
\`\`\`

\`pd fleet up\` reads \`pd-fleet.yml\`, spawns each agent via \`pd spawn\`, wires up the pub/sub triggers, and starts the schedulers. Each agent gets a Port Daddy identity, a session, and a heartbeat. If an agent dies, the daemon's reaper detects it and it enters the [salvage queue](/blog/dead-agents-tell-tales).

\`pd fleet status\` shows the live state:

\`\`\`
FLEET: port-daddy-dev

  Agent           Backend      Schedule/Trigger    Status    Last Run
  gardener        custom       */10 * * * *        running   2 min ago
  qa              claude-cli   trigger:committed   idle      14 min ago
  test-hunter     claude-cli   trigger:committed   idle      14 min ago
  documentarian   claude-cli   trigger:committed   running   3 min ago
  simplifier      claude-cli   trigger:committed   idle      14 min ago
  cartographer    claude-cli   trigger:committed   idle      14 min ago
  spark           claude-cli   */30 * * * *        idle      18 min ago
  spider          claude-cli   trigger:spark:idea  idle      47 min ago

  Channels: git:committed(4 consumers) qa:findings(1) spark:idea(1)
\`\`\`

\`pd fleet down\` gracefully shuts down all agents, closes their sessions via \`pd done\`, and removes the fleet state file.

## The 8 Built-In Fleet Agents

Port Daddy ships with a \`pd-fleet.yml\` that we use for our own development. These agents run continuously in the background while we work. Here's what each one does:

\`\`\`mermaid
graph TB
    GIT[post-commit hook] -->|git:committed| QA[QA Agent]
    GIT -->|git:committed| TH[Test Hunter]
    GIT -->|git:committed| DOC[Documentarian]
    GIT -->|git:committed| SIM[Simplifier]
    GIT -->|git:committed| CART[Cartographer]
    CRON1[*/10 cron] --> GARD[Gardener]
    CRON2[*/30 cron] --> SPARK[Spark]
    SPARK -->|spark:idea| SPIDER[Spider]
    QA -->|qa:findings| NOTIFY[Notify Watcher]
\`\`\`

**Gardener** -- Runs every 10 minutes. Executes \`git status --porcelain\` and publishes the result to \`git:status\`. A simple heartbeat that tells you if uncommitted changes are accumulating. Uses \`custom\` backend (raw shell command, no LLM).

**QA** -- Triggers on every commit. Reviews every changed file in the commit. Identifies inputs that would break the changes. Writes tests that expose bugs. Also audits existing tests for tautologies, mock echoes, missing negative paths, and coverage theater. If it finds problems, publishes to \`qa:findings\`.

**Test Hunter** -- Triggers on every commit. Runs the full test suite, finds modules below 50% coverage, and writes meaningful tests to fill the gaps. Runs the tests it writes to verify they pass. Also runs the build to catch JSX errors that \`tsc\` misses.

**Documentarian** -- Triggers on every commit. Checks that CLAUDE.md, README, CHANGELOG, \`features.manifest.json\`, and the website docs all match the actual code. If a new API endpoint exists in \`routes/\` but isn't documented anywhere, the documentarian creates the missing docs.

**Simplifier** -- Triggers on every commit. Reviews recently changed files for unnecessary complexity. Simplifies without changing behavior. Removes code rather than adding it. Runs tests to verify nothing broke. Uses a git worktree so its changes don't interfere with your working directory.

**Cartographer** -- Triggers on every commit. Maintains the V4 roadmap document. Moves completed items from NEXT to COMPLETE. Flags stale work. Tracks velocity. Ensures the roadmap reflects reality, not aspiration.

**Spark** -- Runs every 30 minutes. Reads the codebase, the roadmap, and Spider's latest connections. Proposes one concrete improvement or new feature. Writes a brief proposal and saves it to \`.spark/ideas/\`. Publishes to \`spark:idea\` so Spider can find combinatorial possibilities.

**Spider** -- Triggers on \`spark:idea\` and also runs every 2 hours. Reads the feature manifest, the module headers, and Spark's proposals. Produces syllogisms: "We have Feature X AND Feature Y, THEREFORE Capability Z is now available." Finds non-obvious connections between existing features that no one has noticed. Uses the Sonnet model for faster inference since it runs frequently.

The topology is a DAG. Commits trigger the core 5 agents (QA, test-hunter, documentarian, simplifier, cartographer) in parallel. Spark runs on a schedule, independent of commits. Spider reacts to Spark's output. QA findings trigger a notification watcher that posts to the notes system.

## Writing Your Own Fleet Agent

A minimal fleet agent is 5 lines of YAML:

\`\`\`yaml
fleet:
  name: my-project
  agents:
    lint-watcher:
      schedule: "*/5 * * * *"
      backend: custom
      prompt: "npx eslint src/ --max-warnings 0"
      identity: "{project}:fleet:lint-watcher"
\`\`\`

That runs ESLint every 5 minutes. No AI. No LLM. Just a cron-scheduled shell command with Port Daddy coordination (identity, heartbeat, salvage eligibility).

For AI agents, specify a backend and a prompt:

\`\`\`yaml
    reviewer:
      trigger: git:committed
      backend: claude-cli
      model: sonnet           # optional: defaults to whatever's configured
      singleton: true          # only one instance at a time
      worktree: true           # gets its own git worktree
      allowedTools: "Read,Grep,Glob,Edit"
      prompt: |
        Review the last commit for security issues.
        Check for: SQL injection, XSS, SSRF, path traversal,
        hardcoded secrets, and missing input validation.
        Write findings to .security/reviews/ as timestamped markdown.
      on_success: publish security:clean
      on_failure: publish security:findings
      identity: "{project}:fleet:reviewer"
\`\`\`

The key fields:

| Field | What it does |
|-------|-------------|
| \`schedule\` | Cron expression. Agent runs on this schedule. |
| \`trigger\` | Pub/sub channel name. Agent runs when a message arrives. |
| \`backend\` | How to run the agent: \`claude-cli\`, \`ollama\`, \`custom\`, etc. |
| \`prompt\` | The instructions (for LLM backends) or the command (for \`custom\`). |
| \`singleton\` | Only one instance of this agent runs at a time. |
| \`worktree\` | Agent gets its own git worktree for isolated changes. |
| \`allowedTools\` | Restrict which tools the LLM agent can use. |
| \`on_success/on_failure\` | Publish to a channel on completion. Chains agents together. |
| \`identity\` | Semantic identity for Port Daddy registration. |

You can use both \`schedule\` and \`trigger\` on the same agent. The Spider runs every 2 hours *and* on every \`spark:idea\` message -- whichever comes first.

Port Daddy handles everything else automatically:
- **Heartbeats** -- Each agent sends a heartbeat every 5 minutes. The daemon detects death if heartbeats stop.
- **Resurrection** -- Dead agents enter the salvage queue. Their notes, file claims, and session context are preserved for a replacement.
- **Identity** -- Each agent gets a semantic identity (\`{project}:fleet:{name}\`). You can query all fleet agents for a project with \`pd agents --filter fleet\`.
- **Coordination** -- Agents that use \`pd begin\`/\`pd done\` get sessions, notes, and file claims for free. The fleet engine wires this up automatically.

The whole point of Fleet is that agents should be declared, not coded. Your \`pd-fleet.yml\` is the infrastructure manifest for your AI workforce. Version control it. Review changes to it. Treat it with the same seriousness as your \`docker-compose.yml\` or your Terraform files.

\`\`\`bash
# Get started in 30 seconds
pd fleet init        # creates pd-fleet.yml + post-commit hook
# Edit pd-fleet.yml to add your agents
pd fleet up          # launch the swarm
pd fleet status      # see what's running
\`\`\`

441 orphaned sessions taught me that manual agent management is a losing game. Declare your agents. Let the daemon manage them. Go think about architecture.

---

### Further Reading
- [Fleet documentation](/docs) -- Full YAML schema reference and fleet CLI commands
- [pd spawn](/docs) -- The underlying agent spawning primitive that Fleet wraps
- [Agent Lifecycle](/tutorials) -- How agent registration, heartbeats, and resurrection work
- [Dead Agents Tell Tales](/blog/dead-agents-tell-tales) -- What happens when fleet agents crash
    `
  },
  {
    id: 'spark-and-spider',
    slug: 'spark-and-spider-the-creative-engine',
    title: 'Spark and Spider: How Two AI Agents Generate Ideas While I Sleep',
    date: '2026-05-26',
    author: 'Port Daddy Engineering',
    excerpt: 'Spark proposes ideas. Spider finds connections between features via formal syllogisms. Together they form a creative engine that runs in the background and compounds knowledge over time.',
    tags: ['Fleet', 'Spark', 'Spider', 'Stigmergy', 'Advanced'],
    content: `
# Spark and Spider: The Creative Engine

I woke up on a Wednesday morning, opened my terminal, and found this waiting for me:

\`\`\`
PREMISE A: The Arbiter checks every state transition against six
hard-coded invariant rules with fixed enforcement levels.

PREMISE B: The pheromone system lets agents spray numeric confidence
signals (0-1) onto any entity with read-time decay.

THEREFORE: The Arbiter's invariant thresholds can be made adaptive.
When pheromone anomaly on an agent exceeds a configurable watermark,
the Arbiter drops its intervention threshold for that agent.
High-anomaly agents get tighter oversight automatically.

CONFIDENCE: high
EFFORT: medium
\`\`\`

I didn't write this. I didn't prompt for it. I didn't even know this connection existed.

Spider wrote it. At 9:13 PM the night before, while I was watching TV, Spider read Port Daddy's feature manifest, scanned the module headers, and found that two features I'd built independently --- the Arbiter and the pheromone system --- compose into something neither was designed for: adaptive oversight thresholds.

Then Spark woke up, read Spider's syllogism, and wrote a 95-line implementation proposal with exact file paths and line counts.

By morning, I had a concrete plan for a feature I hadn't imagined, grounded in code I'd already shipped. This is what a creative engine looks like.

## What Spark Does

Spark runs every 30 minutes. Its job is simple: read the codebase, read the roadmap, propose one concrete improvement.

\`\`\`yaml
# From pd-fleet.yml
spark:
  schedule: "*/30 * * * *"
  backend: claude-cli
  singleton: true
  prompt: |
    Read CLAUDE.md, the V4 roadmap, and recent commits.
    Read .spider/connections/ for Spider's latest syllogisms.
    Identify one concrete improvement. Write a brief proposal.
    Save to .spark/ideas/ as a timestamped markdown file.
  on_success: publish spark:idea
\`\`\`

The key constraint: **achievable in one session, not moonshots.** Spark doesn't dream about rewriting the system. It finds the small, concrete thing that makes Port Daddy better *today*.

Every idea publishes to the \`spark:idea\` channel. Anything listening --- Spider, the documentarian, a Slack webhook --- gets notified.

## What Spider Does

Spider is the connection engine. It reads the feature manifest, the codebase, and Spark's latest ideas. Then it produces **formal syllogisms**: pairs of existing features whose composition implies a new, unbuilt capability.

\`\`\`yaml
spider:
  trigger: spark:idea
  schedule: "0 */2 * * *"
  backend: claude-cli
  model: sonnet
  singleton: true
  prompt: |
    Find combinatorial possibilities between features.
    Output formal syllogisms:
    PREMISE A: [Feature X exists and does Y]
    PREMISE B: [Feature Z exists and does W]
    THEREFORE: [New capability C is now available]
  on_success: publish spider:connections
\`\`\`

Spider doesn't invent features. It discovers features that *already exist implicitly* in the composition of what's been built. That's a crucial distinction.

## The Syllogisms

In one run, Spider produced 10 connections. Here are three that changed how I think about Port Daddy:

### S2: Salvage Queue + Agent Inbox = Auto-Briefing

\`\`\`
PREMISE A: The salvage system captures a dead agent's full session
context when a new agent claims the resurrection slot.

PREMISE B: The agent inbox delivers typed, structured messages
directly to any registered agent by ID.

THEREFORE: When an agent claims a resurrection slot, the daemon
should automatically compose a structured salvage briefing and
deliver it to the claiming agent's inbox.

CONFIDENCE: high | EFFORT: small
\`\`\`

Two systems that had never been connected. The salvage system knows everything about the dead agent. The inbox can deliver anything to any agent. Spider saw the obvious connection I'd missed: wire them together, and knowledge transfer becomes automatic.

### S9: Worktree Detection + Semantic Trie = Auto-Namespaced Identities

\`\`\`
PREMISE A: Worktree detection identifies the current git branch
and worktree ID at daemon startup.

PREMISE B: The semantic trie indexes identities with colon-segment
namespacing: project:stack:context.

THEREFORE: When pd claim myapp:api is called from a linked worktree
(branch feature/auth), the daemon auto-resolves it to
myapp:api:feature-auth. Agents on different branches
cannot accidentally collide on ports.

CONFIDENCE: high | EFFORT: medium
\`\`\`

This solved a problem we'd been fighting for weeks --- worktree agents colliding on ports. The solution was already there, implicit in the intersection of two features.

### S10: Spawner + Pheromone = Reputation-Based Backend Selection

\`\`\`
PREMISE A: The spawner selects agent backends by explicit flag,
with no awareness of past performance.

PREMISE B: The pheromone system allows agents to spray quality
signals onto completed agent identities.

THEREFORE: pd spawn can use accumulated quality signals to
auto-select the best-performing backend for a given task.
High-quality agents get promoted to Opus. Low-quality
agents get demoted to Haiku.

CONFIDENCE: medium | EFFORT: medium
\`\`\`

This is the reputation system from Phase 2 of the roadmap, bootstrapped entirely from Phase 0 and Phase 3 infrastructure that already ships. No new modules needed. Just connecting what exists.

## The Loop

Here's what makes this more than two independent agents:

\`\`\`mermaid
graph LR
    Spark["Spark\\n(proposes ideas)"] -->|spark:idea| Spider["Spider\\n(finds connections)"]
    Spider -->|spider:connections| Spark
    Spider -->|spider:connections| QA["QA\\n(validates)"]
    Spark -->|spark:idea| Documentarian["Documentarian\\n(records)"]
\`\`\`

Spark reads Spider's connections and proposes implementations. Spider reads Spark's ideas and finds more connections. The ideas compound. Nobody orchestrates this --- it emerges from the pub/sub topology.

This is [stigmergic coordination](https://en.wikipedia.org/wiki/Stigmergy). No central planner. No shared memory. No meetings. Just agents leaving traces for other agents to find. Ant colonies use it. Wikipedia uses it. Now your dev environment can too.

## What I Found in the Morning

After one night of Spark + Spider running:

- **2 Spark ideas** --- one for pheromone CLI (the missing UI for the stigmergic engine), one for auto-inbox salvage briefing (from Spider's S2)
- **10 Spider syllogisms** --- connecting features across the codebase in ways I hadn't considered
- **3 of those syllogisms** rated as "high confidence, small effort" --- meaning I could implement them in a single session each

Total API cost: about $0.40. Total human effort: zero (until review).

The fleet doesn't replace me. It generates options. I choose which to build. But the options are better than what I'd come up with alone, because Spider sees combinations that are invisible when you're heads-down writing code.

## Running It Yourself

\`\`\`bash
# The fleet is declared in pd-fleet.yml
pd fleet up

# Watch the creative loop in real-time
pd watch spark:idea --exec 'echo "Spark: $PD_MESSAGE_CONTENT"' &
pd watch spider:connections --exec 'echo "Spider: $PD_MESSAGE_CONTENT"' &

# Or just check in the morning
ls .spark/ideas/
ls .spider/connections/

# Read what they found
cat .spider/connections/$(ls -t .spider/connections/ | head -1)
\`\`\`

The fleet runs while you sleep. Spark dreams. Spider connects. The codebase gets better on its own.

---

### Further Reading
- [Fleet Management](/blog/fleet-management) --- How to declare and run your fleet
- [The Pheromone Trail](/blog/pheromone-trail) --- Stigmergic coordination for AI agents
- [Fleet documentation](/docs) --- Full YAML schema and fleet CLI commands
- [Pub/Sub for Your Dev Environment](/blog/pubsub-self-healing-pipeline) --- The messaging layer that carries the creative loop
    `
  }
];
