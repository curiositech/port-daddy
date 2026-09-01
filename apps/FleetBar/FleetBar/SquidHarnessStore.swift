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

enum SquidHookCircuitState: String, Codable, Sendable {
    case closed
    case open
    case halfOpen = "half_open"
}

enum SquidHookProbeState: String, Codable, Sendable {
    case none
    case active
    case stale
    case unknown
}

struct SquidHookCircuit: Codable, Equatable, Sendable, Identifiable {
    let hook: String
    let label: String
    let state: SquidHookCircuitState
    let consecutiveFailures: Int
    let openedAt: String?
    let retryAt: String?
    let lastReason: String
    let lastDurationMs: Int
    let lastExitCode: Int?
    let updatedAt: String
    let probeState: SquidHookProbeState?
    let probeStartedAt: String?
    let probeExpectedBy: String?
    let recoveryReady: Bool?

    var id: String { hook }

    var operatorHeadline: String {
        let reason = lastReason.replacingOccurrences(of: "_", with: " ")
        if state == .halfOpen {
            return "\(label) is running one bounded recovery probe after \(consecutiveFailures) unhealthy calls."
        }
        if recoveryReady == true {
            return "\(label) recovery is ready after \(consecutiveFailures) unhealthy calls; no probe is running."
        }
        return "\(label) disabled itself after \(consecutiveFailures) unhealthy calls; the last reason was \(reason)."
    }

    var timingLine: String? {
        if state == .halfOpen, let probeStartedAt, let probeExpectedBy {
            return "Probe started \(probeStartedAt) · expected by \(probeExpectedBy)"
        }
        if recoveryReady == true, let retryAt {
            return "Recovery available since \(retryAt)"
        }
        if let retryAt {
            return "Automatic recovery available at \(retryAt)"
        }
        return nil
    }
}

struct SquidHookHealthThresholds: Codable, Equatable, Sendable {
    let consecutiveFailures: Int
    let slowMs: Int
    let cooldownMs: Int
}

struct SquidHookHealthSnapshot: Codable, Equatable, Sendable {
    let degraded: Bool
    let capturedAt: String
    let thresholds: SquidHookHealthThresholds
    let circuits: [SquidHookCircuit]
    let remediation: String
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
    let health: SquidHookHealthSnapshot?

    var detectedProviderCount: Int { providers.filter(\.detected).count }
    var wiredProviderCount: Int { providers.filter { $0.detected && $0.wired }.count }
}

enum SquidHookDebugState: String, Codable, Sendable {
    case running
    case overdue
    case completed
    case skipped
    case blocked
    case failed

    var label: String { rawValue.uppercased() }
    var color: Color {
        switch self {
        case .completed: return Fleet.Color.healthy
        case .running: return Fleet.Color.active
        case .skipped: return Fleet.Color.dormant
        case .blocked, .overdue: return Fleet.Color.warning
        case .failed: return Fleet.Color.failure
        }
    }

    var symbol: String {
        switch self {
        case .completed: return "checkmark.circle.fill"
        case .running: return "clock.fill"
        case .skipped: return "minus.circle"
        case .blocked: return "hand.raised.fill"
        case .overdue: return "exclamationmark.triangle.fill"
        case .failed: return "xmark.octagon.fill"
        }
    }
}

struct SquidHookDebugStep: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let phase: String
    let label: String
    let hook: String
    let state: SquidHookDebugState
    let startedAt: String
    let expectedBy: String
    let finishedAt: String?
    let durationMs: Int?
    let deadlineMs: Int
    let outcome: String?
    let exitCode: Int?
    let description: String
}

struct SquidHookDebugSession: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let runtimeSessionId: String
    let provider: String
    let providerLabel: String
    let workspace: String
    let workspaceLabel: String
    let state: SquidHookDebugState
    let startedAt: String
    let lastActivityAt: String
    let steps: [SquidHookDebugStep]
}

struct SquidHookDebugRetention: Codable, Equatable, Sendable {
    let maxBytes: Int
    let eventPath: String
}

