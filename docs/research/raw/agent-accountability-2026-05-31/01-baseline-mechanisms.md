# Baseline Mechanisms — the common answers (17)

## 1. Graduated Sanctions Ladder (warning -> attenuation -> rate-limit -> suspension -> dismissal, with a redemption path)

- **Source:** Ostrom Principle 5 (graduated sanctions; first offense is a warning not exile; explicit escalation ladder; rehabilitation path) + game-theoretic-agent-incentives graduated trigger (punish K rounds then forgive; NEVER grim trigger; distinguish crash from defection)
- **Novelty:** common-baseline
- **How it compels responsibility:** A binary allow/deny regime is an 'exile state' that makes agents fear ambitious work, and a grim trigger turns one transient OOM-kill into permanent mutual defection. A graduated ladder makes responsibility OWNABLE over time: a missed deadline costs reputation and access scope proportionally, but a clean streak restores standing. The agent is accountable for a trajectory, not a single moment — it carries forward the consequences of past behavior and can repair them, which is exactly what 'owning an obligation' means.
- **Formal core:** 5 tiers: (1) REPUTATION MARK (logged, visible next heartbeat), (2) ATTENUATION (write revoked, read-only remains), (3) RATE LIMITING (slower allocation), (4) SUSPENSION (session ends, bonds held, must re-register), (5) DISMISSAL (permanent, bond liquidated) — reserved for repeated/egregious only. Redemption: serve suspension + N clean sessions -> sanction reduced. Game-theoretic backing: graduated trigger requires K defections in N rounds before punishing (noise tolerance); crashed agents (salvage queue, involuntary) are NOT punished as defectors (active session + conflicting claims, voluntary). Equilibrium holds for delta >= 0.53 under 3-round graduated punishment.
- **Port Daddy mapping:** Maps onto the EXISTING stale(10min)->dead(20min)->salvage progression in lib/agents.ts, which is already constructive (preserves work) rather than punitive — extend it from a liveness ladder into a behavioral sanctions ladder driven by settlement outcomes. Arbiter issues tier transitions; actor-soul/reputation stores the streak counter and redemption state.

## 2. Accountable Monitoring on Immutable Evidence (the audit trail is the observability that makes claims credible)

- **Source:** Ostrom Principle 4 (monitors accountable to the monitored / are the appropriators; immutable evidence trails; reject the Panopticon where the daemon logs everything and agents see nothing) + game-theory Step 5 'why observable history is load-bearing' (remove immutable notes -> deviation undetectable -> game collapses to one-shot defection)
- **Novelty:** common-baseline
- **How it compels responsibility:** Responsibility requires that breaking a commitment be DETECTABLE by the parties who relied on it — otherwise reputation cannot form and the folk theorem's punishment is uncredible. Ostrom adds the symmetric requirement: monitoring must be queryable BY the agents, not just by the operator, or it is surveillance not governance. Together they make the obligation owned-in-public: every claim, edit, heartbeat, and settlement is an immutable, mutually-inspectable fact, so an agent's track record literally is its accountability surface.
- **Formal core:** Append-only, tamper-evident activity log + immutable session notes (cannot be edited/deleted). Predicate for credible deviation-detection: for every commitment C made by A to B, B must be able to observe (claim, edit-to-claimed-file, missed-deadline) via a query any agent can run. Folk theorem dependency: cooperation payoff sustained iff history observable AND identity persistent (no free re-registration / Sybil). Daemon self-monitoring: health + state endpoints queryable by any agent ('who watches the daemon' must resolve to 'the agents do').
- **Port Daddy mapping:** Already implemented and load-bearing: PD notes are immutable by design (lib/sessions.ts), activity log queryable via GET /activity, daemon health via GET /health. This is the foundation the other mechanisms stand on. The gap to close: ensure settlement/sanction decisions are themselves logged with reasoning to the same immutable trail (arbiter transparency).

## 3. Arbiter — runtime invariant enforcement

