import Foundation

// MARK: - Harbors and reachability (ADR-0125 §2 item 2, §6)
//
// A harbor is a shared workspace; reachability is the operator's answer to
// "can I actually reach the bodies in it right now". The X2 enum is four
// values, and the fourth one is the point:
//
//   possible | degraded | impossible | unknown
//
// SPLIT-PLANE LAW (ADR-0125 §6), which this file and HarborsView implement:
//
//   "verdicts inform degradation, never gate existence."
//
//   - No splash screen blocks on a status fetch. The list renders first.
//   - `unknown` renders the last cached verdict PLUS ITS AGE, and retries with
//     full jitter. `unknown` is never treated as `impossible`.
//   - Hard gates only on a machine-readable `impossible`, and PER CAPABILITY,
//     never app-wide.
//   - Disconnected shows cached, read-only, with a stale marker, and must not
//     pretend to have live authority.
//
// UNBUILT — READ BEFORE WIRING:
//   The relay serves NO JSON reachability verdict. apps/relay/src/harbors.ts
//   defers it in its own header ("reachability verdicts (possible|degraded|
//   impossible|unknown)" listed as v2+). The only implementation anywhere is
//   an HTML account page on a separate branch. So `Reachability.derive` below
//   reproduces that page's rules client-side from
//   GET /v1/harbors/:ns/:name/presence, which IS real, and the UI labels the
//   verdict as locally derived and ADVISORY. If the relay later ships a
//   verdict of its own, the server's answer wins and this derivation goes.

/// One harbor as `harborJson` returns it from GET /v1/harbors.
public struct Harbor: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let namespace: String
    public let name: String
    public let pubkey: String
    /// Epoch seconds.
    public let createdAt: Double
    /// 'owner' | 'member' — the caller's role.
    public let role: String

    public var slug: String { "\(namespace)/\(name)" }

    public init(id: String, namespace: String, name: String, pubkey: String, createdAt: Double, role: String) {
        self.id = id
        self.namespace = namespace
        self.name = name
        self.pubkey = pubkey
        self.createdAt = createdAt
        self.role = role
    }
}

/// One live presence entry from GET /v1/harbors/:ns/:name/presence.
/// `kind` is 'user' or 'daemon'; `member` is a login for users and a
/// fingerprint for daemons.
public struct PresenceEntry: Codable, Hashable, Sendable {
    public let kind: String
    public let member: String
    public let tier: String?
    /// Epoch seconds.
    public let lastSeenAt: Double

    public var isDaemon: Bool { kind == "daemon" }

    public init(kind: String, member: String, tier: String?, lastSeenAt: Double) {
        self.kind = kind
        self.member = member
        self.tier = tier
        self.lastSeenAt = lastSeenAt
    }
}

/// The presence response body.
public struct PresenceSnapshot: Codable, Hashable, Sendable {
    public let online: [PresenceEntry]
    /// PRESENCE_TTL_SECONDS — 90 on the relay today. Read from the response,
    /// not assumed, so the phone's idea of "live" cannot drift from the
    /// relay's.
    public let ttlSeconds: Double

    public init(online: [PresenceEntry], ttlSeconds: Double) {
        self.online = online
        self.ttlSeconds = ttlSeconds
    }
}

/// The X2 verdict enum.
public enum ReachabilityVerdict: String, CaseIterable, Sendable, Codable {
    case possible
    case degraded
    case impossible
    case unknown

    public var label: String { rawValue.uppercased() }

    /// Flag state, so the chip goes through lib/maritime-signals.ts like
    /// every other state on every other surface.
    public var coordinationState: CoordinationState {
        switch self {
        case .possible:   return .fleetHealthy
        case .degraded:   return .blocked
        case .impossible: return .awaitingHuman
        case .unknown:    return .idle
        }
    }

    /// One line explaining the verdict in operator terms.
    public var explanation: String {
        switch self {
        case .possible:   return "Every daemon member is heartbeating."
        case .degraded:   return "Some daemon members are heartbeating, some are not."
        case .impossible: return "No daemon member is heartbeating."
        case .unknown:    return "Presence could not be read. This is not the same as unreachable."
        }
    }

    /// Whether a capability may be hard-gated on this verdict.
    ///
    /// ONLY `impossible` gates, and only the capability that needs a live
    /// body — never the whole app, never the list, never a splash. `unknown`
    /// returns false, which is the entire reason this property exists rather
    /// than a `verdict != .possible` check written inline at each call site.
    public var gatesRemoteCapability: Bool { self == .impossible }
}

