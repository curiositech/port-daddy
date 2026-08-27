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
ACTOR_CREDENTIAL="${PD_ACTOR_CREDENTIAL:?use the daemon-minted credential held by pd-console or your agent}"
```

The operator's primary surface is the `Doctrine` pane in pd-console. It reads
the shared daemon ledger and can append retrieval, application, outcome, and
contest receipts through the same contract as every automation adapter. The
HTTP examples exist so agents, scripts, the CLI, SDK, and MCP clients can make
the same evidence trail explicit.

```text
pd-console → Doctrine → Ctrl-A : → doctrine retrieve <decision-id> <decision-class>
```

Every mutation is attributed from a daemon-minted credential (`x-actor-credential`),
not a typed `actorId`; the daemon derives both writer and admission reviewer.
Public write bodies therefore contain the evidence and project scope, not an
identity claim that could be replayed under another actor.
The console never shells out to `pd` or MCP, and it never grants merge,
deployment, spend, or other irreversible authority. It renders the facts the
daemon returns and labels a refused write as refused.

Before treating any one replay as a lesson, read the companion
[CASE-13 experiment design](../research/case-13-experiment-design.md). The
first experiment is a 2 × 2 technical-evidence × review-thread-state exercise;
the ledger records its receipts but does not claim that a matched pair proves a
population effect.

## 1. Log the decision episode

Record the event you are trying to understand, not an invented explanation for
it. The `decisionClass` is a structured decision surface; the first vertical
slice matches it exactly rather than pretending a word-search is causal
retrieval.

```bash
curl -sS -X POST "$PD_URL/doctrine/episodes" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    '{
      projectDir: $projectDir,
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

## 2. Freeze a recurring observation before generalizing

One episode can start a candidate, but it is not a pattern. Record a second
compatible episode the same way, then freeze the two cited observations as an
Admiralty harvest. This does not establish causal support; it prevents the
candidate from silently changing its evidence base later.

```bash
EPISODE_ID_2="episode_..." # a second cited integration.merge episode in this project

curl -sS -X POST "$PD_URL/doctrine/harvests" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg episodeId "$EPISODE_ID" \
    --arg episodeId2 "$EPISODE_ID_2" \
    '{
      projectDir: $projectDir,
      citations: ["research:CASE-13:episode-pair"],
      decisionClass: "integration.merge",
      episodeIds: [$episodeId, $episodeId2],
      summary: "Two cited CASE-13-class integration decisions with distinct review-state observations."
    }')"
```

Save `harvestId`. It is an immutable observation, not advice and not a hidden
source of confidence.

## 3. Propose a falsifiable candidate, not a personality label

Do not write "the Steward is cautious." Write a conditional choice rule which
could be wrong. This candidate deliberately distinguishes technical evidence
from review-interface state.

```bash
EPISODE_ID="episode_..." # returned by the previous request
HARVEST_ID="doctrine-harvest_..." # returned by the cited recurring observation

curl -sS -X POST "$PD_URL/doctrine/candidates" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg episodeId "$EPISODE_ID" \
    --arg harvestId "$HARVEST_ID" \
    '{
      projectDir: $projectDir,
      episodeId: $episodeId,
      harvestId: $harvestId,
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

The candidate, its anchor episode, optional harvest, and later experiment must
all share this exact project and structured decision class. That binding prevents
a persuasive-looking CASE-13 record from being used to admit guidance in a
different repository or decision domain.

## 4. Preregister the maneuver before looking at its result

The useful test is not simply "remove the thread and see whether the answer
changes." The experiment should preserve the factual situation, specify a
control and treatment before execution, and include a sham when the wording or
attention itself could move behavior.

```bash
CANDIDATE_ID="doctrine-candidate_..."

curl -sS -X POST "$PD_URL/doctrine/experiments" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg candidateId "$CANDIDATE_ID" \
    '{
      projectDir: $projectDir,
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

## 5. Record every run — including the failed factual replay

The factual control must resemble the original observed decision closely enough
to be useful. A response to a prompt-only reconstruction is a new observation,
not proof of what historically caused CASE-13.

```bash
EXPERIMENT_ID="doctrine-experiment_..."

curl -sS -X POST "$PD_URL/doctrine/experiments/$EXPERIMENT_ID/runs" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    '{
      projectDir: $projectDir,
      citations: ["fork:CASE-13:control:run-01"],
      arm: "control",
      action: "withheld merge",
      outcome: "reproduced the historical decision and cited the same evidence basis",
      fidelity: "matched",
      replayContext: {
        model: "the-original-model",
        modelVersion: "exact-checkpoint-version",
        harness: "the-original-harness",
        worktree: $projectDir,
        environment: "named-dev-berth",
        checkpoint: "fork:CASE-13:checkpoint:before-merge",
        replicaId: "control-01"
      }
    }')"

curl -sS -X POST "$PD_URL/doctrine/experiments/$EXPERIMENT_ID/runs" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    '{
      projectDir: $projectDir,
      citations: ["fork:CASE-13:treatment:run-01"],
      arm: "treatment",
      action: "requested independent evidence before withholding merge",
      outcome: "review-thread state alone did not determine the decision",
      fidelity: "matched",
      replayContext: {
        model: "the-original-model",
        modelVersion: "exact-checkpoint-version",
        harness: "the-original-harness",
        worktree: $projectDir,
        environment: "named-dev-berth",
        checkpoint: "fork:CASE-13:checkpoint:before-merge",
        replicaId: "treatment-01"
      }
    }')"
```