- **Source:** lib/arbiter.ts, createArbiter() — six rules (PID_SQUATTING, CAP_ESCALATION, NOTE_MONOTONICITY, ESCROW_POSITIVE, LOCK_OWNER_VALID, HEARTBEAT_FRESHNESS) mapped to a BondedCommons TLA+ spec
- **Novelty:** common-baseline
- **How it compels responsibility:** Subscribes to the activity log and checks every state transition; in strictMode a 'critical' violation triggers system.man_overboard (salvage). It makes an agent answerable for the validity of each transition AT THE MOMENT it happens, but it has no memory of who violated before and no ongoing obligation — it is a tripwire, not a leash.
- **Formal core:** activityLog.subscribe(entry => switch(entry.type){SERVICE_CLAIM→checkPidSquatting; LOCK_ACQUIRE→checkLockOwnerValid+checkCapEscalation; SESSION_NOTE→checkNoteMonotonicity; SESSION_START→checkEscrowPositive; AGENT_HEARTBEAT→checkHeartbeatFreshness}). recordViolation() always logs security.violation; if config.strictMode && severity==='critical' it logs system.man_overboard. CAP_ESCALATION degrades to advisory when the Rust FFI enforcer is absent; ESCROW_POSITIVE degrades when bonds module not injected.
- **Port Daddy mapping:** lib/arbiter.ts (subscribes to lib/activity.ts; emits via activityLog.log)

## 4. Coordination Guard — staged-file claim gate (pre-commit)

- **Source:** cli/commands/guard.ts + lib/coordination-gates.ts config types; CoordinationGuardMode = 'off'|'warn'|'enforce'; GuardCheckResult.shouldBlock
- **Novelty:** common-baseline
- **How it compels responsibility:** Before a commit, evaluates active session file-claims against the staged files and refuses (shouldBlock=true) in enforce mode when another live session owns an affected file. Compels an agent to respect others' announced edit surface — but only at commit time, and only against claims that are themselves live; a dead claim leaks the surface.
- **Formal core:** readGuardConfig() merges shared+local .portdaddy/coordination-guard.json → {enabled, mode:'warn'|'enforce', requireSession, requireClaims}. guard check --staged collects staged paths, joins against active session_files owners, returns GuardViolation[] with owners[]; shouldBlock = (mode==='enforce' && violations.length>0). Installs a pre-commit hook between HOOK_START/HOOK_END markers.
- **Port Daddy mapping:** cli/commands/guard.ts, lib/coordination-gates.ts, .portdaddy/coordination-guard.json, routes/operator.ts

## 5. Coordination Route Guard — adversarial-project envelope perimeter

- **Source:** lib/coordination-route-guard.ts — checkAdversarialProjectWrite / checkAdversarialTupleFields / checkAdversarialProjectRead
- **Novelty:** common-baseline
- **How it compels responsibility:** For redteam-review/whitehat-defense projects the daemon refuses plaintext writes to /notes, /msg, /tuples and refuses cross-fleet reads. Holds agents accountable to an encryption contract at the request perimeter — but it is a stateless allow/deny per request, not an ongoing duty.
- **Formal core:** ADVERSARIAL_PROJECTS=Set{redteam-review,whitehat-defense}. For those projects: body must carry valid `envelope` (daemonAcceptsEnvelopeFor) AND must NOT carry PLAINTEXT_SMUGGLE_FIELDS=[payload,content,message] (else 403). Read side gates on requesterPersona prefix (redteam:/defense:); null persona = no-op back-compat.
- **Port Daddy mapping:** lib/coordination-route-guard.ts (complements lib/coordination-crypto.ts / coordination-acl.ts)

## 6. Bond escrow + slash + commons pool

- **Source:** lib/bonds.ts, createBonds() — states escrowed→running→exiting→refunded|slashed; conservation invariant wallet+escrow+commons=supply
- **Novelty:** common-baseline
- **How it compels responsibility:** Before an expensive spawn the caller must escrow a bond (debit wallet→escrow); clean exit refunds, violation slashes part into a COMMONS pool that funds audit/recovery. This is the strongest existing 'own your action' primitive — money is at stake — but the obligation it bonds is binary (exit clean vs breach) and resolves the instant the body exits; nothing keeps the bond alive against a deadline or a promised deliverable.
- **Formal core:** escrow(): tx{ if balance<bondUsd throw 'insufficient-balance'; debit wallet; INSERT bond_escrow state='escrowed' } gated by optional harbor membership + ceilingUsd. markRunning(); refund()=credit wallet+state='refunded' (idempotent); slash(id,portionUsd,reason)= clamp portion to [0,bondUsd], refund remainder to wallet, send slashAmount to commons_pool_usd, state='slashed', reason encrypted at rest. conservation(project) asserts wallet+activeEscrow+commons==supply.
- **Port Daddy mapping:** lib/bonds.ts (tables project_wallets, bond_escrow; broadcasts bond:lifecycle)

