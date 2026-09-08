import Foundation

// MARK: - HITL operator interruptions (ADR-0125 §2 item 1, docs/hitl-interruptions.md §4)
//
// The v1 spine. The relay owns the decaying-nag state machine — full jitter,
// stage dedupe, hard stop after five delivered nags, per-operator page budget.
// ADR-0125 is blunt about what the app is allowed to be:
//
//   "The app is a renderer and an answer path, not a second nag engine."
//
// So there are no nag constants in this file. Not URGENCY_BASE_SECONDS, not
// MAX_NAGS, not PAGE_BUDGET_PER_HOUR. A second copy of those numbers on the
// phone is a second nag engine with extra steps.
//
// The §4 UI contract this implements:
//   1. Poll GET /v1/interruptions?state=open at <= 30 s WITH FULL JITTER.
//   2. Surface within 60 seconds.
//   3. Block dependent work while a `critical` ask is open.
//   4. Deep-link to the session-gated answer/ack surface.
//   5. Never fabricate — a failed poll renders "unknown", never "all clear".
//
// ── WHY THERE IS NO IN-APP ANSWER POST ───────────────────────────────────────
//
// Verified against apps/relay/src/interruptions.ts on this branch, not assumed:
// `closeInterruption` — the shared path behind BOTH /answer and /ack — begins
//
//     if (!isSameOrigin(request, env)) return json(403, ...)
//     const session = await resolveSession(request, env);
//     if (!session) return json(401, { code: 'UNAUTHENTICATED',
//                                      error: 'a signed-in session is required' });
//
// `resolveSession`, not `resolveUserFromRequest`. A `pdu_` bearer token — the
// only credential a native client holds — cannot close an interruption at all,
// by design: a token must never be able to silence its own escalations.
// FleetBar reached the same conclusion and its store has no answer method
// either.
//
// Therefore this app READS the inbox with its bearer token and HANDS OFF to
// the session-gated web surface to answer or ack. That is ADR-0125 §2.1's
// "deep-link to the session-gated answer/ack surface", implemented literally.
// Do not add a POST here to make the button feel native: it would 401, or
// worse, it would work for the wrong reason.

public enum InterruptionUrgency: String, CaseIterable, Sendable, Codable {
    case low
    case normal
    case high
    case critical

    /// high/critical must be visually loud.
    public var isLoud: Bool { self == .high || self == .critical }

    public var label: String { rawValue.uppercased() }

    /// Sort weight — the relay orders `critical > high > normal > low` and the
    /// list keeps that order rather than re-sorting by arrival.
    public var rank: Int {
        switch self {
        case .critical: return 0
        case .high:     return 1
        case .normal:   return 2
        case .low:      return 3
        }
    }

    public var coordinationState: CoordinationState {
        switch self {
        case .critical: return .mayday
        case .high:     return .awaitingHuman
        case .normal:   return .request
        case .low:      return .inform
        }
    }
}

/// The relay's four states. Validated server-side against
/// `STATES = ['open','acked','answered','expired']`.
public enum InterruptionState: String, CaseIterable, Sendable, Codable {
    case open
    case acked
    case answered
    case expired

    public var isClosed: Bool { self != .open }

    public var label: String { rawValue.uppercased() }
}