struct SquidHookDebugSnapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let enabled: Bool
    let enabledAt: String?
    let capturedAt: String
    let workspace: String?
    let privacy: String
    let retention: SquidHookDebugRetention
    let health: SquidHookHealthSnapshot?
    let sessions: [SquidHookDebugSession]

    var overdueCount: Int {
        sessions.flatMap(\.steps).filter { $0.state == .overdue }.count
    }
}

struct ContextContinuityCounts: Codable, Equatable, Sendable {
    let observed: Int
    let packetReady: Int
    let successorRequired: Int
    let continuing: Int
    let completed: Int
    let verificationFailed: Int
}

struct ContextContinuityPressure: Codable, Equatable, Sendable {
    let band: String
    let ratio: Double
    let action: String
    let windowTokens: Int
    let usedTokensEstimate: Int
    let estimateMode: String
    let strategy: String
    let selfReportDrift: [String]
}

struct ContextContinuityPacket: Codable, Equatable, Sendable {
    let packetId: String
    let createdAt: String
    let validatorPassed: Bool
    let sourceHeadEventId: String
    let sourceHeadHash: String
    let transcriptEventId: String?
}

struct ContextContinuationReceipt: Codable, Equatable, Sendable {
    let id: String
    let status: String
    let targetAdapter: String
    let successorRunId: String?
    let successorSessionId: String?
    let updatedAt: Double
}

struct ContextContinuityItem: Codable, Equatable, Sendable, Identifiable {
    let agentNodeId: String
    let sessionId: String
    let runId: String?
    let transcriptId: String?
    let model: String?
    let sourceAdapter: String?
    let project: String?
    let projectDir: String?
    let envelopeId: String
    let measuredAt: String
    let pressure: ContextContinuityPressure
    let packet: ContextContinuityPacket?
    let handoffEpisodeId: Int?
    let continuation: ContextContinuationReceipt?
    let readiness: String

    var id: String { envelopeId }
}

struct ContextContinuityFailure: Codable, Equatable, Sendable, Identifiable {
    let eventId: String
    let sessionId: String
    let agentNodeId: String
    let reason: String

    var id: String { eventId }
}

