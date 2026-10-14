# Porthole cooperative native loop

Status: source-only implementation direction and release checklist, not a shipped
private-recording or live-sharing claim. This extends the existing Porthole plan;
it does not create another roadmap or search owner.

## Boundaries and shared native code

Target shared inventory (not a claim that every item exists): a
Foundation/AVFoundation timeline and media package with attributable source
intervals, gap handling, bounded segment I/O, playback cancellation, thumbnails,
and test fixtures. Keep macOS capture/TCC and `BodyAdapter` separate from iOS
presentation/pairing. Native crypto and control-authority integration are not yet
wired. Reuse the Rust security primitives through their supported boundary; do
not create Swift lookalike grants or sealing formats.

One live session begins capture-ready before embodied action and becomes the same
session's sealed history. Fleet surfaces reference the active/most-recent session.
Historical playback never redispatches recorded actions. Sugar/Parley is a
producer protocol, not the stage owner. Preserve the closed vocabulary
`witnessed | reported | derived | inferred | unavailable`; repeated summaries do
not promote evidence or establish independent recurrence.

Integrations remain governed by [Porthole security](../operations/porthole-contract-security.md),
[iOS ADR-0125](../adr/0125-ios-operator-surface.md),
[Convoy requirements](convoy-platform-requirements.md),
[Drydock delivery proof](../../skills/drydock-program-architecture/references/delivery-and-proof.md),
[execution observatory](../../skills/drydock-program-architecture/references/hypertree-execution-observatory.md),
and [Epistemology delivery](../research/egosystem-reconciliation/final/delivery-plan.md).
Porthole supplies observations; shared search retrieves; Epistemology evaluates;
Drydock governs execution. Their evidence/warrant/witness classes stay distinct.

## Data and authority matrix

| Recipient | Live access | Effects and retained history |
|---|---|---|
| Alice, source owner | Chooses one source and audience; visible capture | Own archive policy; explicit bounded grants to others |
| Bob, collaborator/source owner | Receives Alice's granted tracks; separately approves publishing his own | Control only through target-specific `PortholeControlLease` and existing capability/receipt checks |
| Alice's and Bob's agents | Each agent is a distinct scoped recipient, not implicit access through its human | Purpose/expiry-bound recall; cloud receives only exact approved excerpts and destination |
| Charli, observer | Receive-only membership | No control, delegation, or archive permission; cannot promise prevention of copying received pixels |
| Dave, later viewer | No live-room keys | Separately approved historical interval, revocable future access; no retroactive live authority |

An invitation is not authority to control, record, index, delegate, or disclose.
Source time, policy-effective time, and display time remain separate. Reconnect
uses existing snapshot/cursor projections and reports stale state or gaps instead
of inventing continuity. Commands travel separately from projections, are checked
at execution, and receive signed invocation receipts covering effects and gaps.

## Transport proposal, not a provider commitment

Use existing Relay sealed envelopes for application grants, events, and authorized
key-wrap delivery. The selected RTC SDK retains its own signaling protocol;
Relay is not a frame tunnel. Use RTC SFU/TURN for live media and a separate local
sealed archive for history. Archive approval does not imply server recording.

