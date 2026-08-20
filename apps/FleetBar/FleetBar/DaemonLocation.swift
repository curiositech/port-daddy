import Foundation

// MARK: - Typed control-plane resolution

/// Where a resolved daemon endpoint came from. Surfaced in the UI so the
/// operator can see *why* FleetBar is talking to a given daemon — never a bare
/// number the app invented.
enum DaemonEndpointSource: Equatable {
    /// Explicit `PORT_DADDY_URL` — the daemon spawns FleetBar with one; an
    /// operator can also export one.
    case explicitURL
    /// Explicit `PORT_DADDY_PORT` on loopback.
    case explicitPort
    /// Explicit `PORT_DADDY_PORT_FILE` pointing at a port-publishing file.
    case explicitPortFile
    /// A named daemon profile selected via `PD_ACTIVE_DAEMON`, resolved to the
    /// port that profile *published* — not a fixed lane. `label` is the profile.
    case namedProfile(label: String)
    /// The live daemon's atomically-published `~/.port-daddy/daemon.port`.
    case publishedPortFile

    /// Short human label for tooltips / the control-plane banner.
    var label: String {
        switch self {
        case .explicitURL: return "PORT_DADDY_URL"
        case .explicitPort: return "PORT_DADDY_PORT"
        case .explicitPortFile: return "PORT_DADDY_PORT_FILE"
        case .namedProfile(let name): return "profile “\(name)”"
        case .publishedPortFile: return "published daemon.port"
        }
    }

    /// The canonical/stable daemon is the one discovered via its published
    /// `daemon.port` — an identity derived from *publication*, never from a
    /// preferred port number (ADR-0084; the daemon may bind anywhere).
    var isCanonicalPublication: Bool { self == .publishedPortFile }
}

/// Why FleetBar could not resolve a live control-plane endpoint. The app fails
/// closed to one of these instead of manufacturing a fake URL or a port-0
/// sentinel: a request that never gets built can never hit the wrong process.
enum DaemonUnavailableReason: Equatable {
    /// Nothing is exported and no port file has been published yet (daemon not
    /// started, or still starting).
    case noPublication
    /// `PORT_DADDY_URL` is set but is not a valid `http(s)` loopback URL.
    case invalidExplicitURL(String)
    /// `PORT_DADDY_PORT` is set but is not a valid decimal TCP port.
    case invalidExplicitPort(String)
    /// `PORT_DADDY_PORT_FILE` is set but the file is missing or holds no valid
    /// port.
    case invalidExplicitPortFile(path: String)
    /// `PD_ACTIVE_DAEMON` names a profile that has not published a port.
    case profileNotPublished(label: String)
    /// `PD_ACTIVE_DAEMON` names a profile whose published port is out of range.
    case profilePortOutOfRange(label: String, value: Int)
    /// A port file was present but its contents were not a valid decimal port.
    case malformedPublication(String)

    /// One-line operator-facing reason for the control-plane-unavailable state.
    var summary: String {
        switch self {
        case .noPublication:
            return "No daemon has published an endpoint yet."
        case .invalidExplicitURL(let raw):
            return "PORT_DADDY_URL is not a valid http(s) URL: \(raw)"
        case .invalidExplicitPort(let raw):
            return "PORT_DADDY_PORT is not a valid port: \(raw)"
        case .invalidExplicitPortFile(let path):
            return "PORT_DADDY_PORT_FILE has no valid port: \(path)"
        case .profileNotPublished(let label):
            return "Profile “\(label)” has not published a port."
        case .profilePortOutOfRange(let label, let value):
            return "Profile “\(label)” published an out-of-range port: \(value)"
        case .malformedPublication(let raw):
            return "Published port is malformed: \(raw.isEmpty ? "(empty)" : raw)"
        }
    }
}

/// The result of resolving where the control plane lives. Either an actual,
/// validated base URL together with its provenance, or an explicit unavailable
/// state with a typed reason. There is deliberately no third "guessed" case.
enum DaemonEndpoint: Equatable {
    case available(url: String, source: DaemonEndpointSource)
    case unavailable(DaemonUnavailableReason)

