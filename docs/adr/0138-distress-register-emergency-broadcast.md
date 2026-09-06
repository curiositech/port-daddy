# 0138. The Distress Register — an emergency broadcast system that works when Port Daddy doesn't

## Status

Proposed — 2026-09-05, written during the repo-wide Port Daddy halt, without Port Daddy.

## Context

On 2026-09-05 the operator halted Port Daddy after a spend spike. The halt exposed
four failures that are one failure:

1. **The halt could not be broadcast.** The only mechanism for telling every agent
   "stop" was Port Daddy itself — the thing being stopped. The operator fell back to
   editing `~/.claude/CLAUDE.md` and telling agents in chat, one at a time.
2. **The halt did not stop everything.** After "all-stop," six more `port-daddy`
   processes were found in Activity Monitor. `launchctl disable` was applied to some
   labels, but the daemon has at least three independent supervisors
   (`com.portdaddy.daemon`, `homebrew.mxcl.port-daddy`, `com.portdaddy.bosun`) plus
   dev/test variants, each with its own KeepAlive belief, and the in-process
   "already running" guard is a *probe* (`lib/daemon-takeover.ts`), not an atomic
   lock — two supervisors that probe at the same instant both start.
3. **The enforcement organ could not tell "off" from "broken."** The Coordination
   Guard git hook classifies `daemon-unreachable` as a structural emergency and
   escalates ("COORDINATION LAYER DOWN — a human should repair the daemon") even when
   the daemon is unreachable *because the operator turned it off on purpose*
   (`cli/commands/guard.ts:695`). ADR-0137 names this exact conflation.
4. **Nobody could see who was fixing what.** With coordination gone, agents could not
   discover whether an incident was already owned, so several re-diagnosed the same
   root causes in parallel — the spend multiplier ADR-0137 describes.

This is the classic outage shape. Facebook's October 2021 outage: DNS, the internal
tools, and even the data-center badge readers all depended on the network that was
down, so engineers were physically locked out of the buildings they needed to enter
to fix it. AWS's February 2017 S3 outage: the AWS Service Health Dashboard stored its
assets on S3 in the affected region, so for two of the four hours AWS could not update
its own status page and fell back to Twitter. The lesson is identical each time:
**the channel you use to say "I am broken" and the tools you use to fix it must not
depend on the thing that is broken.**

Maritime signalling solved this a century ago and wrote it down. The International
Code of Signals lists fourteen distress encodings — gun, foghorn, red star shells,
SOS, MAYDAY, the NC hoist, square-flag-and-ball, flames, red flare, orange smoke,
arm-waving, radiotelegraph alarm, radiotelephone alarm, EPIRB — not because a ship
needs fourteen ways to say the same thing, but because **any single transport can be
down**, and the set is chosen so at least one survives any given failure. GMDSS then
layered the modern radio system by *reach*: Sea Area A1 (VHF, in sight of a coast
station), A2 (MF, ~150 nmi), A3 (satellite), A4 (HF, polar) — with mandatory minimum
equipment per area, and an EPIRB everywhere as the floor. This ADR ports that
discipline, not the flags.

## Decision Drivers

- The repair path must not depend on the broken thing (Facebook). Each fallback tier
  must be strictly independent of every tier above it.
- The status channel must live on independent infrastructure (AWS). "Who is fixing
  me" cannot live in the Port Daddy DB.
- Tiers by reach, with mandatory carriage (GMDSS). Every entity MUST implement the
  floor tier; nothing may opt out of the EPIRB.
- Distress is a predicate, not an intensity knob (ICOS). False MAYDAY erodes the one
  channel every real emergency depends on; misuse is a protocol violation.
- A halt is a *mode* and needs explicit, acknowledged enter/exit brackets (ICOS
  `WM`/`WO`). A line in a Markdown file that agents may or may not have loaded is not
  a bracket.
- When distress is declared, someone takes the floor and everyone else goes quiet
  (`SEELONCE MAYDAY`). For an agent fleet, "quiet" means **stop spending** — this is
  the mechanism that would have bounded the incident that caused the halt.
- Two-phase acknowledgement (answering pennant at the dip / close up): "I saw the
  halt" is a different state from "I have complied with the halt," and the dangerous
  state is delivered-but-not-complied.
- A conversation without an agreed termination is not over, it is abandoned.
  Orphan processes, dangling claims, and phantom merges are abandoned conversations.
  All-clear must be explicit, and only the operator may issue it.

