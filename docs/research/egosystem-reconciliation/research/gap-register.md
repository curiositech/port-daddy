# Inventory Gap Register

Status: pre-synthesis gap register  
Purpose: identify what Phase 1 positions must challenge; this is not the final architecture

| ID | Gap | Existing nearest mechanism | Risk if conflated | Required Phase 1 challenge |
| --- | --- | --- | --- | --- |
| G01 | evidence and assertion are not normalized separately | notes, transcripts, Porthole, Harbor events | signed prose is mistaken for truth | provenance/formal + privacy |
| G02 | actor beliefs are not first-class or time-indexed | handoffs, messages, profiles | institutional projection overwrites individual uncertainty | provenance/formal + governance |
| G03 | project decisions lack one authority-owned transition schema | roadmap, ADRs, PRs, notes | “latest text wins” and parallel authority | distributed + governance |
| G04 | values and affected humans are prose-only | ADR drivers, operator rules | technical consensus hides legitimate value conflict | governance + UX |
| G05 | arguments lack premises/warrants and attack subtype | Tube discourse lineage | a `synthesizes` label falsely resolves a contradiction | provenance/formal |
| G06 | consequence paths stop at files/claims/tasks | claims, planner edges, unSpider proposal | independently mergeable work can still break an outcome | distributed + product |
| G07 | independence/disclosure phase is not represented | Parley gather and messages | reviewers anchor, imitate or leak protected facts | privacy + governance |
| G08 | retrieval candidates can be over-read as logical proof | provider-neutral retrieval fabric | similarity becomes contradiction/implication | provenance/formal + distributed |
| G09 | source authority/freshness is not attached to historian output | ADRs/docs/code/runtime | stale documentation blocks correct replacement | governance + product |
| G10 | candidate findings are either noisy or disappear | review comments, mock reviewer rule | human overload or no calibration trail | UX + economics |
| G11 | reviewer roles can be confused with durable identity | AgentNode, static actors, personas | self-asserted expertise and fake independence | privacy + governance |
| G12 | no unified escalation threshold for value/authority changes | Parley, inbox, guard | automation decides human tradeoffs | governance + UX |
| G13 | no attention-adjusted objective | budgets, review latency | system optimizes alert volume and review theater | product/economics + UX |
| G14 | no field-level epistemic disclosure model | resource scope, transcript redaction | existence/content/derivative leakage across boundaries | privacy |
| G15 | no cross-object supersession invariant | append-only notes/profiles, roadmap history | corrections coexist without a safe current projection | distributed + formal |
| G16 | no controlled cutover from research artifact to canonical roadmap work | roadmap touch/upsert/chomp | research silently becomes product authority or duplicate items | governance + product |

## Immediate design constraints

1. No new truth store: use the current Harbor authority event family and deterministic projections.
2. No new identity root: use durable AgentNode and attributable human/account principals.
3. No new retrieval engine: register a scoped corpus/profile in the provider-neutral fabric.
4. No new debate runtime: extend Parley inputs and receipts.
5. No detector verdict may directly mutate canonical state.
6. No cross-project search, derived claim, or existence disclosure without explicit resource-scope authority.
7. No consensus score substitutes for a named decider and rationale.
8. No value conflict is auto-resolved by more model calls.
9. No reviewer role is called independent without distinct initial evidence gathering and sealed first submission.
10. No external novelty claim before the systematic-review gate in `literature-map.md`.

## Questions reserved for divergent positions

- Is a belief object worth storing, or should beliefs remain reconstructable from attributed arguments to reduce surveillance and stale state?
- Which values are hard constraints, which admit tradeoffs, and who may set their priority?
- Can consequence closure remain bounded and useful without a full domain ontology?
- What is the minimum disclosure that permits rebuttal while protecting private evidence?
- Should the Synthesis Steward be a durable role, a per-case selected principal, or a two-key human/agent composition?
- Which institutional transitions can be automatic, and which always require an authorized human?
- How can a detector demonstrate enough recall without training operators to ignore it?
- What event/projection shape survives offline work and authority handoff without last-writer-wins?
- When does preserving dissent become clutter rather than safety evidence?
- What is the cheapest staged experiment capable of falsifying H1–H4?

