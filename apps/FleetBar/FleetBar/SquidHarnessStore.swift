import Foundation
import SwiftUI

enum SquidHarnessLifecycle: String, Codable, Sendable {
    case off = "OFF"
    case ready = "READY"
    case partial = "PARTIAL"
    case live = "LIVE"
    case degraded = "DEGRADED"

    var label: String { rawValue }
    var isFullyWired: Bool { self == .ready || self == .live }
    var color: Color {
        switch self {
        case .live: return Fleet.Color.healthy
        case .ready: return Fleet.Color.active
        case .partial: return Fleet.Color.warning
        case .degraded: return Fleet.Color.failure
        case .off: return Fleet.Color.dormant
        }
    }
}

struct SquidHarnessProviderStatus: Codable, Equatable, Sendable, Identifiable {
    let name: String
    let slug: String
    let detected: Bool
    let expectedScope: String
    let wired: Bool

    var id: String { slug }
}

struct SquidHarnessIdentityStatus: Codable, Equatable, Sendable {
    let statuslineStaged: Bool
    let statuslineProject: Bool
    let statuslineUser: Bool
    let slashCommand: Bool
    let pilotSessionStart: Bool
    let daemonAlive: Bool
}

struct SquidHarnessValue: Codable, Equatable, Sendable {
    let beforeTurn: String
    let beforeEdit: String
    let afterTool: String
}

struct SquidHarnessSnapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let state: SquidHarnessLifecycle
    let workspace: String
    let daemonAlive: Bool
    let tentaclesStaged: Bool
    let providers: [SquidHarnessProviderStatus]
    let identity: SquidHarnessIdentityStatus
    let value: SquidHarnessValue

    var detectedProviderCount: Int { providers.filter(\.detected).count }
    var wiredProviderCount: Int { providers.filter { $0.detected && $0.wired }.count }
}

struct SquidCommandResult: Sendable {
    let status: Int32
    let stdout: String
    let stderr: String
}

typealias SquidCommandRunner = @Sendable ([String]) async -> SquidCommandResult

enum SquidHarnessCLI {
    static func locate() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = ["/opt/homebrew/bin/pd", "/usr/local/bin/pd", "\(home)/.npm-global/bin/pd"]
        return candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }).map(URL.init(fileURLWithPath:))
    }

    static func run(_ arguments: [String]) async -> SquidCommandResult {
        guard let executable = locate() else {
            return SquidCommandResult(status: 127, stdout: "", stderr: "Port Daddy is not installed")
        }
        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                let stdout = Pipe()
                let stderr = Pipe()
                process.executableURL = executable
                process.arguments = arguments
                process.standardOutput = stdout
                process.standardError = stderr
                do {
                    try process.run()
                    process.waitUntilExit()
                    continuation.resume(returning: SquidCommandResult(
                        status: process.terminationStatus,
                        stdout: String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "",
                        stderr: String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                    ))
                } catch {
                    continuation.resume(returning: SquidCommandResult(status: 126, stdout: "", stderr: error.localizedDescription))
                }
            }
        }
    }
}

@MainActor
final class SquidHarnessStore: ObservableObject {
    @Published private(set) var snapshot: SquidHarnessSnapshot?
    @Published private(set) var isWorking = false
    @Published private(set) var message: String?

    private let runner: SquidCommandRunner

    init(runner: @escaping SquidCommandRunner = SquidHarnessCLI.run) {
        self.runner = runner
    }

    func refresh(projectDir: String?) async {
        guard let projectDir, !projectDir.isEmpty else {
            snapshot = nil
            message = nil
            return
        }
        isWorking = true
        defer { isWorking = false }
        let result = await runner(["squid", "status", "--json", "--cwd", projectDir])
        guard let data = result.stdout.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(SquidHarnessSnapshot.self, from: data) else {
            snapshot = nil
            message = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Squid status is unavailable."
                : result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            return
        }
        snapshot = decoded
        message = decoded.state == .degraded ? "The harness needs repair before it can protect this project." : nil
    }

    func arm(projectDir: String) async {
        await mutate(["squid", "on", "--cwd", projectDir], projectDir: projectDir, success: "Squid armed. New agent sessions will show ◆ PD.")
    }

    func disarm(projectDir: String) async {
        await mutate(["squid", "off", "--cwd", projectDir], projectDir: projectDir, success: "Squid disarmed for this project.")
    }

    private func mutate(_ arguments: [String], projectDir: String, success: String) async {
        isWorking = true
        message = nil
        let result = await runner(arguments)
        isWorking = false
        let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        let actionMessage = result.status == 0
            ? success
            : (detail.isEmpty ? "The Squid action failed." : detail)
        await refresh(projectDir: projectDir)
        if result.status != 0 {
            // A refresh can update the snapshot, but it must never erase the
            // actionable stderr that explains why Arm/Repair/Disarm failed.
            message = actionMessage
        } else if snapshot != nil {
            message = actionMessage
        }
    }
}

struct SquidHarnessStrip: View {
    @ObservedObject var store: SquidHarnessStore
    let projectDir: String

    private var lifecycle: SquidHarnessLifecycle { store.snapshot?.state ?? .off }

    var body: some View {
        HStack(spacing: Fleet.Space.m) {
            ZStack {
                Circle().fill(lifecycle.color.opacity(0.16)).frame(width: 30, height: 30)
                Image(systemName: "point.3.connected.trianglepath.dotted")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(lifecycle.color)
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Fleet.Space.xs) {
                    Text("◆ GIANT SQUID")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(lifecycle.color)
                    Text(lifecycle.label)
                        .font(.system(.caption, design: .monospaced).weight(.bold))
                    if let snapshot = store.snapshot {
                        Text("\(snapshot.wiredProviderCount)/\(snapshot.detectedProviderCount) agents wired")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Text("Before each turn: context · before each edit: collision gate · after each tool: fleet trace")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let message = store.message {
                    Text(message)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(lifecycle == .degraded || store.snapshot == nil ? Fleet.Color.failure : lifecycle.color)
                        .lineLimit(2)
                        .accessibilityLabel("Giant Squid status: \(message)")
                }
            }

            Spacer(minLength: Fleet.Space.m)

            if store.isWorking {
                ProgressView().controlSize(.small)
            }
            Button(lifecycle.isFullyWired ? "Disarm" : (lifecycle == .degraded ? "Repair" : "Arm")) {
                Task {
                    if lifecycle.isFullyWired { await store.disarm(projectDir: projectDir) }
                    else { await store.arm(projectDir: projectDir) }
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(lifecycle.isFullyWired ? Fleet.Color.dormant : lifecycle.color)
            .disabled(store.isWorking)
            .accessibilityHint("Controls Port Daddy hooks for the selected project without opening a terminal")
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, 8)
        .background(lifecycle.color.opacity(0.09), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous).stroke(lifecycle.color.opacity(0.24), lineWidth: 1))
        .help("Port Daddy adds coordination context outside the agent conversation")
    }
}
