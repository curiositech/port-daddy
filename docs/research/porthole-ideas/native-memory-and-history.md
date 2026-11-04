# Porthole: native capture, private memory, and the recovered chronology

Research notes, 2026-11-03. Source snapshot: `curiositech/port-daddy` at `94f6f6dca8a4120ef8748fc84e9777b06151f9f5`; additional historical revisions are explicit. This is an explanation of prior intent and inspected source. It does not change a roadmap, authorize recording, or establish deployment or operational privacy.

## The native app was part of a larger memory system

The system specification calls Porthole a privacy-safe evidence, continuity and flight-recorder layer for autonomous software engineering. It describes three connected planes: terminal bytes and process/tool context; an explicitly selected native window; and a web inspector joining their histories. Its central question is what a worker saw, what it was allowed to do, what events led to an outcome, and how a proposed repair could be inspected safely. [N1]

The native private-memory plan makes that tangible: remember a bounded lead-up, deliberately record a high-quality session, or enter a cooperative stage. These are separate modes. Start is explicit, source scope is visible, and background recording remains tied to the approved source. A useful archive should let someone remember a certificate error in Terminal, a diagram in Preview, or the changes immediately before a failed test. A diagram is a visual-retrieval requirement; OCR alone is not its full meaning. [N2] [N3]

**Perspective** means one attributable observation stream, such as selected-window pixels or a terminal event stream; its own source, sequence, clock and gaps matter. **Projection** means a derived view assembled from underlying records, rather than a second authority that invents their truth. The current stage types live in `lib/agent-harbor/porthole.ts`; the ownership table in the private-memory plan keeps capture, shared search, reasoning about evidence, and execution separate. [N4] [N2]

## 1. Retrospective memory and deliberate recording

The early terminal design proposed a last-15-minute / 2 MB byte buffer and a command that materializes the preceding minutes after a failure. Its SDK version saves a crash replay. Those are original terminal proposals, documented in the companion terminal notes; they are not the native media buffer's dimensions. [H1]

The later native support buffer has a different envelope: at most 120 seconds, 256 MiB and 120 complete encoded segments. The inspected `SupportRecordingBuffer` source checks generation, monotonic intervals, sequence, nonempty bytes, age and size, and evicts complete segments rather than cutting encoded bytes. Reset fences older callbacks. That is useful source, but it accepts already encoded segments and does not itself record, encode, seal or prove decodability. [N2] [N5]

The intended user experience is straightforward: explicitly remember this selected source, keep working, then save the relevant lead-up. A deliberate recording can instead prioritize detail and export. A cooperative session adds other participants and independently granted access. The document specifically refuses automatic startup and treats recording, indexing, local-agent recall and disclosure as separate permissions. [N2]

## 2. Search that opens the exact evidence

The search ambition extends beyond titles or a transcript keyword box. Inputs include authorized OCR, application semantics, actions/effects and annotations. Each result should explain why it matched and open an attributable source interval, with source revision, transformations, omissions, privacy policy and index freshness preserved. Source time, policy-effective time and edited display time remain different facts. [N2] [N3]

The retrieval proposal distinguishes exact/text, code and visual jobs. Its role table includes text embeddings, code embeddings, sanitized screenshot/UI retrieval and reranking. It proposes combining lexical results with compatible dense results using **reciprocal-rank fusion**—combining rank positions rather than treating unrelated numeric scores as comparable—and testing quality against a project corpus. Model/provider names are not quality proof. [N6]

A **vector space identity** (`spaceId`) identifies the exact model/configuration and preprocessing that make stored and query vectors comparable. Changing it requires a new index generation or explicit migration, rather than relabeling old vectors. The role/profile implementation remains a separate owner's work; Porthole supplies eligible sanitized derivatives, not a second independently chosen search stack. [N6]

Authorization comes before candidate retrieval, not only before displaying results. Raw encrypted recordings and their decryption keys remain with the capture owner. Deleting or revoking a source must invalidate OCR, embeddings, thumbnails, cached hits and derived proposals. A partial index must report its missing coverage. These are product requirements for trustworthy recall, not paperwork attached after search is built. [N2] [N6]

## 3. Private recall for people and agents

The developer-memory plan explicitly proposes purpose-specific local-agent recall. A cloud agent may receive only the exact excerpt and destination currently approved by the person; a change in source, bytes, policy or destination requires another approval. There is no silent remote fallback. The source contracts distinguish indexing, local-agent recall and disclosure operations. Creating a grant-shaped Swift value does not authenticate consent. [N2] [N7]

