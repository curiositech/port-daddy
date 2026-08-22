import Foundation

// MARK: - Operator control verbs (ADR-0125 §4)
//
// This file exists to prevent ONE specific failure: hiding a control verb a
// backend cannot perform. Hiding it looks tidy and lies — the operator learns
// nothing about why `pause` is not there, and the next person assumes it was
// never asked for. ADR-0125 §4 is explicit, and it is quoted here because the
// wording is the whole rule:
//
//   "`pause` and `fork` render as honest unsupported affordances: visible,
//    disabled, with the stated reason — never hidden, never wired to a no-op,
//    never quietly substituted by `kill`."
//
// So `Support.unsupported(reason:)` carries a reason string, the view renders
// the row either way, and ControlVerbsTests pins the v1 matrix so a future
// edit that drops pause/fork from the remote row fails CI instead of shipping.
//
// The matrix is not this file's invention. It is the `cloudflare-remote` row
// of skills/agent-control-command-contract/examples/sample-input.json, which
// the contract audit script reads. When an adapter gains a verb, that JSON
// changes first, then this file, then the tests.
//
// ADR-0125 §4, second paragraph, is the other half:
//
//   "The UI never collapses a command's lifecycle to a single spinner. The
//    operator sees whether a control was queued, delivered, acknowledged,
//    failed, or expired."
//
// Hence `CommandState` below has six members, not a Bool.

/// The six control verbs. Order is the matrix order in sample-input.json.
public enum ControlVerb: String, CaseIterable, Sendable, Codable {
    case steer
    case interrupt
    case pause
    case kill
    case checkpoint
    case fork

    public var title: String {
        switch self {
        case .steer:      return "Steer"
        case .interrupt:  return "Interrupt"
        case .pause:      return "Pause"
        case .kill:       return "Kill"
        case .checkpoint: return "Checkpoint"
        case .fork:       return "Fork"
        }
    }

    /// SF Symbols only — ADR-0125 §7 forbids emoji on this surface.
    public var systemImage: String {
        switch self {
        case .steer:      return "arrow.triangle.turn.up.right.diamond"
        case .interrupt:  return "hand.raised"
        case .pause:      return "pause.circle"
        case .kill:       return "xmark.octagon"
        case .checkpoint: return "flag.checkered"
        case .fork:       return "arrow.triangle.branch"
        }
    }

    /// True for verbs whose effect an operator cannot take back. The view
    /// requires a second confirmation for these; nothing here executes.
    public var isDestructive: Bool { self == .kill }
}

/// Backends an agent body can run on, named as the contract fixture names
/// them. `cloudflareRemote` is the row an iOS operator acts through — the
/// phone reaches remote bodies, not the operator's laptop process table.
public enum ControlBackend: String, CaseIterable, Sendable, Codable {
    case localSameUID = "local-same-uid"
    case cloudflareRemote = "cloudflare-remote"
    case hookOnlyObserved = "hook-only-observed"

    public var title: String {
        switch self {
        case .localSameUID:     return "Local (same uid)"
        case .cloudflareRemote: return "Remote body"
        case .hookOnlyObserved: return "Observed only"
        }
    }
}

/// The lifecycle of one issued command. Six states, matching
/// `terminalStates` in sample-input.json — note that the JSON carries
/// `unsupported` as a sixth member even though ADR-0125's prose enumerates
/// five. The enum carries all six so an `unsupported` response off the wire
/// decodes as itself instead of collapsing into `failed`.
public enum CommandState: String, CaseIterable, Sendable, Codable {
    case queued
    case delivered
    case acknowledged
    case failed
    case expired
    case unsupported

    /// Whether the command is still in flight. Only `queued` and `delivered`
    /// are; ADR-0122 §5 is that a queued command terminates in ack or failure
    /// and there is no third state, so everything else here is terminal.
    public var isInFlight: Bool { self == .queued || self == .delivered }

    public var label: String { rawValue.uppercased() }

    /// The coordination state this lifecycle stage renders as, so command
    /// status goes through lib/maritime-signals.ts like every other state
    /// flag on every other Port Daddy surface. ADR-0125 §7: "no surface
    /// hand-picks letters."
    public var coordinationState: CoordinationState {
        switch self {
        case .queued:       return .request
        case .delivered:    return .inform
        case .acknowledged: return .affirmative
        case .failed:       return .refuse
        case .expired:      return .claimStale
        case .unsupported:  return .blocked
        }
    }
}

/// Whether a verb is available on a backend, and if not, why not.
///
/// The reason is not optional. An unsupported verb with no reason is the
/// hidden-verb failure wearing a disabled control's clothes.
public enum VerbSupport: Equatable, Sendable {
    case supported
    case unsupported(reason: String)

    public var isSupported: Bool {
        if case .supported = self { return true }
        return false
    }

