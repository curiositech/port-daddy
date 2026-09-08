# #10108 review replies — local draft, not posted

Prepared September 8, 2026, against published head `edd1a7403` and this local
follow-through. “Fixed locally” does not mean available on GitHub. Publication
is held: the inspected webhook treats PR updates and metadata edits as Fleet
triggers; #10109 is still open, and no deployed no-spawn receipt was established.
No bot, workflow, queue or new agent was requested. Refresh the exact head,
comment list and downstream-effect authority before publishing any reply.

## QA: CSP, schema parity and the cost-record citation

Reply to [QA's review](https://github.com/curiositech/port-daddy/pull/10108#issuecomment-5581916261):

The two medium findings are fixed locally. The preview now permits its exact
inline script by SHA-256 instead of `script-src 'unsafe-inline'`; a test checks
the actual script bytes and a tampered-script negative. String nonblank rules
and maximum safe revisions are now explicit in the schema and followed by the
validator. Seventeen independently evaluated Ajv parity tests supplement the
original 50 declaration tests. These checks do not verify real authority.

I could not reproduce the hash-format finding at the cited head. The cost
record has 58 lines, not 91, and the three frozen-head entries consistently use
`e8426c635`. Please identify the exact revision and row if a different artifact
was intended. I have not invented a correction or marked this finding fixed.

## Lookout: scope naming and authority-verification premise

Reply to [Lookout's review](https://github.com/curiositech/port-daddy/pull/10108#issuecomment-5582057818):

I am retaining `scope`: this is a local declaration packet, not a `ResourceScope`
grant or a Harbor wire envelope. Renaming it `harborScope` would suggest an
integration it does not have. The packet contract and integration contract
state that boundary explicitly.

The authority finding assumes a lookup that does not exist. `authorityVerified`
is an input declaration checked for consistency, not a signature or store
verification. The skill description now leads with that limitation. A mocked
store would not prove production authorization. Real envelope/authority
conformance remains a D1b/D5 gate; the synthetic harness's separately supplied
access policy is also explicitly not authentication proof.

## Book: authority, falsifiers, dissent and publication

Reply to [the Book review](https://github.com/curiositech/port-daddy/pull/10108#issuecomment-5582126644):

Article 2 now explicitly says that a decision record documents existing
authority rather than creating jurisdiction, and that this package is not a
second canonical policy, identity or roadmap registry. The integration contract
maps the existing writers, cooperative editor, participant lifecycle, tenancy,
recovery and cold-start gates instead of proposing a replacement application.

The experimental protocol now names demotion observations and consequences for
each H1–H4 hypothesis. Meaningful-effect and attention/cost thresholds must be
registered before held-out runs, not selected after results. No study was run.
The skill's description states its declaration-only limit. Dissent case notes
now require a review owner, review date and discharge condition; expiration does
not clear an active blocker or erase permitted history.

The unknown roadmap association remains an explicit gap. The unregistered-row
queue described in your review is a proposed follow-up from #10097, not a
source-present capability I can claim here. This branch does not create a
competing registry or remove gate labels to hide the gap.

I am holding publication as well as merge/queue actions. The webhook source
still includes `synchronize` and `edited`, #10109 was read back open/unmerged,
and a merge alone would not prove deployed no-spawn behavior. No trigger was
used as an experiment.

## Roadmap gate

Reply to [the roadmap gate](https://github.com/curiositech/port-daddy/pull/10108#issuecomment-5581866420):

The association is historical and is not represented as a verified registry
row. D1b–D6 are proposed downstream work with owners and gates in the delivery
and integration contracts, but no downstream roadmap IDs have been allocated
under the halt. I will not claim `Roadmap-Spawns: none` for a plan that genuinely
proposes work, fabricate rows, start the daemon, or remove the honest labels.
Registration and protected-land approval remain outstanding.

## Spark proposals

Reply to [Spark's proposals](https://github.com/curiositech/port-daddy/pull/10108#issuecomment-5581932975):

Disposition: CI automation and autonomous phase gates are deferred; the current
scope is solo offline verification. A new visual-audit skill would duplicate
the existing design/layout skill dependencies, so it is not added here.
Declaration consistency remains the existing auditor's narrow responsibility;
it cannot certify constitutional compliance from arbitrary code or prose.
The follow-through instead reuses the existing R17 checker with synthetic
temporal and consequence tests. No proposal was dispatched or queued.

## Spider proposals

Reply to [Spider's proposals](https://github.com/curiositech/port-daddy/pull/10108#issuecomment-5582003304):

Disposition: the bounded binder coverage and integration contract provide the
requested traceability without claiming automated compliance certification.
R17 is reused for a finite consequence fragment; parsing Markdown flowcharts
does not establish semantic contradictions. Rich evidence/retention enforcement
belongs to canonical admission and production conformance, not self-asserted
booleans. Dissent routing stays specified for existing review/commitment
surfaces; no autonomous routing or new workflow is activated. No proposal was
dispatched or queued.

## Preview deployment notice

Regarding [the preview notice](https://github.com/curiositech/port-daddy/pull/10108#issuecomment-5581854118):

This records a preview for the previously published head, not the new local
follow-through or production Relay deployment. It is not evidence of paused
Fleet, runtime integration, zero downstream cost or a passed human study.

## Evidence for the follow-through

- [Validation and limits](../final/validation.md): 68 Node tests and 31 Python
  tests pass; four consequence cases and the original R17 oracle/mutation sweep
  reproduce their expected results.
- [Integration contract](../final/harbor-integration-contract.md): source reuse,
  role ownership, separate views and explicit deployment gates.
- [Local checklist](offline-implementation-checklist.md): scope and publication
  hold, distinct from runtime or canonical roadmap state.
