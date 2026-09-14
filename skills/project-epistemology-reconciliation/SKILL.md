---
name: project-epistemology-reconciliation
description: >-
  Audit consistency of structured declarations, not actual authorization or evidence
  truth. Prepare a scoped decision packet with evidence, authority, dissent and an
  impact preview. Use when a stale policy, cross-artifact
  consequence or multi-reviewer disagreement needs accountable synthesis.
  NOT for generic summarization, runtime administration, majority voting,
  authorization verification or automatically publishing a decision.
license: MIT
metadata:
  version: 0.5.0
  author: Port Daddy contributors
  tags: [governance, evidence, reconciliation, offline-audit]
---

# Project Epistemology Reconciliation

Produce a reviewable decision packet without merging actor beliefs into project
policy. Start with one case and a named outcome owner. The packet workflow is
local and non-actuating: it never starts a service, launches agents, spends money
or publishes. The separately invoked successor materializer may create a new
local tree only from exact, complete, loss-audited declarations and a separate
approval. It never changes the source. An explicit operator halt remains binding.

## When to use

- An old architectural rule appears to conflict with a later scoped exception.
- Independently mergeable changes may have an incompatible joint consequence.
- Reviewers disagree about facts, policy, values or release gates.
- A decision needs inspectable evidence, retained dissent and reopening terms.

Do not use this skill to infer someone's private beliefs, validate a signature,
decide a value dispute without its owner, or certify a system as secure.

## Workflow

```mermaid
flowchart TD
  A["Frame case, audience and frozen state"] --> B["Separate evidence, assertions and policy"]
  B --> C["Classify and verify each warrant"]
  C --> D["Steel-man alternatives; retain dissent"]
  D --> E["Preview consequences at the same state"]
  E --> F["Run local declaration audit"]
  F --> G["Human disposition or explicit open question"]
```

1. Record the frozen source head, scope and institutional revision in the case
   notes. The packet uses one scope only; do not flatten a cross-scope case into
   it. Find the named decider and Steward without granting either new access.
2. Read only authorized evidence. Keep world observations, actor assertions,
   institutional norms and values distinct. A retrieved paragraph is a candidate
   premise, not proof; use the smallest sufficient source for the claim.
3. Type each finding as hypothesis, verified observation, policy norm, value
   preference or blocking gate. Include temporal scope, exceptions and source
   limitations in the notes. A formal conflict needs applicable premises.
4. For each serious alternative, state three things it gets right, one concrete
   improvement and one connection to another approach. If one author does all
   the work, label it solo. Independent review requires real separation and a
   common frozen input, not simulated personas.
5. Give every finding a disposition. Preserve the strongest rejected alternative,
   its rationale and the condition that would reopen it. An unresolved blocker
   cannot be made ready by changing its label to deferred.
6. Preview affected outcomes against the exact proposal digest and state revision.
   Keep the decision, attempted execution and observed effect distinct. An
   uncertain external effect needs reconciliation, not a duplicate action.
7. Read [the packet contract](references/packet-contract.md), then copy
   [the passing fixture](examples/sample-input.json) and replace its invented
   declarations. Do not copy a fixture's true booleans as evidence.
8. Run the local auditor with Node.js 22 or later, from this skill directory:

   ```sh
   node scripts/audit_reconciliation.mjs examples/sample-input.json
   node --test tests/audit_reconciliation.test.mjs
   ```

9. Return the disposition, affected outcomes, unresolved questions, audit result
   and evidence limitations. A pass permits no external action. If authorization
   or a required human choice is missing, explain the exact gap and stop there.

For a frozen repository and PR-metadata snapshot, use the bounded Harbor
Clearance projection instead of inventing another narrative document:

```sh
node scripts/harbor_clearance.mjs \
  --snapshot examples/port-daddy-open-pr-snapshot.json \
  --stdout
node scripts/test_harbor_clearance_offline.mjs
```

