import Foundation

// MARK: - FleetBar App Build Channel

/// Which build of the *FleetBar app itself* this process is — distinct from the
/// daemon berth it talks to (see `BerthDirectory`).
///
/// The shipped production app carries bundle id `ai.portdaddy.FleetBar`. A
/// dev/preview build (packaged from a branch, or a raw `swift run`) carries a
/// different identifier — e.g. `dev.portdaddy.fleetbar.devlatest` — so a developer
/// can run a dev FleetBar *beside* the installed one and still tell them apart at a
/// glance. Production stays unbadged; everything else is labelled "DEV …".
///
/// `classify` is pure so the labelling rules are unit-testable without a bundle;
/// `current` reads `Bundle.main` at runtime.
enum AppChannel: Equatable {
    case production
    case dev(label: String)

    /// The one bundle id that is the real, shipped app.
    static let productionBundleID = "ai.portdaddy.FleetBar"

    var isProduction: Bool { self == .production }

    /// Short, constant tag for the menu bar — `nil` for production so the shipped
    /// app shows no chrome. A long branch label has no business in the menu bar; it
    /// lives in ``displayLabel`` (popover header, Cmd-Tab) instead.
    var menuBarBadge: String? {
        switch self {
        case .production: return nil
        case .dev: return "DEV"
        }
    }

    /// Longer human label for popover/manager headers.
    var displayLabel: String {
        switch self {
        case .production: return "Production"
        case .dev(let label): return "Dev · \(label)"
        }
    }

    /// Classify a build from its bundle metadata.
    ///
    /// - A bundle id equal to ``productionBundleID`` is the shipped app.
    /// - Otherwise it is a dev build, and the label is derived (most specific
    ///   first): a parenthetical in the display name (`FleetBar (dev-latest)` →
    ///   `dev-latest`), else the trailing bundle-id segment
    ///   (`dev.portdaddy.fleetbar.devlatest` → `devlatest`), else `"dev"`.
    static func classify(bundleID: String?, displayName: String?) -> AppChannel {
        let id = (bundleID ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if id == productionBundleID { return .production }

        if let name = displayName, let label = parenthetical(in: name) {
            return .dev(label: label)
        }
        if let segment = id.split(separator: ".").last,
           segment.caseInsensitiveCompare("FleetBar") != .orderedSame,
           !segment.isEmpty {
            return .dev(label: String(segment))
        }
        return .dev(label: "dev")
    }

    /// The channel of the currently-running app.
    static var current: AppChannel {
        classify(
            bundleID: Bundle.main.bundleIdentifier,
            displayName: Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
        )
    }

    /// Extract the contents of the first `(…)` group, trimmed; `nil` when absent
    /// or empty.
    static func parenthetical(in string: String) -> String? {
        guard let open = string.firstIndex(of: "("),
              let close = string.firstIndex(of: ")"),
              open < close else { return nil }
        let inner = string[string.index(after: open)..<close]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return inner.isEmpty ? nil : inner
    }
}
