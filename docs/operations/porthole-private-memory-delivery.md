# Porthole private developer memory: delivery checklist

This is the implementation checklist for the operator-approved plan, not a new
canonical roadmap or an execution grant. Reconciled against main `bbc39fc1a`
on 2026-09-17. The local Port Daddy halt remains binding. No source test, signed
guest statement, or recording establishes host containment or absence of egress.

## Ownership

| Owner | Surface | Boundary |
| --- | --- | --- |
| Porthole | Consented capture, private source media, cited moments, playback, retention | Observation does not grant execution or disclosure |
| Existing history-search owner | Shared indexing, retrieval, ranking, query interfaces | No second index or embedding profile selected here |
| Drydock | Admission, containment, reservations, effects, external witnesses | Playback never redispatches actions |
| Epistemology / Harbor | Assertions, contradictions, decisions, dissent, consequences | Retrieval and repeated summaries do not promote evidence |

Dependencies: [Drydock delivery](../../skills/drydock-program-architecture/references/delivery-and-proof.md),
[execution observatory](../../skills/drydock-program-architecture/references/hypertree-execution-observatory.md),
[Epistemology delivery](../research/egosystem-reconciliation/final/delivery-plan.md),
and [existing storage contracts](porthole-contract-security.md).

## Established source foundations