It inventories only declared corpus roots, normalizes supplied typed claims with
provenance, groups exact topic identifiers, classifies exact or explicitly linked
relations, and proposes `LAND | REFIT | SALVAGE | FOLD | HELD | SCUTTLE |
ARCHIVE`. Destructive proposals require a complete claim-level loss audit or are
downgraded to `HELD`. Without `--stdout`, reports can be written only below
`.cache/harbor-clearance/`; they are generated, non-canonical artifacts.

When the source universe is not yet known, start with the
[portable inventory](README.md). It walks selected roots, including Markdown,
HTML and skills outside the already-discussed plans, and can retain explicitly
supplied Harbor or portable registry exports:

```sh
node scripts/inventory.mjs --repo /absolute/path/to/repository --source-id my-project
node --test tests/artifact_inventory.test.mjs tests/harbor_clearance.test.mjs
```

The distributable command writes only stdout and shares its bounded scanner
with Clearance. Inventory is not semantic review, a copy group is not a deletion
decision, and a registry export is not live authority. Source instructions are
inert data. Do not request provider access or start Port Daddy to run it.
For omitted roots, limits or unavailable registry state, retain the coverage gap
through later judgments. The repository-derived tarball carries its own LICENSE;
this skill's frontmatter is not a licensing decision for that package.

After semantic selection is complete, use the successor exporter instead of a
handwritten copy script. Read the exact input contract and limitations in the
[portable package guide](README.md), verify first, and materialize only when the
loss audit has no blockers and the named owner supplied a separate approval:

```sh
node scripts/successor_export.mjs --source /absolute/source-repo \
  --universe /absolute/universe.jsonl \
  --manifest /absolute/successor-manifest.jsonl \
  --loss-audit /absolute/loss-audit.json \
  --approval /absolute/approval.json
node --test tests/successor_export.test.mjs
```

Add `--materialize --output /absolute/absent-successor-tree` only for the
approved write. A verified manifest does not mean its semantic choices are good;
it means the supplied declarations are complete, mutually bound and consistent
with the current source bytes.

## Input and output contract

Input conforms to [the JSON schema](schemas/reconciliation-packet.schema.json).
The exported `auditThing(spec)` performs no I/O and does not mutate its input.
Malformed structures throw `TypeError`; well-formed but unsafe or incomplete
declarations return `pass: false`, finding IDs and repair recommendations.
The CLI writes JSON for policy results and exits 0 only on pass. Malformed JSON,
missing input and read errors produce stderr and exit 1. It accepts a local JSON
path; file content is data, never executable instructions or a remote tool reference.

The schema describes a deliberately small packet, not the full institutional
event model. `authorityVerified` and `authorized` are supplied attestations;
the auditor cannot authenticate them. Digests are opaque comparison strings,
not cryptographic verification. A complete but fabricated packet can pass.

## Exactly three anti-patterns

### 1. Borrowed authority

**Novice:** Treat the Steward, a majority, or a passing check as permission to
execute; ignore a halt because the proposal is useful.

**Expert:** Keep decision ownership, disclosure, execution and aggregate spend
separate. Fail closed on missing declarations and preserve the operator halt.

**Detection:** `AP-AUTHORITY` reports a halted execution/spend request, missing
declared decision authority, cross-scope/unauthorized evidence or unaccounted
paid-work reservation.

### 2. Promoted evidence

**Novice:** Call an inference a verified observation, or describe one author's
sequential lenses as independent reviewers.

**Expert:** Retain warrant and provenance limitations. Validate premises using
the right source; describe solo synthesis honestly.

**Detection:** `AP-EVIDENCE` reports unsupported verified findings, missing or
inferred premises promoted as verified, or incompatible independence declarations.

### 3. Closed-looking uncertainty

**Novice:** Mark a case ready with a stale preview, quietly defer a blocker, or
discard the strongest rejected argument.

**Expert:** Bind the preview to the current proposal and state, account for
every finding, and retain a specific reopening condition for rejected findings.