struct ContextContinuitySnapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let capturedAt: String
    let counts: ContextContinuityCounts
    let items: [ContextContinuityItem]
    let failures: [ContextContinuityFailure]
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
    @Published private(set) var debugSnapshot: SquidHookDebugSnapshot?
    @Published private(set) var continuitySnapshot: ContextContinuitySnapshot?
    @Published private(set) var isWorking = false
    @Published private(set) var isDebugWorking = false
    @Published private(set) var message: String?
    @Published private(set) var debugMessage: String?
    @Published private(set) var continuityMessage: String?

    private let runner: SquidCommandRunner
    private let baseURL: String?
    private let session: URLSession

    init(
        baseURL: String? = nil,
        session: URLSession = .shared,
        runner: @escaping SquidCommandRunner = SquidHarnessCLI.run
    ) {
        self.baseURL = baseURL
        self.session = session
        self.runner = runner
    }

    func refresh(projectDir: String?) async {
        guard let projectDir, !projectDir.isEmpty else {
            snapshot = nil
            message = nil
            continuitySnapshot = nil
            continuityMessage = nil
            return
        }
        await refreshContinuity(projectDir: projectDir)
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
        guard decoded.schemaVersion == 1 else {
            snapshot = nil
            message = "Squid status uses an unsupported data format. Update FleetBar before relying on it."
            return
        }
        snapshot = decoded
        if decoded.state == .degraded, let circuit = decoded.health?.circuits.first(where: { $0.state != .closed }) {
            if circuit.state == .halfOpen {
                message = "\(circuit.label) is running one bounded recovery probe; expected by \(circuit.probeExpectedBy ?? "its configured deadline")."
            } else if circuit.recoveryReady == true {
                message = "\(circuit.label) recovery is ready; the next armed hook may run one bounded probe."
            } else {
                message = "\(circuit.label) disabled itself after repeated \(circuit.lastReason.replacingOccurrences(of: "_", with: " ")) events. Choose Repair."
            }
        } else {
            message = decoded.state == .degraded ? "The harness needs repair before it can protect this project." : nil
        }
    }

    func refreshContinuity(projectDir: String? = nil) async {
        guard let baseURL,
              var components = URLComponents(string: "\(baseURL)/agent-harbor/context-continuity") else {
            continuitySnapshot = nil
            continuityMessage = "Context continuity evidence is unavailable until the daemon publishes an endpoint."
            return
        }
        components.queryItems = [URLQueryItem(name: "limit", value: "50")]
        if let projectDir, !projectDir.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "projectDir", value: projectDir))
        }
        guard let url = components.url else {
            continuitySnapshot = nil
            continuityMessage = "Context continuity evidence could not address the selected project."
            return
        }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse else {
                continuitySnapshot = nil
                continuityMessage = "Context continuity evidence has no daemon response."
                return
            }
            if http.statusCode == 404 {
                continuitySnapshot = nil
                continuityMessage = "Update Port Daddy to see context envelopes and continuation receipts."
                return
            }
            guard http.statusCode == 200,
                  let decoded = try? JSONDecoder().decode(ContextContinuitySnapshot.self, from: data),
                  decoded.schemaVersion == 1 else {
                continuitySnapshot = nil
                continuityMessage = "Context continuity evidence could not be verified."
                return
            }
            continuitySnapshot = decoded
            if decoded.counts.verificationFailed > 0 {
                continuityMessage = "\(decoded.counts.verificationFailed) context proof failed verification. Inspect the evidence panel."
            } else {
                continuityMessage = decoded.items.isEmpty ? "No witnessed context envelopes yet." : nil
            }
        } catch {
            continuitySnapshot = nil
            continuityMessage = "Context continuity error: \(error.localizedDescription)"
        }
    }

    func arm(projectDir: String) async {
        await mutate(["squid", "on", "--cwd", projectDir], projectDir: projectDir, success: "Squid armed. New agent sessions will show ◆ PD.")
    }

    func disarm(projectDir: String) async {
        await mutate(["squid", "off", "--cwd", projectDir], projectDir: projectDir, success: "Squid disarmed for this project.")
    }

    func refreshDebug(projectDir: String) async {
        isDebugWorking = true
        defer { isDebugWorking = false }
        let result = await runner(["squid", "debug", "status", "--json", "--cwd", projectDir])
        decodeDebug(result)
    }

    func setDebugCapture(_ enabled: Bool, projectDir: String) async {
        isDebugWorking = true
        debugMessage = nil
        let action = enabled ? "on" : "off"
        let result = await runner(["squid", "debug", action, "--json", "--cwd", projectDir])
        isDebugWorking = false
        decodeDebug(result)
        if result.status == 0 {
            debugMessage = enabled
                ? "Capturing sanitized hook timing for new invocations."
                : "Capture stopped; the retained timeline remains available."
        }
    }

    func clearDebug(projectDir: String) async {
        isDebugWorking = true
        debugMessage = nil
        let result = await runner(["squid", "debug", "clear", "--json", "--cwd", projectDir])
        isDebugWorking = false
        decodeDebug(result)
        if result.status == 0 { debugMessage = "Hook timeline cleared." }
    }

    private func decodeDebug(_ result: SquidCommandResult) {
        guard let data = result.stdout.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(SquidHookDebugSnapshot.self, from: data) else {
            debugSnapshot = nil
            let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            debugMessage = detail.isEmpty ? "Squid hook timing is unavailable." : detail
            return
        }
        guard decoded.schemaVersion == 1 else {
            debugSnapshot = nil
            debugMessage = "Squid hook timing uses an unsupported data format. Update FleetBar before relying on it."
            return
        }
        debugSnapshot = decoded
        debugMessage = nil
        if result.status != 0 {
            let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            if !detail.isEmpty { debugMessage = detail }
        }
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
    @State private var showingDebug = false

    private var lifecycle: SquidHarnessLifecycle { store.snapshot?.state ?? .off }
    private var continuityColor: Color {
        guard let counts = store.continuitySnapshot?.counts else { return Fleet.Color.dormant }
        if counts.verificationFailed > 0 { return Fleet.Color.failure }
        if counts.successorRequired > 0 { return Fleet.Color.failure }
        if counts.packetReady > 0 || counts.completed > 0 { return Fleet.Color.healthy }
        return counts.observed > 0 ? Fleet.Color.active : Fleet.Color.dormant
    }

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
                    if let counts = store.continuitySnapshot?.counts {
                        Text("·")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text(
                            counts.verificationFailed > 0
                                ? "\(counts.verificationFailed) verification failed"
                                : counts.successorRequired > 0
                                    ? "\(counts.successorRequired) successor required"
                                    : counts.packetReady > 0
                                        ? "\(counts.packetReady) verified packet\(counts.packetReady == 1 ? "" : "s")"
                                        : "\(counts.observed) context receipt\(counts.observed == 1 ? "" : "s")"
                        )
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(continuityColor)
                    }
                }
                Text("Before each turn: context · before each edit: collision gate · cumulative session evidence; no post-tool process")
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
                if store.snapshot != nil, let continuityMessage = store.continuityMessage {
                    Text(continuityMessage)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Fleet.Space.m)

            if store.isWorking {
                ProgressView().controlSize(.small)
            }
            Button {
                showingDebug = true
                Task { await store.refreshDebug(projectDir: projectDir) }
            } label: {
                Label("Inspect", systemImage: "waveform.path.ecg.rectangle")
            }
            .buttonStyle(.bordered)
            .accessibilityHint("Shows each Squid hook step, its actual timing, and its expected deadline")
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
        .sheet(isPresented: $showingDebug) {
            SquidHookDebugSheet(store: store, projectDir: projectDir)
        }
    }
}