An unmatched factual control remains valuable evidence about replay failure,
but not causal support. The admission endpoint refuses to admit a candidate
unless its preregistered experiment has both a matched control and a matched
treatment with the same model/version, harness, worktree, environment, and
checkpoint, from distinct `replicaId`s. In particular, a prompt-only, unmatched,
drifted, or same-replica replay cannot establish a doctrine.

## 6. Admit an advisory packet, then retrieve it at the next decision

After the credentialed reviewer has inspected the evidence, admit the candidate.
The daemon derives that reviewer from the credential and stamps the first
admission as `provisional`; the caller cannot self-promote it to `established`.
Admission is still advisory: it changes no PR, policy, or enforcement rule.

```bash
curl -sS -X POST "$PD_URL/doctrine/candidates/$CANDIDATE_ID/admit" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg experimentId "$EXPERIMENT_ID" \
    '{
      projectDir: $projectDir,
      citations: ["review:doctrine:CASE-13:admission"],
      experimentId: $experimentId
    }')"
```

When a later `integration.merge` decision occurs in the same project, request
an order packet. This is intentionally a `POST`: the receipt is evidence that
an agent was shown guidance at decision time, not a cache read that may never
have been seen.

```bash
curl -sS -X POST "$PD_URL/doctrine/orders" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    '{
      projectDir: $projectDir,
      citations: ["receipt:decision:PR-9844:pre-merge"],
      id: "doctrine-retrieval:PR-9844:merge",
      idempotencyKey: "CASE-13:PR-9844:merge:orders",
      decisionId: "decision:PR-9844:merge",
      decisionClass: "integration.merge",
      limit: 3
    }')"
```

Save `receipt.id`. The current retrieval policy is structured exact
decision-class matching. It returns only active provisional or established
doctrines from that project and writes a receipt even when no relevant doctrine
is available. That absence is an honest result, not a reason to invent advice.
Retry the same retrieval only with the same `projectDir`, `decisionId`, and
`decisionClass`: the stored receipt and shown doctrine IDs are returned. Reusing
that idempotency key for a different decision is refused rather than silently
creating a second receipt.

## 7. Make the response and outcome readable later

The captain may follow, adapt, or reject an advisory order. All three are
legitimate. A well-supported rejection can be the strongest contradiction in
the system.

```bash
RETRIEVAL_ID="doctrine-retrieval_..."
DOCTRINE_ID="doctrine:..."

curl -sS -X POST "$PD_URL/doctrine/retrievals/$RETRIEVAL_ID/application" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg doctrineId "$DOCTRINE_ID" \
    '{
      projectDir: $projectDir,
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
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    '{
      projectDir: $projectDir,
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
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    '{
      projectDir: $projectDir,
      citations: ["review:contradiction:PR-9911"],
      reason: "A policy-bound release required closure regardless of technical evidence; the current exception set is too narrow.",
      severity: "high"
    }')"
```

A contested doctrine stops appearing in active retrieval packets but remains
inspectable as history. The next revision must be a new successor candidate
with a fresh identifier and evidence, not a silent overwrite or an admission
that changes the prior candidate's doctrine ID.

## 8. Supplant a revision; never rewrite it

When the revised candidate has its own harvest, preregistered experiment,
compatible factual arms, and provisional admission, connect the two immutable
revisions explicitly. The predecessor stays readable but leaves future order
packets. The admitted successor must be in the same project and exact decision
class, and its candidate must already name this predecessor in
`supersedesDoctrineId`.

```bash
SUCCESSOR_DOCTRINE_ID="doctrine:case13-evidence-v2"

curl -sS -X POST "$PD_URL/doctrine/$DOCTRINE_ID/supersede" \
  -H 'content-type: application/json' \
  -H "x-actor-credential: $ACTOR_CREDENTIAL" \
  -d "$(jq -n \
    --arg projectDir "$PROJECT_DIR" \
    --arg successorDoctrineId "$SUCCESSOR_DOCTRINE_ID" \
    '{
      projectDir: $projectDir,
      citations: ["research:CASE-13:revision-v2"],
      successorDoctrineId: $successorDoctrineId,
      reason: "The successor isolates the role-conditioned boundary the original candidate left ambiguous."
    }')"
```

Use `POST /doctrine/$DOCTRINE_ID/retire` with the same attributed context when
no supported successor exists. In pd-console, the matching commands are
`doctrine supersede <old> <successor> :: <reason>` and
`doctrine retire <doctrine-id> <reason>`.

## The same closed loop through MCP

MCP clients do not get a read-only, write-only, or shortcut version of this
experiment. They use the same append-only records and gates:

| Phase | MCP tool |
| --- | --- |
| Log the case | `record_doctrine_episode` |
| Freeze recurring observation | `harvest_doctrine_episodes` |
| State the candidate | `propose_doctrine_candidate` |
| Freeze the test | `preregister_doctrine_experiment` |
| Record both factual arms | `record_doctrine_treatment_run` |
| Create advisory guidance | `admit_doctrine_candidate` |
| Read before acting | `doctrine_orders` (or audit with `doctrine_list` / `doctrine_get`) |
| Preserve the response | `record_doctrine_application` |
| Close the after-action loop | `record_doctrine_outcome` or `contest_doctrine` |
| Supplant / retire | `supersede_doctrine` or `retire_doctrine` |

The write tools use snake_case names and expose no actor or reviewer identity
input. The bridge presents the same daemon-minted credential, from which the
daemon derives the persisted writer and reviewer. Capture tools also allow a
stable `id` and `idempotency_key` for retried writes. An MCP call cannot bypass
the factual-fidelity gate: prompt-only, drifted, or same-replica replays can be
recorded, but `admit_doctrine_candidate` refuses them.

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
