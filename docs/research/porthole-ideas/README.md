# Porthole: recovered product ideas

Read and compiled 2026-11-03 from `curiositech/port-daddy`, pinned source `94f6f6dca8a4120ef8748fc84e9777b06151f9f5`, plus selected Git history. These notes preserve earlier ambition and disagreements. They are research, not a new roadmap, product approval, runtime authorization, or completion report.

The central idea evolved through three overlapping directions:

1. **A reusable record of terminal work** — record once, search, replay, share, embed and turn the actual session into a test.
2. **An evidence and continuity system for agent work** — open a decision and inspect what that worker saw, received, did and proved; compare a controlled repair.
3. **A cooperative stage inside any chosen app** — people and agents point, comment, explore and request bounded control, leaving private, searchable history.

The August terminal brainstorm was substantially replaced by the August 29 evidence contract. The broader stage ADR is recoverable from a historical branch object but absent at the pinned main revision. The later native/private-memory plans preserve further ambitions. A current filename alone therefore does not recover the whole product history.

## Read the notes

- [Terminal product, personas, demos, search and controlled repair](terminal-and-product.md) — original August brainstorm recovered from history; old and newer customer stories; public replay/embedding; code/proposal distinctions; historical pricing hypotheses.
- [Cooperative stage, participation, evidence and authority](cooperative-evidence-and-authority.md) — arbitrary GUI/native/browser/simulator adapters; shared pointers and comments; control leases; encrypted perspectives; signed coverage/disclosure; rejection evidence.
- [Native capture, private memory and chronology](native-memory-and-history.md) — support buffers, exact cited recall, storage/retention, semantic and visual retrieval, agent continuity, recurring-friction review, and unresolved product choices.
- [Source inventory](source-inventory.json) — 71 matching current Markdown documents plus selected historical objects. This records discovery scope, not a claim that every matching file, branch or asset was fully read.

## The big ideas, recovered