## Considered Options

- **A. Make Port Daddy more reliable so it never needs an out-of-band channel.**
  Rejected on principle: no reliability level removes the need. Facebook and AWS had
  reliability budgets larger than this project will ever have.
- **B. One out-of-band channel (e.g. a GitHub issue).** Better than nothing, but GitHub
  was itself rate-limited during this incident and the relay was dead-lettering.
  A single fallback is a single point of failure one hop further out.
- **C. A registered, tiered distress system with mandatory carriage and a
  controlling-station rule.** The GMDSS shape. Chosen.

## Decision

Adopt **C**: the **Distress Register**. It has five parts — a *registry* of meanings, a
*ladder* of channels ordered by what still works, an *ontology* of entities each with a
published procedure, a *floor-control* rule, and *drills*.

### 1. The registry: four classes, one small code table

Meanings are registered, not composed. Every distress message carries exactly one class
and one code. Free prose is allowed only in a trailing, non-load-bearing field.

| Class | Meaning | Who may raise it | Preempts |
|---|---|---|---|
| `MAYDAY` | This entity is in grave condition **and** needs another actor to intervene now: split-brain, data corruption, runaway spend, cannot stop itself. | Any entity | Everything. Imposes `SEELONCE` on uninvolved entities. |
| `PAN PAN` | Degraded, not yet grave: unreachable dependency, retrying, half-alive, cannot verify its own state. May self-recover. | Any entity | Routine traffic. |
| `SECURITE` | Safety notice, not a fault: **halt in effect**, maintenance mode, deploy in progress, drill in progress. | Operator; daemon on operator's behalf | Nothing, but every entity must *read* it. |
| `ROUTINE` | Nominal heartbeat. | Any entity | Nothing. |