/// One ask, shaped exactly as the relay's `publicShape` returns it.
///
/// Every field but `id` and `title` decodes defensively: a newer relay adding
/// or dropping an optional must not blank the operator's inbox.
public struct OperatorInterruption: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    /// An INTEGER in the relay, therefore an `Int` here.
    ///
    /// `installation_id INTEGER` (migrations/2026-08-04-operator-interruptions.sql
    /// and the relay baseline), `installation_id: number | null` on
    /// `InterruptionRow`, accepted on creation only as
    /// `typeof b.installation_id === 'number' && Number.isInteger(...)`, and
    /// passed straight through by `publicShape`. The wire value is a JSON
    /// NUMBER. This was declared `String?` and decoded with
    /// `decodeIfPresent(String.self,...)`, which returns nil only for an absent
    /// key or an explicit null and THROWS `DecodingError.typeMismatch` on a
    /// number — and because `InterruptionListResponse.interruptions` is a
    /// non-optional array, one such ask aborts the whole decode, `RelayClient`
    /// reports `.decoding`, and the Asks tab renders `.unknown`. Every operator
    /// whose asks carry a GitHub App installation scope would have seen "open
    /// asks are unknown" instead of their critical ask.
    public let installationId: Int?
    public let sourceAgent: String
    public let sourceSession: String?
    public let title: String
    public let body: String
    public let urgency: InterruptionUrgency
    public let state: InterruptionState
    public let answer: String?
    /// Epoch SECONDS, as the relay stores them.
    public let createdAt: Double
    public let nagCount: Int
    public let lastNaggedAt: Double?
    public let closedAt: Double?

    /// `CaseIterable` so InterruptionsInboxTests can assert this type models
    /// EXACTLY the keys `publicShape` emits — a relay that adds a field the
    /// phone never modelled should be a red test, not a silent omission.
    enum CodingKeys: String, CodingKey, CaseIterable {
        case id, installationId, sourceAgent, sourceSession, title, body
        case urgency, state, answer, createdAt, nagCount, lastNaggedAt, closedAt
    }

    /// Reads the installation scope without ever throwing.
    ///
    /// The scope is a LABEL on an ask, not the ask. This decode sits inside an
    /// all-or-nothing array decode, so a throw here does not cost the operator
    /// one label — it costs them every ask in the response. A number is the
    /// shape the relay sends today; the string branch exists so that a relay
    /// which widens the column, or a proxy which stringifies integers, degrades
    /// to a usable scope instead of a blank inbox. Anything else is nil, which
    /// is what an ask with no installation scope already looks like.
    private static func decodeInstallationId(_ c: KeyedDecodingContainer<CodingKeys>) -> Int? {
        if let asNumber = try? c.decodeIfPresent(Int.self, forKey: .installationId) {
            return asNumber
        }
        if let asString = try? c.decodeIfPresent(String.self, forKey: .installationId) {
            // `try?` flattens the optional (SE-0230), so `asString` is a String,
            // not a String? — `.flatMap` on it would resolve to Sequence.flatMap
            // and map over Characters, yielding [Int]. Int(_:) is the conversion
            // that was meant, and it already returns nil for a non-numeric string.
            return Int(asString)
        }
        return nil
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        installationId = Self.decodeInstallationId(c)
        sourceAgent = (try c.decodeIfPresent(String.self, forKey: .sourceAgent)) ?? "unknown agent"
        sourceSession = try c.decodeIfPresent(String.self, forKey: .sourceSession)
        body = (try c.decodeIfPresent(String.self, forKey: .body)) ?? ""
        // An unrecognised urgency decodes as .normal rather than throwing: a
        // dropped ask is worse than a mis-ranked one. An unrecognised STATE,
        // by contrast, decodes as .open — the safe direction is "still needs
        // you", never "already handled".
        let rawUrgency = (try c.decodeIfPresent(String.self, forKey: .urgency)) ?? "normal"
        urgency = InterruptionUrgency(rawValue: rawUrgency) ?? .normal
        let rawState = (try c.decodeIfPresent(String.self, forKey: .state)) ?? "open"
        state = InterruptionState(rawValue: rawState) ?? .open
        answer = try c.decodeIfPresent(String.self, forKey: .answer)
        createdAt = (try c.decodeIfPresent(Double.self, forKey: .createdAt)) ?? 0
        nagCount = (try c.decodeIfPresent(Int.self, forKey: .nagCount)) ?? 0
        lastNaggedAt = try c.decodeIfPresent(Double.self, forKey: .lastNaggedAt)
        closedAt = try c.decodeIfPresent(Double.self, forKey: .closedAt)
    }

    public init(
        id: String,
        installationId: Int? = nil,
        sourceAgent: String,
        sourceSession: String? = nil,
        title: String,
        body: String = "",
        urgency: InterruptionUrgency,
        state: InterruptionState = .open,
        answer: String? = nil,
        createdAt: Double,
        nagCount: Int = 0,
        lastNaggedAt: Double? = nil,
        closedAt: Double? = nil
    ) {
        self.id = id
        self.installationId = installationId
        self.sourceAgent = sourceAgent
        self.sourceSession = sourceSession
        self.title = title
        self.body = body
        self.urgency = urgency
        self.state = state
        self.answer = answer
        self.createdAt = createdAt
        self.nagCount = nagCount
        self.lastNaggedAt = lastNaggedAt
        self.closedAt = closedAt
    }

    public func age(now: Date = Date()) -> TimeInterval {
        max(0, now.timeIntervalSince1970 - createdAt)
    }
}