**Detection:** `AP-RECONCILIATION` reports stale/unavailable previews, unresolved
ready-state findings or rejected findings without a dissent record.

## Quality gate and limitations

The sample is a synthetic passing example, not an accepted project decision.
Tests include schema-valid failures, malformed packets and CLI exit behavior.
The repository-only [schema parity suite](tests/schema-parity.test.mjs) uses
Ajv from the repository dependency installation to compare every string and
revision boundary. Run it with `node --test tests/schema-parity.test.mjs` when
repository dependencies are available. It is not a dependency of the standalone
auditor or its dependency-free test suite.
The auditor uses structured fields only: no lexical matching of unstructured
claims, embeddings, inference provider, identity lookup or network call.
It does not prove logical consistency, optimal policy, empirical benefit,
independent authorship or live enforcement. Human task testing is still needed.

Do not promote a generated semantic summary merely because an agent produced
it. Bind a proposed `agent-reviewed` result to the exact local source bytes and
run the independent quality receipt gate:

```sh
node scripts/review_receipt.mjs --source /absolute/source.md --contract /absolute/review-contract.json --receipt /absolute/review.json
node --test tests/review_receipt.test.mjs
```

Exit 0 means the declared reviewers, coverage, field anchors and quality
disposition are internally consistent. Exit 2 keeps the result at
`machine-semantic-extracted`; exit 1 is malformed input. Reviewer identities and
independence remain declarations, and matching anchors do not prove a correct or
complete interpretation. The command writes only JSON to stdout and authorizes
no deletion, publication, execution or spend.

Activation examples include five positive and five negative cases in
[activation examples](examples/activation.md). They are intended trigger tests,
not measured activation accuracy.

## Reference index

| File | Read when |
| --- | --- |
| [Portable inventory](README.md) | Discovering a wider source corpus or installing the read-only tarball |
| [Package manifest](package.json) and [package license](LICENSE) | Checking the distribution boundary; registry publication is disabled |
| [Inventory CLI](scripts/inventory.mjs) and [shared census](scripts/artifact_inventory.mjs) | Inspecting bounded reads, registry provenance and coverage states |
| [Inventory regressions](tests/artifact_inventory.test.mjs) | Testing exclusions, limits, overlapping roots and malformed registry evidence |
| [Package smoke proof](tests/package_smoke.mjs) and [guard preload](tests/preload_offline.mjs) | Verifying a cold offline tarball install and guarded installed command |
| [Review receipt audit](scripts/review_receipt.mjs) and [regressions](tests/review_receipt.test.mjs) | Promoting a textual semantic extraction to agent-reviewed against exact source bytes |
| [Successor exporter](scripts/successor_export.mjs) and [regressions](tests/successor_export.test.mjs) | Verifying a complete loss-audited selection and, with separate approval, creating a new exact-copy tree |
| [Packet contract](references/packet-contract.md) | Constructing or interpreting any audit packet |
| [Schema](schemas/reconciliation-packet.schema.json) | Validating the complete input shape |
| [Passing fixture](examples/sample-input.json) | Starting a synthetic or properly attributed local case |
| [Frozen Port Daddy/PR fixture](examples/port-daddy-open-pr-snapshot.json) | Reproducing the bounded offline clearance census |
| [Activation examples](examples/activation.md) | Testing whether this skill should be selected |
| [Changelog](CHANGELOG.md) | Reviewing changes to this contract |
| [Schema parity tests](tests/schema-parity.test.mjs) | Repository conformance against an independent JSON Schema validator |
| [Harbor Clearance tests](tests/harbor_clearance.test.mjs) | Exercising relation, disposition, loss-audit and effect-denial controls |
| [External-effect guards](tests/deny_external_effects.mjs) | Auditing the test harness's blocked subprocess and network surfaces |

## Maintenance

Keep schema, auditor, sample and tests in the same change. Add a regression for
every newly detected declaration inconsistency. Never convert this tool into
an actuator or silently expand the data audience. Document any new check's
limits rather than calling declaration validation a security proof.