| Idea | The experience envisioned | Source |
| --- | --- | --- |
| One session, several uses | The same real recording powers a demo, documentation, incident handoff, review and golden test | [August product](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L1-L16) |
| Terminal flight recorder | After something matters, save the preceding minutes; a CLI SDK can retain the lead-up to a crash | [Historical flight buffer](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L159-L179) |
| Faithful text and interactive TUIs | Scroll and copy linear output; preserve fixed terminal geometry for vim/tmux/fzf; join both in one replay | [Two replay modes](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L18-L32) |
| Demos that cannot rot | Run scenarios in CI; compare the observed terminal state; publish the exact validated cast into docs | [Golden demo tests](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L55-L84) |
| Portable distribution | Standalone utility; self-contained HTML; web component/React wrapper; README SVG poster; documented theme contract | [Packaging and styling proposals](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L86-L157) |
| Vague memory → exact evidence | Find a screen, error, diagram, tool event or decision, then open its cited source interval and see why it matched | [Native recall stories](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-private-memory-delivery.md#L92-L106) |
| Decision inspector | Join a decision to commands, exit status, process lineage, files, tool results, supplied context, compaction and outcome receipts | [Decision-centered demo](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L26-L52) |
| Controlled repair experiments | Start a separately authorized isolated successor from a verified checkpoint, change one declared input, and compare outcomes | [Controlled branching](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L361-L383) |
| Multiple truthful perspectives | See what each person or agent could actually observe, including lag, missing sources and disagreement | [Perspective model](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L152-L192) |
| Arbitrary-app co-exploration | Share a selected native window, browser, terminal, design tool or simulator; add semantic adapters where available | [Adapter family](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L334-L399) |
| Durable comments and semantic anchors | Discuss an element, selection or source interval; preserve attribution/revisions and show drift when the target changes | [Anchor vocabulary](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L179-L192), [co-exploration](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L257-L274) |
| Safe participation and control | Many people can point/comment; an uninstrumented OS target has one explicitly granted controller with immediate human preemption | [Control lease](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L194-L206), [grant/revoke flow](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L276-L290) |
| Mark a moment → report → candidate test | Preserve the person's expected behavior, surrounding actions, source build, gaps and privacy; derive and review a test separately | [Moment/report/test flow](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L292-L330) |
| Private local developer memory | Separate support, deliberate recording and cooperative modes; retain selected work within explicit storage and retention budgets | [Private-memory delivery](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-private-memory-delivery.md#L35-L90) |
| Selective evidence sharing | Preview exact sanitized evidence; create a recipient-scoped derivative and disclosure receipt; preserve independent source custody | [Historical sharing contract](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L318-L330), [current audience matrix](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/design/porthole-cooperative-native-loop.md#L33-L69) |
| Context and people across time | Keep handoff/compaction evidence; invite an earlier contributor back under bounded authority without manufacturing assent | [Continuity and reentry](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L195-L295) |
| Review recurring friction | Ask where work repeatedly stalled, inspect independent occurrences and contrary evidence, and propose reviewed product/skill/instruction improvements | [Reviewed improvements](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-private-memory-delivery.md#L108-L122) |
| Truthful gaps and rejection evidence | Show missing observations and denied actions; preserve deliberate negative tests instead of making every view look complete | [Completeness source](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-contract-security.md#L10-L49), [historical rejection-frontier schema](https://github.com/curiositech/port-daddy/blob/809f8886c1/schemas/agent-harbor/v0/porthole-rejection-coverage.schema.json#L1-L20) |

## Choices the documents have not resolved into one product

- **Entry point:** the terminal-maintainer/DevRel utility, agent-decision inspector, and arbitrary-app cooperative stage are different acquisition stories. The documents changed priority over time. Preserving them does not decide a new launch order.
- **Privacy timing:** the original raw terminal buffer plus scrub-before-share conflicts with the later no-secret-before-first-write contract. Preserve retrospective capture while reconciling its storage/privacy design.
- **Buffer sizes:** the 15-minute/2 MB terminal brainstorm and 120-second/256 MiB native media primitive are different modalities and historical stages, not interchangeable defaults.
- **Search ownership:** the old single-embedder assumption was superseded by the provider-neutral retrieval proposal, with role-specific local/approved profiles and compatible vector spaces. Capture contributes authorized derivatives; a second unrelated index is not the intended integration.
- **Source custody:** local raw archives, ephemeral separately consented live viewing, and newly encrypted shared derivatives are different products and permissions. Room membership grants none of them implicitly.
- **Replay versus execution:** a player can revisit observations; a repair experiment requires a verified checkpoint, new identity/credentials, isolation and current execution authority.
- **Business model:** Free/Pro/Team limits, dollar amounts and competitor gaps in the August draft are historical hypotheses. They were not refreshed or validated in this reading.
- **Release evidence:** a source-present primitive, synthetic movie, schema, signed statement, user observation and notarized build each establish different facts. The notes preserve those limits.

## Reader orientation

A **Body** is the concrete process/device acting for a person or agent; a **perspective** is one attributable observation stream; a **control lease** is a bounded permission to affect one target. Their historical definitions are in [ADR-0135](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L152-L206).

A **receipt** is an attributable record of a request, disposition, observed effect or evidence claim, with its stated verification limits. A **projection** is a derived view of records. The inspected storage types and checks are in [`lib/agent-harbor/porthole.ts`](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/lib/agent-harbor/porthole.ts#L263-L305) and the [source-only security explanation](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-contract-security.md#L1-L49).

## What this research establishes

It recovers source-linked intent and existing source descriptions, including material lost from the current product document. It does not certify a working end-to-end stage, private archive, semantic model, bug reproducer, controlled execution branch, RTC encryption configuration, installed app or commercial demand. No Port Daddy runtime was started and no user application or private transcript database was inspected.

My synthesis, as interpretation: the durable product asset is a private, attributable session of work that people can understand, revisit, reuse and selectively share. Recording, search, collaboration, demonstrations and tests are connected uses of that asset. The individual recovered directions still need an explicit product reconciliation; this notebook does not silently perform one.
