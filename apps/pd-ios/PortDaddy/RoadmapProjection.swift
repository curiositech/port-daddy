import Foundation

// MARK: - Roadmap projection — the read model behind the home screen
//
// CANONICAL SOURCE: lib/roadmap-projection.ts (`ROADMAP_PROJECTION_VERSION = 1`).
// That module's parsimony law is why these are dumb Codable structs and not a
// second derivation:
//
//   "those surfaces render THIS projection — they never re-derive roadmap
//    state from roadmap_items / claims / dispatches themselves. One
//    derivation, three renderers. A surface that needs a field the projection
//    lacks adds it HERE (additively, tolerant-reader on the consumer side)."
//
// So: nothing in this file computes roadmap state. It decodes it, and it
// refuses to overstate it (see `RoadmapLiveEvidence.displayState`).
//
// UNBUILT — READ BEFORE WIRING:
//   No HTTP route serves this projection yet. There is no /v1/roadmap and no
//   /account/roadmap registration in apps/relay/src/index.ts. The projection
//   is code without an endpoint. Until that route exists the home screen runs
//   off the bundled fixture and says so on screen — see RoadmapHomeView's
//   source banner. Do not invent a path here to make it look finished.
//
// Tolerant reader: unknown status/kind/reason strings decode as themselves and
// render as themselves rather than throwing, so a projection that grows a new
// status does not blank an older build's home screen.

/// `RoadmapStatus`. A struct rather than an enum so an unrecognised status
/// off the wire survives decoding — the tolerant-reader half of the parsimony
/// law.
public struct RoadmapStatus: RawRepresentable, Hashable, Sendable, Codable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let now = RoadmapStatus(rawValue: "now")
    public static let merge = RoadmapStatus(rawValue: "merge")
    public static let backlog = RoadmapStatus(rawValue: "backlog")
    public static let parked = RoadmapStatus(rawValue: "parked")
    public static let done = RoadmapStatus(rawValue: "done")

    /// `STATUS_RANK` — the primary sort key. An unknown status sorts after
    /// every known one instead of jumping the queue.
    public static let ranked: [RoadmapStatus] = [.now, .merge, .backlog, .parked, .done]

    public var rank: Int {
        RoadmapStatus.ranked.firstIndex(of: self) ?? RoadmapStatus.ranked.count
    }

    public var isKnown: Bool { RoadmapStatus.ranked.contains(self) }

    public var label: String { rawValue.uppercased() }

    public init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// `RoadmapReceiptKind` — 'status-event' | 'note' | 'dispatch'.
public struct RoadmapReceiptKind: RawRepresentable, Hashable, Sendable, Codable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let statusEvent = RoadmapReceiptKind(rawValue: "status-event")
    public static let note = RoadmapReceiptKind(rawValue: "note")
    public static let dispatch = RoadmapReceiptKind(rawValue: "dispatch")

    // if/else rather than a switch: this is a struct, not an enum, so there is
    // no exhaustiveness to gain and an unrecognised kind must fall through to
    // a neutral glyph rather than being forced into one of the three we know.
    public var systemImage: String {
        if self == .statusEvent { return "arrow.triangle.swap" }
        if self == .note { return "text.alignleft" }
        if self == .dispatch { return "paperplane" }
        return "circle"
    }

    public init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// `RoadmapDoThisNextEntry.reason` — 'status-now' | 'popper-next'.
public struct RoadmapDoThisNextReason: RawRepresentable, Hashable, Sendable, Codable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let statusNow = RoadmapDoThisNextReason(rawValue: "status-now")
    public static let popperNext = RoadmapDoThisNextReason(rawValue: "popper-next")

    /// What the rail says about why this entry is here. The rail is surfaced
    /// at the entry of every sanctioned surface, so the phrasing matches the
    /// other homes rather than being invented for the phone.
    public var explanation: String {
        if self == .statusNow { return "Status is now" }
        if self == .popperNext { return "Next up — dependencies are done and nothing is dispatched" }
        return rawValue
    }

    public init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct RoadmapProjectionReceipt: Codable, Hashable, Sendable {
    public let kind: RoadmapReceiptKind
    /// Epoch milliseconds, as the projection emits.
    public let at: Double
    public let by: String?
    public let detail: String

    public init(kind: RoadmapReceiptKind, at: Double, by: String?, detail: String) {
        self.kind = kind
        self.at = at
        self.by = by
        self.detail = detail
    }
}

public struct RoadmapProjectionClaim: Codable, Hashable, Sendable {
    public let claimedBy: String
    public let claimedAt: Double
    public let kind: String
    public let sessionId: String?
    public let agentId: String?

    public init(claimedBy: String, claimedAt: Double, kind: String, sessionId: String?, agentId: String?) {
        self.claimedBy = claimedBy
        self.claimedAt = claimedAt
        self.kind = kind
        self.sessionId = sessionId
        self.agentId = agentId
    }
}

/// `RoadmapLiveEvidence`. The projection has already decided whether an item
/// is live and has already written the sentence explaining why. This type
/// carries both and adds exactly one rule of its own: it will not render LIVE
/// on evidence that does not support it.
public struct RoadmapLiveEvidence: Codable, Hashable, Sendable {
    public let live: Bool
    /// 'popper-dispatch' or null.
    public let source: String?
    public let dispatchId: String?
    public let lastEvidenceAt: Double?
    public let ageMs: Double?
    /// `ROADMAP_LIVE_EVIDENCE_MAX_AGE_MS` — 65_000 at the time of writing.
    /// Read from the projection, never hard-coded here, so the freshness
    /// window is the server's to move.
    public let maxAgeMs: Double
    /// The projection's own honesty label, e.g. "live — events arriving",
    /// "static — no dispatch receipt trail". Rendered verbatim; the phone does
    /// not paraphrase the server's account of what it knows.
    public let label: String