Codes (the "two-letter groups" — extend only through this ADR's registry, never ad hoc):

| Code | Class | Complete meaning |
|---|---|---|
| `HALT` | SECURITE | Coordination is intentionally stopped. Do not start, restart, or resurrect anything. Enter listening watch. |
| `ALL-CLEAR` | SECURITE | Halt lifted. **Only valid when signed by the operator** (see §4). |
| `DRILL` | SECURITE | A drill is in progress; treat what follows as real for procedure, false for consequence. |
| `SPLIT-BRAIN` | MAYDAY | More than one instance of the same berth is alive. |
| `SPEND-RUNAWAY` | MAYDAY | Spend rate or count exceeds the envelope. |
| `CORRUPT` | MAYDAY | Durable state failed integrity checks. |
| `CANNOT-STOP` | MAYDAY | Entity received HALT and could not comply. |
| `UNREACHABLE` | PAN PAN | A required peer does not answer on any tier the entity can reach. |
| `HALF-ALIVE` | PAN PAN | Some interfaces answer, others don't (socket ok, TCP dead). |
| `UNVERIFIED` | PAN PAN | Entity is running but cannot prove its own state (e.g. DB read failed). |
| `TAKING-FLOOR` | control | "I am fixing `<target>`." Exactly one per target; second claimant must stand down. |
| `STANDING-DOWN` | control | Releasing the floor. |
| `SEEN` | control | Two-phase ack, phase 1: I have read message `<id>`. |
| `COMPLIED` | control | Two-phase ack, phase 2: I have acted on message `<id>`. |
| `LISTENING` | ROUTINE | Periodic watch-keeping check-in during a halt (proves the entity is reading, not spending). |

Wire format — one line, append-only, no multi-line records:

```
<iso8601-utc> <kind>:<id> <CLASS> <CODE> [k=v ...] [-- free text]
```

```
2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend-runaway ref=docs/incidents/2026-09-05-port-daddy-halt.md
2026-09-05T14:02:40Z agent:claude-code:ranking-shadow SEEN ref=2026-09-05T14:02:11Z
2026-09-05T14:02:41Z agent:claude-code:ranking-shadow COMPLIED ref=2026-09-05T14:02:11Z
2026-09-05T14:03:00Z daemon:prod MAYDAY SPLIT-BRAIN pids=812,9944 port=9886
2026-09-05T14:05:12Z operator:erich TAKING-FLOOR target=daemon:prod
```

### 2. The ladder: channels by what still works

Ordered like GMDSS sea areas. An entity raising distress works **down** the ladder
until something answers; an entity listening works **up** it. Every tier is chosen to
be independent of the tiers above it — the whole point.

**Area A0 — the floor. Mandatory carriage. Works with nothing else running.**

1. **The Distress File.** `~/.port-daddy/DISTRESS` (machine-wide) and
   `<repo>/.portdaddy/DISTRESS` (repo-scoped), append-only, `O_APPEND` writes so
   concurrent appends never interleave. Any entity writes its line; any entity reads
   the whole file. Needs no daemon, no network, no git, no Node — a shell `printf >>`
   suffices. This is the EPIRB: it is not allowed to be absent.
2. **The Halt Sentinel.** `~/.port-daddy/HALT` — a file whose *existence* is the
   signal (a hoisted flag). Contents: the `SECURITE HALT` line. Checkable by
   `test -f`. This is what every supervisor, the Coordination Guard, the reaper, and
   the resurrection sweep consult before acting. Its absence is not "all clear" (see
   §4) — its absence is merely "no halt hoisted."
3. **The berth lock.** One `flock(2)` per berth on `<data-dir>/berth.lock`, held for
   the life of the process, released by the kernel on *any* death. Not a broadcast —
   it is what makes "exactly one of me" true with no coordination at all.
4. **Last words on stderr.** Every entity that dies on purpose or catches a fatal
   error prints one registry-format line to stderr before exiting — the flames on
   the vessel, visible to whoever is watching the console or the log.

**Area A1 — same machine, no daemon required.**

5. Unix-socket `/health` probe (already exists; a heartbeat, not a lock).
6. `launchctl print` — the truth about which supervisors are loaded, readable
   without Port Daddy.
7. Daemon and supervisor log files under `~/.port-daddy/logs/` — append-only by
   nature, tail-able.
8. macOS notification via `osascript` — reaches the operator at this machine (the
   guard already uses this for HITL escalation).
9. The git repository itself — a registry-format commit on a dedicated
   `distress/<entity>` branch, or a line appended to `.portdaddy/DISTRESS` and
   committed. Local-first, works offline, and every agent already has it.
10. Lock files as read-only status: "is berth X alive?" is answered by trying the
    flock non-blocking, no RPC involved.

**Area A2 — same harbor, daemon up. Routine traffic lives here.**

11. `pd note` / inbox / `pd attention` — the normal channel. **Unavailable during a
    halt by definition**; nothing in Areas A0–A1 may depend on it.
12. `/health` with a state vocabulary — `nominal | degraded | halted` and the
    current distress class — not merely 200 vs 503.
13. Read-only direct access to the daemon's SQLite file. The DB is a channel
    independent of the daemon *process*: an agent can read sessions and claims with
    `sqlite3 -readonly` even when the RPC is dead.

**Area A3 — cross-machine and cloud.**

14. The relay (portdaddy.dev) — the coast station; carries distress across
    harbors. It was dead-lettering during this incident, so it is a tier, not the
    floor.
15. **A pinned GitHub issue as the status board** (`Port Daddy: status`). Readable
    and writable with plain `gh`, independent of relay, daemon, and `pd`. No merge
    queue, no CI, no check runs can deadlock it. This is where `TAKING-FLOOR` lives
    for cross-machine incidents — the AWS-status-page-on-Twitter move.
16. GitHub check-run titles carrying `VERDICT` / `INFRA` / `DEFERRED` (ADR-0137) —
    the fleet's own distress encoding, one per PR.
17. **A scheduled GitHub Actions workflow as the independent observer.** Every N
    minutes it probes the relay and posts state to the pinned issue. CI runs when
    everything of ours is dead; it does not need the ship's power.
18. A direct operator off-machine path — push notification, e-mail, or SMS —
    routed through the Cloudflare worker or CI, **never through the daemon**, so it
    works during a halt.
19. FleetBar / pd-console hoisting the distress flag (`NC`, or the square flag and
    ball) — for the operator at the bridge.

**Area A4 — everything is down. Last resort.**

20. **Bridge-to-bridge: the operator tells agents directly in chat.** This is what
    actually happened. Make it a *registered* procedure with a fixed, unmistakable
    opening so an agent recognises it without parsing — the orange canvas with the
    black ball and square. Proposed: a message beginning `SECURITE HALT` on its own
    line. The `~/.claude/CLAUDE.md` halt block is the written form; it stays.
21. **Physical intervention.** The operator kills processes and disables labels by
    hand — Facebook's "send engineers to the data center." The exact commands are
    the last-resort runbook in `docs/incidents/2026-09-05-port-daddy-halt.md`; that
    document is the A4 tier and must never assume anything above A0 is working.
22. **Silence as signal.** No heartbeat for N intervals is presumed distress — the
    EPIRB that activates on immersion. The reaper already does this, but it
    currently *resurrects* the silent, which is precisely wrong during a halt: silence
    during `HALT` must not trigger resurrection. Resurrection consults the sentinel.
23. **Smoke and dye: durable evidence for later.** When an entity cannot call for
    help it still leaves marks: transcript, receipt, the security-forensics journal
    (ADR-0089). Write your last state before you die.
24. **Listening watch.** GMDSS mandated silence periods twice an hour so that weak
    distress calls could be heard. Every long-running entity performs an
    unconditional periodic check of the sentinel and distress file — on a timer, not
    on a trigger — so a halt is noticed even by an agent that has heard nothing
    since it started. The Giant Squid hook tentacles are the natural place for this
    on the agent side.

Twenty-four rungs. The number is not the point; the independence between adjacent
rungs is.

### 3. The ontology: who can be in distress, and what each must carry

| Entity | Sea area | Detects distress by | Must raise on | Must listen on | On `SEELONCE` (halt) |
|---|---|---|---|---|---|
| **Operator** (the sovereign) | A4 | Bill, Activity Monitor, gut | A4 chat, A0 sentinel, A3 pinned issue | A3 pinned issue, A0 distress file | Takes the floor. Sole issuer of `ALL-CLEAR`. |
| **Daemon** (one per berth) | A0–A3 | Berth lock contention, DB integrity, health self-probe | A0 file + stderr, A1 socket state, A2 `/health`, A3 relay | A0 sentinel **before every supervisor-facing action** | Refuses to start; if running, enters `halted` state, stops sweeps, answers `/health` with `halted`. |
| **Supervisors** (launchd labels, brew, bosun) | A0–A1 | Repeated child death | A0 stderr last words | **A0 sentinel before every (re)launch** | Do not relaunch. Period. This is the rung that was missing. |
| **Coordination Guard** (git hook) | A0 | `daemon-unreachable` | — | A0 sentinel | Enters its legible `off` state with one calm line, exits 0. Never escalates a halt as an emergency. |
| **Agents** (Claude Code, Codex, Gemini, agy sessions) | A0–A2 | Cannot reach daemon; receives `SECURITE HALT` | A0 file, A1 git, A3 issue | A0 sentinel + file on a **listening watch**, A4 chat | `SEEN` then `COMPLIED`. Stop spending: no subagents, no fleet, no retries. Work solo or wait. |
| **Fleet ships** (purser, reviewers — Cloudflare) | A3 | Sandbox/queue death | A3 check-run `INFRA` title, relay | A3 pinned issue (poll) | Post `INFRA`, never `VERDICT`. Do not retry model calls. |
| **Relay** (portdaddy.dev) | A3 | Queue depth, DLQ rate | A3 pinned issue via CI observer | A3 pinned issue | Stops enqueueing fleet runs; still forwards distress. |
| **Harbor** (trust boundary) | A2–A3 | Member reports | Relay | Relay | Propagates `HALT` to members as `SECURITE`. |
| **SDK / MCP server** | A0–A2 | Transport errors to daemon | Structured error `retryable:false` + registry code | A0 sentinel on every call | Returns `HALT` to the caller instead of retrying. Never silently degrades to "clean." |
| **Operator surfaces** (FleetBar, pd-console) | A1–A3 | Health poll | Visual hoist | A0 file, A2 health, A3 issue | Show the flag. Disable every "start/restart" affordance. |
| **Steward / always-on agents** | A0–A3 | Same as agents | Same as agents | Listening watch, mandatory | Freeze the burn envelope to zero; keep the lights-on watch only. |
| **CI** (GitHub Actions) | A3 | — (it is the observer) | A3 pinned issue | — | Keeps probing. Its independence is its value. |

Two rules the table encodes that were violated during the incident:

- **Supervisors must check the sentinel before relaunching.** A KeepAlive that
  ignores the halt is the mechanism by which "all-stop" produced six processes.
- **Helpers must not impersonate the daemon.** `port-daddy` in Activity Monitor must
  mean the daemon. Bosun, FleetBar, appwatch, freshness, and backup get distinct
  process titles. Six identical rows made the true count unknowable at exactly the
  moment it mattered.

### 4. Floor control and the all-clear

When any entity raises `MAYDAY`, or the operator raises `SECURITE HALT`:

1. **`SEELONCE`.** Every entity not involved stops routine traffic. For agents that
   means: no new subagents, no fleet triggers, no retries against the dead thing,
   no speculative work. Listening watch only. This is the spend bound.
2. **One controlling station.** The first `TAKING-FLOOR target=<x>` wins; a second
   claimant writes `STANDING-DOWN` and waits. Contention is resolved by the append
   order in the distress file — the file is the tie-breaker precisely because it is
   the floor.
3. **Two-phase ack is mandatory for `HALT`.** `SEEN` within one listening interval;
   `COMPLIED` when the entity has actually stopped. An entity that has `SEEN` but not
   `COMPLIED` after two intervals is itself in `PAN PAN CANNOT-STOP` — and that is a
   real signal, not noise.
4. **`ALL-CLEAR` is operator-only and signed.** The distress file is writable by any
   entity, which is correct for raising distress and catastrophic for lifting a halt:
   a runaway agent must not be able to end its own halt by appending a line. The
   `ALL-CLEAR` record therefore carries a signature over `(ALL-CLEAR, halt-ref, ts)`
   made with the operator's harbor key (ADR-0013/0014 already mint ed25519 harbor
   tokens); every listener verifies it and ignores an unsigned or mis-signed
   all-clear as a `MAYDAY`-class protocol violation. The halt order's own text —
   "no agent may lift it" — becomes enforceable rather than aspirational.
