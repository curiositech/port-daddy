//! Harbor Editor **P3, slice 1: claims-as-awareness** (presence-as-claims).
//!
//! ## What this slice is (honest scope)
//! P2 proved doc-ops + presence ride the tube and split the **coordination control
//! plane** (`coordination_channel_for_path`) off the high-frequency edit lane. This
//! slice adds the first citizen of that control plane: a **region-scoped claim** —
//! "agent A is working on `parse_header`, lines 12–40" — that rides the coordination
//! channel as a **Loro awareness range** (build-coop-ide-gpui ref 03 §2:
//! *presence-as-claims* — a claim is a peer's live awareness state, not a lock),
//! labeled and actor-colored by [`PeerId`], visible to every replica, and
//! **mirrored (debounced) into the durable claims table** via the SAME
//! `POST /sessions/:id/files` region endpoint `pd session files add` drives (ref 03
//! §3: *daemon-as-server* — reuse the claims store, never fork a parallel one).
//!
//! ## What this slice is NOT (deferred, on purpose)
//!   - **No conflict prediction.** `/conflicts/predict` firing on claim-acquire, the
//!     one-shot [`Tone::Conflicted`](crate::pane::Tone) guard-band pulse, the guard
//!     refusal, and the commit gate are the NEXT slices. Nothing here branches on a
//!     backend or an actor kind (PD hard rule: claim/release are agent-neutral — a
//!     claim is keyed by a [`PeerId`] minted from *any* PD identity, agent or human).
//!   - **No whole-file locks.** A claim covers ONLY its `[start_line, end_line]`
//!     span; two actors editing adjacent regions of one file is the whole point
//!     (proven by `region_claim_does_not_lock_the_rest_of_the_file`).
//!
//! ## Data-structure discipline (rust-data-structures-advanced)
//! The in-Rust ledger ([`ClaimLedger`]) is a **keyed map over `Copy` claim keys**
//! ([`BTreeMap<ClaimKey, RegionClaim>`]) — NOT an `Rc<RefCell<Claim>>` node web
//! (which would leak cycles, defeat `Send`, and make "who owns line N" a pointer
//! chase) and NOT an `Arc<Mutex<HashMap>>` (the SSE-task↔render seam is a channel,
//! per gpui-rust-console's house pattern — the store is owned single-threaded on the
//! render thread, so no shared lock exists to contend). [`ClaimKey`] is a pair of
//! `Copy` scalars `(PeerId, ClaimId)`; the B-tree gives deterministic, flicker-free
//! draw order and O(log n) idempotent upsert.
//!
//! ## Renderer- and daemon-agnostic on purpose
//! Nothing here touches gpui or opens a socket; it unit-tests on Linux CI in the
//! default (no-`gpui`) build. The live coordination receiver is
//! [`crate::agent::DaemonClient::subscribe_channel`] on the pane's
//! `coordination_channel`; the durable mirror is
//! [`crate::agent::DaemonClient::claim_region`].

use crate::buffer::PeerId;
use base64::Engine as _;
use std::collections::BTreeMap;

/// A claim slot id, unique **within one peer's** set of live claims. A `Copy` `u32`
/// scalar so [`ClaimKey`] stays `Copy`; a peer mints these monotonically (0, 1, 2…)
/// so it can hold several disjoint region claims at once (e.g. `parse_header` at
/// L12–40 AND `write_footer` at L200–260) without one clobbering another.
pub type ClaimId = u32;

/// The `Copy` key into the [`ClaimLedger`]: which replica authored the claim
/// ([`PeerId`]) and its per-peer [`ClaimId`]. Both are `Copy` scalars, so the whole
/// key is `Copy` — it is passed by value, never an `Rc`/`String` node identity, and
/// is the natural dedup identity (re-publishing the same `(peer, id)` updates in
/// place). `Ord` so the ledger's B-tree draws in a stable, reproducible order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ClaimKey {
    /// The authoring replica (a Loro `PeerId` minted from a PD identity — agent OR
    /// human; a claim is agent-neutral).
    pub peer: PeerId,
    /// The claim's slot within that peer's set.
    pub id: ClaimId,
}

impl ClaimKey {
    /// Construct a key from its parts.
    pub fn new(peer: PeerId, id: ClaimId) -> Self {
        Self { peer, id }
    }

    /// The awareness-store key string this claim lives under: `"<peer>:<id>"`. A peer
    /// keeps each claim under its OWN key (not one blob per peer) so releasing one
    /// region does not disturb another the same peer still holds. Both halves are
    /// decimal so the whole string round-trips every bit (a `PeerId` is a full `u64`;
    /// see [`Self::parse_store_key`]).
    fn store_key(&self) -> String {
        format!("{}:{}", self.peer, self.id)
    }

    /// Parse an awareness key string (`"<peer>:<id>"`) back into a [`ClaimKey`], or
    /// `None` if it is not one (a drift/garbage entry the ledger must skip, never
    /// crash on — the util.rs tolerance rule).
    fn parse_store_key(s: &str) -> Option<ClaimKey> {
        let (peer, id) = s.split_once(':')?;
        Some(ClaimKey { peer: peer.parse().ok()?, id: id.parse().ok()? })
    }
}

