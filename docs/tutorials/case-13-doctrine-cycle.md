# CASE-13: turn one disputed merge decision into a retrievable experiment

This tutorial builds the smallest complete **empirically earned doctrine**
loop. It is deliberately narrow: a real decision episode becomes a candidate,
then a preregistered experiment, then an advisory packet that an agent can see
before a comparable decision. The resulting response and verified outcome go
back to the same evidence ledger.

It does **not** turn a transcript into truth. It does **not** make an agent
automatically merge, block, or resolve a pull request. And it does **not** claim
that repeated replays of one checkpoint establish fleet-wide behavior.

The maritime shorthand is useful:

```text
logbook → maneuver plan → sea trial → advisory orders → captain's response → after-action report
```

In Port Daddy, those are a decision episode, candidate, experiment, retrieval
receipt, application, and verified outcome. The evidence ledger is the logbook;
the doctrine is never a hidden personality trait.

## Before you start

Use a real, immutable source reference for every write: a transcript span,
review-thread URL, CI receipt, Git commit, or a saved verifier result. The
current API requires at least one citation on each record. It is intentionally
hard to create polished but untraceable fleet lore.

This walkthrough uses the CASE-13 question:

> Should a steward block an otherwise mergeable change merely because a bot
> review thread remains unresolved?

That question has competing explanations. The agent may be responding to
independent technical evidence, preserving a review protocol, avoiding an
asymmetric loss, following a role norm, or optimizing a ritual. The historical
transcript alone cannot choose between them.

For commands below, set an explicit URL for the daemon you are testing. Use a
named development berth when testing changed source; the installed daemon is
not proof of a branch.

```bash
PD_URL="${PORT_DADDY_URL:?point this at the intended Port Daddy daemon}"
PROJECT_DIR="$PWD"
ACTOR_ID="steward-case13"
```

The operator's primary surface is the Doctrine panel in FleetBar / Fleet
Control Center. The HTTP examples exist so agents, scripts, the CLI, SDK, and
MCP clients can make the same evidence trail explicit.

## 1. Log the decision episode

Record the event you are trying to understand, not an invented explanation for
it. The `decisionClass` is a structured decision surface; the first vertical
slice matches it exactly rather than pretending a word-search is causal
retrieval.

```bash
curl -sS -X POST "$PD_URL/doctrine/episodes" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["github:pull:CASE-13#review-thread-7", "receipt:ci:CASE-13"],
      decisionClass: "integration.merge",
      summary: "Steward withheld a merge with green CI because one bot thread remained unresolved.",
      historicalAction: "withheld merge",
      alternatives: ["merge", "ask for evidence", "resolve administrative thread"],
      cues: ["green CI", "unresolved bot thread", "no independently reproduced defect"],
      fidelity: "T1"
    }')"
```

Save the returned `episodeId`. The historical action, alternatives, and cues
are separate fields because a useful later experiment must be able to remove or
preserve one condition without silently changing the rest of the situation.

## 2. Propose a falsifiable candidate, not a personality label

Do not write "the Steward is cautious." Write a conditional choice rule which
could be wrong. This candidate deliberately distinguishes technical evidence
from review-interface state.

```bash
EPISODE_ID="episode_..." # returned by the previous request

curl -sS -X POST "$PD_URL/doctrine/candidates" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    --arg episodeId "$EPISODE_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      episodeId: $episodeId,
      citations: ["github:pull:CASE-13#review-thread-7"],
      decisionClass: "integration.merge",
      title: "Independent technical evidence, not thread state, carries merge-blocking weight",
      when: "an integration decision is otherwise ready and a review thread remains open",
      prefer: "inspect whether the thread contains independent technical evidence before blocking",
      over: "treating an unresolved thread itself as a merge veto",
      because: "an open-thread count is a proxy; independently reproduced technical evidence is the proposed mechanism",
      unless: ["a binding policy makes the review state itself a release gate"],
      school: "evidence-weighted integration",
      skillRefs: ["port-daddy-agent-skill"]
    }')"
```

