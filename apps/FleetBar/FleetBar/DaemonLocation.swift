import Foundation

enum DaemonLocation {
    static let canonicalPreferredPort = 9876
    /// The dev-latest berth's fixed lane (ADR-0084 / shared/daemon-berths.ts).
    static let devLatestPort = 9886
    static let loopbackHost = ProcessInfo.processInfo.environment["PORT_DADDY_TCP_HOST"]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .isEmpty == false
        ? ProcessInfo.processInfo.environment["PORT_DADDY_TCP_HOST"]!.trimmingCharacters(in: .whitespacesAndNewlines)
        : "127.0.0.1"

    static func resolveBaseURL(channel: AppChannel = .current) -> String {
        // An explicit URL (the daemon spawns FleetBar with one; an operator can
        // export one) always wins.
        if let explicitURL = ProcessInfo.processInfo.environment["PORT_DADDY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !explicitURL.isEmpty {
            return explicitURL
        }

        // The dev-latest build defaults to its own :9886 lane rather than the
        // shared daemon.port (which the stable daemon owns) — so a dev-latest
        // FleetBar talks to the dev-latest daemon out of the box. The operator
        // can still switch berths live from the popover.
        if channel.isDevLatest {
            return "http://\(loopbackHost):\(devLatestPort)"
        }

        let portFile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy/daemon.port")
        if let portString = try? String(contentsOf: portFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
           let port = Int(portString) {
            return "http://\(loopbackHost):\(port)"
        }

        return "http://\(loopbackHost):\(canonicalPreferredPort)"
    }
}
