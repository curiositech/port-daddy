import Foundation

// MARK: - Agents — the durable cast (design pass: mobile-intent-first)
//
// The fleet, re-seen. The operator does not want a process list; they want a
// CAST of named identities that persist across restarts, each followable, each
// with a transcript they can tail. The ephemeral worker processes run
// underneath a durable agent; this surface never surfaces them directly.
//
// This model is a hand-authored fixture type, like HarborFixture — it has no
// generator behind it yet because the durable-agent roster endpoint and the
// actor-subscription ("follow") streams are not built on the relay. Every view
// that renders it therefore shows a ProvenanceBar(.fixture(...)), and the
// per-agent controls render disabled-with-reason, exactly as ControlVerbsView
// does: a follow toggle or a Steer button that looked live and did nothing
// would be the dishonesty the rest of this surface is built to prevent.

/// One durable agent: a named identity with continuity across sessions.
public struct DurableAgent: Codable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// Two-letter monogram for the roster row. Kept in the fixture rather than
    /// derived so a two-word name ("Documentarian") isn't guessed at.
    public let initials: String
    /// The coordination state, rendered as a maritime chip — never colour alone.
    public let state: CoordinationState
    /// One line of what it is doing right now. Truncates in the row.
    public let statusLine: String
    /// Seconds since the last event. `nil` renders as "—" (idle, no recent run),
    /// which is not the same as "0s".
    public let ageSeconds: TimeInterval?
    /// Whether the operator follows this agent's stream. A subscription intent,
    /// not a live capability yet — see the note above.
    public let following: Bool
    /// Whether this identity is durable (survives restarts) or an ephemeral
    /// one-shot. The whole point of the surface is the former.
    public let durable: Bool

    // Detail-only fields.
    /// "resumed from rcpt_7c19 · 3rd session" — the continuity story.
    public let lineage: String?
    public let body: String?
    public let contextPercent: Int?
    public let costUSD: Double?
    public let transcript: [TranscriptEvent]

    public var ageLabel: String {
        guard let ageSeconds else { return "—" }
        return RelativeAge.short(ageSeconds)
    }

    public var costLabel: String? {
        guard let costUSD else { return nil }
        return String(format: "$%.2f", costUSD)
    }
}

/// One line in an agent's transcript tail. A display record — the timestamp is
/// a preformatted string from the fixture, not a Date to re-localize, because
/// this is what the daemon's JSONL archive already looks like on the wire.
public struct TranscriptEvent: Codable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable, CaseIterable {
        case agent
        case tool
        case denied
        case ok

        public var label: String { rawValue.uppercased() }

        /// The colour law again: a kind is a coordination state, so the
        /// transcript and the roster and FleetBar all agree on which red is red.
        public var state: CoordinationState {
            switch self {
            case .agent:  return .inform       // blue — the agent speaking
            case .tool:   return .claimStale   // yellow — a tool call
            case .denied: return .blocked      // red — a gate refused it
            case .ok:     return .affirmative  // green — it went through
            }
        }
    }

    public let id: String
    public let timestamp: String
    public let kind: Kind
    public let text: String
}

/// The roster payload: the note (why this is a fixture) and the cast.
public struct AgentRoster: Codable, Sendable {
    public let note: String?
    public let agents: [DurableAgent]

    public var durableCount: Int { agents.filter(\.durable).count }
}
