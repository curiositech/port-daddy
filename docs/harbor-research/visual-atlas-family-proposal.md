# Book visual family proposal

Status: design recommendation from inspection of the frozen Book PDF, SHA-256 `5c467da4e10998ba9bb59a18f54b8038e80e588c453f1d12082ccb489e5867e7`. The contracts below are proposed generator interfaces, not implemented macros or shipped behavior. The atlas rubric is in [visual-atlas-rubric.md](visual-atlas-rubric.md). Scores describe communication quality; source reliability and empirical status remain separate.

## One semantic registry, several appropriate views

A family should share its objects, relations and evidence before it shares colors. `whitepaper/figures/pd-swiss-evidence.tex` currently defines `SGStackLayers` and `SGMarginLadder` with independent copies of the same four-layer list. Table 4.1 repeats the architecture in another representation. A palette change cannot keep those three content lists synchronized.

The **Layer systems** family includes Figure 1.1 (`v00024`), Table 4.1 (`v00120`), and the complete margin ladder (`v00702`; `v00507` is an extracted fragment). Generate all three from one ordered registry. The full stack explains dependencies and the machine floor; the table supports lookup of audience and capabilities; the margin ladder locates the current chapter. These are different views of the same subject, not three unrelated designs.

A proposed layer record has `id`, `level`, `name`, `audience`, `capabilities`, `evidence`, `conceptRole` and `sourceRefs`. The ordered list contains L0 Substrate, L1 Coordination, L2 Legibility and L3 Economy. Keep the machine floor outside this list, with an explicit `floor` record. If chapter-specific wording differs, store an approved display label without changing the layer identity.

```json
{
  "family": "layer-systems",
  "subjectRef": "architecture/four-strata",
  "view": "stack|reference-table|margin-ladder",
  "detail": "overview|standard|expanded",
  "format": "margin|column|full",
  "focusLayerIds": ["L2", "L3"],
  "relation": "chapter bridges",
  "requiredDistinctions": ["floor is not a fifth layer"],
  "sourceRefs": ["versioned registry record"]
}
```

The chapter bridge should be visible as a span or two focused levels; a single L2 rail does not fully communicate an L2-to-L3 bridge. Layer order, names, conceptual roles and authority must remain stable across views. Do not turn a dependency into containment or imply that physical layer height measures capacity.

## Common payload and rendering boundary

Each visual payload should carry a stable ID, reader question, one-sentence claim, relation type, entities with semantic roles, typed edges, necessary values and units, evidence kind, assumptions, source references and likely counter-reading. Numeric payloads also carry exact data or formula, generating script and parameters, uncertainty semantics and any transformation. A schematic has an explicit schematic scale. A worked example is labeled as constructed; a curve drawn from a formula is not an experiment.

Rendering receives format, detail, edition, focus and an explicit omission policy. It owns coordinates, label bands, line routing and typography. Manuscript authors should supply semantic content rather than bespoke x/y positions. A compact variant must declare omitted fields and retain the distinctions needed for its claim. It must fail validation if simplification reverses a relationship or removes an essential condition.

| Proposed family contract | Semantic inputs and variants | Inspected example and concrete improvement |
|---|---|---|
| `LayerSystem` | Ordered layers, floor, interfaces, focus; stack, reference table, margin ladder | `v00024`, `v00120`, `v00702`: share one registry and explicit bridge emphasis. |
| `StateMachine` | States, typed transitions, initial/terminal states, guards and refusal paths; compact badge legend or expanded transition table | Preserve different geometry for state, decision and artifact; do not make every node an equal box. |
| `ProtocolSequence` | Actors, messages, ordinal/metric time, boundaries; overview or exact-action detail | `v00700`: horizontal messages on shared ordinal rows, readable SQL/action labels. |
| `Timeline` | Events, intervals, epochs, scale and uncertainty; margin interval or full schedule | `v00311`/`v00312` and `v00692`: name unspecified synchronization duration and effective earliest expiry. |
| `EvidenceGraph` | Nodes with actor/artifact roles, typed edges, roots and scope; tree, DAG or certificate pair | `v00697`: common issuer/epoch explicit; `v00701`: parallel identity/witness prerequisites should be a DAG. |
| `ComparisonTable` | Typed columns, rows, groups, units, status key and notes; matrix, ledger or stacked records | `v00197` and appendix manifests: prevent one-word prose columns; retain exact identifiers in full-width records. |
| `AccountingFlow` | Sources, destinations, amounts, units, conservation equation and status axis; flow plus recipient ledger | `v00689` with `v00707`: distinguish whole-bond lifecycle status from an 80/20 recipient split. |
| `NumericPlot` | Data/formula reference, transforms, axes, series, uncertainty, direct labels and worked points; common-axis chart, small multiples or margin spark | `v00554`–`v00556`: shared logarithmic scale and phase boundaries; explicit analytic recurrence. |
| `CodeEvidence` | Exact source/artifact revision, language, selected lines, claim, scope and omitted content; pseudocode, implementation excerpt, solver output or transcript | Keep query/model labels attached to TRUE/FALSE verdicts; repeat identity on continuation pages. |