/// A **region-scoped** claim: one replica's reservation of a contiguous line range in
/// a file, labeled with what it is working on. The span is **1-based inclusive**
/// (`start_line..=end_line`) — the same grain [`PresenceState::selection_line_span`]
/// yields and the `POST /sessions/:id/files` route's `startLine`/`endLine` expect —
/// so a selection mirrors straight through with no off-by-one.
///
/// Region granularity is the whole point: a claim [`covers`](Self::covers) ONLY the
/// lines in its span, so a file can carry many disjoint claims and every line outside
/// them stays free (see [`ClaimLedger::owners_of_line`]).
///
/// The `key` is `Copy` ([`ClaimKey`]); only `label` allocates (a short symbol name
/// like `"parse_header"`), and it is cloned off the render hot path, never per frame.
///
/// [`PresenceState::selection_line_span`]: crate::editor_sync::PresenceState::selection_line_span
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RegionClaim {
    /// Authoring replica (`Copy` scalar; agent OR human).
    pub peer: PeerId,
    /// Per-peer claim slot.
    pub id: ClaimId,
    /// First claimed line, 1-based inclusive.
    pub start_line: u32,
    /// Last claimed line, 1-based inclusive.
    pub end_line: u32,
    /// What the actor is working on here — the symbol/region name (`"parse_header"`).
    /// The *display* label ("peer 3a — parse_header") is composed at render time from
    /// this plus the actor's color/tag, so the wire payload stays the bare work name.
    pub label: String,
    /// A monotonic **grant sequence** the acquiring actor stamps (logical, not
    /// wall-clock — it survives replay and needs no synced clock). It exists so a
    /// later slice can resolve contention by HARD RULE 6 — *first-granted, non-revoked
    /// claim wins* — via [`ClaimLedger::first_granted_owner_of_line`]. Slice 1 only
    /// records and orders by it; it enforces nothing yet (no guard in this slice).
    pub granted_at: u64,
}

impl RegionClaim {
    /// Build a region claim. `start`/`end` are 1-based inclusive; they are stored
    /// low→high regardless of argument order so a caller cannot invert the span.
    pub fn new(
        peer: PeerId,
        id: ClaimId,
        start: u32,
        end: u32,
        label: impl Into<String>,
        granted_at: u64,
    ) -> Self {
        Self {
            peer,
            id,
            start_line: start.min(end),
            end_line: start.max(end),
            label: label.into(),
            granted_at,
        }
    }

    /// This claim's `Copy` ledger key.
    pub fn key(&self) -> ClaimKey {
        ClaimKey { peer: self.peer, id: self.id }
    }

    /// The inclusive `(start_line, end_line)` span.
    pub fn line_span(&self) -> (u32, u32) {
        (self.start_line, self.end_line)
    }

    /// Does this claim cover 1-based line `n`? The region-granularity primitive: a
    /// line above `start_line` or below `end_line` is NOT covered, even though the
    /// same file is claimed elsewhere.
    pub fn covers(&self, n: u32) -> bool {
        n >= self.start_line && n <= self.end_line
    }

    /// Do two claims' spans overlap (share at least one line)? Two claims that merely
    /// touch different lines of one file do NOT overlap — the basis for "adjacent
    /// regions edit concurrently". (Slice 1 uses this only in tests; the guard that
    /// acts on it is a later slice.)
    pub fn overlaps(&self, other: &RegionClaim) -> bool {
        self.start_line <= other.end_line && other.start_line <= self.end_line
    }
}

/// The in-Rust claim ledger: a keyed map from the `Copy` [`ClaimKey`] to its
/// [`RegionClaim`]. This is the render-facing, single-threaded view of "who has
/// reserved which region of this file" — rebuilt from the awareness store on each
/// coordination-lane change and read back by `view()`.
///
/// ## Why a `BTreeMap`, and NOT `Rc<RefCell<_>>` or `Arc<Mutex<_>>`
/// - **Not `Rc<RefCell<Claim>>`:** claims form no graph — "who owns line N" is a
///   range scan over `Copy` keys, not a pointer chase — so a node web buys nothing
///   and costs `!Send` + refcount cycles + interior-mutability foot-guns.
/// - **Not `Arc<Mutex<HashMap>>`:** the only cross-thread seam (SSE task → render) is
///   a `tokio::mpsc` of frame bytes (gpui-rust-console's house pattern; the console
///   already solved concurrent state with channels). Frames land on the channel; the
///   pane folds them into this ledger **on the render thread**, so the ledger is
///   owned single-threaded and no shared lock exists to contend or deadlock. `dashmap`
///   would be a foreign pattern here for the same reason.
/// - **`BTreeMap` over `HashMap`:** deterministic key order ⇒ flicker-free draw order
///   frame-to-frame and reproducible tests, at O(log n) for the handful of live claims
///   on one file.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ClaimLedger {
    claims: BTreeMap<ClaimKey, RegionClaim>,
}

impl ClaimLedger {
    /// An empty ledger.
    pub fn new() -> Self {
        Self { claims: BTreeMap::new() }
    }

    /// Upsert a claim under its `Copy` key. Returns the previous claim at that key,
    /// if any (a re-publish of the same `(peer, id)` — a moved/resized region).
    pub fn upsert(&mut self, claim: RegionClaim) -> Option<RegionClaim> {
        self.claims.insert(claim.key(), claim)
    }

    /// Remove the claim at `key` (a release), returning it if present.
    pub fn remove(&mut self, key: ClaimKey) -> Option<RegionClaim> {
        self.claims.remove(&key)
    }