    /// The base URL when available; `nil` when the control plane is unavailable.
    /// Call sites build requests only when this is non-nil.
    var url: String? {
        if case .available(let url, _) = self { return url }
        return nil
    }

    var source: DaemonEndpointSource? {
        if case .available(_, let source) = self { return source }
        return nil
    }

    var unavailableReason: DaemonUnavailableReason? {
        if case .unavailable(let reason) = self { return reason }
        return nil
    }

    var isAvailable: Bool { url != nil }
}

enum DaemonLocation {
    // Compatibility surface for the stacked migration. These retain the
    // current FleetBar behavior until every store has moved to DaemonEndpoint;
    // the final slice removes them together so no intermediate PR stops the app
    // from compiling or silently changes an unmigrated caller.
    static let canonicalPreferredPort = 9876
    static let devLatestPort = 9886

    /// Legal TCP port range for a listener. Port 0 is excluded on purpose — it
    /// is the "let the kernel pick" sentinel, never a real published endpoint.
    static let validPortRange = 1...65535

    static let loopbackHost = resolveLoopbackHost(environment: ProcessInfo.processInfo.environment)

    static func resolveBaseURL(channel: AppChannel = .current) -> String {
        if let explicitURL = ProcessInfo.processInfo.environment["PORT_DADDY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !explicitURL.isEmpty {
            return explicitURL
        }

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

    /// Pure host resolution — injectable so tests don't depend on the real
    /// process environment.
    static func resolveLoopbackHost(environment: [String: String]) -> String {
        if let raw = environment["PORT_DADDY_TCP_HOST"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !raw.isEmpty {
            return raw
        }
        return "127.0.0.1"
    }

    // MARK: - Resolution

    /// Resolve the control-plane endpoint against the real process environment,
    /// the published `daemon.port` file, and the dev-daemon registry.
    static func resolve() -> DaemonEndpoint {
        resolve(
            environment: ProcessInfo.processInfo.environment,
            portFileContents: readPortFile,
            namedProfilePort: publishedPortForProfile)
    }

    /// Convenience for call sites that only need the base URL. Returns `nil`
    /// when the control plane is unavailable — the fail-closed contract. Never
    /// returns a fabricated URL or a port-0 sentinel.
    static func availableBaseURL() -> String? { resolve().url }

    /// The stable daemon's *published* port, if a valid one has been written to
    /// `~/.port-daddy/daemon.port`. `nil` when unpublished or malformed — the
    /// berth directory then has no canonical berth to display rather than
    /// seeding a preferred literal (ADR-0084; allocator seeds live only in
    /// canonical daemon startup, never in this app).
    static func publishedStablePort() -> Int? {
        publishedStablePort(portFileContents: readPortFile)
    }

    static func publishedStablePort(portFileContents: () -> String?) -> Int? {
        validatedPort(portFileContents())
    }

    /// Pure resolution core. Precedence (highest wins; an *explicit* source that
    /// is present but invalid fails closed rather than silently downgrading, so
    /// an operator's stated intent is never quietly overridden):
    ///
    ///   1. `PORT_DADDY_URL` — validated `http(s)` URL with an in-range port.
    ///   2. `PORT_DADDY_PORT` — validated decimal loopback port.
    ///   3. `PORT_DADDY_PORT_FILE` — a file whose contents are a valid port.
    ///   4. `PD_ACTIVE_DAEMON` — a named profile's *published* port (from the
    ///      dev-daemon registry), when it names one.
    ///   5. the live daemon's atomically-published `~/.port-daddy/daemon.port`.
    ///   6. otherwise `.unavailable` — never manufacture a preferred/fixed port.
    ///
    /// - Parameters:
    ///   - environment: process environment (injected for tests).
    ///   - portFileContents: reads the default published `daemon.port`.
    ///   - namedProfilePort: published port for a profile name, or `nil` when
    ///     that profile has not published one.
    static func resolve(
        environment: [String: String],
        portFileContents: () -> String?,
        namedProfilePort: (String) -> Int?,
        fileReader: (String) -> String? = { readFile(atPath: $0) }
    ) -> DaemonEndpoint {
        let host = resolveLoopbackHost(environment: environment)

        // 1. Explicit URL.
        if let raw = trimmedNonEmpty(environment["PORT_DADDY_URL"]) {
            guard let url = validatedLoopbackURL(raw) else {
                return .unavailable(.invalidExplicitURL(raw))
            }
            return .available(url: url, source: .explicitURL)
        }

        // 2. Explicit port.
        if let raw = trimmedNonEmpty(environment["PORT_DADDY_PORT"]) {
            guard let port = validatedPort(raw) else {
                return .unavailable(.invalidExplicitPort(raw))
            }
            return .available(url: "http://\(host):\(port)", source: .explicitPort)
        }

        // 3. Explicit port file.
        if let path = trimmedNonEmpty(environment["PORT_DADDY_PORT_FILE"]) {
            guard let port = validatedPort(fileReader(path)) else {
                return .unavailable(.invalidExplicitPortFile(path: path))
            }
            return .available(url: "http://\(host):\(port)", source: .explicitPortFile)
        }

        // 4. Named profile selection.
        if let label = trimmedNonEmpty(environment["PD_ACTIVE_DAEMON"]) {
            guard let published = namedProfilePort(label) else {
                return .unavailable(.profileNotPublished(label: label))
            }
            guard validPortRange.contains(published) else {
                return .unavailable(.profilePortOutOfRange(label: label, value: published))
            }
            return .available(url: "http://\(host):\(published)", source: .namedProfile(label: label))
        }

        // 5. Stable published port file.
        let published = portFileContents()
        if let published, !published.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let port = validatedPort(published) else {
                return .unavailable(.malformedPublication(published))
            }
            return .available(url: "http://\(host):\(port)", source: .publishedPortFile)
        }

        // 6. Fail closed.
        return .unavailable(.noPublication)
    }

    // MARK: - Validation helpers

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    /// A strictly-decimal TCP port in `validPortRange`. Rejects empty, signed,
    /// hex, and trailing-garbage forms so a malformed publication never becomes
    /// a live endpoint.
    static func validatedPort(_ raw: String?) -> Int? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty,
              trimmed.allSatisfy({ $0.isNumber && $0.isASCII }),
              let port = Int(trimmed),
              validPortRange.contains(port) else { return nil }
        return port
    }