Save both `candidateId` and `doctrineId`. The `skillRefs` field is a citation
to a procedural projection; it does not make a `SKILL.md` canonical doctrine.
Use Skill Graft to locate or inspect a relevant skill before adding that
reference, and keep the experiment and its evidence in the ledger.

## 3. Preregister the maneuver before looking at its result

The useful test is not simply "remove the thread and see whether the answer
changes." The experiment should preserve the factual situation, specify a
control and treatment before execution, and include a sham when the wording or
attention itself could move behavior.

```bash
CANDIDATE_ID="doctrine-candidate_..."

curl -sS -X POST "$PD_URL/doctrine/experiments" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    --arg candidateId "$CANDIDATE_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      candidateId: $candidateId,
      citations: ["fork:CASE-13:checkpoint:before-merge"],
      hypothesis: "Blocking tracks independently supported technical concern more strongly than unresolved-review-thread state.",
      primaryOutcome: "merge/block choice plus stated evidence basis",
      control: "Recreate the factual CASE-13 state, including the same independent evidence.",
      treatment: "Vary technical concern and review-thread state as preregistered arms while holding the remaining state fixed.",
      sham: "Change neutral wording without changing evidence or thread state."
    }')"
```

For CASE-13, the preferred analysis is a factorial exercise:

| Technical concern | Review thread | What it helps distinguish |
| --- | --- | --- |
| absent | resolved | baseline |
| absent | unresolved | thread-state ritual vs no effect |
| present | resolved | evidence sensitivity |
| present | unresolved | interaction / policy effect |

The first implementation records the arms and their fidelity; it does not yet
generate forks, randomize agents, or calculate a causal interval for you. Keep
the checkpoint count, replay count, model lineage, project count, and effective
sample size separate in the cited result.

## 4. Record every run — including the failed factual replay

The factual control must resemble the original observed decision closely enough
to be useful. A response to a prompt-only reconstruction is a new observation,
not proof of what historically caused CASE-13.

```bash
EXPERIMENT_ID="doctrine-experiment_..."

curl -sS -X POST "$PD_URL/doctrine/experiments/$EXPERIMENT_ID/runs" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["fork:CASE-13:control:run-01"],
      arm: "control",
      action: "withheld merge",
      outcome: "reproduced the historical decision and cited the same evidence basis",
      fidelity: "matched"
    }')"

curl -sS -X POST "$PD_URL/doctrine/experiments/$EXPERIMENT_ID/runs" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["fork:CASE-13:treatment:run-01"],
      arm: "treatment",
      action: "requested independent evidence before withholding merge",
      outcome: "review-thread state alone did not determine the decision",
      fidelity: "matched"
    }')"
```

An unmatched factual control remains valuable evidence about replay failure,
but not causal support. The admission endpoint refuses to admit a candidate
unless its preregistered experiment has both a matched control and a matched
treatment. In particular, a prompt-only or unmatched replay cannot establish a
doctrine.

## 5. Admit an advisory packet, then retrieve it at the next decision

After a reviewer has inspected the evidence, admit the candidate. Admission is
still advisory: it changes no PR, policy, or enforcement rule.

```bash
curl -sS -X POST "$PD_URL/doctrine/candidates/$CANDIDATE_ID/admit" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    --arg experimentId "$EXPERIMENT_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["review:doctrine:CASE-13:admission"],
      experimentId: $experimentId,
      reviewerId: "reviewer-case13",
      status: "provisional"
    }')"
```

When a later `integration.merge` decision occurs in the same project, request
an order packet. This is intentionally a `POST`: the receipt is evidence that
an agent was shown guidance at decision time, not a cache read that may never
have been seen.

```bash
curl -sS -X POST "$PD_URL/doctrine/orders" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["receipt:decision:PR-9844:pre-merge"],
      decisionId: "decision:PR-9844:merge",
      decisionClass: "integration.merge",
      limit: 3
    }')"
```

Save `receipt.id`. The current retrieval policy is structured exact
decision-class matching. It returns only active provisional or established
doctrines from that project and writes a receipt even when no relevant doctrine
is available. That absence is an honest result, not a reason to invent advice.

## 6. Make the response and outcome readable later