    /// How many live claims the ledger holds.
    pub fn len(&self) -> usize {
        self.claims.len()
    }

    /// Is the ledger empty?
    pub fn is_empty(&self) -> bool {
        self.claims.is_empty()
    }

    /// Borrow the claim at `key`, if any.
    pub fn get(&self, key: ClaimKey) -> Option<&RegionClaim> {
        self.claims.get(&key)
    }

    /// Iterate claims in stable `ClaimKey` order.
    pub fn iter(&self) -> impl Iterator<Item = (&ClaimKey, &RegionClaim)> {
        self.claims.iter()
    }

    /// Every claim covering 1-based line `n`, in stable key order. THE region-scoped
    /// query: a line outside every claim's span returns empty even when the file has
    /// claims on other lines — proof a claim is a region reservation, not a file lock.
    pub fn owners_of_line(&self, n: u32) -> Vec<&RegionClaim> {
        self.claims.values().filter(|c| c.covers(n)).collect()
    }

    /// Is 1-based line `n` claimed by some replica **other than** `me`? The seam a
    /// later slice's commit gate / guard reads (HARD RULE 7) — region-scoped, so `me`
    /// editing an unclaimed adjacent line is never blocked. Slice 1 only exposes it.
    pub fn is_line_claimed_by_other(&self, n: u32, me: PeerId) -> bool {
        self.claims.values().any(|c| c.peer != me && c.covers(n))
    }

    /// The **first-granted, non-revoked** claim covering line `n` — HARD RULE 6's
    /// default contention winner (ties broken by `ClaimKey` for determinism). Present
    /// so the ledger already answers "who owns this line" the way the future guard
    /// must; slice 1 wires no guard onto it.
    pub fn first_granted_owner_of_line(&self, n: u32) -> Option<&RegionClaim> {
        self.claims
            .values()
            .filter(|c| c.covers(n))
            .min_by_key(|c| (c.granted_at, c.key()))
    }
}

// ── The claim-awareness frame codec (rides the COORDINATION lane) ─────────────
//
// A claim is published as a Loro `EphemeralStore` update — exactly the presence
// substrate, but on `coordination_channel_for_path` (NOT the edit lane) and under a
// distinct frame `kind` so a coordination receiver routes claim awareness → the
// ledger without it ever crossing an op / presence / snapshot / coord-signal frame.

/// Frame schema version (bumped only on a breaking envelope change; a reader tolerates
/// drift by still trying to decode `eph`).
const FRAME_V: u8 = 1;

/// The wire `kind` for a claim-awareness frame. Distinct from every edit-lane kind
/// AND from `coord.signal` so the decoders never cross.
const KIND_CLAIM: &str = "claim.awareness";

/// A decoded claim-awareness frame: which replica published it and the raw
/// `EphemeralStore` update blob carrying its claim(s). `peer` is a `Copy` scalar
/// [`PeerId`], never a `String`, so it stays a cheap key end to end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimFrame {
    pub peer: PeerId,
    pub eph: Vec<u8>,
}

/// On-wire claim envelope — same discipline as the presence/op frames: `eph` is
/// base64 (an `EphemeralStore` blob is raw bytes; the tube is JSON text) and `peer`
/// is a decimal STRING so a near-`u64::MAX` id round-trips every bit (a JSON number
/// would lose its low bits as an IEEE-754 double — silent misattribution).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WireClaim {
    v: u8,
    kind: String,
    peer: String,
    eph: String,
}

/// Encode a peer's claim `EphemeralStore` update blob into a claim frame string for
/// [`crate::agent::DaemonClient::broadcast_claim`] on the file's
/// [`coordination_channel_for_path`](crate::editor_sync::coordination_channel_for_path).
pub fn encode_claim_frame(peer: PeerId, eph_bytes: &[u8]) -> String {
    let frame = WireClaim {
        v: FRAME_V,
        kind: KIND_CLAIM.to_string(),
        peer: peer.to_string(),
        eph: base64::engine::general_purpose::STANDARD.encode(eph_bytes),
    };
    serde_json::to_string(&frame).unwrap_or_default()
}

/// Decode a coordination-lane message into a [`ClaimFrame`], or `None` for anything
/// that is not a well-formed claim frame — a `coord.signal`, an edit-lane frame, the
/// `connected` handshake, a heartbeat, or garbage. Tolerant by design, mirroring
/// [`crate::editor_sync::decode_frame`]: a malformed frame is skipped, never fatal.
pub fn decode_claim_frame(text: &str) -> Option<ClaimFrame> {
    let frame: WireClaim = serde_json::from_str(text).ok()?;
    if frame.kind != KIND_CLAIM {
        return None;
    }
    let peer: PeerId = frame.peer.parse().ok()?;
    let eph = base64::engine::general_purpose::STANDARD.decode(frame.eph.as_bytes()).ok()?;
    if eph.is_empty() {
        return None;
    }
    Some(ClaimFrame { peer, eph })
}

/// How long (ms) a claim survives in the LIVE awareness view without a refresh before
/// it is considered stale. Deliberately far longer than presence's 30s: a claim means
/// "I am working here", which must outlive a GC pause or a think, but must NOT wedge a
/// region forever if the actor dies — so a dead actor's live claim eventually clears
/// while its **durable** twin (the `/files` mirror) persists until an authorized
/// release or future P3.5 claim-transfer transaction changes it. Generic salvage
/// does not transfer editor claims. A working actor re-publishes (heartbeats) well
/// inside this window.
pub const CLAIM_TIMEOUT_MS: i64 = 120_000;