    /// Text the UI puts next to the disabled control. Never empty for an
    /// unsupported verb.
    public var reason: String? {
        if case .unsupported(let reason) = self { return reason }
        return nil
    }
}

public enum ControlVerbs {

    /// The v1 matrix, transcribed from
    /// skills/agent-control-command-contract/examples/sample-input.json.
    ///
    /// A backend gaining a verb re-opens the matrix — ADR-0125 §4: "a passing
    /// contract from last quarter is not evidence about today's adapters." So
    /// this table is pinned by ControlVerbsTests, and changing it without
    /// changing the contract fixture fails.
    public static let supportedVerbs: [ControlBackend: [ControlVerb]] = [
        .localSameUID: [.steer, .interrupt, .pause, .kill, .checkpoint, .fork],
        .cloudflareRemote: [.steer, .interrupt, .kill, .checkpoint],
        .hookOnlyObserved: [],
    ]

    /// Why a verb is unsupported, per backend. Stated in the operator's terms
    /// — what the backend cannot do — not "not implemented".
    static func unsupportedReason(_ verb: ControlVerb, on backend: ControlBackend) -> String {
        switch backend {
        case .cloudflareRemote:
            switch verb {
            case .pause:
                return "Remote bodies cannot be suspended in place — there is no process to stop and resume. Use Checkpoint, then Kill."
            case .fork:
                return "Remote bodies cannot be duplicated from a running state. Checkpoint first, then start a new body from it."
            default:
                return "This backend's adapter does not implement \(verb.rawValue)."
            }
        case .hookOnlyObserved:
            return "This body is observed through hooks only — Port Daddy can read its transcript but holds no control channel to it."
        case .localSameUID:
            return "This backend's adapter does not implement \(verb.rawValue)."
        }
    }

    /// Support for one verb on one backend.
    public static func support(for verb: ControlVerb, on backend: ControlBackend) -> VerbSupport {
        let supported = supportedVerbs[backend] ?? []
        return supported.contains(verb)
            ? .supported
            : .unsupported(reason: unsupportedReason(verb, on: backend))
    }

    /// EVERY verb, in matrix order, with its support verdict — the list a view
    /// renders.
    ///
    /// There is no filtered variant of this function on purpose. A view that
    /// wants "just the ones that work" would have to write the filter itself,
    /// in the open, where a reviewer can see it and say no.
    public static func matrix(for backend: ControlBackend) -> [VerbAvailability] {
        ControlVerb.allCases.map { VerbAvailability(verb: $0, support: support(for: $0, on: backend)) }
    }

    /// Verbs this backend cannot do. Used by the view to render the honest
    /// unsupported block — never to omit anything.
    public static func unsupportedVerbs(for backend: ControlBackend) -> [ControlVerb] {
        ControlVerb.allCases.filter { !support(for: $0, on: backend).isSupported }
    }
}

/// One row of the matrix: a verb and whether this backend can do it.
///
/// A named type rather than a tuple so a view can iterate it with ForEach and
/// so `map(\.verb)` works — key paths cannot address tuple elements.
public struct VerbAvailability: Identifiable, Equatable, Sendable {
    public let verb: ControlVerb
    public let support: VerbSupport

    public var id: ControlVerb { verb }

    public init(verb: ControlVerb, support: VerbSupport) {
        self.verb = verb
        self.support = support
    }
}

/// One issued command and where it got to.
///
/// `authorityEpoch` and `jti` are carried because ADR-0125 §3 requires every
/// remote command to name the harbor authority epoch it was authorized under
/// and a per-command id, and ADR-0122 §4 makes a stale epoch fail visibly with
/// a recorded reason. They are modelled here so the renderer can show that
/// reason; minting and verifying them is the daemon's job, not the phone's.
public struct ControlCommand: Identifiable, Equatable, Sendable {
    public let id: String
    public let verb: ControlVerb
    public let backend: ControlBackend
    public let state: CommandState
    /// Present on `failed`, `expired` and `unsupported`. ADR-0122 §5: expiry
    /// without delivery is a failure record, not silence.
    public let failureReason: String?
    public let jti: String
    public let authorityEpoch: Int
    public let issuedAt: Date

    public init(
        id: String,
        verb: ControlVerb,
        backend: ControlBackend,
        state: CommandState,
        failureReason: String? = nil,
        jti: String,
        authorityEpoch: Int,
        issuedAt: Date
    ) {
        self.id = id
        self.verb = verb
        self.backend = backend
        self.state = state
        self.failureReason = failureReason
        self.jti = jti
        self.authorityEpoch = authorityEpoch
        self.issuedAt = issuedAt
    }

    /// A terminal command with no reason is the "silent half-control state"
    /// ADR-0122 §5 forbids. The view surfaces this rather than rendering a
    /// blank, so a relay that stops recording reasons is visible immediately.
    public var isMissingRequiredReason: Bool {
        !state.isInFlight && state != .acknowledged && (failureReason ?? "").isEmpty
    }
}