5. **Misuse is a violation.** A `MAYDAY` without the grave-and-immediate predicate,
   or a forged `ALL-CLEAR`, is logged to the forensics journal and raised as
   `pd feedback` severity high. False distress is how the channel dies.

### 5. Drills

GMDSS requires drills because an untested distress procedure is a wish. Quarterly at
minimum, and after any change to a supervisor or the guard: kill the daemon hard,
raise `SECURITE DRILL`, and verify that every entity in §3 (a) noticed within its
listening interval via a tier it actually implements, (b) wrote `SEEN`/`COMPLIED`, (c)
did not relaunch anything, and (d) resumed only on a signed `ALL-CLEAR`. A drill that
finds an entity depending on a higher tier than it claims to carry is a failed drill.

## Rationale

**Why a file is the floor, and not a socket, a DB, or an HTTP endpoint.** Every one
of those is a *process* with a lifecycle that can be the thing that failed. A file is
the only channel whose availability is a property of the machine, not of any of our
code. `O_APPEND` gives atomic appends across concurrent writers without a lock. The
Facebook lesson in one sentence: the badge reader was a service; the door should
have had a key.

**Why existence-as-signal for the sentinel.** A flag hoisted is unambiguous at any
distance and needs no decoder. `test -f` is the cheapest possible check, which means
supervisors and hooks will actually run it on every action instead of "usually."

