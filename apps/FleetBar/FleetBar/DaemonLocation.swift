import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

enum DaemonLocation {
    /// Resolves the loopback host from the caller's environment so endpoint
    /// selection stays deterministic in tests and respects launcher injection.
    /// Blank values intentionally fall back to the stable local host.
    static func loopbackHost(from environment: [String: String]) -> String {
        guard
            let host = environment["PORT_DADDY_TCP_HOST"]?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !host.isEmpty
        else { return "127.0.0.1" }

        return host
    }

    /// Compatibility accessor for views that display the stable berth. This is
    /// the port the daemon actually published, never a compile-time port guess.
    static var canonicalPreferredPort: Int {
        publishedPort(homeDirectory: FileManager.default.homeDirectoryForCurrentUser) ?? 0
    }

    static func resolveBaseURL(
        channel: AppChannel = .current,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
        isProcessAlive: (Int32) -> Bool = defaultIsProcessAlive
    ) -> String {
        let loopbackHost = loopbackHost(from: environment)

        // An explicit URL (the daemon spawns FleetBar with one; an operator can
        // export one) always wins — but an override that fails validation is not
        // silently ignored either. Falling through would guess a *different*
        // daemon than the one the operator explicitly named, which is worse
        // than failing closed.
        if let rawExplicitURL = environment["PORT_DADDY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !rawExplicitURL.isEmpty {
            guard let explicitURL = validatedExplicitURL(rawExplicitURL) else {
                return "http://\(loopbackHost):0"
            }
            return explicitURL
        }

        // A dev app follows the named berth with the same label. The berth
        // registry contains the dynamically allocated port; the app never
        // assumes a shared dev lane.
        if case .dev(let label) = channel,
           let port = registeredPort(
               for: label,
               homeDirectory: homeDirectory,
               isProcessAlive: isProcessAlive
           ) {
            return "http://\(loopbackHost):\(port)"
        }

        if channel.isProduction, let port = publishedPort(homeDirectory: homeDirectory) {
            return "http://\(loopbackHost):\(port)"
        }

        // No endpoint is more truthful than a guessed one. Port zero is an
        // intentionally unreachable loopback target, allowing the existing
        // connection UI to report that no matching daemon is available.
        return "http://\(loopbackHost):0"
    }

    static func publishedPort(homeDirectory: URL) -> Int? {
        let portFile = homeDirectory.appendingPathComponent(".port-daddy/daemon.port")
        guard
            let raw = try? String(contentsOf: portFile, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines),
            let port = Int(raw),
            (1...65_535).contains(port)
        else { return nil }
        return port
    }

    /// Looks up a named dev berth's port from the registry. A record is only
    /// trusted when its port is in range and — when the record carries a
    /// PID — that PID still names a live local process. A registry entry can
    /// outlive the daemon it named (crash, `kill -9`, a stale file); trusting
    /// a dead PID's port would hand FleetBar a URL nothing is listening on.
    /// Reachability and `/whoami` identity agreement are deliberately NOT
    /// checked here — that round trip belongs to the async connection layer
    /// (`BerthDirectory.probe`), which already owns it.
    static func registeredPort(
        for label: String,
        homeDirectory: URL,
        isProcessAlive: (Int32) -> Bool = defaultIsProcessAlive
    ) -> Int? {
        let registry = homeDirectory.appendingPathComponent(".port-daddy/dev-daemons.json")
        guard
            let data = try? Data(contentsOf: registry),
            let records = try? JSONDecoder().decode([DevDaemonRecord].self, from: data)
        else { return nil }

        let wanted = normalized(label)
        guard let record = records.first(where: { record in
            normalized(record.label) == wanted
                || (wanted == "devlatest" && normalized(record.tier) == "devlatest")
        }) else { return nil }

        guard (1...65_535).contains(record.port) else { return nil }

        if let pid = record.pid {
            guard let pid32 = Int32(exactly: pid), isProcessAlive(pid32) else { return nil }
        }

        return record.port
    }

    /// Whether a PID recorded in the dev-daemon registry still belongs to a
    /// live local process. `kill(pid, 0)` sends no signal — it only asks
    /// whether the process exists and is visible to us.
    static func defaultIsProcessAlive(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        return kill(pid, 0) == 0
    }

    /// Validates an explicit `PORT_DADDY_URL` override. Only a bare loopback
    /// `http`/`https` origin — scheme, host, and an explicit in-range port,
    /// with no userinfo, path (beyond a bare `/`), query, or fragment — is
    /// trusted. Call sites build request paths by string interpolation onto
    /// this value, so anything beyond a bare origin here would leak into
    /// every request; a malformed value is treated as absent rather than
    /// partially honoured.
    static func validatedExplicitURL(_ raw: String) -> String? {
        guard let components = URLComponents(string: raw) else { return nil }

        guard let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else { return nil }

        guard components.user == nil, components.password == nil else { return nil }

        guard let host = components.host, isLoopbackHost(host) else { return nil }

        guard let port = components.port, (1...65_535).contains(port) else { return nil }

        guard components.path.isEmpty || components.path == "/" else { return nil }
        guard components.query == nil, components.fragment == nil else { return nil }

        return "\(scheme)://\(host):\(port)"
    }

    private static func isLoopbackHost(_ host: String) -> Bool {
        switch host.lowercased() {
        case "127.0.0.1", "localhost", "::1": return true
        default: return false
        }
    }

    private static func normalized(_ value: String) -> String {
        value.lowercased().filter { $0.isLetter || $0.isNumber }
    }
}