Contracts are intentionally distinct where the reader task differs. Sequence is not a substitute for measured duration; a graph is not a substitute for a lookup matrix; a specimen illustration is not a data mark. Reuse the family generator while permitting layouts that fit different information density.

## Typed tables and honest numeric inputs

Table column roles should include `label`, `prose`, `identifier`, `integer`, `decimal`, `status`, `formula` and `reference`. These determine alignment, reasonable width floors, line breaking and continuation policy. The renderer should switch a dense evidence manifest to stacked artifact records when a five-column view fragments paths and long scope notes. Repeat the table identity as well as column headers on continuations. Preserve precise row/cell lineage; a manifest saying CI is wired does not establish a fresh passing run.

Prefer aligned explicit values when exact lookup is the task. The probation-capacity margin table (`v00705`) and pairwise-correlation counterexample (`v00706`) earn their space without becoming plots. Their values are analytic constructions: discounted sums with L=9 and discount 1/2, and two four-outcome distributions with all-miss probabilities 1/4 and 0. Label the final probability row and explain zero-based period indexing.

Numeric inputs need evidence-specific descriptions. `fig-swk-marker-decay.tex` computes retention powers; `spark-stp-audit-depth.tex` computes a two-regime recurrence. `spark-wald-sprt.tex` contains a manually selected trajectory, not sampled SPRT results. `spark-revocation-gossip.tex` draws a logistic surrogate, not measured gossip convergence. `spark-canary-hypergeom.tex` draws an independent approximation rather than the exact finite-corpus hypergeometric curve. `spark-welfare-loss.tex` is an assumed precautionary-lock welfare-loss model, not leak probability. Preserve these distinctions in captions, atlas lineage and generated metadata.

## Glyph roles

Use glyphs for actor, state, decision, artifact, durable store, trust boundary, evidence receipt and terminal outcome. A glyph identifies a role; it does not carry a quantitative or logical claim by itself. Equal roles share geometry. Distinct roles differ through shape or line treatment and words, with hue as a redundant cue. A cylinder must not imply durability that the evidence does not support; a shield or checkmark must not imply certification.

A document glyph may identify a signed record, but the issuer, epoch, digest and verification relation must remain explicit. A ledger mark can identify an accounting record without implying money conservation across unmodeled systems. An SVG glyph registry should define one viewBox, optical-size classes, baseline and attachment ports, and stroke/fill roles resolved by the same tokens as the diagram. Permit alternate glyph sets through that interface; do not let an imported icon silently override scale, color meaning or connector weights. Compact variants retain role labels when tiny pictograms become ambiguous. Portraits and editorial art stay independent assets with identity, rights and generation metadata; do not force them into technical glyph families.

## Reconcile tokens, then validate the whole family

Existing prescriptions conflict. TikZ craft describes .5/.9/1.6 pt weights, 2–4 hues and white ground; older chartwork craft rules retain different weights, cream/sand and palette conventions; the semantic-figure skill requests one accent plus warning. The sg drawings also carry their own stroke and font system. Treat these as historical conventions to reconcile from printed evidence, not automatic score deductions.

Choose a single role-token registry for type, strokes, surfaces and concept hues. Family renderers resolve tokens through that registry; fragments should not override them with arbitrary local styling. Validate every dependent family after a token change, in the actual Book preamble and at final print size. Mechanical fit/lint results are diagnostic evidence; human inspection must still assess semantic fit, legibility and page integration.

A family is ready when its views preserve source identities and required relations, numeric marks reconcile to inputs, captions state claim and limits, and all variants survive rendered page inspection. Keep the original review, evidence and any operator override with author/date/reason. A higher editorial score is not new empirical evidence.