- [x] [#10013](https://github.com/curiositech/port-daddy/pull/10013): immutable
  storage contracts, trigger regressions and structural envelope validation.
  Sealing remains in pd-vault; SealAad stays harborId/channelId/epoch/seq.
- [x] [#9992](https://github.com/curiositech/port-daddy/pull/9992): native
  lifecycle/policy matrices, bounded shutdown, synthetic fixture and icon/package
  CI. Merged, not an outstanding implementation step.
- [ ] [#9970](https://github.com/curiositech/port-daddy/pull/9970): reconcile its
  remaining ADR, not its superseded storage implementation. Preserve BodyAdapter,
  PortholeControlLease, live-session continuity and Sugar/Parley's producer role.
  Retain [Convoy #9987](https://github.com/curiositech/port-daddy/pull/9987) lineage.

## Ordered delivery slices

### 1. Offline personal-memory primitives (this change)

- [x] Implement bounded support media staging: at most 120 seconds, 256 MiB and
  120 complete encoded segments; chronological eviction, idle expiry, generation
  fencing on reset, and atomic rejection of malformed input.
- [x] Implement actor-isolated storage reservation accounting. Media, OCR,
  embeddings, thumbnails, caches, quarantine and temporary exports share quota;
  pins consume it. Defaults: 20 GiB total and 10 GiB free-disk reserve.
- [x] Implement versioned private-moment and operation-specific recall policy
  contracts, including exact-byte cloud excerpt approval and revocation checks.
- [ ] Obtain exact-head hosted CI and independent review. Local unit tests are
  finite source evidence, not an operational privacy certificate.

These primitives do not enable personal recording in the app. The existing
synthetic-fixture-only persistence gate remains intact. The support buffer accepts
already encoded data; it neither encodes nor proves decodability. The budget is
in-process accounting, not durable reservations or a filesystem quota. The recall
policy consumes authenticated authority from a future boundary; constructing a
Swift value is not consent. There is no production search adapter in this slice.
The closed vocabulary and exact approval equality do not prove source evidence
classification, non-promotion, or gap completeness. Those remain authoritative
producer obligations; no search result may assign itself a stronger class.

### 2. One purposeful personal recording workflow

- [ ] Provide explicit support-buffer, deliberate high-quality, and cooperative
  stage modes. No automatic startup; selected window, visible indicator, local
  destination, no system audio or microphone by default.
- [ ] Keep recording, indexing, local-agent recall and disclosure grants separate.
  Bind exact source/launch/window, policy revision, lease, expiry and revocation.
- [ ] Implement per-frame mandatory exclusions and masks before media admission;
  uncertain admission is withheld. Permitted proprietary work need not be deleted.
- [ ] Add bounded classifier input/output with no network/tools/persistent memory.
  Suggestions can add protection, never remove masks or authorize disclosure.
- [ ] Validate Terminal, Preview and VS Code using approved synthetic content,
  then separately authorized operator-hardware evidence. Retain capture-ready
  before embodied action and seal the same session into history.

### 3. Durable bounded media and replay

- [ ] Integrate reservation-before-write, fresh disk observations, durable intent
  journal and crash recovery with existing sealed blob storage. Account for
  ciphertext/container overhead and concurrent writers; no overcommit on restart.
- [ ] Add reference pins, orphan recovery and policy-permitted audit tombstones.
  Seven-day maximum unpinned retention; earlier byte pressure eviction; pinned
  saturation denies new writes rather than deleting pins silently.
- [ ] Implement hardware HEVC when supported, H.264 otherwise, five-second
  independently decodable segments and two-second keyframes. Benchmark before
  declaring these defaults suitable. Gaps/static intervals retain original time.
- [ ] Add bounded scrub thumbnails and original-segment inspection; reserve export
  space. Measure bytes/hour, small-text readability, memory, first-frame/seek
  latency and timestamp accuracy. Pixel playback is not action reproduction.
- [ ] Propagate expiry/revocation through media, OCR, vectors, thumbnails, result
  caches and derived proposals; test crash interruption and complete invalidation.

### 4. Shared search and execution views

- [ ] Agree the native handoff with the existing search owner using canonical
  Harbor identity/scope/receipt/commitment contracts. Do not mint a second ledger.
- [ ] Ingest authorized OCR, app semantics, action/effect intervals and annotations.
  Preserve source revision, lineage, gaps, transformations, evidence class, policy
  revision, retention, and source/effective/display time independently.
- [ ] Implement ingest/update, lineage invalidation, scope-bound query and
  authorized playback resolution. Results explain the match and open its interval.
- [ ] Test vague Terminal certificate errors, Preview diagrams, and changes before
  failed tests; include inaccessible/deleted sources and a relevant unindexed frame.
- [ ] Join Drydock plan/node/attempt/actor/body-generation/receipt identities through
  its snapshot/cursor projection, never its command channel. Reconnect/gaps display
  stale state; work-item evidence is reachable in two actions. Drydock witness
  classes remain distinct from Porthole's five evidence classes.

### 5. Local recall and reviewed improvements

- [ ] Wire purpose-specific bounded local recall. Cloud agents receive only the
  exact excerpt and destination currently approved by the user; changed bytes,
  source, policy or destination require new approval. No remote fallback.
- [ ] Add user-started “Review recurring friction” for selected projects/dates.
  Count independent occurrences, not repeated summaries; report attempts,
  delays/failures, contrary evidence and possible fixes without causal overclaim.
- [ ] Distinguish product defect, missing skill and misunderstood instruction.
  Propose cases through Epistemology with source revisions, uncertainty,
  alternatives, affected outcomes and named decision owner; preserve dissent.
- [ ] Evaluate chronological held-out examples against matched retrieval baselines.
  Report usefulness, false alarms, human attention and compute separately. Require
  observed reduction in recurrence before claiming a fix helps. No automatic skill
  writes, recurring analysis or empirical capability inferred from fixtures.

### 6. Release gates

- [ ] Expand security tests: one-frame secrets, mask races, screenshot prompt
  injection, classifier timeout, logs/temp files/indexes/outbound channels.
- [ ] Expand storage integration tests: full disk, concurrent/process reservations,
  pins, crash during sealing, missing blobs and derivative deletion.
- [ ] Reuse FleetBar's generic signing/notarization ceremony with app-specific
  inputs. Require Developer ID, hardened runtime, accepted notarization, staple,
  strict signature verification, Gatekeeper, exact artifact checksums and manifest.
  Missing credentials fail closed; ad-hoc CI artifacts are never a release.
- [ ] Resolve native macOS minimum version, release/update identity and package
  acceptance. Respond to review comments with exact-head tests and disposition.
- [ ] Tie privacy claims to the tested build/configuration and independent observed
  outbound-content checks. Customer-hosted provider-IP protection remains
  unavailable without a selected attested boundary and leakage controls.

## Proof ceiling

The runtime halt prevents local Port Daddy/Drydock runs. Dynamic tiers require
their own grants and external witnesses. Epistemology's empirical and automation
gates remain dependencies. This checklist may advance on source/tests/review;
it cannot declare a complete private recording product on that evidence alone.