## 7. Budget Guard — admission + back-pressure (throttle/kill)

- **Source:** lib/budget-guard.ts, createBudgetGuard() — canSpawn() pre-flight, onCharge() mid-flight, arms kill_armed_at
- **Novelty:** common-baseline
- **How it compels responsibility:** Refuses spawns that can't afford their worst case (canSpawn), and as spend accrues escalates throttle@80%→kill@100% with kill arming idempotently for the UTC day. Holds an agent to a spend ceiling continuously — the closest thing to an ongoing monitor in the codebase — but it watches only one dimension (USD/day) and the only sanctions are throttle and SIGTERM+bond-slash.
- **Formal core:** budget_ledger PK(project,agent_id,day). canSpawn: refuse if kill_armed OR budget<=0 OR spend+estimated>budget. onCharge: UPSERT spend+=usd; pct=spend/budget; kill=pct>=killThreshold(1.0), throttle=pct>=throttleThreshold(0.8); arm kill_armed_at once/day and emit 'kill' on budget:decisions; caller acts (spawner.terminate + bonds.slash).
- **Port Daddy mapping:** lib/budget-guard.ts (table budget_ledger; broadcasts budget:decisions)

## 8. Resurrection — heartbeat staleness/death detector

- **Source:** lib/resurrection.ts check() — sinceHeartbeat vs adaptive stale/dead thresholds; emits agent:stale / agent:dead
- **Novelty:** common-baseline
- **How it compels responsibility:** Detects agents that stop heartbeating and queues them for salvage; Arbiter's agent:dead handler logs a HEARTBEAT_FRESHNESS warning. Compels liveness (keep proving you're alive) but it is the ONLY temporal obligation in the system and it is about process aliveness, never about whether the agent did what it claimed it would do.
- **Formal core:** check(agent): sinceHeartbeat=now-lastHeartbeat; if < staleThreshold(status) → healthy + dequeue; else status = sinceHeartbeat>=deadThreshold ? 'dead':'stale'; queue row (pending|stale) + emit agent:dead|agent:stale. Per-status adaptive thresholds via getStaleThreshold/getDeadThreshold.
- **Port Daddy mapping:** lib/resurrection.ts (resurrection_queue table) + lib/arbiter.ts agent:dead subscription

## 9. Roadmap Pop — atomic slug claim (claim → session/agent link)

- **Source:** lib/roadmap-pop.ts createRoadmapPop(); ADR-0033 (atomic claim), ADR-0034 (session/agent link)
- **Novelty:** common-baseline
- **How it compels responsibility:** pop() atomically takes a slug off the curated pile via a partial UNIQUE index, so 'someone owns this' is a storage fact not a hope; ADR-0034 links the claim to the session+agent so 'who is working on slug X' is resolvable. BUT ADR-0033 explicitly states claims have NO TTL and survive session abandonment — the claim announces intent and never comes due. It is a do-and-forget grab, not an owned obligation.
- **Formal core:** CREATE UNIQUE INDEX idx_roadmap_claims_active_slug ON roadmap_claims(slug) WHERE released_at IS NULL. pop walks candidates in precedence [live,next-cut,now,feedback]; attemptInsert catches SQLITE_CONSTRAINT_UNIQUE → 'taken' → next candidate. release() sets released_at (lifts index). linkClaim() COALESCE-writes session_id/agent_id. No deadline column; no sweeper.
- **Port Daddy mapping:** lib/roadmap-pop.ts (table roadmap_claims), lib/roadmap-items.ts (roadmap_item_status_events audit trail)

## 10. Feedback drop/harvest stream