The product contract rules out collecting model-private chain of thought. Observable tool calls, output, public explanations, the actual supplied context and declared omissions can still be recorded within permission. It proposes joining a decision to its `ContextEnvelope` (the supplied context record), `CompactionPacket` (the cited continuity packet), command/process events and `WorkReceipt` (the work/outcome evidence record). Replay seeking is distinct from resuming execution. [N8]

Adjacent transcript plans also describe adapters for external Claude/Codex-style logs and a common versioned JSONL format (one JSON event per line), rather than another unrelated recording database. The persistence contract names visible turns, tool/control actions, file touches, cost, denials, approvals, checkpoints and stop reasons. The earlier ingestion sketch also contains a role named `thinking`; a schema label is not permission to collect model-private reasoning. Likewise, an older fleet RFC's cloud transcript storage proposal does not authorize uploading a person's private Porthole archive. These are separate source classes and policies that need reconciliation. [N11] [N12] [N13]

This gives a specific continuity story: after a handoff or context compaction, find what the earlier worker actually received, what warning was omitted, which obligation survived, and what is unavailable. A summary never retroactively proves that its author saw the underlying source. [N8]

## 4. Recurring-friction review

A notably underused idea is a user-started review for selected projects and dates. It asks which problems repeatedly cost time, what was attempted, whether contrary evidence exists, and whether the cause appears to be a product defect, a missing skill, or a misunderstood instruction. It proposes evidence-backed improvements for review. [N2]

Independent occurrences must be counted separately from repeated summaries of one occurrence. The proposal asks for chronological held-out evaluation, false alarms, attention cost and compute cost, then observed reduction in recurrence before calling a proposed fix helpful. It explicitly excludes automatic skill rewriting and recurring analysis without a new grant. This is a learning loop from real work, with human judgment retained. [N2]

## 5. Durable media with bounded custody

The native plan proposes a 20 GiB shared budget and 10 GiB free-disk floor covering media, OCR, vectors, thumbnails, caches, quarantine and temporary exports. Pins still consume capacity. Seven days is a maximum for unpinned history, with earlier eviction under byte pressure; saturated pins should deny new writes rather than disappear silently. Durable reservations, a write-intent journal, crash recovery and derivative deletion are explicit unfinished integrations in the plan. [N2] [N3]

For archive media it proposes hardware HEVC when supported and H.264 otherwise, independently decodable five-second segments and two-second keyframes. These are benchmark targets, not demonstrated performance defaults. Live transport negotiates separately from archive encoding. Text readability, storage per hour, memory, seek time and timestamp error should be measured on the actual build. [N2] [N3]

`apps/PortholeMediaKit` is a real shared macOS/iOS source package for synthetic encoding/playback fixtures. Its documentation describes generated H.264 segments, bounded plans and a timeline that returns an explicit gap. It explicitly does not implement live capture, sealed storage, HEVC hardware guarantees, networking or remote-control authority. An encoded fixture establishes a different fact from a complete personal-memory product. [N9]

## 6. Privacy is an admission boundary

The August terminal brainstorm stored local bytes and scrubbed before sharing. The later product contract says that is insufficient for a no-secret-on-disk promise: classify, minimize and redact before the first durable write, including adapter-private casts, debug logs, thumbnails, caches, indexes and crash artifacts. A privacy test should render a one-use secret and search the declared durable perimeter for it. [H1] [N8]

The native plan adds mandatory masks/exclusions before media admission and a bounded classifier that cannot use network, tools or persistent memory. A suggestion may add protection, never remove masks or grant disclosure. It also explicitly says permitted proprietary work need not be deleted. Product privacy is not the same as treating every sensitive project as forbidden. [N2]

The original operator ledger asks for strong encryption and searchable selected history, arbitrary GUI windows, ghost cursors, selections, clocks and typed comments. Later plans keep explicit source approval, visible capture and local custody. The phrase “always-filming” in historical material is evidence of the remembered lead-up ambition; it is not present permission for ambient desktop surveillance or automatic startup. [N10] [N2]

The native documents default microphone/system audio to off. Historical ADR-0135 also includes an optional explicitly enabled audio/media channel. These are different capture/participation policies; that channel proposal does not establish a shipped conference voice feature. [N3] [H3]

## 7. Recover the full sequence of ideas