/// The awareness-store key of a **revocation** marker for `(peer, id)`: the claim's
/// `<peer>:<id>` key with a `!` sentinel prefix, so it lives in a DISTINCT keyspace
/// that can never collide with the claim entry itself (see [`ClaimStore::release`] for
/// why a distinct key, not a same-key delete, is what survives the coarse LWW clock).
fn revocation_key(peer: PeerId, id: ClaimId) -> String {
    format!("!{peer}:{id}")
}

/// Parse a revocation marker key (`!<peer>:<id>`) back into its [`ClaimKey`], or
/// `None` if `s` is not one (a claim entry or garbage). The `!` prefix is what
/// distinguishes a revocation from a claim; a claim key never starts with `!`, so
/// [`ClaimKey::parse_store_key`] and this are mutually exclusive.
fn parse_revocation_key(s: &str) -> Option<ClaimKey> {
    ClaimKey::parse_store_key(s.strip_prefix('!')?)
}

/// A per-file **claim store**: a render-agnostic wrapper over Loro's
/// [`EphemeralStore`](loro::awareness::EphemeralStore) that carries each replica's
/// region claims as awareness state on the coordination lane, LWW-merged per key with
/// a [`CLAIM_TIMEOUT_MS`] horizon. This is *presence-as-claims* (ref 03 §2): the same
/// awareness substrate as cursors, but for the durable-intent "who owns which region".
///
/// ## Threading (why no `Arc<Mutex<..>>`)
/// Identical discipline to [`PresenceStore`](crate::editor_sync::PresenceStore): the
/// store lives entirely on the render/main thread, owned by the `EditorPane`. Claim
/// frames arrive over the coordination channel's `mpsc`, the pane folds them in on the
/// main thread, and reads [`ledger`](Self::ledger) back — no lock is shared across
/// threads. The store's internal `Arc` is Loro's own concern.
///
/// ## Own claims are IN the ledger (unlike remote cursors)
/// [`PresenceStore::remote_cursors`] excludes the local peer — you do not draw your
/// own remote-cursor chip. A claim ledger is the opposite: [`ledger`](Self::ledger)
/// includes the local peer's claims, because a replica renders its OWN reservation
/// bands too (and the durable mirror needs them). Self-exclusion happens only where a
/// query asks it ([`ClaimLedger::is_line_claimed_by_other`]).
pub struct ClaimStore {
    local: PeerId,
    store: loro::awareness::EphemeralStore,
}

impl ClaimStore {
    /// A fresh claim store for the local replica `local`.
    pub fn new(local: PeerId) -> Self {
        Self { local, store: loro::awareness::EphemeralStore::new(CLAIM_TIMEOUT_MS) }
    }

    /// The local replica id this store publishes under.
    pub fn local(&self) -> PeerId {
        self.local
    }

    /// Publish (or update) one of the LOCAL replica's region claims and return the
    /// encoded update blob to broadcast (wrap with [`encode_claim_frame`]). Only this
    /// claim's key is encoded — every other claim/peer republishes its own — so a
    /// frame stays small. The claim's `peer` is forced to `local`, so a caller cannot
    /// publish under another replica's identity.
    pub fn publish(&self, claim: &RegionClaim) -> Vec<u8> {
        let key = ClaimKey::new(self.local, claim.id);
        // Force local authorship, then store as one compact JSON string value.
        let owned = RegionClaim { peer: self.local, ..claim.clone() };
        let json = serde_json::to_string(&owned).unwrap_or_default();
        self.store.set(&key.store_key(), json);
        self.store.encode(&key.store_key())
    }

    /// Release one of the LOCAL replica's claims by id, returning the encoded
    /// **revocation** blob to broadcast — applying it on a remote replica makes
    /// [`ledger`](Self::ledger) subtract the claim.
    ///
    /// ## Why a revocation marker, NOT a same-key `delete`
    /// EphemeralStore is timestamp-LWW at **millisecond** resolution with a `>=` reject
    /// rule, so two operations on the SAME key within one millisecond do not order — the
    /// remote keeps whichever it saw first. A delete-based release tombstones the claim's
    /// OWN key, so an acquire-then-release inside a millisecond (an agent that grabs and
    /// immediately hands back, or any fast churn) would strand the claim on every remote.
    /// Publishing the revocation under a DISTINCT key (`!<peer>:<id>`) never collides with
    /// the acquire, so the ledger reliably subtracts it regardless of clock resolution or
    /// arrival order (error-handling-patterns: design the race out, don't lose to it).
    /// Releasing a claim you never held just plants a harmless, idempotent marker.
    pub fn release(&self, id: ClaimId) -> Vec<u8> {
        let rev = revocation_key(self.local, id);
        self.store.set(&rev, true);
        self.store.encode(&rev)
    }

    /// Fold a remote replica's claim blob (a decoded [`ClaimFrame::eph`]) into the
    /// store, LWW-merging it. Returns `Err` only if the blob is undecodable; a stale
    /// (older-timestamp) update imports as a no-op, so a replayed/out-of-order claim
    /// frame is harmless.
    pub fn apply(&self, eph_bytes: &[u8]) -> Result<(), String> {
        self.store.apply(eph_bytes).map_err(|e| e.to_string())
    }

