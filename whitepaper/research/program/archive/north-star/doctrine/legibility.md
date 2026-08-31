# Legibility — digest-with-zoom, scored against the code

**Layer.** L2 — *legibility & authority* — of the Port Daddy North Star
(**ADR-0048**, `docs/adr/0048-what-port-daddy-is.md` — *names L2 "the Leviathan; the
GUI; for the human operator"*). This doc scores Port Daddy against its own central
L2 rule, **digest-with-zoom** (*every summary is a lens onto the real artifact, never
a replacement for it*), argued at length in the companion paper
`../legibility-leviathan.md`.

**Audience.** A software engineer with a working math/CS background. Every term is
defined on first use.

**Honesty discipline (ADR-0045).** **[BUILT]** = on `origin/main`. **[DESIGNED]** =
accepted ADR, no merged code. **[VISION]** = argued, unspecified.

---

## Scorecard — eight gates

| # | Quality gate | Verdict | Grounded at |
|---|---|---|---|
| L1 | **Honest-green liveness** — does the operator see a *true* alive/stale/dead status, never a faked green? | **[BUILT]** | `routes/operator.ts:184` (`liveness: 'alive' \| 'stale' \| 'dead' \| null`) |
| L2 | **Legible authority** — when authority refuses, does the refusal name *why* (the invariant) and *what to do* (the fix)? | **[BUILT]** | `cli/commands/guard.ts` (typed refusal messages); `lib/budget-guard.ts` (named `reason`) |
| L3 | **No-advertise-bypass** — does a refusal point *only* to the correct action, never naming the override? | **[BUILT]** | `cli/commands/guard.ts:390,406` (points to `pd begin` / the claim owner, not `--no-verify`) |
| L4 | **Mētis-home (append-only audit)** — is there an immutable record the operator can zoom *into*, that no agent can rewrite? | **[BUILT]** | `lib/sessions.ts:1096` (notes immutable, create-only); `lib/tuples.ts` (append + TTL) |
| L5 | **Verifiable zoom target** — does the zoom land on an *artifact* (diff, test log, DB row), not the agent's own narration? | **[BUILT-WEAK]** | `lib/briefing.ts` (partial diff + last test output in `salvageQueue`) |
| L6 | **Graceful authority** — does enforcement offer a decision window, not just a guillotine? | **[BUILT]** | `lib/budget-pause.ts` (60s grace; raise/kill/grace) |
| L7 | **Force-zoom on irreversible P0** — is the operator *made* to zoom before an irreversible high-stakes action? | **[VISION]** | unbuilt — see §4 |
| L8 | **Out-of-the-loop testing** — does the system test the supervisor's ability to catch a bad summary? | **[VISION]** | unbuilt — see §4 |

**One-line grade.** The *read-surfaces* of legibility are built and honest (L1–L4):
the operator sees true liveness, refusals are legible and never advertise their
bypass, and there is an immutable record to zoom into. The two gaps are the
**human-factors** gates the companion paper warns about: nobody is *forced* to zoom
before an irreversible action (L7), and the system never *tests* whether the
operator could catch a lying digest (L8).

---

## 1. The rule being scored

> **Legibility is the product, not a byproduct; over-flattening is the failure mode;
> the one rule is digest-with-zoom — every digest must be a lens onto a verifiable
> artifact (the diff, the test log, the DB row), never a replacement and never the
> agent's own possibly-unfaithful narration.**

The hazard is **James C. Scott's** warning [Scott 1998, *Seeing Like a State*] —
*high-modernist over-legibility crushes* **mētis** (*local, practical, hard-to-codify
know-how*) *and the simplified scheme collapses because the map was never the
territory.* The buildable form of the warning is digest-with-zoom: summarize, but
always link to the work, and make the zoom target a thing the agent **cannot fake**.
This is the same discipline as honest attestation (ADR-0045) — *don't trust the
narration, check the artifact* — applied to the operator's read surface.

---

## 2. The built read-surfaces (L1–L4, L6)

**L1 — Honest-green liveness [BUILT].** The operator's view of an agent's aliveness
is a *true* four-state value, not a green light an agent can assert. The operator
route (`routes/operator.ts`) exposes **`liveness: 'alive' | 'stale' | 'dead' | null`**
(`:184`), computed from `lastActivityAt` (`:185`, `:895`) and reconciliation windows
(`:892` orphan-reconciled), with `null` for genuinely-unknown. This is the
direct realization of ADR-0045's *"a green that wasn't checked is a lie"*: the
status is **derived from observed activity**, and the honest fourth state (`null`)
refuses to claim knowledge the daemon does not have. The operator never sees a
fabricated "alive."

**L2 — Legible authority [BUILT].** When Port Daddy's authority *refuses*, the
refusal is legible: it names the **invariant** being enforced and the **corrective
action**. The **Coordination Guard** (`cli/commands/guard.ts` — *the pre-commit gate
that refuses if another session owns a staged file, or if no session is attached*)
returns typed messages: *"No active Port Daddy session is attached to this shell.
Run `pd begin` before editing or committing."* (`:390`), *"`${file}` is claimed by
another active Port Daddy session."* (`:406`), and — when the daemon is down —
*"...live session and claim truth cannot be verified."* (`:382`). The budget guard
(`lib/budget-guard.ts`) does the same with a typed `reason: 'budget-exceeded' |
'kill-armed'`. Authority that refuses *silently* or *opaquely* is illegible; this
authority states its reason.

**L3 — No-advertise-bypass [BUILT].** A subtle but load-bearing legibility property:
a refusal must point **only** to the correct action, **never** to the override that
would skip the check. An agent takes whatever exit the error hands it, so naming the
bypass in an agent-facing message is handing it the bypass. The guard's refusals
(`cli/commands/guard.ts:390,406`) point to `pd begin` and to the claim's owner —
**not** to `--no-verify` or `--allow-main-worktree`. The bypass stays in `--help`
for humans, out of the refusal path for agents. This is the encoded form of the
project rule *"guardrails never advertise their bypass."*

**L4 — Mētis-home (append-only audit) [BUILT].** Digest-with-zoom needs something to
zoom *into* that the agent cannot have rewritten. Port Daddy's audit substrate is
**immutable by construction**. Session **notes** (`lib/sessions.ts:1096` — *`addNote`
is documented "immutable — create only"; the only write is `INSERT INTO
session_notes`*) cannot be edited or deleted in the normal lifecycle; the only
removal is a CASCADE on deleting the whole session, an auditable administrative act.
**Tuples** (`lib/tuples.ts` — *the shared blackboard; `INSERT` plus a TTL-expiry
`DELETE`, never an in-place `UPDATE`*) are append-with-expiry. This immutable
timeline is the **home of mētis**: the practical know-how an agent leaves in a note
survives, and the operator can zoom from any digest down to the exact note, in
order, with confidence it was not retconned.

**L6 — Graceful authority [BUILT].** Legible authority is also *humane* authority: a
hard kill is correct as a backstop but illegible as an experience (the operator
cannot see *why* in time to act). The **budget pause** (`lib/budget-pause.ts`, scored
C6 in `context-economics.md`) interposes a 60-second grace window with `raise` /
`kill` / `grace` options and broadcasts `budget:pending` / `budget:resolved` so the
operator's dashboard *shows the pending action before it fires*. The cliff becomes a
legible decision point.

---

## 3. The weak gate — verifiable zoom (L5)

**L5 — Verifiable zoom target [BUILT-WEAK].** The rule says the zoom must land on an
**artifact the agent cannot fake**, not on its self-report. Port Daddy is *partway*
here. The **briefing** (`lib/briefing.ts`) hands a successor the **partial diff** and
the **last test output** alongside the scope note — real artifacts, not narration.
That is genuine verifiable-zoom for the salvage path. But it is **weak** because the
zoom is not yet *uniform*: the operator's liveness view (L1) and many digests still
surface the agent's *summary* as the primary object, with the artifact a click away
rather than the default landing. The companion paper's standard
(`../legibility-leviathan.md` §4.2) is that **the verifiable artifact is the default
zoom target everywhere**, and the agent's narration is the *annotation*, not the
*source of truth*. Today that holds for salvage (briefing) and not yet for every
digest. Scored [BUILT-WEAK]: the mechanism exists, the universality does not.

---

## 4. The held levers — the two human-factors gaps (L7, L8)

Both open gates come straight from the human-factors literature the companion paper
cites — the paradox that *good automation puts its supervisor out of the loop*
[Bainbridge 1983, "Ironies of Automation"; Endsley 1995, situation awareness].

- **L7 — Force-zoom on irreversible P0 [VISION].** Digest-with-zoom *lets* the
  operator zoom; it does not *make* them. Before an **irreversible, high-stakes (P0)**
  action — a force-push, a production deploy, a destructive migration — the operator
  should be **required** to zoom into the artifact, not merely offered the option.
  The open research question (`../legibility-leviathan.md` §9, an explicitly
  unsolved problem): **at what sampling rate must the operator be forced to zoom, as
  a function of agent reputation × action stakes?** This couples L2 legibility to L3
  reputation (a low-reputation agent doing a high-stakes action should force a zoom;
  a trusted agent doing routine work should not), and reputation is itself unbuilt
  (`../identity-reputation.md`). So L7 is gated on L3. **[VISION].**

- **L8 — Out-of-the-loop testing [VISION].** A legibility system that is never
  tested is a legibility system you cannot trust. The supervisor's ability to *catch
  a bad summary* — to notice when a digest is unfaithful to the artifact it claims to
  represent — degrades silently with disuse (the out-of-the-loop effect). The lever:
  periodically **inject a known-bad digest** and measure whether the operator (or a
  guard) catches it before acting. This is the legibility analog of chaos
  engineering, and the metric is the same one `context-economics.md` C10 reaches
  for: **can the reader succeed from the digest alone — and notice when they
  shouldn't?** No such test harness exists. **[VISION].**

Both levers are held in the same sense as the rest of the volume: the read-surfaces
that make zoom *possible* are built (L1–L6); the *discipline that makes zoom
mandatory and tested* is the next slice — and the part L7 needs (reputation) is the
L3 work the whole stack waits on.

---

## 5. Why this doc and `context-economics.md` are one mechanism

The digest that legibility zooms into **is** the compaction that context-economics
bills for. L5's "verifiable zoom target" and C11's "recursive compaction from
artifacts" are the *same requirement* stated for two audiences: re-derive from the
diff/test-log/immutable-note, never from the prior summary. L7's "force-zoom" and
C10's "effective-context budgeting" share a metric: *successor-task-success-from-
digest-alone*. Read together, the two docs score the two faces — *map* and *bill* —
of the single act of deciding what survives the context window.

---

## References

- Scott, J. C. (1998). *Seeing Like a State.* Yale UP. (Legibility, mētis,
  high-modernist failure.)
- Bainbridge, L. (1983). *Ironies of Automation.* Automatica 19(6). (Out-of-the-loop.)
- Endsley, M. (1995). *Toward a Theory of Situation Awareness.* Human Factors 37(1).
- Code: `routes/operator.ts` (L1 liveness), `cli/commands/guard.ts` (L2/L3 legible
  refusal), `lib/budget-guard.ts` (L2 named reasons), `lib/sessions.ts` (L4 immutable
  notes), `lib/tuples.ts` (L4 append-only blackboard), `lib/briefing.ts` (L5
  verifiable zoom), `lib/budget-pause.ts` (L6 graceful authority).
- Companion: `../legibility-leviathan.md` (the full Leviathan argument, the
  out-of-the-loop literature, the forced-zoom open problem); `context-economics.md`
  (the COGS face of the same digest).
- Skill: `legibility-for-agentic-systems` (the one law, 4 decision points, 5 failure
  modes, 3 worked examples, 8 quality gates above).