The captain may follow, adapt, or reject an advisory order. All three are
legitimate. A well-supported rejection can be the strongest contradiction in
the system.

```bash
RETRIEVAL_ID="doctrine-retrieval_..."
DOCTRINE_ID="doctrine:..."

curl -sS -X POST "$PD_URL/doctrine/retrievals/$RETRIEVAL_ID/application" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    --arg doctrineId "$DOCTRINE_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["receipt:decision:PR-9844:reasoning"],
      doctrineId: $doctrineId,
      response: "adapt",
      decision: "Requested an independent reproduction, then merged after none was found.",
      note: "The thread was resolved after preserving a direct link to its substantive concern."
    }')"
```

Finally, record an outcome only after a person or a verifier can name the
evidence. `helped`, `harmed`, and `inconclusive` are observations about this
application — they are not automatic confidence updates or a population-level
claim.

```bash
APPLICATION_ID="doctrine-application_..."

curl -sS -X POST "$PD_URL/doctrine/applications/$APPLICATION_ID/outcome" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["github:pull:9844", "receipt:ci:9844", "review:outcome:9844"],
      verdict: "helped",
      summary: "The adapted evidence check found no independent defect; CI remained green and the reviewer confirmed the resolved concern.",
      verifiedBy: "reviewer-case13"
    }')"
```

If the next case shows the rule harmed a decision or fails at a boundary, do
not hide the bad news. Contest it:

```bash
curl -sS -X POST "$PD_URL/doctrine/$DOCTRINE_ID/contest" \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg actorId "$ACTOR_ID" \
    '{
      projectDir: $projectDir,
      actorId: $actorId,
      citations: ["review:contradiction:PR-9911"],
      reason: "A policy-bound release required closure regardless of technical evidence; the current exception set is too narrow.",
      severity: "high"
    }')"
```

A contested doctrine stops appearing in active retrieval packets but remains
inspectable as history. The next revision must be a new successor candidate
with a fresh identifier and evidence, not a silent overwrite or an admission
that changes the prior candidate's doctrine ID.

## The same closed loop through MCP

MCP clients do not get a read-only, write-only, or shortcut version of this
experiment. They use the same append-only records and gates:

| Phase | MCP tool |
| --- | --- |
| Log the case | `record_doctrine_episode` |
| State the candidate | `propose_doctrine_candidate` |
| Freeze the test | `preregister_doctrine_experiment` |
| Record both factual arms | `record_doctrine_treatment_run` |
| Create advisory guidance | `admit_doctrine_candidate` |
| Read before acting | `doctrine_orders` (or audit with `doctrine_list` / `doctrine_get`) |
| Preserve the response | `record_doctrine_application` |
| Close the after-action loop | `record_doctrine_outcome` or `contest_doctrine` |

The write tools use snake_case names but require the same `project_dir`,
`actor_id`, and immutable `citations` context. Capture tools also allow a
stable `id` and `idempotency_key` for retried writes. An MCP call cannot bypass
the factual-fidelity gate: prompt-only or unmatched replays can be recorded,
but `admit_doctrine_candidate` refuses them.

## Read the whole chain

Use the detail endpoint to inspect the joined path before making a stronger
claim:

```bash
curl -sS "$PD_URL/doctrine/$DOCTRINE_ID" | jq
```

The result should show the linked episode, experiment, retrieval receipts,
applications, and outcomes. If any link is missing, the right conclusion is
not "the fleet learned." It is "this is an incomplete hypothesis trail."

## What this first vertical slice proves

It proves that a supplied, cited chain can be written into one append-only
Harbor stream and read back at the point of a comparable decision. It proves
that the product can preserve the response to advice and a later verified
outcome. It does not yet prove the CASE-13 mechanism, an effect size, transfer
across projects or models, or an automatic skill improvement.

Those claims require the next layers: a faithful replay adapter, planted-cause
calibration, preregistered analysis, independent cases, and a held-out skill
evaluation. The full architecture and its kill criteria live in
[`docs/proposals/empirically-earned-fleet-doctrine.md`](../proposals/empirically-earned-fleet-doctrine.md).