    /// Rebuild the [`ClaimLedger`] from the store — every live claim from every peer
    /// (INCLUDING the local one), minus revocations. A released claim (its `!<peer>:<id>`
    /// marker is present) or an expired one is absent; an entry whose key or value fails
    /// to parse (drift/garbage) is skipped rather than crashing the ledger.
    pub fn ledger(&self) -> ClaimLedger {
        let states = self.store.get_all_states();
        // First pass: which (peer, id)s have a revocation marker.
        let mut revoked: std::collections::BTreeSet<ClaimKey> = std::collections::BTreeSet::new();
        for key in states.keys() {
            if let Some(k) = parse_revocation_key(key) {
                revoked.insert(k);
            }
        }
        // Second pass: live claim entries, minus anything revoked.
        let mut ledger = ClaimLedger::new();
        for (key, value) in &states {
            let Some(claim_key) = ClaimKey::parse_store_key(key) else { continue };
            if revoked.contains(&claim_key) {
                continue; // released — subtracted regardless of same-ms LWW ordering
            }
            let loro::LoroValue::String(s) = value else { continue };
            let Ok(claim) = serde_json::from_str::<RegionClaim>(s.as_ref()) else { continue };
            // Trust the key's identity over the payload's, and ignore a claim whose
            // key/payload disagree (defensive: a well-formed publish always agrees).
            if claim.key() == claim_key {
                ledger.upsert(claim);
            }
        }
        ledger
    }

    /// Drop claims whose awareness has aged past [`CLAIM_TIMEOUT_MS`] (a dead actor's
    /// stranded claim). Mirrors [`PresenceStore::expire`]; changes nothing until a
    /// claim actually times out, so an idle-but-live screen stays quiet.
    pub fn expire(&self) {
        self.store.remove_outdated();
    }
}

/// The semantic [`Tone`](crate::pane::Tone) a claim band renders with, **actor-colored
/// by `PeerId`** — reusing P2's presence coloring precedent
/// ([`author_tone`](crate::editor_pane::author_tone)): the local replica's own claim is
/// `Resting` (you), any other replica's is `Engaged` (a peer working here). Slice 1
/// claims are pure *visibility*, so they never use `Tone::Conflicted`/`Tone::Gated` —
/// those stay reserved for the later conflict-pulse and guard slices, so we add no
/// parallel color path (HARD RULE 3/5 live in those slices, not here).
pub fn claim_tone(claim_peer: PeerId, opener: PeerId) -> crate::pane::Tone {
    if claim_peer == opener {
        crate::pane::Tone::Resting
    } else {
        crate::pane::Tone::Engaged
    }
}

/// A clock-injected debounce gate for the **durable claims-table mirror**. A claim
/// acquire/resize should land in `/sessions/:id/files` (the persistent twin of the
/// live awareness range), but a fast region drag would otherwise POST on every
/// adjustment. This gate coalesces per-claim changes and flushes each distinct local
/// claim at most once per `min_interval_ms`, always carrying its latest span/label.
///
/// Clock-free (the caller passes `now_ms`) so it unit-tests deterministically with a
/// fake clock — no sleeps, no flakes — exactly like
/// [`PresenceDebouncer`](crate::editor_sync::PresenceDebouncer). Pending claims are
/// keyed by `Copy` [`ClaimId`] in a `BTreeMap` (deterministic flush order), so
/// adjusting one held region never drops another.
#[derive(Debug, Default)]
pub struct ClaimMirror {
    min_interval_ms: i64,
    last_sent_ms: Option<i64>,
    pending: BTreeMap<ClaimId, RegionClaim>,
}

impl ClaimMirror {
    /// A mirror gate that flushes at most once per `min_interval_ms`.
    pub fn new(min_interval_ms: i64) -> Self {
        Self { min_interval_ms, last_sent_ms: None, pending: BTreeMap::new() }
    }

    /// Record that a local claim needs mirroring (idempotent between flushes — it
    /// stashes the newest state per `ClaimId`; the POST happens in [`take_due`]).
    ///
    /// [`take_due`]: Self::take_due
    pub fn record(&mut self, claim: RegionClaim) {
        self.pending.insert(claim.id, claim);
    }