    public init(
        live: Bool,
        source: String?,
        dispatchId: String?,
        lastEvidenceAt: Double?,
        ageMs: Double?,
        maxAgeMs: Double,
        label: String
    ) {
        self.live = live
        self.source = source
        self.dispatchId = dispatchId
        self.lastEvidenceAt = lastEvidenceAt
        self.ageMs = ageMs
        self.maxAgeMs = maxAgeMs
        self.label = label
    }

    /// How the chip renders.
    public enum DisplayState: Equatable, Sendable {
        /// Events are arriving now, and the evidence backs it.
        case live
        /// There is a receipt trail but the last evidence is older than the
        /// freshness window — cached truth, shown as cached.
        case stale
        /// No dispatch at all. Not stale, not live: nothing ever streamed.
        case noEvidence

        public var label: String {
            switch self {
            case .live:       return "LIVE"
            case .stale:      return "STALE"
            case .noEvidence: return "NO EVIDENCE"
            }
        }

        public var coordinationState: CoordinationState {
            switch self {
            case .live:       return .claimActive
            case .stale:      return .claimStale
            case .noEvidence: return .idle
            }
        }
    }

    /// Law 13, rendered honestly.
    ///
    /// The projection's `live` flag is necessary but not sufficient: a chip
    /// says LIVE only when there is a dispatch, there is a timestamp, and that
    /// timestamp is inside the server's own freshness window. A projection
    /// that says `live: true` with no evidence behind it renders STALE, not
    /// LIVE — a stale chip is a small disappointment, a fake LIVE is an
    /// operator acting on a body that stopped talking.
    public var displayState: DisplayState {
        guard dispatchId != nil else { return .noEvidence }
        guard live, let age = ageMs, lastEvidenceAt != nil, age <= maxAgeMs else { return .stale }
        return .live
    }

    /// Age of the last evidence, when there is any.
    public var evidenceAge: TimeInterval? {
        guard let ageMs else { return nil }
        return ageMs / 1000
    }
}

public struct RoadmapProjectionItem: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let slug: String
    public let title: String
    public let status: RoadmapStatus
    public let priority: Int
    public let claim: RoadmapProjectionClaim?
    public let receipts: [RoadmapProjectionReceipt]
    public let liveEvidence: RoadmapLiveEvidence
    public let lastTouchedAt: Double
    public let dependencies: [String]

    public init(
        id: String,
        slug: String,
        title: String,
        status: RoadmapStatus,
        priority: Int,
        claim: RoadmapProjectionClaim?,
        receipts: [RoadmapProjectionReceipt],
        liveEvidence: RoadmapLiveEvidence,
        lastTouchedAt: Double,
        dependencies: [String]
    ) {
        self.id = id
        self.slug = slug
        self.title = title
        self.status = status
        self.priority = priority
        self.claim = claim
        self.receipts = receipts
        self.liveEvidence = liveEvidence
        self.lastTouchedAt = lastTouchedAt
        self.dependencies = dependencies
    }
}

public struct RoadmapDoThisNextEntry: Codable, Hashable, Sendable, Identifiable {
    public let slug: String
    public let title: String
    public let reason: RoadmapDoThisNextReason

    public var id: String { slug }

    public init(slug: String, title: String, reason: RoadmapDoThisNextReason) {
        self.slug = slug
        self.title = title
        self.reason = reason
    }
}

/// `RoadmapProjection` — `{ v: 1, harbor, generatedAt, items, doThisNext }`.
public struct RoadmapProjection: Codable, Hashable, Sendable {
    public let v: Int
    public let harbor: String
    public let generatedAt: Double
    public let items: [RoadmapProjectionItem]
    public let doThisNext: [RoadmapDoThisNextEntry]

    /// `ROADMAP_PROJECTION_VERSION`. A projection announcing a version this
    /// build does not know still renders — it is additive by law — but the
    /// home screen says so rather than pretending it understood every field.
    public static let knownVersion = 1

    /// `DO_THIS_NEXT_MAX`.
    public static let doThisNextMax = 5

    public var isKnownVersion: Bool { v == RoadmapProjection.knownVersion }

    public init(v: Int, harbor: String, generatedAt: Double, items: [RoadmapProjectionItem], doThisNext: [RoadmapDoThisNextEntry]) {
        self.v = v
        self.harbor = harbor
        self.generatedAt = generatedAt
        self.items = items
        self.doThisNext = doThisNext
    }

    /// The projection arrives already sorted by `buildRoadmapProjection`. This
    /// re-applies the same order locally so a list the phone filters or merges
    /// cannot silently reorder relative to the console and the web home:
    /// STATUS_RANK, then priority ascending, then lastTouchedAt DESCENDING,
    /// then slug.
    public static func inProjectionOrder(_ items: [RoadmapProjectionItem]) -> [RoadmapProjectionItem] {
        items.sorted { lhs, rhs in
            if lhs.status.rank != rhs.status.rank { return lhs.status.rank < rhs.status.rank }
            if lhs.priority != rhs.priority { return lhs.priority < rhs.priority }
            if lhs.lastTouchedAt != rhs.lastTouchedAt { return lhs.lastTouchedAt > rhs.lastTouchedAt }
            return lhs.slug < rhs.slug
        }
    }
}
