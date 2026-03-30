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
  }
];
