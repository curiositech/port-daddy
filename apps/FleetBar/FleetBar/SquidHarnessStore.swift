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
    let sessions: [SquidHookDebugSession]

    var overdueCount: Int {
        sessions.flatMap(\.steps).filter { $0.state == .overdue }.count
    }
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
    @Published private(set) var isWorking = false
    @Published private(set) var isDebugWorking = false
    @Published private(set) var message: String?
    @Published private(set) var debugMessage: String?

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
        if let snapshot, !snapshot.sessions.isEmpty {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Fleet.Space.m) {
                    privacyCard(snapshot)
                    ForEach(snapshot.sessions) { session in
                        sessionCard(session)
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
