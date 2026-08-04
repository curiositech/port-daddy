import Foundation

enum DaemonLocation {
    static let loopbackHost = ProcessInfo.processInfo.environment["PORT_DADDY_TCP_HOST"]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .isEmpty == false
        ? ProcessInfo.processInfo.environment["PORT_DADDY_TCP_HOST"]!.trimmingCharacters(in: .whitespacesAndNewlines)
        : "127.0.0.1"

    /// Compatibility accessor for views that display the stable berth. This is
    /// the port the daemon actually published, never a compile-time port guess.
    static var canonicalPreferredPort: Int {
        publishedPort(homeDirectory: FileManager.default.homeDirectoryForCurrentUser) ?? 0
    }

    static func resolveBaseURL(
        channel: AppChannel = .current,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> String {
        // An explicit URL (the daemon spawns FleetBar with one; an operator can
        // export one) always wins.
        if let explicitURL = environment["PORT_DADDY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !explicitURL.isEmpty {
            return explicitURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }

        // A dev app follows the named berth with the same label. The berth
        // registry contains the dynamically allocated port; the app never
        // assumes a shared dev lane.
        if case .dev(let label) = channel,
           let port = registeredPort(for: label, homeDirectory: homeDirectory) {
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

    static func registeredPort(for label: String, homeDirectory: URL) -> Int? {
        let registry = homeDirectory.appendingPathComponent(".port-daddy/dev-daemons.json")
        guard
            let data = try? Data(contentsOf: registry),
            let records = try? JSONDecoder().decode([DevDaemonRecord].self, from: data)
        else { return nil }

        let wanted = normalized(label)
        return records.first { record in
            normalized(record.label) == wanted
                || (wanted == "devlatest" && normalized(record.tier) == "devlatest")
        }?.port
    }

    private static func normalized(_ value: String) -> String {
        value.lowercased().filter { $0.isLetter || $0.isNumber }
    }
}