| Recorded date | Recovered direction | Provenance limit |
| --- | --- | --- |
| 2026-08-18 | Honest terminal replay prototype replacing misleading GIF demos | Commit `16cdfd8847ad9fb4fe90bda4676556205b4f3c03`; source/history, no current runtime claim |
| 2026-08-19 | Capture/test/share/embed; flight buffer; crash SDK; living docs; standalone utility | Historical PRODUCT/PERSONAS recovered from `f3098054…`; pricing and competitive claims are historical hypotheses |
| 2026-08-29 | Decision-centered evidence, context continuity, privacy-before-persistence and controlled repair branches | Current PRODUCT declares this update date; it substantially replaces the earlier product document |
| 2026-08-30–31 | Searchable encrypted history and arbitrary-GUI human/agent co-exploration | Repository operator charge ledger; historical directives and observations, not new authorization |
| 2026-09-07 | Architecture questions about customer/provider observation, disclosure and assurance | Historical Book-response document at `2c639df8f7`; not present at the pinned main snapshot |
| 2026-09-17–19 | Bounded private-memory primitives and full cooperative-loop checklist | Current delivery/design documents; unfinished integrations are explicitly identified |
| 2026-10-14 | Native stop/save bug diagnosis, screenshots, scriptable GUI capture, unified GUI/TUI replay, sealing and notarized distribution | System-spec file says September, but Git records its introduction on October 14 (`3b052d460f…`); preserve both dates |

The September Book-response paper also says a provider support view is disclosure: customer-only by default, bounded per-run grant if support is desired. Its broader confidential-compute, settlement and registry questions belong to the surrounding platform. They are not prerequisites for a useful standalone recording tool. This last prioritization is analysis. [H2]

## Implications for the ongoing product, explicitly analysis

1. Preserve two kinds of source truth: terminal bytes/structured tool observations where authorized, and native pixels plus semantics where available. Screenshot OCR cannot substitute for the terminal data plane.
2. Keep a shared session/history object that can become a demo, remembered moment, teaching artifact, handoff, discussion or test candidate. Bug reports are one consumer.
3. Pair vague recollection with exact return-to-source citations. Visual recall of a diagram needs more than OCR of its title.
4. Treat saving, indexing, agent recall, live participation and sharing as distinct choices with clear defaults.
5. Keep the original small standalone-product entry point legible even while preserving the larger agent-accountability architecture.
6. Preserve history across compaction and across people, without inventing recovered hidden reasoning or allowing playback to dispatch old actions.
7. Keep privacy promises tied to tested enforcement and custody. Local file storage, encryption, pre-write minimization and no-provider-egress are different claims.
8. Add recurring-friction review only as an explicit later experience with evidence and human disposition.

These are recommendations for a future reconciliation. No implementation or roadmap change is performed by these notes.

## Sources and reading scope

The root reader fully read the current PRODUCT, historical PRODUCT/PERSONAS, native system specification, private-memory checklist, cooperative-loop plan, native README, MediaKit README, support-buffer source, operator ledger parts 01–02 and the historical Book-response document. Retrieval-fabric roles/privacy/pipeline/failure sections, source type exports, the third operator-ledger part, adjacent product experiences, and the opening architecture/format sections of the external-ingestion, fleet-transcript and persistence documents were targeted reads. Parallel readers recorded their own coverage in the sibling notes. The JSON inventory records 71 matching Markdown documents, not 71 claimed complete reads. Local Git history was searched across refs; selected historical objects were inspected. Every branch and attachment was not read.

[N1]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/architecture/PORTHOLE-SYSTEM-SPECIFICATION-AND-MILESTONES.md#L11-L24
[N2]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-private-memory-delivery.md#L8-L144
[N3]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/design/porthole-cooperative-native-loop.md#L7-L130
[N4]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/lib/agent-harbor/porthole.ts#L36-L122
[N5]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/apps/porthole-stage-capture/Sources/PortholeStageCore/SupportRecordingBuffer.swift#L1-L100
[N6]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/proposals/provider-neutral-retrieval-fabric.md#L80-L414
[N7]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/apps/porthole-stage-capture/Sources/PortholeStageCore/PrivateRecallContracts.swift#L7-L155
[N8]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L195-L331
[N9]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/apps/PortholeMediaKit/README.md#L1-L17
[N10]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/operator-charge-ledger/part-01-messages-001-027.md#L7-L15
[H1]: https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L159-L206
[H2]: https://github.com/curiositech/port-daddy/blob/2c639df8f7/docs/harbor-research/exposition/PORTHOLE-DECISIONS-FROM-THE-BOOK.md#L23-L32

[H3]: https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L401-L447

[N11]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/architecture/agent-harbor-technical-binder/work-packets/transcript-receipt-persistence-contract.md#L27-L78
[N12]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/.scratch/transcript-ingestion-design.md#L1-L110
[N13]: https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/FLEET-SESSION-TRANSCRIPTS.md#L1-L124
