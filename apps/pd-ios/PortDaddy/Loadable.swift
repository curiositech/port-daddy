import Foundation

// MARK: - Loadable
//
// Three states, and the first one is the reason this type exists instead of
// `Optional`: a surface that has not managed to read something must be able to
// say so. `nil` cannot tell "empty" from "never arrived", and every honest
// rule on this surface — the interruptions inbox that never says "all clear",
// the reachability verdict that is never downgraded to impossible, the roadmap
// item that never fakes LIVE — comes down to keeping those two apart.
public enum Loadable<Value> {
    /// Nothing has been read yet, or the last read failed. Carries the reason
    /// so the UI can state it rather than shrugging.
    case unknown(reason: String)
    case loaded(Value, provenance: Provenance)

    public var value: Value? {
        if case .loaded(let value, _) = self { return value }
        return nil
    }

    public var provenance: Provenance? {
        if case .loaded(_, let provenance) = self { return provenance }
        return nil
    }

    public var unknownReason: String? {
        if case .unknown(let reason) = self { return reason }
        return nil
    }

    public var isUnknown: Bool {
        if case .unknown = self { return true }
        return false
    }
}