    /// A well-formed `http(s)` base URL with a non-empty host and an explicit,
    /// in-range port. User info and request-specific path/query/fragment state
    /// are rejected because callers append their own route paths.
    static func validatedLoopbackURL(
        _ raw: String,
        requireExplicitPort: Bool = true
    ) -> String? {
        guard let components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/" else { return nil }

        if requireExplicitPort, components.port == nil { return nil }
        if let port = components.port, !validPortRange.contains(port) { return nil }

        var normalized = URLComponents()
        normalized.scheme = scheme
        normalized.host = host
        normalized.port = components.port
        return normalized.string
    }

    // MARK: - Production I/O

    private static func readPortFile() -> String? {
        readFile(atPath: FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy/daemon.port").path)
    }

    private static func readFile(atPath path: String) -> String? {
        try? String(contentsOfFile: path, encoding: .utf8)
    }

    /// Published port for a named daemon profile, read from the dev-daemon
    /// registry (`~/.port-daddy/dev-daemons.json`). Matches by label or tier so
    /// `PD_ACTIVE_DAEMON=dev-latest` finds the record that build published.
    private static func publishedPortForProfile(_ label: String) -> Int? {
        let needle = label.lowercased()
        return BerthDirectory.loadRegistry()
            .first { $0.label.lowercased() == needle || $0.tier.lowercased() == needle }?
            .port
    }
}
