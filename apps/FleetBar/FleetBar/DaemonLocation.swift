import Foundation

enum DaemonLocation {
    static let canonicalPreferredPort = 9876
    static let loopbackHost = ProcessInfo.processInfo.environment["PORT_DADDY_TCP_HOST"]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .isEmpty == false
        ? ProcessInfo.processInfo.environment["PORT_DADDY_TCP_HOST"]!.trimmingCharacters(in: .whitespacesAndNewlines)
        : "127.0.0.1"

    static func resolveBaseURL() -> String {
        if let explicitURL = ProcessInfo.processInfo.environment["PORT_DADDY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !explicitURL.isEmpty {
            return explicitURL
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