    /// If claims are pending AND enough time has elapsed since the last flush, drain
    /// and return them (arming the interval). Otherwise an empty `Vec` — the caller
    /// POSTs nothing, so an idle/quiet claim set produces zero durable-mirror traffic.
    pub fn take_due(&mut self, now_ms: i64) -> Vec<RegionClaim> {
        let due = match self.last_sent_ms {
            None => true,
            Some(last) => now_ms - last >= self.min_interval_ms,
        };
        if due && !self.pending.is_empty() {
            self.last_sent_ms = Some(now_ms);
            return std::mem::take(&mut self.pending).into_values().collect();
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::peer_id_for_identity;

    #[test]
    fn claim_key_store_key_round_trips_including_near_u64_max() {
        let key = ClaimKey::new(peer_id_for_identity("port-daddy:editor:agent-A"), 7);
        let s = key.store_key();
        assert_eq!(ClaimKey::parse_store_key(&s), Some(key), "a (peer, id) key round-trips");

        // A near-u64::MAX peer id must survive the decimal encoding every bit.
        let big = ClaimKey::new(u64::MAX - 3, 4_000_000_000);
        assert_eq!(ClaimKey::parse_store_key(&big.store_key()), Some(big));

        // Garbage / drift keys are skipped, never panic.
        assert_eq!(ClaimKey::parse_store_key("no-colon"), None);
        assert_eq!(ClaimKey::parse_store_key("notnum:1"), None);
        assert_eq!(ClaimKey::parse_store_key("5:notnum"), None);
    }

    #[test]
    fn region_claim_normalizes_span_and_answers_coverage() {
        let peer = peer_id_for_identity("port-daddy:editor:agent-A");
        // Constructed low←high (end < start): the span is stored ordered.
        let c = RegionClaim::new(peer, 0, 40, 12, "parse_header", 100);
        assert_eq!(c.line_span(), (12, 40), "span is stored low→high regardless of arg order");
        assert!(!c.covers(11), "line above the span is not covered");
        assert!(c.covers(12), "the start line is covered (inclusive)");
        assert!(c.covers(40), "the end line is covered (inclusive)");
        assert!(!c.covers(41), "line below the span is not covered");
        assert_eq!(c.key(), ClaimKey::new(peer, 0));
    }

    #[test]
    fn region_claims_overlap_only_when_spans_intersect() {
        let p = peer_id_for_identity("port-daddy:editor:agent-A");
        let header = RegionClaim::new(p, 0, 12, 40, "parse_header", 1);
        let footer = RegionClaim::new(p, 1, 200, 260, "write_footer", 2);
        let straddle = RegionClaim::new(p, 2, 38, 45, "rename", 3);
        assert!(!header.overlaps(&footer), "disjoint regions of one file do not overlap");
        assert!(header.overlaps(&straddle), "regions sharing line 38–40 overlap");
        assert!(straddle.overlaps(&header), "overlap is symmetric");
    }

    #[test]
    fn claim_frame_round_trips_and_stays_off_every_other_lane() {
        let peer = peer_id_for_identity("port-daddy:editor:agent-A");
        let eph = vec![1u8, 2, 3, 250, 255, 0, 9];
        let text = encode_claim_frame(peer, &eph);
        let decoded = decode_claim_frame(&text).expect("a well-formed claim frame decodes");
        assert_eq!(decoded.peer, peer, "claim peer round-trips every bit");
        assert_eq!(decoded.eph, eph, "the awareness blob round-trips through base64");

        // A near-u64::MAX peer id survives (decimal string, not JSON number).
        let big = u64::MAX - 5;
        assert_eq!(decode_claim_frame(&encode_claim_frame(big, &[1])).unwrap().peer, big);

        // The claim lane never crosses any edit-lane frame or the coord.signal frame.
        assert!(crate::editor_sync::decode_frame(&text).is_none(), "op decoder rejects a claim frame");
        assert!(crate::editor_sync::decode_presence_frame(&text).is_none(), "presence decoder rejects a claim frame");
        assert!(crate::editor_sync::decode_snapshot_frame(&text).is_none(), "snapshot decoder rejects a claim frame");
        assert!(crate::editor_sync::decode_coord_frame(&text).is_none(), "coord-signal decoder rejects a claim frame");
        // ...and the claim decoder rejects each of those, plus garbage/empty.
        assert!(decode_claim_frame(&crate::editor_sync::encode_frame(peer, &[1, 2, 3])).is_none());
        assert!(decode_claim_frame("not json").is_none());
        assert!(decode_claim_frame(r#"{"v":1,"kind":"claim.awareness","peer":"5","eph":""}"#).is_none());
        assert!(decode_claim_frame(r#"{"v":1,"kind":"claim.awareness","peer":"5","eph":"!!!"}"#).is_none());
    }

    /// THE P3 SLICE-1 PROOF (transport half) — a region claim rides the coordination
    /// lane as a Loro awareness range and lands, whole, in a REMOTE replica's ledger,
    /// keyed by the authoring peer's `ClaimKey`.
    #[test]
    fn claim_rides_awareness_and_lands_in_a_remote_ledger() {
        let a_peer = peer_id_for_identity("port-daddy:editor:agent-A");
        let b_peer = peer_id_for_identity("port-daddy:console:human-B");
        let store_a = ClaimStore::new(a_peer);
        let store_b = ClaimStore::new(b_peer);

        // A claims parse_header (lines 12–40) and its blob becomes a coord-lane frame.
        let claim = RegionClaim::new(a_peer, 0, 12, 40, "parse_header", 100);
        let frame_text = encode_claim_frame(a_peer, &store_a.publish(&claim));

        // B receives it off its coordination subscription and folds it in.
        let frame = decode_claim_frame(&frame_text).expect("A's claim frame decodes on B");
        assert_eq!(frame.peer, a_peer);
        store_b.apply(&frame.eph).expect("A's claim lands in B's store");

        let ledger = store_b.ledger();
        assert_eq!(ledger.len(), 1, "exactly A's claim is in B's ledger");
        let got = ledger.get(ClaimKey::new(a_peer, 0)).expect("keyed by A's ClaimKey");
        assert_eq!(got.label, "parse_header", "the work label survived the wire");
        assert_eq!(got.line_span(), (12, 40), "the region span survived the wire");
        assert_eq!(got.peer, a_peer, "authorship is intact");
    }

    /// THE P3 SLICE-1 REGION-GRANULARITY PROOF — claiming one symbol's line range does
    /// NOT lock the rest of the file. A claims `parse_header` (L12–40); every line
    /// OUTSIDE that span stays unowned, and a second actor freely claims a disjoint
    /// adjacent region of the SAME file. This is the defect-target from HARD RULE 1:
    /// a file-path-granularity claim would fail this test.
    #[test]
    fn region_claim_does_not_lock_the_rest_of_the_file() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let store_a = ClaimStore::new(a);
        let store_b = ClaimStore::new(b);

        // A claims parse_header, lines 12–40 of a long file; B folds A's frame in.
        let a_claim = RegionClaim::new(a, 0, 12, 40, "parse_header", 1);
        let a_frame = encode_claim_frame(a, &store_a.publish(&a_claim));
        store_b.apply(&decode_claim_frame(&a_frame).unwrap().eph).unwrap();

        let ledger = store_b.ledger();
        // INSIDE the claimed span: A owns it.
        assert_eq!(ledger.owners_of_line(12).len(), 1, "the start line is owned");
        assert_eq!(ledger.owners_of_line(40).len(), 1, "the end line is owned");
        assert_eq!(ledger.owners_of_line(25)[0].peer, a, "a mid-span line is A's");
        // OUTSIDE the span: the rest of the file is NOT locked.
        assert!(ledger.owners_of_line(1).is_empty(), "line 1 (above the claim) is free");
        assert!(ledger.owners_of_line(11).is_empty(), "the line just above the span is free");
        assert!(ledger.owners_of_line(41).is_empty(), "the line just below the span is free");
        assert!(ledger.owners_of_line(300).is_empty(), "a far line is free");

        // A SECOND actor claims a DISJOINT adjacent region (write_footer, L200–260) of
        // the SAME file — impossible if a claim were a whole-file lock.
        let b_claim = RegionClaim::new(b, 0, 200, 260, "write_footer", 2);
        store_b.apply(&store_b.publish(&b_claim)).unwrap();
        let ledger = store_b.ledger();
        assert_eq!(ledger.len(), 2, "two disjoint region claims coexist on one file");
        assert_eq!(ledger.owners_of_line(230)[0].peer, b, "the footer line is B's");
        assert!(ledger.owners_of_line(100).is_empty(), "the gap between the two regions stays free");

        // Region-scoped ownership queries respect the span, not the file.
        assert!(ledger.is_line_claimed_by_other(20, b), "L20 is claimed by A (an 'other' to B)");
        assert!(!ledger.is_line_claimed_by_other(20, a), "L20 is A's own — not an 'other' claim to A");
        assert!(ledger.is_line_claimed_by_other(230, a), "L230 is claimed by B (an 'other' to A)");
        assert!(!ledger.is_line_claimed_by_other(100, a), "the free gap is claimed by nobody");
        assert!(!ledger.is_line_claimed_by_other(100, b), "the free gap is claimed by nobody");
    }

    /// A release tombstones the claim out of a remote replica's ledger (Loro `delete`
    /// → a None-valued fresh-timestamp record that [`ClaimLedger`] rebuilds without).
    #[test]
    fn releasing_a_claim_tombstones_it_out_of_a_remote_ledger() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:console:human-B");
        let store_a = ClaimStore::new(a);
        let store_b = ClaimStore::new(b);

        // A claims, B sees it.
        let claim = RegionClaim::new(a, 3, 5, 9, "tidy_imports", 1);
        let acquire = encode_claim_frame(a, &store_a.publish(&claim));
        store_b.apply(&decode_claim_frame(&acquire).unwrap().eph).unwrap();
        assert_eq!(store_b.ledger().len(), 1, "B sees A's claim");

        // A releases claim id 3; the tombstone frame rides the same lane.
        let tomb = encode_claim_frame(a, &store_a.release(3));
        store_b.apply(&decode_claim_frame(&tomb).unwrap().eph).unwrap();
        assert!(store_b.ledger().is_empty(), "the released claim is gone from B's ledger");
        assert!(store_b.ledger().get(ClaimKey::new(a, 3)).is_none(), "no stale key remains");
    }

    /// REGRESSION LOCK for the coarse-clock LWW fix: an acquire IMMEDIATELY followed by
    /// a release — the two landing in the SAME millisecond — must still net out to "not
    /// claimed" on a remote replica. A same-key delete would strand the claim here (the
    /// remote keeps the equal-timestamp acquire); the distinct revocation key makes the
    /// subtraction independent of clock resolution. Repeated so a ms boundary can't hide
    /// the race.
    #[test]
    fn acquire_then_release_in_the_same_instant_nets_to_unclaimed() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:console:human-B");
        for id in 0..50u32 {
            let store_a = ClaimStore::new(a);
            let store_b = ClaimStore::new(b);
            // Acquire and release back-to-back (no clock advance between them).
            let acquire = encode_claim_frame(a, &store_a.publish(&RegionClaim::new(a, id, 1, 4, "churn", 1)));
            let release = encode_claim_frame(a, &store_a.release(id));
            // Deliver to B in order; the release must win regardless of same-ms stamps.
            store_b.apply(&decode_claim_frame(&acquire).unwrap().eph).unwrap();
            store_b.apply(&decode_claim_frame(&release).unwrap().eph).unwrap();
            assert!(store_b.ledger().is_empty(), "same-instant acquire+release nets to unclaimed (id {id})");
            // Even the acquirer's own ledger reflects the release.
            assert!(store_a.ledger().is_empty(), "the acquirer also sees its own release (id {id})");
        }
    }

    /// The ledger includes the LOCAL peer's own claims (unlike remote cursors, which
    /// exclude self) — a replica renders its own reservation bands and mirrors them.
    #[test]
    fn ledger_includes_the_local_peers_own_claims() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let store_a = ClaimStore::new(a);
        store_a.publish(&RegionClaim::new(a, 0, 3, 8, "own_work", 1));
        let ledger = store_a.ledger();
        assert_eq!(ledger.len(), 1, "the store's own ledger carries its own claim");
        assert_eq!(ledger.get(ClaimKey::new(a, 0)).map(|c| c.peer), Some(a));
    }

    /// One peer holds several DISJOINT region claims on one file at once; releasing one
    /// leaves the others — the per-claim keying (`<peer>:<id>`), not one-blob-per-peer.
    #[test]
    fn same_peer_holds_multiple_disjoint_region_claims() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let store = ClaimStore::new(a);
        store.publish(&RegionClaim::new(a, 0, 12, 40, "parse_header", 1));
        store.publish(&RegionClaim::new(a, 1, 200, 260, "write_footer", 2));
        let ledger = store.ledger();
        assert_eq!(ledger.len(), 2, "both of one peer's disjoint claims are live");

        store.apply(&store.release(0)).unwrap();
        let ledger = store.ledger();
        assert_eq!(ledger.len(), 1, "releasing one claim leaves the other");
        assert!(ledger.get(ClaimKey::new(a, 1)).is_some(), "write_footer still held");
        assert!(ledger.get(ClaimKey::new(a, 0)).is_none(), "parse_header released");
    }

    /// The durable-mirror gate coalesces rapid same-claim adjustments into ONE flush,
    /// carries distinct claims together, and stays silent inside the debounce window.
    #[test]
    fn claim_mirror_debounce_coalesces_and_flushes_per_claim() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let mut mirror = ClaimMirror::new(100); // ≤ 1 flush / 100ms

        // Idle: nothing pending → nothing due.
        assert!(mirror.take_due(0).is_empty(), "an idle claim set mirrors nothing");

        // Three rapid resizes of the SAME claim (id 0) before the first tick collapse
        // to the latest span.
        mirror.record(RegionClaim::new(a, 0, 12, 30, "parse_header", 1));
        mirror.record(RegionClaim::new(a, 0, 12, 35, "parse_header", 1));
        mirror.record(RegionClaim::new(a, 0, 12, 40, "parse_header", 1));
        // ...plus a distinct claim (id 1) that must flush alongside it.
        mirror.record(RegionClaim::new(a, 1, 200, 260, "write_footer", 2));

        let due = mirror.take_due(10);
        assert_eq!(due.len(), 2, "two distinct claims flush together");
        let header = due.iter().find(|c| c.id == 0).expect("the coalesced header claim");
        assert_eq!(header.line_span(), (12, 40), "only the newest span of id 0 is mirrored");

        // Within the interval a further resize does not flush again.
        mirror.record(RegionClaim::new(a, 0, 12, 50, "parse_header", 1));
        assert!(mirror.take_due(50).is_empty(), "suppressed inside the debounce window");
        // Past the interval the pending resize flushes.
        let due = mirror.take_due(120);
        assert_eq!(due.len(), 1, "the later resize flushes after the interval");
        assert_eq!(due[0].line_span(), (12, 50));
        // Nothing newly recorded → the next tick is silent.
        assert!(mirror.take_due(500).is_empty(), "no new claim → no mirror");
    }