struct SquidHookDebugSheet: View {
    @ObservedObject var store: SquidHarnessStore
    let projectDir: String
    @Environment(\.dismiss) private var dismiss

    private var snapshot: SquidHookDebugSnapshot? { store.debugSnapshot }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .frame(minWidth: 760, idealWidth: 860, minHeight: 560, idealHeight: 680)
        .background(Fleet.Chrome.popoverBackground)
        .task {
            while !Task.isCancelled {
                await store.refreshDebug(projectDir: projectDir)
                await store.refreshContinuity(projectDir: projectDir)
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack(alignment: .top, spacing: Fleet.Space.m) {
                ZStack {
                    RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                        .fill(Fleet.Color.active.opacity(0.14))
                    Image(systemName: "waveform.path.ecg.rectangle")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Fleet.Color.active)
                }
                .frame(width: 46, height: 46)

                VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                    Text("Squid hook timeline")
                        .font(.title2.weight(.semibold))
                    Text("Every agent session, every coordination step, and the deadline it was expected to meet.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if store.isDebugWorking { ProgressView().controlSize(.small) }
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }

            HStack(spacing: Fleet.Space.s) {
                debugBadge
                if let count = snapshot?.overdueCount, count > 0 {
                    Label("\(count) overdue", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Fleet.Color.warning)
                }
                if snapshot?.health?.degraded == true {
                    let recovering = snapshot?.health?.circuits.contains(where: { $0.state == .halfOpen }) == true
                    let recoveryReady = snapshot?.health?.circuits.contains(where: { $0.recoveryReady == true }) == true
                    let healthTitle = recovering ? "HOOK RECOVERING" : recoveryReady ? "RECOVERY READY" : "HOOK DISABLED"
                    let healthIcon = recovering ? "arrow.triangle.2.circlepath" : recoveryReady ? "arrow.clockwise.circle.fill" : "bolt.slash.fill"
                    Label(healthTitle, systemImage: healthIcon)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(recovering || recoveryReady ? Fleet.Color.warning : Fleet.Color.failure)
                }
                Spacer()
                Button(snapshot?.enabled == true ? "Stop capture" : "Start capture") {
                    Task { await store.setDebugCapture(snapshot?.enabled != true, projectDir: projectDir) }
                }
                .buttonStyle(.borderedProminent)
                .tint(snapshot?.enabled == true ? Fleet.Color.dormant : Fleet.Color.active)
                .disabled(store.isDebugWorking)
                Button("Clear") {
                    Task { await store.clearDebug(projectDir: projectDir) }
                }
                .buttonStyle(.bordered)
                .disabled(store.isDebugWorking || snapshot?.sessions.isEmpty != false)
            }

            if let message = store.debugMessage {
                Text(message)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Squid debug status: \(message)")
            }
            if let health = snapshot?.health,
               let circuit = health.circuits.first(where: { $0.state != .closed }) {
                VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                    Text(circuit.operatorHeadline)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(circuit.state == .halfOpen || circuit.recoveryReady == true ? Fleet.Color.warning : Fleet.Color.failure)
                    if let timingLine = circuit.timingLine {
                        Text(timingLine)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Text(health.remediation)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .padding(Fleet.Space.s)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Fleet.Color.failure.opacity(0.08), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
            }
        }
        .padding(Fleet.Space.l)
    }

    @ViewBuilder
    private var debugBadge: some View {
        let enabled = snapshot?.enabled == true
        Label(enabled ? "CAPTURING" : "CAPTURE OFF", systemImage: enabled ? "record.circle.fill" : "record.circle")
            .font(.caption.weight(.bold))
            .foregroundStyle(enabled ? Fleet.Color.healthy : Fleet.Color.dormant)
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, Fleet.Space.xs)
            .background((enabled ? Fleet.Color.healthy : Fleet.Color.dormant).opacity(0.12), in: Capsule())
    }