[LiveKit's encryption documentation](https://docs.livekit.io/transport/encryption/)
(reviewed 2026-09-19) documents media/data E2EE and application-owned key
distribution. Its old `e2ee` field alone does not encrypt data; validate the exact
native SDK and `encryption` configuration. Signaling remains visible to the
service. This is a candidate requiring native integration and adversarial proof.
[Cloudflare Realtime SFU](https://developers.cloudflare.com/realtime/sfu/) is
another routing candidate; native selective-key and rotation proof remains
unresolved in this project, not a claim that the provider cannot support it.

A shared room key cannot enforce selective track audiences. Start with one
explicit audience per crypto session, or separate crypto sessions. Admission,
revocation, epochs, reconnect, and participant changes must fail closed across
media AND data. Rotation prevents future access, not recovery of content already
received. No room keys for Dave. No plaintext transport fallback on SDK failure.

## Complete-loop delivery checklist

- [ ] Reconcile current source and reviews before treating historical PR numbers
  as completion receipts. Bind all sessions, sources, body generations, attempts,
  grants, receipts, and revisions to existing Harbor identities/contracts.
- [ ] Deliver explicit remember-buffer, deliberate recording, and cooperative
  modes. Start selected-window, local-only, visible, no audio, no autostart.
  Prove Terminal, Preview, and VS Code independently. Recording, indexing, local
  recall, and disclosure are separate permissions.
- [ ] Put private admission before encode/store/send: mandatory masks, one-frame
  secrets, mask races, uncertain admission, screenshot prompt injection, classifier
  timeout, log/temp/index leakage. A sandboxed classifier only adds protection;
  it cannot remove masks or grant disclosure. Sensitive proprietary work may be
  retained when permitted. Local-only needs external outbound-content witnesses.
- [ ] Bound storage: 20 GiB quota, 10 GiB free-disk reserve, seven-day maximum
  unpinned retention with earlier byte-pressure expiry. Pins consume quota;
  support buffer is capped at min(120 seconds, 256 MiB). Reserve export scratch.
  Test concurrent reservations, pinned saturation, failed writes, crash recovery,
  missing blobs, interrupted sealing, and derivative deletion propagation.
- [ ] Benchmark hardware HEVC where supported, H.264 otherwise for archive;
  negotiate live codecs separately. Five-second independently decodable segments
  and two-second keyframes are targets to validate, not fixture proof. Preserve
  static intervals, gaps, and action timing. Measure text readability, bytes/hour,
  memory, first frame, seek latency, cancellation, and timestamp error at exact
  build/configuration; no numeric performance result is claimed here.
- [ ] Feed separately authorized OCR/semantics/action intervals/annotations into
  the existing shared search owner. Use versioned provenance-bound derivatives,
  scope filters before retrieval, approved profile/space IDs, lineage invalidation,
  and exact cited playback intervals. Do not add another index or embedding model.
  Prove vague recollection, exact errors, never-indexed frames, denied sources,
  expiry, and deletion. Search match must explain itself and open source history.
- [ ] Close search → cited replay → bounded agent recall → revoke/delete loop.
  Changed cloud excerpts need new destination-bound approval. No raw remote
  archive or silent remote fallback. Invalidate OCR, embeddings, thumbnails,
  cached results, and derived proposals; retain only permitted audit skeletons.
- [ ] Prove real RTC media/data E2EE, selective audience isolation, rotation,
  removed-member reconnect, stale grants, wrong-source leases, bounded queues,
  cancellation, backpressure, and network-loss recovery before live release.
  Validate all observer/control/state-machine transition combinations.
  The existing iOS Relay JSON client still aggregates response bodies without a
  byte ceiling; add bounded accumulation before large/untrusted payload reuse.
- [ ] Expose Drydock evidence within two actions of a work item, with cursor
  gaps/staleness visible. No guest assertion becomes host containment proof.
- [ ] Add user-started recurring-friction review for selected projects/dates.
  Count independent occurrences and contrary evidence; distinguish product bugs,
  missing skills, and misunderstood instructions. Proposed cases carry revisions,
  uncertainty, alternatives, effects, dissent, and a named Epistemology decision
  owner. No automatic skill rewrite. Use chronological held-out examples and
  matched retrieval baselines; measure usefulness, false alarms, attention, and
  compute separately, then prove fixes reduce recurrence.
- [ ] Complete exact-build native fixture/UI/accessibility/performance evidence,
  icon generation, FleetBar-derived signing/notarization and package verification,
  plus the separate iOS release gate. Close reviewer findings with regression
  evidence. Synthetic pass, self-issued receipts, and compile success do not
  certify privacy, deployment, store readiness, or end-to-end product completion.

Local Port Daddy remains halted. Dynamic Drydock tiers require explicit grants
and external witnesses; Epistemology empirical/automation gates remain dependencies.
Provider-IP protection on a customer-controlled host remains `unavailable` without
a selected measured/attested confidential boundary and leakage controls.
