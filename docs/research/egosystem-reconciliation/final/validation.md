# Validation and limits

Executed September 8, 2026, on local synthetic artifacts during the offline
validation phase recorded here. No Port Daddy CLI, MCP, daemon, application,
agent launch, external publication or review workflow was used in that phase.
Subsequent publication authority is recorded separately in the
[publication packet](publication-packet.md); it does not change what these
checks establish. Earlier activity is retained as history in the
[process log](../meta/process-log.md) and [cost record](../meta/cost-tracking.md).

## Executed evidence

| Check | Result | What it establishes |
| --- | --- | --- |
| Node local declaration suite | 50/50 pass | Tested input validation, declaration consistency and CLI exit behavior |
| Skill structural validator, strict | Pass; no errors, warnings or suggestions | Required frontmatter, length and bundle structure |
| Skill self-containment check | Pass; no phantom references | Referenced skill resources resolve within the supplied bundle |
| Skill reference index check | Pass; seven bundled files, no orphans | All support files are indexed by the skill |
| Initial preview layout | Eight configurations, zero detected violations | Initial 320/390/720/1100px layouts in both themes |
| Expanded preview interactions | 48 configurations, zero detected violations | Three cases × two paths × four widths × two themes, with expanded dissent |
| Preview runtime observations | Zero page errors and zero network requests | The tested local page did not call a service or fail in Chromium |
| Keyboard checks | Five pass | Tab order, appearance toggle, radio arrows, preview and dissent controls |
| Enlarged text | No detected geometry violations at 640px | CSS text enlargement; not browser zoom or OS accessibility proof |
| Text contrast / targets | Minimum 5.53:1 / 44px | Tested opaque DOM text and clickable label/control bounds |
| Visual inspection | Desktop light and mobile dark inspected | Rendered fixture screenshots, not a human usability study |
| Structured design review | 78/100; `pass: false` | Primary-action and navigation studies remain unperformed |

The skill suite checks policy-valid negatives as well as malformed input.
It covers source/state/proposal preview binding, unsupported verified findings,
inference and hypothesis promotion, claimed independent review, retained dissent,
active blockers, unknown references, duplicate IDs, nonfinite numbers and halt,
scope, authority and aggregate-cost declarations. `auditThing(spec)` is pure for
JSON-derived input. It returns findings on well-formed inconsistencies and
throws on malformed data. CLI failures return a nonzero status.

## Reproduce locally

The paths below are relative to this repository; they invoke no daemon or
package lifecycle script. Use Node.js 22 or later and Python with Playwright
and installed Chromium. The existing layout-overflow-guard skill is an explicit
test dependency for the visual harness; nothing is installed automatically.

```sh
node --test skills/project-epistemology-reconciliation/tests/audit_reconciliation.test.mjs
python3 skills/skill-architect/scripts/validate_skill.py skills/project-epistemology-reconciliation --strict
python3 skills/skill-architect/scripts/check_self_contained.py skills/project-epistemology-reconciliation
python3 skills/skill-architect/scripts/index_references.py skills/project-epistemology-reconciliation
node skills/web-design-expert/scripts/design_audit.mjs --input docs/design/egosystem-reconciliation/design-plan.json
```

The [preview README](../../../design/egosystem-reconciliation/README.md) gives
the geometry/interaction reproduction procedure, links raw reports and explains
the design scorer's limits. The test browser was Chromium 139.0.7258.5 as
recorded in the interaction report. Its local load measurement is not a hosted
3G performance result. Human study fields were not set true to make a score pass.

## Checks intentionally not run

- No full repository build, integration tests, provider call, daemon dogfood,
  GitHub CI, Fleet review or operator-app launch. This slice adds no runtime
  route, and those checks risk crossing the explicit halt.
- No signed-grant or identity verification. An `authorized: true` or
  `authorityVerified: true` input is a declaration, not a validated grant.
- No real event replay, formal contradiction proof, live corpus retrieval,
  revocation race, distributed reservation or provider cost containment test.
- No independently authored Phase 1/3/5 reviews were produced during this
  validation phase. Sequential lenses do not establish epistemic independence.
- No H1–H4 evaluation, statistically powered benefit claim, systematic novelty
  review, actual-device, screen-reader, forced-colors or human task study.

The [delivery plan](delivery-plan.md) makes these future gates explicit. This
package is ready for local examination; it is not a production-readiness verdict,
accepted institutional policy, publication receipt or permission to resume.
