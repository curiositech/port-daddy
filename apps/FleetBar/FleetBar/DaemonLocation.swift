import Foundation

enum DaemonLocation {
    /// The well-known preferred control port. NOT a guaranteed runtime value —
    /// the daemon can bind elsewhere (port contention, CI, custom installs).
    /// Kept here as the Swift-side mirror of `shared/daemon-discovery.ts`'s
    /// `DEFAULT_DAEMON_PORT` for display/comparison use; `resolveBaseURL`
    /// itself must never return this as a guess (see below).
    static let canonicalPreferredPort = 9876
    /// The dev-latest berth's fixed lane (ADR-0084 / shared/daemon-berths.ts).
    static let devLatestPort = 9886
    /// Fail-closed sentinel for "the daemon has not published a live endpoint."
    /// Port 0 can never be a real TCP listener, so a request against it fails
    /// immediately and visibly instead of silently guessing
    /// `canonicalPreferredPort` and risking a false match against whatever
    /// unrelated process happens to be bound to it.
    static let unpublishedSentinelPort = 0

    static let loopbackHost = resolveLoopbackHost(environment: ProcessInfo.processInfo.environment)

    /// Pure host resolution — injectable so tests don't depend on the real
    /// process environment.
    static func resolveLoopbackHost(environment: [String: String]) -> String {
        if let raw = environment["PORT_DADDY_TCP_HOST"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !raw.isEmpty {
            return raw
        }
        return "127.0.0.1"
    }

    static func resolveBaseURL(channel: AppChannel = .current) -> String {
        resolveBaseURL(
            channel: channel,
            environment: ProcessInfo.processInfo.environment,
            portFileContents: readPublishedPortFile)
    }

    /// Pure resolution core. Precedence:
    ///   1. an explicit `PORT_DADDY_URL` (the daemon spawns FleetBar with one;
    ///      an operator can export one) always wins.
    ///   2. the dev-latest build defaults to its own fixed `:9886` lane rather
    ///      than the shared `daemon.port` (which the stable daemon owns) — so
    ///      a dev-latest FleetBar talks to the dev-latest daemon out of the
    ///      box. The operator can still switch berths live from the popover.
    ///   3. the live daemon's atomically-published `~/.port-daddy/daemon.port`
    ///      file, when present and a valid positive port.
    ///   4. otherwise, fail closed to `unpublishedSentinelPort` — never
    ///      manufacture `canonicalPreferredPort` as a guess. Publication may
    ///      simply not have happened yet (daemon still starting) or the
    ///      literal port may be occupied by something else entirely; either
    ///      way FleetBar should show "disconnected," not silently talk to the
    ///      wrong process.
    static func resolveBaseURL(
        channel: AppChannel,
        environment: [String: String],
        portFileContents: () -> String?
    ) -> String {
        let host = resolveLoopbackHost(environment: environment)

        if let explicitURL = environment["PORT_DADDY_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !explicitURL.isEmpty {
            return explicitURL
        }

        if channel.isDevLatest {
            return "http://\(host):\(devLatestPort)"
        }

        if let portString = portFileContents()?.trimmingCharacters(in: .whitespacesAndNewlines),
           let port = Int(portString), port > 0 {
            return "http://\(host):\(port)"
        }

        return "http://\(host):\(unpublishedSentinelPort)"
    }

    private static func readPublishedPortFile() -> String? {
        let portFile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy/daemon.port")
        return try? String(contentsOf: portFile, encoding: .utf8)
    }
}
