import Foundation
import Security

// MARK: - FleetBar Build Identity

/// The version of the running FleetBar app.
///
/// At package time, `scripts/package-fleetbar.sh` injects the repo's
/// `package.json` version into the bundle's `CFBundleShortVersionString`, so a
/// shipped `.app` reports its real version here. In `swift run` dev builds there
/// is no bundled Info.plist, so this returns `nil` — which the staleness check
/// treats as "unknown, do not nag" rather than guessing.
enum FleetBarBuild {
    /// The app's own version string, or `nil` when it cannot be determined
    /// (dev build with no packaged Info.plist).
    static var version: String? {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // The static dev plist ships a placeholder "1.0". Treat it as unknown so
        // a developer running an un-packaged build is never told they're stale.
        if trimmed.isEmpty || trimmed == "1.0" { return nil }
        return trimmed
    }
}

// MARK: - Semantic Version

/// A minimal SemVer parser/comparator good enough for Port Daddy's `X.Y.Z`
/// (optionally `vX.Y.Z` or `X.Y.Z-rc.N`) version strings.
///
/// Comparison is by numeric `major.minor.patch`; when those tie, a build that
/// carries a pre-release suffix (`-rc.1`) sorts *below* the same release with no
/// suffix, matching SemVer §11.
struct SemanticVersion: Comparable, Equatable, CustomStringConvertible {
    let major: Int
    let minor: Int
    let patch: Int
    let isPrerelease: Bool

    /// Parse a version string. Returns `nil` for anything that is not at least
    /// `MAJOR.MINOR` numeric. A leading `v` and a trailing `+build` are tolerated.
    init?(_ raw: String) {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("v") || text.hasPrefix("V") { text.removeFirst() }

        // Strip build metadata (`+...`) entirely; it is not used for ordering.
        if let plus = text.firstIndex(of: "+") {
            text = String(text[text.startIndex..<plus])
        }

        // Split off any pre-release (`-rc.1`).
        let prerelease: Bool
        if let dash = text.firstIndex(of: "-") {
            prerelease = true
            text = String(text[text.startIndex..<dash])
        } else {
            prerelease = false
        }

        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2 else { return nil }

        func number(_ index: Int) -> Int? {
            guard index < parts.count else { return 0 }
            return Int(parts[index])
        }

        guard
            let major = number(0),
            let minor = number(1),
            let patch = number(2)
        else {
            return nil
        }

        self.major = major
        self.minor = minor
        self.patch = patch
        self.isPrerelease = prerelease
    }

    static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        if lhs.patch != rhs.patch { return lhs.patch < rhs.patch }
        // Equal core: a pre-release is older than the finished release.
        if lhs.isPrerelease != rhs.isPrerelease { return lhs.isPrerelease }
        return false
    }

    var description: String { "\(major).\(minor).\(patch)" }
}

// MARK: - Version Skew

/// The relationship between the running FleetBar app and the daemon it is
/// talking to. FleetBar is a separately-downloaded `.app`; `brew upgrade
/// port-daddy` moves the daemon but never the menu bar app, so the two drift.
enum FleetVersionSkew: Equatable {
    /// Versions match, or skew cannot be determined (treat as fine — never nag).
    case upToDate
    /// The app is older than the daemon: re-download the latest FleetBar.
    case appBehindDaemon(app: SemanticVersion, daemon: SemanticVersion)
    /// The app is newer than the daemon: the running daemon needs upgrading/restart.
    case daemonBehindApp(app: SemanticVersion, daemon: SemanticVersion)

    /// True when there is an actionable mismatch worth surfacing to the operator.
    var needsAttention: Bool {
        switch self {
        case .upToDate: return false
        case .appBehindDaemon, .daemonBehindApp: return true
        }
    }
}

enum FleetVersion {
    /// Decide the skew between the app and the daemon. Either input being absent
    /// or unparseable yields `.upToDate` — we never invent a staleness warning
    /// from data we don't actually have.
    static func evaluate(appVersion: String?, daemonVersion: String?) -> FleetVersionSkew {
        guard
            let appRaw = appVersion,
            let daemonRaw = daemonVersion,
            let app = SemanticVersion(appRaw),
            let daemon = SemanticVersion(daemonRaw)
        else {
            return .upToDate
        }

        if app < daemon {
            return .appBehindDaemon(app: app, daemon: daemon)
        }
        if app > daemon {
            return .daemonBehindApp(app: app, daemon: daemon)
        }
        return .upToDate
    }

    /// Canonical, arch-agnostic download/remediation page. We send people to the
    /// page (which resolves the right release asset for their machine) rather
    /// than auto-pulling the zip; for unsigned builds it also carries the
    /// checksum + verification steps.
    static let downloadPageURL = URL(string: "https://portdaddy.dev/#download")!

    /// True when the running app carries a real certificate-backed code
    /// signature (the Developer-ID-signed release that
    /// `scripts/package-fleetbar.sh` produces when `PORT_DADDY_SIGN_IDENTITY`
    /// is set). Ad-hoc and unsigned builds — local `swift run`, forks without
    /// the cert secret — fail the requirement because they have no certificate
    /// chain, and any Security API hiccup also lands on `false`: we would
    /// rather show a stale checksum caveat than falsely claim a signed build.
    ///
    /// Used by the update banner: a signed build implies the release pipeline
    /// signs + notarizes, so the "verify the checksum" caveat is dropped and
    /// the download Just Works under Gatekeeper.
    static let isSignedBuild: Bool = {
        var code: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code else { return false }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess,
              let staticCode else { return false }
        var requirement: SecRequirement?
        // "anchor apple generic" matches any Apple-issued signing chain
        // (Developer ID, App Store) and rejects ad-hoc signatures.
        guard SecRequirementCreateWithString("anchor apple generic" as CFString, SecCSFlags(), &requirement) == errSecSuccess,
              let requirement else { return false }
        return SecStaticCodeCheckValidity(staticCode, SecCSFlags(), requirement) == errSecSuccess
    }()
}