/// A verdict plus when it was observed, because ADR-0125 §6 requires a stale
/// verdict to be shown WITH ITS AGE rather than presented as current.
public struct ReachabilityReading: Hashable, Sendable {
    public let verdict: ReachabilityVerdict
    public let onlineDaemons: Int
    public let totalDaemons: Int
    public let observedAt: Date
    /// True when this reading came from cache after a failed refresh — the
    /// stale marker the split-plane law requires.
    public let isCached: Bool

    public init(
        verdict: ReachabilityVerdict,
        onlineDaemons: Int,
        totalDaemons: Int,
        observedAt: Date,
        isCached: Bool = false
    ) {
        self.verdict = verdict
        self.onlineDaemons = onlineDaemons
        self.totalDaemons = totalDaemons
        self.observedAt = observedAt
        self.isCached = isCached
    }

    public func age(now: Date = Date()) -> TimeInterval {
        max(0, now.timeIntervalSince(observedAt))
    }

    /// What the chip's caption says. A cached reading always names its age; a
    /// live one never claims an age it does not have.
    public func caption(now: Date = Date()) -> String {
        if isCached {
            return "last known \(RelativeAge.short(age(now: now))) ago"
        }
        if verdict == .unknown {
            return "no reading yet"
        }
        return "\(onlineDaemons)/\(totalDaemons) daemons heartbeating"
    }

    /// The reading to show when a refresh failed: the old verdict, kept, but
    /// marked cached so its age renders. Falls back to `unknown` when there is
    /// nothing cached — never to `impossible`.
    public static func cached(from previous: ReachabilityReading?, now: Date = Date()) -> ReachabilityReading {
        guard let previous else {
            return ReachabilityReading(verdict: .unknown, onlineDaemons: 0, totalDaemons: 0, observedAt: now, isCached: false)
        }
        return ReachabilityReading(
            verdict: previous.verdict,
            onlineDaemons: previous.onlineDaemons,
            totalDaemons: previous.totalDaemons,
            observedAt: previous.observedAt,
            isCached: true
        )
    }
}

public enum Reachability {

    /// Derive a verdict from a presence snapshot plus the harbor's known
    /// daemon membership.
    ///
    /// Rules, transcribed from the HTML implementation so the phone and the
    /// web page cannot disagree:
    ///
    ///   possible   — every daemon member has a live heartbeat
    ///   degraded   — some daemon members live, some not
    ///   impossible — no daemon member live, INCLUDING "no daemon members at
    ///                all" (totalDaemons == 0 -> impossible)
    ///   unknown    — membership or presence could not be read
    ///
    /// The `totalDaemons == 0` case reads oddly and is deliberate: a harbor
    /// with no daemon in it cannot reach anything, which is exactly what
    /// `impossible` means. It is not an error state.
    public static func derive(
        totalDaemonMembers: Int,
        presence: PresenceSnapshot?,
        now: Date = Date()
    ) -> ReachabilityReading {
        guard let presence else {
            // Could not read presence. NOT impossible.
            return ReachabilityReading(verdict: .unknown, onlineDaemons: 0, totalDaemons: totalDaemonMembers, observedAt: now)
        }
        let onlineDaemons = presence.online.filter(\.isDaemon).count
        if totalDaemonMembers <= 0 {
            return ReachabilityReading(verdict: .impossible, onlineDaemons: 0, totalDaemons: 0, observedAt: now)
        }
        let verdict: ReachabilityVerdict
        if onlineDaemons <= 0 {
            verdict = .impossible
        } else if onlineDaemons >= totalDaemonMembers {
            verdict = .possible
        } else {
            verdict = .degraded
        }
        return ReachabilityReading(
            verdict: verdict,
            onlineDaemons: min(onlineDaemons, totalDaemonMembers),
            totalDaemons: totalDaemonMembers,
            observedAt: now
        )
    }
}

/// Short human ages ("42s", "6m", "3h", "2d"). Hand-rolled rather than
/// RelativeDateTimeFormatter so the strings are deterministic and testable.
public enum RelativeAge {
    public static func short(_ seconds: TimeInterval) -> String {
        let s = Int(max(0, seconds.rounded()))
        if s < 60 { return "\(s)s" }
        if s < 3600 { return "\(s / 60)m" }
        if s < 86_400 { return "\(s / 3600)h" }
        return "\(s / 86_400)d"
    }
}
