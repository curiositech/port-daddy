import Foundation

// MARK: - Port Daddy Maritime Signals — Swift port
//
// CANONICAL SOURCE: lib/maritime-signals.ts. That TypeScript module is the
// single source of truth for the mapping between Port Daddy coordination
// states and the International Code of Signals single-letter alphabet. This
// file is a PORT, not a second opinion. When the two disagree, the TypeScript
// is right and this file is a bug.
//
// Drift is caught mechanically, not by review:
//
//   lib/maritime-signals.ts
//     -> scripts/generate-maritime-signals-fixture.ts
//       -> PortDaddy/Resources/maritime-signals.fixture.json  (generated)
//         -> Tests/PortDaddyKitTests/MaritimeSignalsParityTests.swift
//
// The fixture is regenerated from the TypeScript and CI verifies it is not
// stale; the parity test then asserts every constant below reproduces it
// byte-for-byte, escape sequences included. Editing one side alone fails.
//
// Names, ordering, colour buckets and the throw message are kept identical to
// the TypeScript on purpose, including its documented warts.

/// The ICS single-letter alphabet — `SignalCode` in the TypeScript.
///
/// Deliberately letters-only, matching `type SignalCode = 'A' | ... | 'Z'`.
/// The `K-1` hoist therefore carries only `[K]` and describes the numeric
/// pennant in prose. The TypeScript calls that out as a known wart; the port
/// mirrors it rather than "fixing" it and diverging.
public enum SignalCode: String, CaseIterable, Sendable, Codable {
    case A, B, C, D, E, F, G, H, I, J, K, L, M
    case N, O, P, Q, R, S, T, U, V, W, X, Y, Z
}

/// `CoordinationState` in the TypeScript, in declaration order.
///
/// The order is load-bearing: `signalFor`'s error message interpolates
/// `Object.keys(SIGNAL_FOR_STATE)`, so `MaritimeSignals.knownStatesJoined`
/// only matches the TypeScript if this order matches.
public enum CoordinationState: String, CaseIterable, Sendable, Codable {
    case claimActive = "claim-active"
    case claimStale = "claim-stale"
    case awaitingHuman = "awaiting-human"
    case burningCash = "burning-cash"
    case conflict
    case blocked
    case idle
    case spawning
    case fleetHealthy = "fleet-healthy"
    case mayday
    case inform
    case request
    case refuse
    case affirmative
}

/// Raised by `MaritimeSignals.signal(for:)` when handed a state string with no
/// mapping. The TypeScript throws rather than falling back to a default flag,
/// and so does this: a surface that renders the wrong flag is worse than one
/// that fails loudly.
public struct UnknownCoordinationStateError: Error, CustomStringConvertible, Equatable {
    public let state: String
    public let knownStates: String

    public var description: String {
        "\(MaritimeSignals.unknownStateErrorPrefix)\(state). Known states: \(knownStates)"
    }
}

public enum MaritimeSignals {

    // MARK: - Mapping rationale
    //
    // Verbatim from lib/maritime-signals.ts (research-pass refinement,
    // 2026-05-06), because the reasoning is the reason the table is not
    // obvious:
    //
    //   awaiting-human -> F, not K — F is "I am disabled; communicate with me"
    //                                K is "I wish to communicate" (general
    //                                channel-open) -> request
    //   blocked        -> D, not F — D is "maneuvering with difficulty"
    //                                (creds/auth); F is hard-disabled
    //   conflict       -> V, not D — V is "I require assistance" (arbitration)
    //   spawning       -> A, not P — A is "diver down, keep clear" (vulnerable
    //                                boot window); P is "Blue Peter, ready to
    //                                sail" -> fleet-healthy
    //   mayday         -> J        — J is "on fire + dangerous cargo"
    //   inform         -> R        — procedure signal "Received"; R has no
    //                                1969 single-letter meaning
    //   burning-cash   -> B, not U — B is "carrying dangerous cargo"

    /// `SIGNAL_FOR_STATE`.
    public static let signalForState: [CoordinationState: SignalCode] = [
        .claimActive: .H, .claimStale: .Y, .awaitingHuman: .F,
        .burningCash: .B, .conflict: .V, .blocked: .D, .idle: .M,
        .spawning: .A, .fleetHealthy: .P, .mayday: .J,
        .inform: .R, .request: .K, .refuse: .N, .affirmative: .C,
    ]

