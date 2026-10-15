# Book visual atlas judgment contract

Target: `.scratch/publication-repair/release/governing-ai-agents.pdf`; SHA256 `5c467da4e10998ba9bb59a18f54b8038e80e588c453f1d12082ccb489e5867e7`.

## Evidence discipline

Every scored record requires actual visual inspection of its object and final page. Record one-based PDF page, printed page when present, crop/image paths and viewing scale. Contact sheets support comparison; unreadable thumbnails require enlargement. Source-only records are explicitly provisional, receive null scores and are excluded from rankings. Regexes, ink fractions and lint warnings cannot supply aesthetic scores. Repeated occurrences require placement inspection even when sharing design scores.

State purpose, literal contents and page role (`carries`, `supports`, `decorates`, `interrupts`; art may establish tone). Give concrete strengths, confirmed defects or explicit no-defect finding, actionable improvements, comparative reason and rationale for every dimension. Separate suspected defects from confirmed ones. Art is judged against editorial purpose, not numerical density; low scores do not authorize altering operator art.

## Dimensions and anchors

Craft dimensions: `typography` (final-size readability, spacing, role hierarchy, numeric alignment); `composition` (reading order, alignment, focus, integration, collisions/clipping); `color_contrast` (semantic and redundant distinctions, readable boundaries); `consistency_economy` (same roles share geometry/type, marks earn attention, useful guides retained).

Information dimensions: `purpose_fitness` (form answers a reader question); `encoding_relations` (geometry faithfully conveys magnitude/order/causality/containment; art communicates its subject); `completeness_uncertainty` (necessary cases, units, limits and assumptions; art avoids invented documentary implication); `caption_context` (takeaway/scope and adjacency, including context for intentionally uncaptioned art).

| Score | Anchor applied separately to every dimension |
|---|---|
| 0 | Absent or fundamentally broken: essential content unreadable, relationship reversed, no usable answer. |
| 1 | Severe failure: main reading requires guessing or invites a material false inference. |
| 2 | Weak: purpose recoverable with effort; a major omission or several interfering defects. |
| 3 | Competent: main reading works; identifiable moderate weaknesses remain. |
| 4 | Strong: accurate, fluent, purposeful; localized minor improvements. |
| 5 | Exemplary: immediate, precise and complete within stated scope; exceptional economy, no material defect found. |

Fractions require a reason. `craft = mean(first four)*20`; `information = mean(last four)*20`; `composite = (craft+information)/2`. Show both subscores. No hidden provenance penalty. Essential unreadability, clipping or materially false encoding receives a separate publication-blocker flag. Confidence is high/medium/low with evidence limits, not invented precision.

## Type-specific checks

| Family | Required checks |
|---|---|
| Table/matrix | Headers, row/column mapping, units, aligned decimals, comparable precision, wrapped cells, repeated headers, restrained rules. Lookup/classification normally belongs here. |
| Stack/layer | Containment versus dependency, layer order, interfaces, typed cross-layer links. Size must not imply measured capacity accidentally. |
| Flow/state | Initial/terminal states, conditions, direction, error paths; differentiate actors, states, artifacts and decisions. |
| Timeline/sequence | Shared direction, time axis or explicit ordinal steps, intervals/concurrency/endpoints. Equal spacing must not silently assert equal elapsed time. |
| Tree/graph | Typed directed relations, ancestry versus membership, root/leaf roles, boundary, crossings, missing edges. Matrix for exhaustive lookup; sequence for time. |
| Numeric chart | Traceable values/formula, axes/units/domain, baseline, direct labels, uncertainty/sample scope, valid shared scales; no interpolation over discrete categories. |
| Concept | Explicit metaphor mapping without empirical implication; compare with a smaller analytical representation. |
| Portrait/art | Subject, crop/resolution, tonal hierarchy, page rhythm, caption/credit adjacency, rights and historical identity. Appearance proves neither identity nor rights. |

## Provenance, independent of quality

Kinds: `measured_experiment`, `simulation`, `computed_theory`, `worked_example`, `schematic`, `documentary_image`, `commissioned_or_generated_art`, `unknown`. Classify mixed panels separately. Scripted curves are not experiments; plausible numbers are not measurements.

Statuses: `verified_chain` (display reconciled to exact source/data/parameters); `source_located` (source found, reconciliation/replay incomplete); `asserted_only` (caption/comment claim); `unresolved` (unknown/conflicting). Record exact source paths/lines, script, data, parameters/seed/formula, upstream source, clearance/license sidecar, verification performed and open questions. Missing metadata is a gap, not proof of fabrication. External sources are unverified unless actually checked.

## Record schema

A record contains `id`, `reviewer`, `review_version`, `status` (inspected/provisional), `type`, `purpose`, `shows`, `page_role`; `evidence` with PDF digest/pages/printed pages/image paths/inspection scale; `scores` with all eight keys; `score_rationale` keyed identically; `craft`, `information`, `composite`; `strengths`, `defects`, `improvements`; `comparison` with peer IDs and reason against a peer or anchored standard; `confidence`, `limitations`, `publication_blocker`; `provenance` with kind/status/source_paths/scripts/data_paths/parameters/upstream/clearance/verified/questions. Source-only scores and aggregate fields are null.

Overrides preserve original values/evidence, record author/date/reason, recompute visible aggregate and identify active scoring version. Overrides are editorial decisions, not disappearance of observations.

## Applied skills and conflicting prescriptions

Tufte supplies reader question, truthful comparison, useful reading aids and resistance to decorative ink. Whitepaper figure system supplies relation-specific grammar/counter-reading. TikZ craft supplies actual print-size inspection and semantic roles. Chartwork supplies fit/collision leads, not beauty verdicts. Typography expert informs readable measure/numeric alignment. Data-viz-2025 explicitly excludes print; only accessible atlas interaction and scale honesty carry over.

Existing standards conflict: TikZ craft specifies .5/.9/1.6 pt, 2–4 hues and white ground; chartwork craft-rules retains .45 guides, .62/1.05 rules, cream/sand and older palette prescriptions; whitepaper figure system requests one accent plus warning. SGStackLayers/SGMarginLadder have an independent sg vocabulary. These are source conventions to reconcile, not automatic deductions from scores. Judge actual semantic clarity and print behavior; record convention divergence separately.