**Why a signed all-clear.** Because the halt that motivated this document was
triggered by agents spending money faster than the operator could stop them, and a
halt any agent can lift is not a halt. The signature is the difference between
"no agent may lift it" as a rule in a Markdown file and as a property of the system.

**Why `SEELONCE` is the important part.** Twenty-four channels for saying "help" are
worth nothing if the response to "help" is twenty more agents each starting an
investigation. The controlling-station rule and the spend freeze are what convert a
broadcast into a *bound*. The maritime rule exists for the same reason: a distress
frequency jammed by helpful chatter is a frequency on which nobody is rescued.

**Why drills.** Because every one of the twenty-four rungs above will silently rot
into depending on a rung above it unless something pulls the daemon on purpose and
watches what breaks. This document's own accuracy has a half-life without them.

### Critical Decision Method sweep: this incident as the elicitation case

Applied to the 2026-08-10 → 2026-09-05 sequence, the cues an experienced responder
used and a novice would have missed — recorded so the registry encodes them:

| Cue | Novice reading | Expert reading | What the registry does with it |
|---|---|---|---|
| A red `Port Daddy Fleet` check | "My PR is wrong." | "Did a ship *decide*, or did the pipeline *die*?" | `INFRA` vs `VERDICT` titles (ADR-0137); `PAN PAN UNVERIFIED`. |
| `state: MERGED` on a PR | "It shipped." | "Merged into *what*? Check `baseRefName`." | Phantom-merge notice (PR #7186); `COMPLIED` requires the terminal state, not the transitional one. |
| Six `port-daddy` rows after all-stop | "Six daemons." | "Six *processes named* port-daddy — which are daemons, which are helpers, which supervisor spawned each?" | Distinct process titles; berth lock makes the count provable; sentinel makes relaunch impossible. |
| Guard says "COORDINATION LAYER DOWN, escalating" | "Something is badly broken." | "Unreachable because *I turned it off*. The guard can't tell." | Guard consults the sentinel; `HALT` routes to the legible `off` state. |
| Same root cause found by five agents | "Thorough." | "Five agents spent five budgets on one diagnosis because none could see the others had it." | `TAKING-FLOOR` + `SEELONCE`. |
| The halt arrived as a chat message | "Noted." | "This is the only channel that worked. It must become a registered one." | Registry-format opening for A4 bridge-to-bridge; sentinel as the machine twin. |

What-if probes the sweep raised, now design constraints: *What if the sentinel is
deleted by an agent?* — the sentinel's absence is not all-clear; only a signed
`ALL-CLEAR` is. *What if the distress file fills with noise?* — misuse is a
violation; `ROUTINE` lines go to the log, not the file. *What if GitHub is down
too?* — A0 and A1 do not need it; that is why they exist.

## Implementation Matrix

<!-- ADR-0043 matrix. Roadmap wiring (`pd adr sync`) deliberately deferred until the
     halt is lifted; do not run pd to wire this up. -->

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0138-phase-0-floor | now | — | `lib/distress.ts` + a dependency-free `bin/pd-distress` shell script implementing the registry line format, `O_APPEND` writes to the distress file, and sentinel read/write. Coordination Guard, reaper, and resurrection consult the sentinel and take the legible `off` path. Unit + subprocess tests; no daemon started. |
| 1 | adr-0138-phase-1-berth-singleton | now | — | Per-berth `flock` in a single shared launch entry point that every path (launchd, brew, bosun, `pd start`, `pd dev up`, tests) must use; loser exits 0 quietly. Distinct process titles for helpers. A supervisor registry + `pd all-stop` (also runnable as a plain script) that disables *every* label. Concurrency test: N simultaneous starts → exactly one survivor; dev + prod berths coexist. |
| 2 | adr-0138-phase-2-status-board | now | 0 | Pinned GitHub status issue + scheduled Actions observer that probes relay/daemon and posts registry-format state. Independent of `pd` entirely. |
| 3 | adr-0138-phase-3-listening-watch | backlog | 0 | Giant Squid tentacles check sentinel + distress file each turn (agents); daemon and steward run a timer-based watch. `SEEN`/`COMPLIED` emitted automatically. |
| 4 | adr-0138-phase-4-signed-all-clear | backlog | 0 | `ALL-CLEAR` signed with the operator's harbor key; all listeners verify; forged/unsigned all-clear raised as a violation. |
| 5 | adr-0138-phase-5-relay-and-fleet | backlog | 0, 2 | `/health` state vocabulary; relay stops enqueueing on `HALT`; fleet check titles per ADR-0137; operator off-machine path not via daemon. |
| 6 | adr-0138-phase-6-drills | backlog | 1, 3 | Scripted drill: hard-kill daemon, raise `DRILL`, assert every entity's `SEEN`/`COMPLIED`/no-relaunch within interval. Run quarterly and on every supervisor/guard change. |

## Consequences

### Positive
- A halt becomes a property of the machine (a file, a lock, a signature) instead of a
  request to each agent's good behaviour.
- "Who is fixing this" is discoverable with no coordination layer, which is the
  single biggest lever on the spend multiplier ADR-0137 identifies.
- The six-processes failure becomes impossible rather than merely detected: the lock
  makes a second instance exit, and the sentinel makes a supervisor not try.
- The Coordination Guard, the reaper, and resurrection get an honest `off` state,
  closing the ADR-0137 conflation at three more sites.

### Negative
- Mandatory carriage means every entity — including ones not yet written — owes A0.
  That is a real tax, paid in every new supervisor and hook. It is the price.
- A signed all-clear puts a private key in the operator's hands and a verification
  step in every listener; key loss becomes a halt that cannot be lifted without the
  A4 runbook. Acceptable: that is the correct failure direction.
- Drills cost operator time and will occasionally find that something depended on a
  higher tier than it claimed. That is the drill working.

### Neutral
- This ADR does not make Port Daddy fail less. It makes failure sayable, hearable,
  and bounded. Reliability work continues separately, and this document is what
  protects the budget while it does.