    /// `STATE_FOR_SIGNAL` — the partial inverse. The twelve letters with no
    /// coordination state stay absent, exactly as the TypeScript's
    /// `Partial<Record<...>>` leaves them undefined.
    public static let stateForSignal: [SignalCode: CoordinationState] = [
        .H: .claimActive, .Y: .claimStale, .F: .awaitingHuman, .B: .burningCash,
        .V: .conflict, .D: .blocked, .M: .idle, .A: .spawning, .P: .fleetHealthy,
        .J: .mayday, .R: .inform, .K: .request, .N: .refuse, .C: .affirmative,
    ]

    /// `ICS_MEANING` — all 26 letters, strings byte-identical to the
    /// TypeScript (em-dashes in P and R included).
    public static let icsMeaning: [SignalCode: String] = [
        .A: "I have a diver down; keep well clear at slow speed",
        .B: "I am taking in, discharging, or carrying dangerous cargo",
        .C: "Affirmative / yes",
        .D: "Keep clear of me; I am maneuvering with difficulty",
        .E: "I am altering my course to starboard",
        .F: "I am disabled; communicate with me",
        .G: "I require a pilot",
        .H: "I have a pilot on board",
        .I: "I am altering my course to port",
        .J: "I am on fire and have dangerous cargo on board; keep well clear",
        .K: "I wish to communicate with you",
        .L: "You should stop your vessel instantly",
        .M: "My vessel is stopped and making no way through the water",
        .N: "Negative / no",
        .O: "Man overboard",
        .P: "Blue Peter — about to put to sea (in harbor); nets caught (at sea, fishing)",
        .Q: "My vessel is healthy and I request free pratique",
        .R: "No 1969 single-letter meaning; procedure signal: Received",
        .S: "I am operating astern propulsion",
        .T: "Keep clear of me; I am engaged in pair trawling",
        .U: "You are running into danger",
        .V: "I require assistance",
        .W: "I require medical assistance",
        .X: "Stop carrying out your intentions and watch for my signals",
        .Y: "I am dragging my anchor",
        .Z: "I require a tug",
    ]

    /// `NATO_PHONETIC` — note "Juliett" (double-t) and "X-ray"
    /// (hyphen, lowercase r), as spelled in the TypeScript.
    public static let natoPhonetic: [SignalCode: String] = [
        .A: "Alpha", .B: "Bravo", .C: "Charlie", .D: "Delta", .E: "Echo",
        .F: "Foxtrot", .G: "Golf", .H: "Hotel", .I: "India", .J: "Juliett",
        .K: "Kilo", .L: "Lima", .M: "Mike", .N: "November", .O: "Oscar",
        .P: "Papa", .Q: "Quebec", .R: "Romeo", .S: "Sierra", .T: "Tango",
        .U: "Uniform", .V: "Victor", .W: "Whiskey", .X: "X-ray", .Y: "Yankee",
        .Z: "Zulu",
    ]

    // MARK: - Colour law
    //
    // The TypeScript's SIGNAL_ANSI is the authority on which letters share a
    // colour. The port keeps the raw escape sequences so parity is byte-exact
    // rather than a judgement call about which "green" was meant; the SwiftUI
    // palette (Theme.swift) derives from `bucket(for:)` below, so the phone
    // and the terminal can never disagree about which letters are red.

    /// Six colour buckets, named after the escape they carry.
    public enum ColorBucket: String, CaseIterable, Sendable {
        case green, yellow, red, blue, magenta, gray

        /// The ANSI foreground escape from lib/maritime.ts.
        public var ansi: String {
            switch self {
            case .green:   return "\u{1B}[32m"
            case .yellow:  return "\u{1B}[33m"
            case .red:     return "\u{1B}[31m"
            case .blue:    return "\u{1B}[34m"
            case .magenta: return "\u{1B}[35m"
            case .gray:    return "\u{1B}[90m"
            }
        }
    }

    /// `ANSI.reset`.
    public static let ansiReset = "\u{1B}[0m"

    /// `SIGNAL_ANSI`, expressed as buckets. Grouped exactly as the TypeScript
    /// groups them, comments included.
    public static let bucketForSignal: [SignalCode: ColorBucket] = [
        // Green — success / healthy
        .C: .green, .H: .green, .P: .green, .Q: .green,
        // Yellow — caution / advisory
        .K: .yellow, .M: .yellow, .U: .yellow, .Y: .yellow,
        // Red — alert / negative / danger
        .D: .red, .F: .red, .N: .red, .O: .red, .V: .red, .W: .red, .X: .red,
        // Blue — informational / nav-state
        .E: .blue, .I: .blue, .R: .blue, .S: .blue,
        // Magenta — domain-specific signaling
        .G: .magenta, .J: .magenta,
        // Gray — neutral / structural
        .A: .gray, .B: .gray, .L: .gray, .T: .gray, .Z: .gray,
    ]

    // MARK: - Lookups