    /// HARD RULE 6 seam: on two overlapping claims, `first_granted_owner_of_line`
    /// returns the earlier-granted, non-revoked one (ties broken by key). Slice 1
    /// enforces no guard on this — it only proves the ledger answers "who owns it".
    #[test]
    fn first_granted_owner_wins_on_contention() {
        let a = peer_id_for_identity("port-daddy:editor:agent-A");
        let b = peer_id_for_identity("port-daddy:editor:agent-B");
        let mut ledger = ClaimLedger::new();
        // B granted later (seq 9) than A (seq 3) over an overlapping span.
        ledger.upsert(RegionClaim::new(b, 0, 10, 30, "b_work", 9));
        ledger.upsert(RegionClaim::new(a, 0, 20, 40, "a_work", 3));
        let owner = ledger.first_granted_owner_of_line(25).expect("line 25 is contended");
        assert_eq!(owner.peer, a, "the first-granted (earlier seq) claim wins the contended line");
        // A line only B covers is B's.
        assert_eq!(ledger.first_granted_owner_of_line(12).unwrap().peer, b);
        // A free line has no owner.
        assert!(ledger.first_granted_owner_of_line(100).is_none());
    }

    /// Claim bands are actor-colored by PeerId: your own claim is Resting, a peer's is
    /// Engaged (reusing the presence coloring precedent; no Conflicted/Gated in slice 1).
    #[test]
    fn claim_tone_colors_by_peer() {
        let opener = peer_id_for_identity("port-daddy:console:operator");
        let agent = peer_id_for_identity("port-daddy:editor:agent-Z");
        assert!(matches!(claim_tone(opener, opener), crate::pane::Tone::Resting));
        assert!(matches!(claim_tone(agent, opener), crate::pane::Tone::Engaged));
    }
}
