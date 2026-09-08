# ADR-0117: Fleet v2 — Execution Ships, Sandboxed Adversarial Testing, and the AI Gateway

## Status

Proposed — 2026-07-15. Strategic + engineering direction. Sibling to ADR-0116
(monetization — this ADR's execution ships are the premium tier that pays for
their own container cost). Builds on the existing `needsExecution → GHA`
dispatch hook in `apps/fleet-executor`.

## Context

Today the fleet **reads** diffs: cloud ships map-reduce over the PR text and post
findings. That is the commoditized half of the market. Two shifts make the next
leap both possible and defensible:

1. **The market's execution frontier has arrived but is framed friendly.**
   Greptile **TREX** spins per-issue sandboxes to write+run tests and attach
   logs/screenshots ("~20% more bugs, requires execution to find"). **Qodo
   Cover** (built on Meta TestGen-LLM) generates tests and validates each by
   running it. **Diffblue Cover** writes+runs guaranteed-passing unit tests.
   All frame execution as *coverage / regression / bug-finding* — "here are
   tests you're missing."

2. **The adversarial framing is unclaimed white space.** No shipping PR-review
   product frames a ship as **the prosecutor that writes and runs tests
   specifically to prove a PR does not meet its own stated objective**, then
   shows the red failures. The primitives all exist separately: **Meta ACH**
   (mutation-guided — manufacture the fault the PR should prevent, prove a test
   catches it; 73% engineer-accepted), **LogicHunter** (a falsification oracle
   that critiques coverage-chasing generators for "writing tests that pass
   rather than exposing bugs"), and the named **"Critic/Builder" adversarial
   code-review** pattern. Nobody has combined them into a shipped product.

3. **Cost is currently invisible.** The relay does not record per-run tokens
   (only `outputLength`), which is why a gpt-oss-no-cache month cost ~$100+
   unnoticed. This blocks both accurate pricing (ADR-0116) and any per-run
   spend gate.

Cloudflare now provides both missing pieces natively (verified 2026-07-15):
**AI Gateway** (one-line proxy over Workers AI + Anthropic + OpenAI with
per-request token/cost logging, caching, rate limiting, fallbacks) and the
**Sandbox SDK** (Workers execute arbitrary code/shell in isolated Containers —
clone a repo, install deps, run a test suite, stream output via `sandbox.exec()`).

## Decision

### D1 — Route all fleet inference through Cloudflare AI Gateway (do first)

Put every model call behind one AI Gateway. It is the **observability + cost
substrate** the rest depends on:

- **Real per-request token + cost logging** → the source of truth for
  `fleet_run_spend`, so ADR-0116's draw-down bills actual cost, not an estimate,
  and a runaway spend can't hide.
- **Caching** (better than the current per-ship `x-session-affinity` hack),
  **rate limiting** (abuse control), **model fallback** (resilience).
- ~1 day of work ("one line to get started"), available on all plans. This is
  **step 0 of monetization** — you cannot price or bill correctly without it.

### D2 — Sandbox SDK as the execution substrate for `needsExecution` ships

Give execution ships a Cloudflare-native run path: a ship runs in an isolated
**Sandbox** container — checks out the PR branch, installs deps, runs the suite,
captures output — instead of only dispatching to GitHub Actions. This keeps
execution in the operator's control plane and is the prerequisite for every
"run the code" ship.

**Honest cost-of-construction:** Sandbox/Containers cost materially more than a
stateless Worker (spin-up + compute + time/memory limits), and they run
*attacker-influenced PR code* — so this is a **premium/paid tier** (aligns with
ADR-0116) and a real new execution path, not a config flip. Isolation is the
safety boundary; the sandbox never gets repo write creds or secrets — it reports
results back, and any repository mutation goes through the App with its own gate.

### D3 — The adversarial test-writer ("prosecutor") ship — the flagship

A new execution ship that, given the PR diff **and its stated objective** (PR
title/body, linked issue, or `pd-fleet.yml` intent), writes the strongest tests
it can **to falsify the claim that the PR meets its objective**, runs them in a
Sandbox, and posts the **red evidence** as its verdict. Technique blends what the
research proved works:

- **Mutation-guided** (Meta ACH): manufacture the fault the PR claims to
  prevent, assert a test that should catch it, run it.
- **Spec/objective-conformance**: derive properties from the stated objective;
  a failing property is a falsification, not a "missing test."
- **Property/metamorphic** where a spec exists.

Verdict semantics: a passing prosecutor is a *strong* PASS (the PR survived an
adversary); a failing prosecutor is a BLOCK with the exact red test attached —
far more trustworthy than an opaque confidence score. This directly compounds
the ADR-0116 transparency moat: the run page already shows where ships
*disagree*; this ship shows where the PR *fails its own claim*.

### D4 — The remediation loop (critique → engineering)

The bigger arc: the fleet stops only *critiquing* and starts *fixing*. After the
prosecutor produces a red test, a remediation ship can open a **companion PR**
that adds the missing tests, the logging, and the refactor of the touched
backend, then re-runs the suite to hand back green. Autofix-during-review is
already commoditized (CodeRabbit Autofix, Cursor BugBot ~35% merge rate), but
**adversarial-test-then-fix-then-refactor is unclaimed** — autofix targets its
own findings, never failures it *manufactured to falsify the PR's claim*. The
closed loop **falsify → red → refactor → green** is the defensible combination.

### D5 — Positioning

> The fleet doesn't just tell you the PR is insufficient — it writes the test
> that proves it, then the fix that closes it.

Two things no competitor surfaces, combined: transparent *disagreement*
(ADR-0116) and falsification of the PR's *own stated objective* (this ADR). The
window is closing — Greptile TREX and Qodo already own the execution substrate —
so the differentiator is the **framing (prosecutor, not helper) + the closed
loop**, not the execution capability itself.

## Sequencing (respecting cost-of-construction)

1. **AI Gateway** (D1) — ~1 day; unblocks accurate billing + kills invisible
   spend. Fold into ADR-0116's "persist real token counts" step.
2. **Balance/abuse gate + Stripe credits** (ADR-0116) — protect the operator,
   monetize; execution ships need a paid tier to exist behind.
3. **Sandbox execution path** (D2) — the premium substrate.
4. **Adversarial prosecutor ship** (D3) — the headline execution ship.
5. **Remediation loop** (D4) — critique → engineering; the closed loop.

## Consequences

**Positive:** cost becomes visible and billable (D1); the fleet crosses from
reviewer to engineer (D2–D4); the product gets a wedge — adversarial
falsification + closed-loop remediation — that no shipping competitor claims and
that only makes sense on top of the transparency moat already built.

**Negative:** running attacker-influenced PR code is a new, real attack surface
(mitigated by Sandbox isolation + no-creds-in-sandbox, but it must be threat-
modeled before D2 ships); Sandbox/Container cost makes execution ships a paid-
only tier (fine, but it means they can't be in the free tier); and the window is
closing, so this is time-sensitive relative to the read-only review work.

## Deferred / open

- Threat model for sandboxed execution of untrusted PR code (its own review
  before D2 ships) — pairs with `agentic-zero-trust-security` /
  `sandboxed-adversarial-test-harness`.
- Whether the prosecutor's objective comes from PR body, a linked tracker issue
  (ADR-0116 deferred PR-authoring intake: GitHub Issues + Linear), or explicit
  `pd-fleet.yml` intent — likely all three, in that priority.

## References

- ADR-0116 (monetization — execution ships as the premium tier), ADR-0101
  (accounts + run pages), `apps/fleet-executor/src/fleet.ts`
  (`needsExecution → GHA` dispatch hook this replaces/augments).
- Cloudflare AI Gateway (multi-provider proxy, token/cost analytics) and Sandbox
  SDK (isolated code execution on Containers), verified 2026-07-15.
- Research 2026-07-15: Greptile TREX, Qodo Cover / Meta TestGen-LLM, Diffblue
  Cover; Meta ACH (mutation-guided compliance hardening); LogicHunter
  (falsification oracle); the Critic/Builder adversarial-code-review pattern.