    /// `signalFor(state)`. Total over the enum, so it cannot throw here — the
    /// throwing variant below is the one that mirrors the TypeScript's
    /// behaviour on an unrecognised string off the wire.
    public static func signal(for state: CoordinationState) -> SignalCode {
        // Force-unwrap is safe and intentional: signalForState is exhaustive
        // over CoordinationState, and MaritimeSignalsParityTests asserts that
        // key set directly (Set(signalForState.keys) == Set(allCases)) before
        // it ever calls this function. That ordering matters — this is a
        // dictionary literal, not a switch, so the compiler does NOT check
        // exhaustiveness, and a new enum case would otherwise reach this line
        // and abort the test process instead of naming itself.
        // A missing entry must fail loudly, never render a default flag.
        guard let code = signalForState[state] else {
            preconditionFailure(
                "\(unknownStateErrorPrefix)\(state.rawValue). Known states: \(knownStatesJoined)"
            )
        }
        return code
    }

    /// The wire-facing form: a raw state string from the daemon or relay that
    /// this build does not know about throws, exactly as the TypeScript does.
    /// A renderer must not invent a flag for a state it cannot name.
    public static func signal(forRawState raw: String) throws -> SignalCode {
        guard let state = CoordinationState(rawValue: raw) else {
            throw UnknownCoordinationStateError(state: raw, knownStates: knownStatesJoined)
        }
        return signal(for: state)
    }

    /// `stateFor(signal)` — nil for the twelve unmapped letters.
    public static func state(for signal: SignalCode) -> CoordinationState? {
        stateForSignal[signal]
    }

    public static func bucket(for state: CoordinationState) -> ColorBucket {
        guard let bucket = bucketForSignal[signal(for: state)] else {
            preconditionFailure("[maritime-signals] no colour bucket for \(state.rawValue)")
        }
        return bucket
    }

    public static func meaning(for state: CoordinationState) -> String {
        icsMeaning[signal(for: state)] ?? ""
    }

    public static func phonetic(for state: CoordinationState) -> String {
        natoPhonetic[signal(for: state)] ?? ""
    }

    // MARK: - Formatters

    /// `formatSignal(state)` -> "[V] conflict".
    public static func formatSignal(_ state: CoordinationState) -> String {
        "[\(signal(for: state).rawValue)] \(state.rawValue)"
    }

    /// `colorize(state, label?)` -> "\u{1B}[31m[V] conflict\u{1B}[0m".
    ///
    /// An iOS app has no terminal to write escapes to; this exists so the
    /// parity test can prove the colour law itself matches, not just a
    /// re-spelling of it.
    public static func colorize(_ state: CoordinationState, label: String? = nil) -> String {
        let letter = signal(for: state)
        let color = bucketForSignal[letter]?.ansi ?? ""
        let text = label ?? state.rawValue
        return "\(color)[\(letter.rawValue)] \(text)\(ansiReset)"
    }

    // MARK: - Hoists

    public struct Hoist: Equatable, Sendable {
        public let letters: [SignalCode]
        public let meaning: String

        public init(letters: [SignalCode], meaning: String) {
            self.letters = letters
            self.meaning = meaning
        }
    }

    /// `HOISTS`. Multi-flag combinations carrying composite meaning.
    ///
    /// `K-1` keeps letters-only with the numeric pennant described in prose —
    /// the TypeScript's documented wart, mirrored on purpose. Widening
    /// SignalCode to numeric pennants is the proper fix, and it belongs in the
    /// TypeScript first.
    public static let hoists: [String: Hoist] = [
        "K-1": Hoist(letters: [.K], meaning: "I want to communicate about subject 1 — pd ask --topic"),
        "U-Y": Hoist(letters: [.U, .Y], meaning: "Running into danger, dragging anchor — cap proximity + claim stale on same actor"),
        "P-Q": Hoist(letters: [.P, .Q], meaning: "About to put to sea, vessel healthy — fleet-up sequence"),
        "D-V": Hoist(letters: [.D, .V], meaning: "Maneuvering with difficulty, require assistance — conflict + need-human escalation"),
        "F-G": Hoist(letters: [.F, .G], meaning: "Disabled, require pilot — blocked + auto-spawn-fix-it"),
        "O-W": Hoist(letters: [.O, .W], meaning: "Man overboard, require medical — agent crashed + mayday"),
    ]

    // MARK: - Error text

    public static let unknownStateErrorPrefix = "[maritime-signals] unknown coordination state: "

    /// `Object.keys(SIGNAL_FOR_STATE).join(', ')` — declaration order.
    public static var knownStatesJoined: String {
        CoordinationState.allCases.map(\.rawValue).joined(separator: ", ")
    }
}
