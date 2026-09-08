import Foundation
import SwiftUI

// MARK: - Daemon Berths (ADR-0084 Phase 2 — FleetBar surface)

/// A daemon *berth*: one addressable daemon instance pinned to a tier, a port, and
/// a brand colour (ADR-0084). The daemon self-identifies on `GET /whoami`; dev
/// berths are also recorded in `~/.port-daddy/dev-daemons.json`. FleetBar discovers
/// them, labels them, and lets the operator switch the live connection between
/// them — the "one FleetBar showing all berths" the ADR defers to Phase 2.
struct Berth: Identifiable, Equatable {
    let tier: String          // "stable" | "dev-latest" | "codebase"
    let label: String
    let port: Int
    let colorHex: String
    let canonical: Bool       // the stable brew berth on the canonical port
    let sourceDir: String?
    let gitBranch: String?
    let gitRev: String?
    let pid: Int?
    var reachable: Bool       // /whoami answered
    var version: String?

    var id: String { "\(tier)/\(label)/\(port)" }
    var url: String { "http://127.0.0.1:\(port)" }
    var color: Color { Fleet.Color.hex(colorHex) ?? Fleet.Color.dormant }

    /// One-line provenance for the row subtitle.
    var sourceSummary: String {
        if canonical { return "brew release · canonical" }
        var parts: [String] = []
        if let branch = gitBranch, !branch.isEmpty { parts.append(branch) }
        if let rev = gitRev, !rev.isEmpty { parts.append("@\(rev)") }
        if let dir = sourceDir, !dir.isEmpty {
            parts.append((dir as NSString).abbreviatingWithTildeInPath)
        }
        return parts.isEmpty ? "dev berth" : parts.joined(separator: " · ")
    }
}

// MARK: - Wire types

/// `GET /whoami` response (ADR-0084). Only the fields FleetBar surfaces are decoded.
struct WhoamiResponse: Decodable {
    let version: String?
    let pid: Int?
    let daemon: WhoamiDaemon
}

struct WhoamiDaemon: Decodable {
    let tier: String
    let label: String
    let color: String
    let canonical: Bool
    let port: Int
    let sourceDir: String?
    let gitBranch: String?
    let gitRev: String?
}

/// A recorded running dev berth, mirroring the TS `DevDaemonRecord` persisted to
/// `~/.port-daddy/dev-daemons.json`. The stable berth is never recorded here — it
/// is discovered by probing the canonical port.
struct DevDaemonRecord: Decodable {
    let label: String
    let tier: String
    let port: Int
    let sourceDir: String?
    let pid: Int?
    let gitRev: String?
    let color: String
}

// MARK: - Discovery

enum BerthDirectory {
    static var registryURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy/dev-daemons.json")
    }

    /// Probe the published stable berth plus every recorded dev berth, returning
    /// a merged, port-deduplicated list sorted stable-first. When the stable
    /// daemon has not published an endpoint, do not invent one.
    static func discover() async -> [Berth] {
        var byPort: [Int: Berth] = [:]

        if let stablePort = DaemonLocation.publishedStablePort() {
            if let stable = await probe(port: stablePort) {
                byPort[stablePort] = stable
            } else {
                byPort[stablePort] = Berth(
                    tier: "stable", label: "stable", port: stablePort, colorHex: "#E6A23C",
                    canonical: true, sourceDir: nil, gitBranch: nil, gitRev: nil, pid: nil,
                    reachable: false, version: nil)
            }
        }

        for record in loadRegistry() where byPort[record.port] == nil {
            if let live = await probe(port: record.port) {
                byPort[record.port] = live
            } else {
                byPort[record.port] = Berth(
                    tier: record.tier, label: record.label, port: record.port,
                    colorHex: record.color, canonical: false, sourceDir: record.sourceDir,
                    gitBranch: nil, gitRev: record.gitRev, pid: record.pid,
                    reachable: false, version: nil)
            }
        }

        return byPort.values.sorted {
            if $0.canonical != $1.canonical { return $0.canonical }
            return $0.port < $1.port
        }
    }

    static func loadRegistry() -> [DevDaemonRecord] {
        guard let data = try? Data(contentsOf: registryURL) else { return [] }
        return (try? JSONDecoder().decode([DevDaemonRecord].self, from: data)) ?? []
    }

    /// `GET http://127.0.0.1:<port>/whoami` with a short timeout; `nil` when the
    /// berth is down or does not speak the berth protocol.
    static func probe(port: Int) async -> Berth? {
        guard let url = URL(string: "http://127.0.0.1:\(port)/whoami") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5
        guard
            let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse, http.statusCode == 200,
            let who = try? JSONDecoder().decode(WhoamiResponse.self, from: data)
        else { return nil }

        let d = who.daemon
        return Berth(
            tier: d.tier, label: d.label, port: d.port, colorHex: d.color,
            canonical: d.canonical, sourceDir: d.sourceDir, gitBranch: d.gitBranch,
            gitRev: d.gitRev, pid: who.pid, reachable: true, version: who.version)
    }
}