    @ViewBuilder
    private var content: some View {
        if snapshot?.sessions.isEmpty == false
            || store.continuitySnapshot?.items.isEmpty == false
            || (store.continuitySnapshot?.counts.verificationFailed ?? 0) > 0 {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Fleet.Space.m) {
                    if let continuity = store.continuitySnapshot {
                        continuityCard(continuity)
                    }
                    if let snapshot {
                        privacyCard(snapshot)
                        ForEach(snapshot.sessions) { session in
                            sessionCard(session)
                        }
                    }
                }
                .padding(Fleet.Space.l)
            }
        } else {
            VStack(spacing: Fleet.Space.m) {
                Image(systemName: "waveform.path")
                    .font(.system(.largeTitle, design: .rounded))
                    .foregroundStyle(Fleet.Color.dormant)
                Text(snapshot?.enabled == true ? "Waiting for the next hook invocation" : "Capture is off")
                    .font(.headline)
                Text(snapshot?.enabled == true
                     ? "New PD TURN and direct PD EDIT steps will appear here automatically; retained PD TRACE rows are legacy history."
                     : "Start capture to see what each agent session is running and whether it met its deadline.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 480)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(Fleet.Space.xl)
        }
    }

    private func continuityCard(_ snapshot: ContextContinuitySnapshot) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                    Text("Context continuity evidence")
                        .font(.headline)
                    Text("Append-only envelopes, cited packets, and exactly-one successor receipts")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(snapshot.counts.packetReady) VERIFIED")
                    .font(.caption.monospaced().weight(.bold))
                    .foregroundStyle(snapshot.counts.successorRequired > 0 || snapshot.counts.verificationFailed > 0 ? Fleet.Color.failure : Fleet.Color.healthy)
            }

            if snapshot.counts.verificationFailed > 0 {
                Label("\(snapshot.counts.verificationFailed) context proof failed verification; no green receipt was emitted.", systemImage: "xmark.shield.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(Fleet.Color.failure)
                ForEach(snapshot.failures.prefix(3)) { failure in
                    Text("\(failure.sessionId): \(failure.reason)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }

            ForEach(snapshot.items.prefix(5)) { item in
                HStack(alignment: .top, spacing: Fleet.Space.m) {
                    Image(systemName: item.packet?.validatorPassed == true ? "checkmark.shield.fill" : "gauge.with.dots.needle.67percent")
                        .foregroundStyle(item.readiness == "successor-required" ? Fleet.Color.failure : item.packet == nil ? Fleet.Color.active : Fleet.Color.healthy)
                    VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                        HStack {
                            Text(item.model ?? item.sourceAdapter ?? item.agentNodeId)
                                .font(.callout.weight(.semibold))
                            Text("\(Int((item.pressure.ratio * 100).rounded()))%")
                                .font(.caption.monospaced().weight(.bold))
                            Text(item.readiness.replacingOccurrences(of: "-", with: " ").uppercased())
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.secondary)
                        }
                        Text(item.packet.map { "Packet \($0.packetId) · source \($0.sourceHeadEventId)" }
                             ?? "Envelope \(item.envelopeId) · \(item.pressure.strategy)")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        if let receipt = item.continuation {
                            Text("Successor receipt \(receipt.id) · \(receipt.status)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                }
            }
        }
        .padding(Fleet.Space.m)
        .background(Fleet.Color.active.opacity(0.08), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous).stroke(Fleet.Color.active.opacity(0.22)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Context continuity: \(snapshot.counts.observed) envelopes, \(snapshot.counts.packetReady) verified packets, \(snapshot.counts.successorRequired) successors required, \(snapshot.counts.verificationFailed) verification failures")
    }

    private func privacyCard(_ snapshot: SquidHookDebugSnapshot) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: "lock.shield.fill")
                .foregroundStyle(Fleet.Color.healthy)
            VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                Text("Sanitized local timing")
                    .font(.callout.weight(.semibold))
                Text(snapshot.privacy)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text("Bounded retention: \(snapshot.retention.maxBytes / 1_048_576) MiB")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(Fleet.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Fleet.Color.healthy.opacity(0.08), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func sessionCard(_ session: SquidHookDebugSession) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                    Text(session.providerLabel)
                        .font(.headline)
                    Text("\(session.runtimeSessionId) · \(session.workspaceLabel)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                stateBadge(session.state)
            }
            ForEach(session.steps) { step in
                stepRow(step)
            }
        }
        .padding(Fleet.Space.m)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous).stroke(session.state.color.opacity(0.22)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(session.providerLabel) session \(session.runtimeSessionId), \(session.state.label)")
    }

    private func stepRow(_ step: SquidHookDebugStep) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.m) {
            Image(systemName: step.state.symbol)
                .foregroundStyle(step.state.color)
                .font(.body.weight(.semibold))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                HStack {
                    Text(step.label)
                        .font(.callout.monospaced().weight(.bold))
                    stateBadge(step.state)
                    Spacer()
                    if let duration = step.durationMs {
                        Text("\(duration) ms")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                timelineLine(label: "Actual", value: "\(step.startedAt) → \(step.finishedAt ?? "running")")
                timelineLine(label: "Expected", value: "by \(step.expectedBy) · \(step.deadlineMs) ms")
                Text(step.description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, Fleet.Space.s)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(step.label), \(step.state.label). Actual start \(step.startedAt). Expected by \(step.expectedBy). \(step.description)")
    }

    private func timelineLine(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.s) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(.tertiary)
                .frame(width: 64, alignment: .leading)
            Text(value)
                .font(.caption.monospacedDigit())
                .textSelection(.enabled)
        }
    }

    private func stateBadge(_ state: SquidHookDebugState) -> some View {
        Text(state.label)
            .font(.caption2.weight(.bold))
            .foregroundStyle(state.color)
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, 3)
            .background(state.color.opacity(0.12), in: Capsule())
    }
}