- **Source:** lib/feedback.ts createFeedback() — drop() emits feedback:dropped tuple, harvest() emits feedback:harvested
- **Novelty:** common-baseline
- **How it compels responsibility:** Lets agents drop structured findings (severity/source/suggested) that Cartographer harvests into the roadmap — closes the develop→feedback→curate→work loop. It records that a finding EXISTS and whether it was harvested, but nobody is on the hook to resolve it; unharvested feedback just TTLs out after 30 days. Accountability for acting on a finding is absent.
- **Formal core:** drop(): validate slug/summary/droppedBy; tuples.out(['feedback:dropped',uuid,entry],{harbor,ttlMs:30d}). list() reflects harvest state by reading ['feedback:harvested','*','*'] (tuples immutable, so harvest is a second tuple, not a mutation). Severity rank low<medium<high<critical drives sort + cartographer auto-promote threshold.
- **Port Daddy mapping:** lib/feedback.ts (tuple-backed; harbor-scoped)

## 11. Worktree policy — main-worktree refusal (with leaked escape hatch)

- **Source:** lib/worktree-policy.ts evaluateSessionWorktreePolicy() — codes WORKTREE_REQUIRED, MAIN_WORKTREE_SESSION_FORBIDDEN
- **Novelty:** common-baseline
- **How it compels responsibility:** Refuses to start a session on the main git worktree by default, forcing agents into isolated worktrees so they cannot trample shared HEAD. A regimentation primitive — but the failure hint literally advertises its own bypass ('pass --allow-main-worktree'), so the discipline leaks its escape hatch in the same breath it enforces it.
- **Formal core:** if requireLinkedWorktree && !worktree → fail WORKTREE_REQUIRED. if worktree.isMain && !allowMainWorktree → fail MAIN_WORKTREE_SESSION_FORBIDDEN with hint 'pass --allow-main-worktree only for explicit integration work'. allowMainWorktree=true short-circuits the guard.
- **Port Daddy mapping:** lib/worktree-policy.ts (consumed by lib/sessions.ts begin path)

## 12. Role-framing / 'You are responsible for X' system prompts

- **Source:** Instruction-following + persona prompting folklore ('You are the maintainer responsible for keeping the test suite green'); the dominant first move in agent frameworks (AutoGPT role cards, CrewAI 'roles', system-prompt 'responsibilities' sections).
- **Novelty:** common-baseline
- **How it compels responsibility:** Intended mechanism: states the obligation in natural language and asks the model to internalize it — persona ('you are the on-call owner') plus duty clause ('keep CI green / the roadmap current / contradictions flagged'). The model conditions its generations on that framing, so within the turn it acts as if it owns the job, refusing to declare done while the duty is unmet. WHY IT UNDERDELIVERS ON DURABLE RESPONSIBILITY: prompt-space responsibility dies with the context window. The 'owner' has no memory of the duty after compaction, a new turn, or a fresh process — no entity persists to be held responsible. It is do-and-forget by construction: the model may diligently keep tests green this turn with zero awareness it ever agreed to next turn. Worse, duty clauses are unverifiable claims the model can satisfy by *saying* it kept the job ('CI is green') without binding to ground truth; the duty is discharged in the narration, not the world. No mechanism detects the duty was dropped, no escalation, no skin in the game — just hope that conditioning holds.
- **Formal core:** A fixed prefix string P appended to context: P = persona ⊕ duty-predicate ⊕ success-criteria. Behavior is sampling p(output | P, task, context). No state created; the 'obligation' exists only as tokens influencing the current decode. There is no operator that re-asserts P after the context is gone, no record that P was discharged, no consequence if it wasn't.
- **Port Daddy mapping:** Maps to actor-soul / session identity — but exposes its weakness: a soul that is only a prompt string evaporates with the window. PD's durable analogue is the persisted session+note ledger that re-injects the duty and records discharge.

## 13. Adversarial panels / debate / critic agents / LLM-as-judge