/// The list response: `{ code, error, openCount, interruptions }`.
public struct InterruptionListResponse: Codable, Sendable {
    public let code: String
    public let error: String?
    public let openCount: Int?
    public let interruptions: [OperatorInterruption]
}

/// What the inbox knows.
///
/// `unknown` is a first-class state, not an empty list. Before the first
/// successful poll, and after ANY failed poll, the inbox is unknown — it does
/// not say "all clear", because it does not know that. An operator who has
/// been told "all clear" by a surface that simply could not reach the relay
/// stops looking, which is the whole failure this enum exists to prevent.
public enum InterruptionInboxStatus: Equatable, Sendable {
    case unknown(reason: String)
    case loaded(openCount: Int)

    public var isUnknown: Bool {
        if case .unknown = self { return true }
        return false
    }

    /// The badge number, or nil when unknown. Nil renders as "?" — never 0.
    public var badgeCount: Int? {
        if case .loaded(let count) = self { return count }
        return nil
    }
}

public enum InterruptionInbox {

    /// Contract order: urgency descending, then oldest first. The relay
    /// already sorts this way for a `?state=` query; re-applying it locally
    /// keeps a merged or filtered list in the same order.
    public static func inContractOrder(_ items: [OperatorInterruption]) -> [OperatorInterruption] {
        items.sorted { lhs, rhs in
            if lhs.urgency.rank != rhs.urgency.rank { return lhs.urgency.rank < rhs.urgency.rank }
            if lhs.createdAt != rhs.createdAt { return lhs.createdAt < rhs.createdAt }
            return lhs.id < rhs.id
        }
    }

    /// The open `critical` ask that blocks dependent work, if any.
    ///
    /// Contract point 3: while a critical ask is open, dependent work is
    /// blocked and the ask's title is the stated reason. The caller renders
    /// that reason; it never disables a control without naming the ask.
    public static func blockingCritical(_ items: [OperatorInterruption]) -> OperatorInterruption? {
        inContractOrder(items).first { $0.state == .open && $0.urgency == .critical }
    }

    /// Full-jitter poll delay: a uniform draw over (0, cap], never a fixed
    /// offset and never a fixed base plus jitter. Contract point 1 caps the
    /// interval at 30 s.
    ///
    /// Full jitter is the whole point — a fleet of phones on a fixed 30 s
    /// timer is a synchronised thundering herd against the relay.
    public static let pollCapSeconds: TimeInterval = 30

    public static func nextPollDelay(
        cap: TimeInterval = pollCapSeconds,
        randomizer: (ClosedRange<Double>) -> Double = { Double.random(in: $0) }
    ) -> TimeInterval {
        let bounded = max(1, cap)
        return randomizer(0.001...bounded)
    }
}

/// Where the operator goes to answer or ack.
///
/// Not a request. A destination. See the file header for why.
public struct InterruptionHandoff: Equatable, Sendable {
    public let url: URL
    public let explanation: String

    /// The session-gated web surface, `GET /account/interruptions`, which is a
    /// real registered route on the relay.
    public static func webAnswerSurface(relayBaseURL: URL, interruptionID: String? = nil) -> InterruptionHandoff {
        var url = relayBaseURL.appendingPathComponent("account").appendingPathComponent("interruptions")
        if let interruptionID,
           var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.fragment = interruptionID
            if let built = components.url { url = built }
        }
        return InterruptionHandoff(
            url: url,
            explanation: "Answering signs you in on the web. Port Daddy will not let a device token close an ask it could have caused."
        )
    }
}
