# Skill audit — `provable-action-adjudicator`

**Independent read-only audit · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Verdict

The skill is **quarantined as runtime-enforcement guidance**. Structural lint
passes with warnings, but the semantic score is **3.1/10 (D)**. It overstates a
Phase-0 contract as a deployed reference monitor, materially misdescribes cited
research, contains seven phantom references, and diagrams a denied action being
executed before compensation. This needs replacement, not cosmetic editing.

## P0 findings

### P0-1 — Repository truth is overstated

The skill claims a deployed reference monitor and complete mediation. The
canonical ADR describes a Phase-0 contract and verifier, not a runtime reference
monitor. Source-present schemas, verifier code, tests, and fixtures are useful;
they do not prove every consequential effect is intercepted.

### P0-2 — FormalJudge attribution is materially wrong

The cited paper uses Dafny, Boogie, and Z3 rather than Lean. The skill attributes
invented validity rates, models, API shapes, and latency to it. Those claims must
be removed and the source ledger rebuilt from the primary paper.

### P0-3 — Benchmark laundering

A roughly five-microsecond Lean differential-test input is presented as runtime
proof-checking cost. The complete cited proof/check/model compilation path is on
the order of minutes, not microseconds. External research measurements may be
recorded as external observations; they are not local service objectives.

### P0-4 — Phantom references

Seven referenced artifacts do not exist: four validator/support files and three
manuals. A future agent following the skill reaches an assurance surface that is
imaginary.

### P0-5 — DENY still executes

The current diagram permits a denied operation to execute and then compensate.
Compensation is recovery or damage limitation, never prevention. A `DENY` result
must make the effect path unreachable.

## P1 findings

1. Activation is broad, has no precise `NOT for`, and requests more tools than
   an audit/design skill requires.
2. The text conflates policy meaning, policy compilation, evaluator correctness,
   substrate truth, complete mediation, and effect binding.
3. XACML obligations, I/O logic, Datalog fragments, LTL, pushdown reachability,
   graph checks, and Lean's TCB are described imprecisely.
4. No schema, activation suite, negative-control corpus, or executable bundle
   validator exists.
5. The changelog and scorecard do not describe the current claims.

## Correct replacement boundary

> Audits and designs evidence-bound pre-effect action-adjudication contracts:
> typed action proposals, policy- and authority-bound decisions, effect receipts,
> and a claim ladder separating verifier correctness from complete mediation.
> Use when specifying or reviewing a concrete adjudication boundary, threat
> model, or bypass-evidence plan. NOT for claiming a deployed reference monitor,
> generic policy-language authoring, generic Lean or Datalog work, prompt safety,
> post-hoc log analysis, or production latency claims without local evidence.

## Required replacement bundle

- `SKILL.md` under 300 lines and `CHANGELOG.md` with an explicit breaking entry;
- `references/repository-status.md`;
- `references/claim-ladder-and-threat-model.md`;
- `references/source-ledger.md`;
- `references/benchmark-protocol.md`;
- pre-effect and claim-ladder diagrams;
- closed adjudication-audit and claim-ledger schemas;
- at least six positive and six negative activation cases;
- a validator plus mutation tests for bypass, stale authority, wrong scope,
  changed policy, duplicate redemption, unbound effects, and fabricated proof;
- no performance number promoted without a local, reproducible benchmark.

## Existing source evidence to reference, not duplicate

- `schemas/agent-harbor/v0/governance/action-proposal.schema.json`
- `schemas/agent-harbor/v0/governance/adjudication-receipt.schema.json`
- `schemas/agent-harbor/v0/governance/effect-receipt.schema.json`
- `lib/agent-harbor/governance/action-adjudication.ts`
- `tests/unit/action-adjudication.test.js`
- `tests/fixtures/action-adjudication/pr-10104-force-merge.json`
- `docs/adr/0140-provable-action-adjudication-contract.md`

## Source corrections

- NIST's reference-monitor definition supports complete mediation as a required
  property; application-framework join points do not establish it by themselves.
- FORGE v3 is a research system with an explicit TCB and out-of-band exclusions,
  not proof that this repository has complete mediation.
- AgentSpec, AgentBC, and Lean-Agent remain external research evidence only.
- XACML 3.0 does define obligations and advice.
- Standard pushdown-system reachability is polynomial; a blanket EXPTIME claim
  is false.

## Update rule

Supplant the current primary contract in one change. Do not retain an alternative
“deployed reference monitor” mode. The replacement must say exactly which rung
of the claim ladder the available evidence supports and what remains unknown or
blocked by the local-runtime halt.