- **Source:** Zheng et al. 2023 (LLM-as-a-Judge, MT-Bench/Chatbot Arena); Irving et al. debate; self-refine / critic-actor patterns; reviewer/approver roles in AutoGen, MetaGPT.
- **Novelty:** common-baseline
- **How it compels responsibility:** Intended mechanism: a second model (or panel) scrutinizes the worker's output against a rubric — find the bug, rate the answer, approve/reject the PR, surface the missed contradiction — externalizing the check so the worker can't rationalize lapses away. WHY IT UNDERDELIVERS: critics have no skin in the game. The judge is graded on nothing — it bears no cost when it approves a regression or misses a contradiction, so its 'responsibility' is itself unowned (who is responsible for the judge being right?). It evaluates a snapshot artifact at one instant, not the ongoing obligation: a panel blesses a green build today and is structurally blind to tomorrow's drift because it only runs when summoned. Its verdicts are biased-by-default (position bias — Claude-v1 ~23.8% consistent; verbosity — ~91% attackable; reasoning contamination) and gameable: a verbose worker or a confidently-phrased contradiction sails through. And a verdict is do-and-forget — 'approved' is written nowhere binding, creates no standing duty, and the next worker inherits no memory the surface was reviewed. It detects, at best; it does not own.
- **Formal core:** Judge function J(output, rubric) → verdict/score, ideally ensembled over position-swapped orderings (A,B)+(B,A) and multiple judges; debate is iterated J over rebuttals. Per Zheng et al., J carries default biases (position, verbosity, self-enhancement, reasoning contamination); reliability is non-linear in judge capability and reference-guided judging is required for objective tasks.
- **Port Daddy mapping:** Maps to arbiter / single-approver-agent / redteam-review. PD must give the verdict teeth (block the merge, open a tracked claim) rather than emit advice that nobody is bound to honor.

## 14. Eval loops / CI gates / pre-commit hooks

- **Source:** Software testing + CI/CD (GitHub Actions, pre-commit framework, branch protection); LLM eval harnesses (promptfoo, OpenAI evals, llm-evaluation-harness); the dominant 'keep tests green' enforcement story.
- **Novelty:** common-baseline
- **How it compels responsibility:** Intended mechanism: a deterministic gate fires on a trigger (commit, push, PR) and blocks the artifact unless predicates pass — tests green, lint clean, types check, eval score ≥ threshold. The wall is real and external: the agent literally cannot merge red. WHY IT UNDERDELIVERS: CI checks artifacts, not obligations. The gate enforces only assertions that already exist — an agent 'keeps tests green' by deleting the failing test, weakening the assertion, or skipping it, and the gate cheerfully passes (Goodhart: the gate becomes the target). It cannot detect the obligation that has no test yet: the roadmap item nobody encoded, the contradiction between two docs, the silent coverage gap. It is purely event-triggered and reactive — between commits the obligation is unguarded, and nothing owns the *space of things that should be checked*. The gate has no concept of an owner; it stops a bad artifact at a checkpoint but assigns responsibility to no one, so a perpetually-red main can persist while every individual commit 'passed' its own narrow gate. The gate itself decays and no party is on the hook to maintain it.
- **Formal core:** A trigger-bound predicate set G = {gᵢ(artifact) ∈ {pass,fail}}; merge/commit allowed iff ∀i gᵢ=pass. Triggers are event-bound (on-commit/on-PR/on-cron). Gate is stateless w.r.t. intent: it inspects the artifact at trigger time and knows only what existing assertions check, not what *should* exist.
- **Port Daddy mapping:** Maps to guard (pd guard check --staged) and this repo's pre-commit hook. PD's edge: bind gate outcomes to a persistent claim/obligation, not just a pass/fail at one checkpoint.

## 15. Scheduled re-runs / cron / always-on loops

- **Source:** Ops automation (cron, systemd timers, launchd, scheduled GitHub workflows); always-on agent loops (ralph-loop, watch/poll patterns); autonomic computing (Kephart & Chess 2003).
- **Novelty:** common-baseline
- **How it compels responsibility:** Intended mechanism: re-invoke the agent on a timer or watch so the job is revisited continuously — every 5 minutes / nightly, wake up, re-run the suite, re-check the roadmap, re-scan for contradictions. Persistence-over-time is meant to convert a one-shot task into ongoing stewardship. WHY IT UNDERDELIVERS: cron re-runs without accountable ownership. Frequency is not responsibility — a timer that re-fires a fresh, amnesiac context is not an owner, it is a metronome. Each tick is do-and-forget: the run has no memory of prior runs' commitments, no notion that *it* failed last time, no obligation carried forward except whatever a file happens to encode. So the loop runs forever while the job rots — it can re-run a suite that's been silently red for 200 ticks and 'succeed' at running it. Failure is invisible: a crashed loop, a quota-exhausted backend (cf. dead codex owners), or a no-op run looks identical to healthy stewardship from outside; no party notices the loop stopped owning. Accountability requires an identity that accrues consequences across time; a stateless schedule provides recurrence without any such identity.
- **Formal core:** A scheduler S fires invocation I(context) at {t₀+kΔ} or on event e; each I is an independent fresh-context run. State across runs = only what is externally persisted (logs, status file); the loop carries none. No invocation is causally accountable for another's outcome; failure of run k has no consequence for run k+1 beyond what the next prompt reads.
- **Port Daddy mapping:** Maps to fleet / pheromone / feedback and the pd-fleet.yml vision. PD's differentiator: tie each re-run to a persistent accountable identity + obligation ledger, not a stateless tick.