// MARK: - Store

/// Observable list of berths for the manager UI. Discovery only — the *active*
/// connection lives in `FleetStore`; the view wires a tap to `FleetStore.rebind`.
@MainActor
final class BerthStore: ObservableObject {
    @Published var berths: [Berth] = []
    @Published var isRefreshing = false
    @Published var actionMessage: String?

    /// Watches `~/.port-daddy/dev-daemons.json` so a newly-registered (or removed)
    /// berth shows up instantly, not just on the next poll.
    private var registryWatch: DispatchSourceFileSystemObject?

    func refresh() async {
        isRefreshing = true
        berths = await BerthDirectory.discover()
        isRefreshing = false
    }

    /// Keep the berth list live while the popover is open: re-scan on an interval
    /// (catches daemons that came up / died / changed reachability) and watch the
    /// dev-daemons registry for instant updates when `pd dev up/down` runs. The
    /// loop is cancelled automatically when the hosting `.task` tears down (the
    /// popover closing), which also tears down the file watch.
    ///
    /// A *new FleetBar build* is handled separately by `SingleInstanceGuard` (the
    /// newer peer takes over the menu bar); this is about new *daemons*.
    func autoRefreshLoop(interval: Duration = .seconds(6)) async {
        ensureRegistryWatch()
        defer { teardownRegistryWatch() }
        while !Task.isCancelled {
            try? await Task.sleep(for: interval)
            if Task.isCancelled { break }
            await refresh()
        }
    }

    private func ensureRegistryWatch() {
        guard registryWatch == nil else { return }
        let fd = open(BerthDirectory.registryURL.path, O_EVTONLY)
        guard fd >= 0 else { return } // file may not exist yet — the poll covers it
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .extend, .delete, .rename],
            queue: .main)
        source.setEventHandler { [weak self] in
            Task { @MainActor in await self?.refresh() }
        }
        source.setCancelHandler { close(fd) }
        registryWatch = source
        source.resume()
    }

    private func teardownRegistryWatch() {
        registryWatch?.cancel()
        registryWatch = nil
    }

    /// Stop a dev berth via `pd dev down <label>` (which also releases its claimed
    /// port and cleans the registry). The canonical/stable berth is launchd-managed
    /// and is refused here — exactly the ADR-0084 safety rail.
    func stop(_ berth: Berth) async {
        guard !berth.canonical else {
            actionMessage = "The stable daemon is launchd-managed — stop it with brew, not here."
            return
        }
        actionMessage = "Stopping \(berth.label)…"
        let ok = await PDCLI.run(["dev", "down", berth.label])
        actionMessage = ok ? "Stopped \(berth.label)." : "Could not stop \(berth.label) (is pd on PATH?)."
        await refresh()
    }
}

// MARK: - pd CLI runner

/// Minimal runner for the `pd` binary, matching the candidate-path convention used
/// by `FleetStore.startDaemonViaCLI`.
enum PDCLI {
    static func locate() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = ["/opt/homebrew/bin/pd", "/usr/local/bin/pd", "\(home)/.npm-global/bin/pd"]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        return nil
    }

    /// Run `pd <args…>` off the main thread; `true` on exit status 0.
    static func run(_ arguments: [String]) async -> Bool {
        guard let executable = locate() else { return false }
        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = executable
                process.arguments = arguments
                process.standardOutput = nil
                process.standardError = nil
                do {
                    try process.run()
                    process.waitUntilExit()
                    continuation.resume(returning: process.terminationStatus == 0)
                } catch {
                    continuation.resume(returning: false)
                }
            }
        }
    }
}