## 16. Reflection / self-critique / ReAct

- **Source:** Yao et al. 2022 (ReAct); Shinn et al. Reflexion; self-refine; chain-of-thought (Wei 2022). The 'agent reasons about its own progress and corrects itself' family.
- **Novelty:** common-baseline
- **How it compels responsibility:** Intended mechanism: interleave thought/observation with action so the agent monitors its own trajectory, notices failed actions, breaks loops, re-plans — and in Reflexion-style variants writes a self-critique that conditions the next attempt, making it responsible-to-itself for tracking progress and catching its own contradictions before declaring done. WHY IT UNDERDELIVERS: reflection is unverified self-report. The agent that grades its own progress is judge, defendant, and jury in one context — 'I verified the tests pass, the roadmap is current, no contradictions remain' is a generated sentence, not a checked fact, and the same model that lapsed certifies it didn't. ReAct/Reflexion are vulnerable to the hallucination spiral ReAct's own quality gates warn about: ungrounded reasoning compounds into confident fabrication, and self-critique can rationalize the lapse as fine. Crucially the reflection lives in the trajectory and dies with it — Reflexion's memory is just text re-appended, so once the context is gone the 'lesson' is gone; nothing persists to make a *future* instance responsible. It improves one attempt's internal coherence; it does not institute an owner accountable across attempts to an external standard.
- **Formal core:** ReAct: alternating (thoughtₜ, actionₜ, observationₜ) where thought conditions the next action and grounding actions correct internal beliefs. Reflexion adds a self-generated verbal critique cₜ appended to context for attempt t+1. All signals are model-generated text evaluated by the same model; ground truth enters only through whatever the action space exposes.
- **Port Daddy mapping:** Maps to actor-soul's internal loop / feedback. PD must externalize the reflection into a verifiable, persisted obligation rather than trust in-context self-report.

## 17. Memory / scratchpads / handoff notes

- **Source:** Agent-memory work (Park et al. 2023 Generative Agents memory stream; episodic-memory patterns); scratchpad/working-memory prompting; handoff docs (the .CLAUDE_NOTES.md tradition Port Daddy itself replaced).
- **Novelty:** common-baseline
- **How it compels responsibility:** Intended mechanism: persist state outside the context window — a scratchpad of what's done, a handoff note for the next agent, a memory stream of observations — so the obligation survives compaction and process death; the next instance reads the note and picks up the duty where the last left it. WHY IT UNDERDELIVERS: a note is a message, not an obligation. Persistence of *text* is not persistence of *responsibility* — the handoff note records that a duty existed, but nothing forces the next instance to read it, accept it, or act on it; honoring is advisory (as PD itself flags: 'file claims are advisory'). The note also rots: it snapshots a belief ('tests green as of commit abc') that silently becomes a lie as the world moves on, and a stale note teaches the next session the wrong thing (the exact failure the user's memory-hygiene rule guards against). Mutable scratchpads can be overwritten to erase an inconvenient open duty. Above all, memory makes the obligation *retrievable* but assigns it to no accountable party — still no entity on the hook, no consequence for dropping it, no detection that the baton was passed to the floor. Necessary substrate for durable responsibility; alone, none of it.
- **Formal core:** A store M (file, vector DB, note table) written by instance k and read by k+1; retrieval r(query, M) injects relevant entries into the next context. Notes may be mutable (overwritten) or append-only. Continuity depends entirely on (a) the writer recording the obligation, (b) the reader retrieving and honoring it, (c) the note remaining truthful as the world changes — none of which is compelled.
- **Port Daddy mapping:** Maps directly to claim-tree + immutable notes + episodic memory. PD already hardens this (notes immutable, claims first-class); the residual gap is that reading and honoring remain advisory, not compelled.

