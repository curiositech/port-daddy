import SwiftUI
import Combine
import Darwin

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Data Model

enum ProjectOperatorState: String {
    case running
    case ready
    case blocked
    case serviceOnly = "service_only"
    case contextOnly = "context_only"
    case missing
}

enum FleetConfigStatus: String {
    case ready
    case missingBudget = "missing_budget"
    case invalid
    case missing
}

struct ProjectRemediation {
    let action: String
    let title: String
    let detail: String
    let command: String?
    let suggestedBudgetUsdPerDay: Double?
}

struct FleetProject: Identifiable {
    let id: String  // projectDir
    let name: String
    let projectDir: String
    let worktree: ProjectWorktreeMetadata?
    var agents: [FleetAgent]
    var startedAt: Date?
    var configuredAgentCount: Int = 0
    var configuredWatcherCount: Int = 0
    var operatorState: ProjectOperatorState = .missing
    var operatorSummary: String = "No operator readiness has been reported yet."
    var operatorNextAction: String = "Open the console for current project truth."
    var fleetConfigStatus: FleetConfigStatus = .missing
    var budgetUsdPerDay: Double?
    var configError: String?
    var configWarnings: [String] = []
    var remediation: ProjectRemediation?
    var signals: [String] = []
    var sources: [String] = []

    var activeCount: Int { agents.filter { $0.status.isDeployed }.count }
    var idleCount: Int { agents.filter { $0.status == .idle || $0.status == .paused }.count }
    var failedCount: Int { agents.filter { $0.status == .failed }.count }
    var visibleAgentCount: Int { max(agents.count, configuredAgentCount) }
    var isRunning: Bool { operatorState == .running || activeCount > 0 }
    var needsBudget: Bool { fleetConfigStatus == .missingBudget || remediation?.action == "set_budget" }
    var worktreeMenuLabel: String? {
        guard let worktree, worktree.siblingCount > 1 else { return nil }
        if worktree.isMain { return "\(worktree.siblingCount) worktrees" }
        return worktree.branch ?? worktree.name
    }

    var suggestedBudgetUsdPerDay: Double {
        remediation?.suggestedBudgetUsdPerDay ?? 5
    }

    var statusLabel: String {
        switch operatorState {
        case .running:
            return "running"
        case .ready:
            return "ready"
        case .blocked:
            return fleetConfigStatus == .missingBudget ? "needs budget" : "blocked"
        case .serviceOnly:
            return "pd up config"
        case .contextOnly:
            return "context only"
        case .missing:
            return "not configured"
        }
    }

    var statusIcon: String {
        switch operatorState {
        case .running:
            return "dot.radiowaves.left.and.right"
        case .ready:
            return "checkmark.circle.fill"
        case .blocked:
            return fleetConfigStatus == .missingBudget ? "wallet.pass" : "exclamationmark.triangle.fill"
        case .serviceOnly:
            return "server.rack"
        case .contextOnly:
            return "doc.text.magnifyingglass"
        case .missing:
            return "questionmark.folder"
        }
    }

    var statusColor: Color {
        switch operatorState {
        case .running:
            return Fleet.Color.healthy
        case .ready:
            return Fleet.Color.active
        case .blocked:
            return Fleet.Color.warning
        case .serviceOnly, .contextOnly:
            return Fleet.Color.dormant
        case .missing:
            return Fleet.Color.failure
        }
    }

    var sortRank: Int {
        switch operatorState {
        case .running:
            return 0
        case .blocked:
            return 1
        case .ready:
            return 2
        case .serviceOnly:
            return 3
        case .contextOnly:
            return 4
        case .missing:
            return 5
        }
    }
}

struct ProjectWorktreeMetadata: Decodable {
    let id: String
    let name: String
    let branch: String?
    let isMain: Bool
    let repoKey: String
    let repoRoot: String?
    let siblingCount: Int
}

struct FleetAgent: Identifiable {
    let id: String  // identity (project:fleet:agent)
    let name: String
    let type: AgentType  // scheduled, triggered, watcher
    let isConfiguredFleetAgent: Bool
    let inboxTarget: String?
    var purpose: String?
    var status: AgentStatus
    var statusReason: String?
    var queueDepth: Int
    var lastActivity: Date?
    var lastEvent: String?
    var lastSummary: String?
    var recentFiles: [String]

    enum AgentType: String, Codable {
        case scheduled, triggered, watcher
        case adhoc = "ad_hoc"
    }

    enum AgentStatus: String {
        case running, queued, armed, scheduled, paused, idle, failed, dead
        case salvaged, orphanReconciled = "orphan_reconciled", historical

        var isDeployed: Bool {
            switch self {
            case .running, .queued, .armed, .scheduled:
                return true
            default:
                return false
            }
        }
    }

    var canControl: Bool {
        isConfiguredFleetAgent && type != .adhoc
    }
}

enum FleetMenuBarTone: Equatable {
    case dormant
    case healthy
    case warning
    /// LOUD alarm — the daemon's health is CRITICAL. Drives the menu-bar icon to
    /// a warning-triangle SF Symbol in the failure (red) color.
    case critical

    var color: Color {
        switch self {
        case .dormant:
            return .secondary
        case .healthy:
            return Fleet.Color.healthy
        case .warning:
            return Fleet.Color.warning
        case .critical:
            return Fleet.Color.failure
        }
    }
}

// MARK: - API Response Types

struct FleetStatusResponse: Decodable {
    let success: Bool
    let running: Bool
    let startedAt: Double?
    let fleets: [FleetResponse]
    let totalAgents: Int
    let totalWatchers: Int
}

struct RegisteredProjectsResponse: Decodable {
    let success: Bool
    let count: Int
    let projects: [RegisteredProjectResponse]
}

struct RegisteredProjectResponse: Decodable {
    let id: String
    let displayName: String?
    let root: String
    let type: String
    let serviceCount: Int
    let lastScanned: StringCodable?
    let createdAt: StringCodable?
    let frameworks: [String]
    let signals: [String]?
    let sources: [String]?
    let exists: Bool?
    let worktree: ProjectWorktreeMetadata?
    let running: Bool?
    let configuredAgentCount: Int?
    let configuredWatcherCount: Int?
    let operatorState: String?
    let operatorSummary: String?
    let operatorNextAction: String?
    let fleetConfigStatus: String?
    let budgetUsdPerDay: Double?
    let configError: String?
    let configWarnings: [String]?
    let remediation: ProjectRemediationResponse?
}

struct ProjectRemediationResponse: Decodable {
    let action: String
    let title: String
    let detail: String
    let command: String?
    let suggestedBudgetUsdPerDay: Double?
}

struct FleetResponse: Decodable {
    let project: String
    let projectDir: String
    let running: Bool
    let agents: [AgentResponse]
    let watchers: Int
    let channels: Int
    let startedAt: Double
}

struct AgentResponse: Decodable {
    let name: String
    let type: String
    let status: String
    let running: Bool
    let paused: Bool
    let uptime: Double
    let queueDepth: Int?
}

struct OperatorActorsResponse: Decodable {
    let success: Bool
    let projectDir: String?
    let project: String?
    let actors: [OperatorActorResponse]
    let count: Int
}

struct OperatorActorResponse: Decodable {
    let id: String
    let label: String
    let purpose: String?
    let identity: String?
    let fleetAgentName: String?
    let inboxTarget: String
    let isConfiguredFleetAgent: Bool
    let actorKind: ActorKind
    let actorState: ActorState
    let actorStateReason: String
    let runtimeStatus: String?
    let lastActivityAt: Double?
    let lastSummary: String?
    let recentFiles: [String]

    enum ActorKind: String, Decodable {
        case scheduled, triggered, watcher
        case adHoc = "ad_hoc"
    }

    enum ActorState: String, Decodable {
        case running, idle, salvaged, historical
        case orphanReconciled = "orphan_reconciled"
    }
}

struct DaemonStatusResponse: Decodable {
    let status: String
    let version: String
    let pid: Int
    let uptimeSeconds: Double
    let uptimeHuman: String
    let daemon: DaemonBuildResponse?
    let metrics: DaemonMetricsResponse?
    let runtime: DaemonRuntimeResponse?
    let guardians: DaemonGuardiansResponse?
    let history: DaemonHistoryResponse?
    /// Shared three-tier health severity (ok | warn | critical) — the same
    /// vocabulary the daemon (lib/health-severity.ts), `pd doctor`, and the Rust
    /// console all speak. Optional + defaulted so an older daemon that predates
    /// the field decodes as nil (treated as ok) and the memberwise init stays
    /// source-compatible.
    var severity: String? = nil
}

/// The three-tier daemon health severity surfaced in the menu bar + popover.
enum HealthSeverity: String {
    case ok
    case warn
    case critical
}

struct DaemonBuildResponse: Decodable {
    let version: String
    let codeHash: String
    let startedAt: Double
    let installDir: String
    let nodeVersion: String
    /// Which berth this daemon is (ADR-0084): stable / dev-latest / codebase.
    /// Optional — an older daemon that predates berth self-identity omits it,
    /// in which case the UI treats the connection as the canonical stable berth.
    /// Defaulted so the synthesized memberwise init stays source-compatible.
    var berth: DaemonBerthResponse? = nil
}

/// The daemon's self-reported berth identity (ADR-0084). Mirrors the TS
/// `DaemonBerthIdentity` in `shared/daemon-berths.ts`; only the fields the menu
/// bar surfaces are decoded.
struct DaemonBerthResponse: Decodable {
    let tier: String        // "stable" | "dev-latest" | "codebase"
    let label: String
    let color: String       // "#RRGGBB"
    let canonical: Bool
    let port: Int
    let gitBranch: String?
    let gitRev: String?
    let sourceDir: String?
}

struct DaemonMetricsResponse: Decodable {
    let activePorts: Int?
    let memoryRSS: Double?
    let avgResponseMs: Double?
}

struct DaemonRuntimeResponse: Decodable {
    let state: String
    let degraded: Bool
}

struct DaemonGuardiansResponse: Decodable {
    let supervisor: DaemonSupervisorResponse?
    let runtime: DaemonRuntimeWitnessResponse?
}

struct DaemonSupervisorResponse: Decodable {
    let state: String
    let summary: String
}

struct DaemonRuntimeWitnessResponse: Decodable {
    let enabled: Bool
    let state: String
    let reason: String?
    let monitoredUrl: String?
    let lastCheckAt: Double?
    let lastHealthyAt: Double?
    let lastFailureAt: Double?
    let failureCount: Int
}

struct DaemonHistoryResponse: Decodable {
    let lastActivityAt: Double?
    let recentActivity: [DaemonHistoryActivityResponse]
    let recentSpend: [DaemonHistorySpendResponse]
}

struct DaemonHistoryActivityResponse: Decodable, Identifiable {
    let id: Int
    let timestamp: Double
    let type: String
    let agentId: String?
    let targetId: String?
    let summary: String
}

struct DaemonHistorySpendResponse: Decodable, Identifiable {
    let id: String
    let timestamp: Double
    let backend: String
    let model: String
    let projectName: String?
    let projectDir: String?
    let costUsd: Double
    let isEstimate: Bool
}

struct SSEEvent: Decodable {
    let type: String
    let agent: String?
    let identity: String?
    let project: String?
    let timestamp: Double?
    let details: [String: StringCodable]?
}

struct StringCodable: Codable {
    let value: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let stringValue = try? container.decode(String.self) {
            value = stringValue
            return
        }
        if let intValue = try? container.decode(Int.self) {
            value = String(intValue)
            return
        }
        if let doubleValue = try? container.decode(Double.self) {
            value = String(doubleValue)
            return
        }
        if let boolValue = try? container.decode(Bool.self) {
            value = String(boolValue)
            return
        }
        value = ""
    }
}

private struct BriefingEnvelope: Decodable {
    let success: Bool
    let briefing: FleetBriefing?
}

private struct FleetBriefing: Decodable {
    let recentActivity: [BriefingActivity]
    let recentNotes: [BriefingNote]
}

private struct BriefingActivity: Decodable {
    let timestamp: Double
    let type: String
    let agentId: String?
    let targetId: String?
    let details: String?
    let summary: String?
    let files: [String]?
}

private struct BriefingNote: Decodable {
    let sessionId: String
    let content: String
    let type: String
    let createdAt: Double
    let sessionPurpose: String?
    let agentId: String?
    let identityProject: String?
}

// MARK: - Fleet Store

@MainActor
class FleetStore: ObservableObject {
    @Published var projects: [FleetProject] = []
    @Published var isConnected = false
    @Published var isDaemonRunning = false
    @Published var lastRefresh: Date?
    @Published var daemonStatus: DaemonStatusResponse?
    @Published var expandedProjects: Set<String> = []
    @Published var preferences: FleetBarPreferences
    @Published var settingsMessage: String?

    private var sseTask: Task<Void, Never>?
    private nonisolated(unsafe) var pollTimer: Timer?
    /// Mutable so the operator can switch berths live via `rebind(to:)`. Switching
    /// is in-memory only — FleetBar returns to the canonical berth on next launch,
    /// per the ADR-0084 rail that a dev berth must never be the implicit default.
    private var baseURL: String

    var daemonURL: String { baseURL }

    /// The port FleetBar is currently bound to, for matching against discovered
    /// berths in the manager UI.
    var activePort: Int? { URL(string: baseURL)?.port }

    var daemonLabel: String {
        guard let url = URL(string: baseURL) else { return baseURL }
        let port = url.port ?? (url.scheme == "https" ? 443 : 80)
        return "\(url.host ?? "localhost"):\(port)"
    }

    var isCanonicalDaemon: Bool {
        guard let url = URL(string: baseURL) else { return false }
        return (url.host == "localhost" || url.host == "127.0.0.1")
            && url.port == DaemonLocation.canonicalPreferredPort
    }

    /// The daemon's own health severity. Reads the daemon-reported `severity`
    /// field; falls back to deriving from `runtime.degraded` for an older daemon
    /// that predates the field, so FleetBar never shows a calm icon over a
    /// degraded daemon.
    var daemonSeverity: HealthSeverity {
        guard isDaemonRunning, let status = daemonStatus else { return .ok }
        if let raw = status.severity, let sev = HealthSeverity(rawValue: raw) {
            return sev
        }
        return status.runtime?.degraded == true ? .warn : .ok
    }

    // Menu bar display. Daemon health is the DOMINANT signal: a critical daemon
    // turns the menu-bar icon into an alarm triangle regardless of fleet state.
    var menuBarIcon: String {
        guard isDaemonRunning else { return "sailboat" }
        switch daemonSeverity {
        case .critical: return "exclamationmark.triangle.fill"
        case .warn: return "exclamationmark.triangle"
        case .ok:
            let totalActive = projects.reduce(0) { $0 + $1.activeCount }
            return totalActive > 0 ? "sailboat.fill" : "sailboat"
        }
    }

    var menuBarTone: FleetMenuBarTone {
        guard isDaemonRunning else { return .dormant }
        switch daemonSeverity {
        case .critical: return .critical
        case .warn: return .warning
        case .ok:
            let totalFailed = projects.reduce(0) { $0 + $1.failedCount }
            let totalActive = projects.reduce(0) { $0 + $1.activeCount }
            if totalFailed > 0 { return .warning }
            if totalActive > 0 { return .healthy }
            return .dormant
        }
    }

    var menuBarColor: Color {
        menuBarTone.color
    }

    @Published var isStartingDaemon = false

    var totalAgents: Int { projects.reduce(0) { $0 + $1.visibleAgentCount } }
    var totalActive: Int { projects.reduce(0) { $0 + $1.activeCount } }
    var totalFailed: Int { projects.reduce(0) { $0 + $1.failedCount } }
    var projectsNeedingBudget: Int { projects.filter(\.needsBudget).count }

    /// How the running FleetBar app compares to the daemon it is talking to.
    /// Drives the staleness banner. `.upToDate` whenever the daemon is offline
    /// or either version is unknown, so the banner only appears on a real, live
    /// mismatch.
    var versionSkew: FleetVersionSkew {
        guard isDaemonRunning else { return .upToDate }
        let daemonVersion = daemonStatus?.daemon?.version ?? daemonStatus?.version
        return FleetVersion.evaluate(appVersion: FleetBarBuild.version, daemonVersion: daemonVersion)
    }

    init(autoStart: Bool = true) {
        self.preferences = FleetBarPreferenceStore.load()
        self.baseURL = DaemonLocation.resolveBaseURL()

        guard autoStart else { return }

        // Initial fetch + start SSE
        Task {
            await refresh()
            connectSSE()
        }

        // Poll every 15s as fallback (SSE is primary)
        pollTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }

    deinit {
        sseTask?.cancel()
        pollTimer?.invalidate()
    }

    // MARK: - Daemon Lifecycle

    func startDaemon() {
        guard !isStartingDaemon else { return }
        isStartingDaemon = true

        Task {
            let started = startLaunchAgentDaemon() || startDaemonViaCLI()

            if !started {
                settingsMessage = "Could not start Port Daddy"
                isStartingDaemon = false
                return
            }

            for _ in 0..<10 {
                try? await Task.sleep(for: .milliseconds(500))
                await refresh()
                if isDaemonRunning {
                    isStartingDaemon = false
                    settingsMessage = nil
                    return
                }
            }

            settingsMessage = "Daemon did not respond"
            isStartingDaemon = false
        }
    }

    /// Switch the live connection to a different daemon berth (ADR-0084). Tears
    /// down the current SSE stream, repoints `baseURL`, clears stale state, and
    /// reconnects. In-memory only: not persisted, so a relaunch returns to the
    /// canonical berth and a dev berth never becomes the silent default.
    func rebind(to url: String) {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        guard !normalized.isEmpty, normalized != baseURL else { return }

        sseTask?.cancel()
        baseURL = normalized
        isConnected = false
        isDaemonRunning = false
        daemonStatus = nil
        projects = []
        settingsMessage = nil

        Task {
            await refresh()
            connectSSE()
        }
    }

    func setLaunchFleetBarOnDaemonStart(_ enabled: Bool) {
        preferences.launchFleetBarOnDaemonStart = enabled
        let saved = FleetBarPreferenceStore.save(preferences)
        settingsMessage = saved
            ? (enabled ? "FleetBar will open with Port Daddy" : "FleetBar auto-open disabled")
            : "Could not save FleetBar setting"
    }

    // MARK: - HTTP API

    func refresh() async {
        guard let fleetURL = URL(string: "\(baseURL)/fleet") else { return }
        let registeredProjectsURL = URL(string: "\(baseURL)/projects")
        let daemonStatusURL = URL(string: "\(baseURL)/status")
        do {
            let (data, response) = try await URLSession.shared.data(from: fleetURL)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                isDaemonRunning = false
                daemonStatus = nil
                return
            }
            isDaemonRunning = true
            let status = try JSONDecoder().decode(FleetStatusResponse.self, from: data)
            let registeredProjects: [RegisteredProjectResponse]
            if let projectsURL = registeredProjectsURL,
               let (projectsData, projectsHTTPResponse) = try? await URLSession.shared.data(from: projectsURL),
               let projectsHTTP = projectsHTTPResponse as? HTTPURLResponse,
               projectsHTTP.statusCode == 200,
               let decoded = try? JSONDecoder().decode(RegisteredProjectsResponse.self, from: projectsData) {
                registeredProjects = decoded.projects
            } else {
                registeredProjects = []
            }
            if let daemonStatusURL,
               let (statusData, statusHTTPResponse) = try? await URLSession.shared.data(from: daemonStatusURL),
               let statusHTTP = statusHTTPResponse as? HTTPURLResponse,
               statusHTTP.statusCode == 200,
               let decodedStatus = try? JSONDecoder().decode(DaemonStatusResponse.self, from: statusData) {
                daemonStatus = decodedStatus
            } else {
                daemonStatus = nil
            }
            applyStatus(status, registeredProjects: registeredProjects)
            let actorEnriched = await enrichProjectsFromActors()
            if !actorEnriched {
                await enrichProjectsFromBriefings()
            }
            lastRefresh = Date()
        } catch {
            isDaemonRunning = false
            daemonStatus = nil
        }
    }

    func startFleet(projectDir: String? = nil, enabledAgents: [String]? = nil) async {
        guard let url = URL(string: "\(baseURL)/fleet/start") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [:]
        if let projectDir { body["projectDir"] = projectDir }
        if let enabledAgents { body["enabledAgents"] = enabledAgents }
        request.httpBody = (try? JSONSerialization.data(withJSONObject: body.isEmpty ? [:] : body))
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func stopFleet(projectDir: String? = nil) async {
        guard let url = URL(string: "\(baseURL)/fleet/stop") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let projectDir {
            request.httpBody = try? JSONEncoder().encode(["projectDir": projectDir])
        } else {
            request.httpBody = "{}".data(using: .utf8)
        }
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func reloadFleet() async {
        guard let url = URL(string: "\(baseURL)/fleet/reload") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func setFleetBudget(projectDir: String, usdPerDay: Double = 5) async {
        guard let encodedProject = encodePathSegment(projectDir),
              let url = URL(string: "\(baseURL)/fleet/config/\(encodedProject)/budget") else {
            settingsMessage = "Could not prepare budget update"
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["usdPerDay": usdPerDay])

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                settingsMessage = "Budget update failed"
                await refresh()
                return
            }
            settingsMessage = String(format: "Budget set to $%.2f/day", usdPerDay)
        } catch {
            settingsMessage = "Budget update failed"
        }
        await refresh()
    }

    func runAgent(projectDir: String, agentName: String) async {
        guard let url = URL(string: "\(baseURL)/fleet/agent/run") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["projectDir": projectDir, "agentName": agentName])
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func pauseAgent(projectDir: String, agentName: String) async {
        guard let url = URL(string: "\(baseURL)/fleet/agent/pause") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["projectDir": projectDir, "agentName": agentName])
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func resumeAgent(projectDir: String, agentName: String) async {
        guard let url = URL(string: "\(baseURL)/fleet/agent/resume") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["projectDir": projectDir, "agentName": agentName])
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    // MARK: - Local Helpers

    private func encodePathSegment(_ value: String) -> String? {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed)
    }

    private func startLaunchAgentDaemon() -> Bool {
        let uid = String(getuid())
        return runProcess(
            executable: URL(fileURLWithPath: "/bin/launchctl"),
            arguments: ["kickstart", "-k", "gui/\(uid)/homebrew.mxcl.port-daddy"]
        ) == 0
    }

    private func startDaemonViaCLI() -> Bool {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "/opt/homebrew/bin/pd",
            "/usr/local/bin/pd",
            "\(home)/.npm-global/bin/pd",
        ]

        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            if runProcess(executable: URL(fileURLWithPath: path), arguments: ["start"]) == 0 {
                return true
            }
        }

        return false
    }

    private func runProcess(executable: URL, arguments: [String]) -> Int32? {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.standardOutput = nil
        process.standardError = nil

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus
        } catch {
            return nil
        }
    }

    // MARK: - SSE Connection

    private func connectSSE() {
        sseTask?.cancel()
        sseTask = Task { [weak self, baseURL] in
            guard let url = URL(string: "\(baseURL)/fleet/events") else { return }
            while !Task.isCancelled {
                do {
                    let (stream, response) = try await URLSession.shared.bytes(from: url)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                        try await Task.sleep(for: .seconds(5))
                        continue
                    }
                    await MainActor.run { self?.isConnected = true }

                    for try await line in stream.lines {
                        guard !Task.isCancelled else { break }
                        guard line.hasPrefix("data: ") else { continue }
                        let jsonStr = String(line.dropFirst(6))
                        guard let data = jsonStr.data(using: .utf8) else { continue }
                        if let event = try? JSONDecoder().decode(SSEEvent.self, from: data) {
                            await MainActor.run { self?.handleEvent(event) }
                        }
                    }
                } catch {
                    await MainActor.run { self?.isConnected = false }
                }
                // Reconnect backoff
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    // MARK: - State Updates

    private func projectMetadata(from registered: RegisteredProjectResponse?, fallbackRunning: Bool) -> (
        configuredAgentCount: Int,
        configuredWatcherCount: Int,
        operatorState: ProjectOperatorState,
        operatorSummary: String,
        operatorNextAction: String,
        fleetConfigStatus: FleetConfigStatus,
        budgetUsdPerDay: Double?,
        configError: String?,
        configWarnings: [String],
        remediation: ProjectRemediation?,
        signals: [String],
        sources: [String],
        worktree: ProjectWorktreeMetadata?
    ) {
        let operatorState = registered?.operatorState.flatMap(ProjectOperatorState.init(rawValue:))
            ?? (fallbackRunning ? .running : .missing)
        let fleetConfigStatus = registered?.fleetConfigStatus.flatMap(FleetConfigStatus.init(rawValue:))
            ?? (fallbackRunning ? .ready : .missing)
        let remediation = registered?.remediation.map {
            ProjectRemediation(
                action: $0.action,
                title: $0.title,
                detail: $0.detail,
                command: $0.command,
                suggestedBudgetUsdPerDay: $0.suggestedBudgetUsdPerDay
            )
        }

        return (
            configuredAgentCount: registered?.configuredAgentCount ?? 0,
            configuredWatcherCount: registered?.configuredWatcherCount ?? 0,
            operatorState: operatorState,
            operatorSummary: registered?.operatorSummary ?? (fallbackRunning ? "Fleet is running on this daemon." : "No operator readiness has been reported yet."),
            operatorNextAction: registered?.operatorNextAction ?? (fallbackRunning ? "Inspect the shared console." : "Open the console for current project truth."),
            fleetConfigStatus: fleetConfigStatus,
            budgetUsdPerDay: registered?.budgetUsdPerDay,
            configError: registered?.configError,
            configWarnings: registered?.configWarnings ?? [],
            remediation: remediation,
            signals: registered?.signals ?? [],
            sources: registered?.sources ?? [],
            worktree: registered?.worktree
        )
    }

    private func makeProject(
        id: String,
        name: String,
        projectDir: String,
        agents: [FleetAgent],
        startedAt: Date?,
        registered: RegisteredProjectResponse?,
        fallbackRunning: Bool
    ) -> FleetProject {
        let metadata = projectMetadata(from: registered, fallbackRunning: fallbackRunning)
        return FleetProject(
            id: id,
            name: name,
            projectDir: projectDir,
            worktree: metadata.worktree,
            agents: agents,
            startedAt: startedAt,
            configuredAgentCount: max(metadata.configuredAgentCount, agents.count),
            configuredWatcherCount: metadata.configuredWatcherCount,
            operatorState: fallbackRunning ? .running : metadata.operatorState,
            operatorSummary: metadata.operatorSummary,
            operatorNextAction: metadata.operatorNextAction,
            fleetConfigStatus: metadata.fleetConfigStatus,
            budgetUsdPerDay: metadata.budgetUsdPerDay,
            configError: metadata.configError,
            configWarnings: metadata.configWarnings,
            remediation: metadata.remediation,
            signals: metadata.signals,
            sources: metadata.sources
        )
    }

    private func applyStatus(_ status: FleetStatusResponse, registeredProjects: [RegisteredProjectResponse] = []) {
        var registeredByRoot: [String: RegisteredProjectResponse] = [:]
        for project in registeredProjects {
            registeredByRoot[project.root] = project
        }
        var runningProjectsByDir: [String: FleetProject] = [:]
        for fleet in status.fleets {
            let registered = registeredByRoot[fleet.projectDir]
            let agents = fleet.agents.map { agent in
                // Preserve existing agent state (last event etc.) if we have it
                let existing = projects
                    .first(where: { $0.id == fleet.projectDir || $0.projectDir == fleet.projectDir || $0.name == fleet.project })?
                    .agents.first(where: { $0.name == agent.name })

                return FleetAgent(
                    id: "\(fleet.project):fleet:\(agent.name)",
                    name: agent.name,
                    type: FleetAgent.AgentType(rawValue: agent.type) ?? .triggered,
                    isConfiguredFleetAgent: true,
                    inboxTarget: agent.name,
                    purpose: existing?.purpose,
                    status: FleetAgent.AgentStatus(rawValue: agent.status) ?? (agent.running ? .running : agent.paused ? .paused : .idle),
                    statusReason: existing?.statusReason,
                    queueDepth: agent.queueDepth ?? 0,
                    lastActivity: existing?.lastActivity,
                    lastEvent: existing?.lastEvent,
                    lastSummary: existing?.lastSummary,
                    recentFiles: existing?.recentFiles ?? []
                )
            }
            runningProjectsByDir[fleet.projectDir] = makeProject(
                id: fleet.projectDir,
                name: registered?.displayName ?? fleet.project,
                projectDir: fleet.projectDir,
                agents: agents,
                startedAt: Date(timeIntervalSince1970: fleet.startedAt / 1000),
                registered: registered,
                fallbackRunning: true
            )
        }
        for registeredProject in registeredProjects {
            guard runningProjectsByDir[registeredProject.root] == nil else { continue }
            runningProjectsByDir[registeredProject.root] = makeProject(
                id: registeredProject.root,
                name: registeredProject.displayName ?? registeredProject.id,
                projectDir: registeredProject.root,
                agents: [],
                startedAt: nil,
                registered: registeredProject,
                fallbackRunning: false
            )
        }
        let newProjects = Array(runningProjectsByDir.values)
            .sorted { lhs, rhs in
                if lhs.sortRank != rhs.sortRank {
                    return lhs.sortRank < rhs.sortRank
                }
                let lhsStarted = lhs.startedAt?.timeIntervalSince1970 ?? 0
                let rhsStarted = rhs.startedAt?.timeIntervalSince1970 ?? 0
                if lhsStarted != rhsStarted {
                    return lhsStarted > rhsStarted
                }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
        projects = newProjects

        // Auto-expand first project if nothing expanded
        if expandedProjects.isEmpty, let first = newProjects.first {
            expandedProjects.insert(first.id)
        }
    }

    private func handleEvent(_ event: SSEEvent) {
        guard let project = event.project, let agent = event.agent else { return }

        // Find or create the project
        guard let projectIdx = projects.firstIndex(where: { $0.name == project || $0.projectDir == project || $0.id == project }) else { return }
        guard let agentIdx = projects[projectIdx].agents.firstIndex(where: { $0.name == agent }) else { return }

        let now = Date()
        projects[projectIdx].agents[agentIdx].lastActivity = now
        projects[projectIdx].agents[agentIdx].lastEvent = event.type
        if let summary = summarize(event.details) {
            projects[projectIdx].agents[agentIdx].lastSummary = summary
            let files = extractPaths(summary)
            if !files.isEmpty {
                projects[projectIdx].agents[agentIdx].recentFiles = files
            }
        }

        switch event.type {
        case "agent_started":
            projects[projectIdx].agents[agentIdx].status = .running
        case "agent_completed":
            let type = projects[projectIdx].agents[agentIdx].type
            projects[projectIdx].agents[agentIdx].status = type == .scheduled || type == .triggered ? .armed : .idle
        case "agent_failed":
            projects[projectIdx].agents[agentIdx].status = .failed
        case "agent_paused":
            projects[projectIdx].agents[agentIdx].status = .paused
        case "agent_resumed":
            let type = projects[projectIdx].agents[agentIdx].type
            projects[projectIdx].agents[agentIdx].status = type == .scheduled || type == .triggered ? .armed : .idle
        default:
            break
        }
    }

    func toggleProject(_ id: String) {
        if expandedProjects.contains(id) {
            expandedProjects.remove(id)
        } else {
            expandedProjects.insert(id)
        }
    }

    /**
     * Merge daemon actor-lens records into the FleetBar project list so
     * configured idle actors, salvage state, and historical residue remain
     * visible even when no live runtime body is registered.
     *
     * Example:
     * - input: `/fleet` plus `/operator/actors?projectDir=...`
     * - output: project rows that still show `spark` as salvaged or historical
     */
    private func enrichProjectsFromActors() async -> Bool {
        guard isDaemonRunning, !projects.isEmpty else { return false }

        var nextProjects = projects
        var loadedAny = false
        await withTaskGroup(of: (String, [OperatorActorResponse]?).self) { group in
            for project in nextProjects {
                group.addTask { [baseURL] in
                    guard var components = URLComponents(string: "\(baseURL)/operator/actors") else {
                        return (project.id, nil)
                    }
                    components.queryItems = [
                        URLQueryItem(name: "projectDir", value: project.projectDir),
                        URLQueryItem(name: "limit", value: "80"),
                    ]
                    guard let url = components.url else { return (project.id, nil) }
                    do {
                        let (data, response) = try await URLSession.shared.data(from: url)
                        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                            return (project.id, nil)
                        }
                        let envelope = try JSONDecoder().decode(OperatorActorsResponse.self, from: data)
                        return (project.id, envelope.actors)
                    } catch {
                        return (project.id, nil)
                    }
                }
            }

            for await (projectId, actors) in group {
                guard let projectIndex = nextProjects.firstIndex(where: { $0.id == projectId }),
                      let actors else { continue }
                loadedAny = true
                mergeActorEntries(actors, into: &nextProjects[projectIndex])
            }
        }

        if loadedAny {
            projects = nextProjects
        }
        return loadedAny
    }

    /**
     * Join logical actor records onto the current native project snapshot using
     * the daemon inbox target or configured fleet name as the durable key.
     *
     * Example:
     * - input: existing running `spark` row + historical `spark` actor record
     * - output: one `spark` row carrying summary, files, and actor lifecycle
     */
    private func mergeActorEntries(_ actors: [OperatorActorResponse], into project: inout FleetProject) {
        var mergedByKey = Dictionary(uniqueKeysWithValues: project.agents.map { (actorMergeKey(for: $0), $0) })

        for actor in actors {
            let key = actorMergeKey(for: actor)
            let existing = mergedByKey[key]
            let nextType = existing?.type ?? mapActorType(actor.actorKind)
            let nextSummary = actor.lastSummary?.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextPurpose = actor.purpose?.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextFiles = actor.recentFiles.isEmpty
                ? (existing?.recentFiles ?? [])
                : Array(actor.recentFiles.prefix(4))
            let agentName = actor.fleetAgentName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                ?? actor.label.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                ?? actor.id

            mergedByKey[key] = FleetAgent(
                id: existing?.id ?? synthesizeAgentId(for: actor, projectName: project.name, fallbackName: agentName),
                name: agentName,
                type: nextType,
                isConfiguredFleetAgent: actor.isConfiguredFleetAgent,
                inboxTarget: actor.inboxTarget,
                purpose: nextPurpose?.nilIfEmpty ?? existing?.purpose,
                status: mapActorStatus(actor),
                statusReason: actor.actorStateReason,
                queueDepth: existing?.queueDepth ?? 0,
                lastActivity: actor.lastActivityAt.map { Date(timeIntervalSince1970: $0 / 1000) } ?? existing?.lastActivity,
                lastEvent: actor.runtimeStatus ?? actor.actorState.rawValue,
                lastSummary: nextSummary?.nilIfEmpty ?? existing?.lastSummary,
                recentFiles: nextFiles
            )
        }

        project.agents = Array(mergedByKey.values)
            .sorted { lhs, rhs in
                switch (lhs.lastActivity, rhs.lastActivity) {
                case let (left?, right?) where left != right:
                    return left > right
                case (.some, nil):
                    return true
                case (nil, .some):
                    return false
                default:
                    return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
                }
            }
    }

    private func actorMergeKey(for actor: OperatorActorResponse) -> String {
        if let fleetAgentName = actor.fleetAgentName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !fleetAgentName.isEmpty {
            return fleetAgentName.lowercased()
        }
        return actor.inboxTarget.lowercased()
    }

    private func actorMergeKey(for agent: FleetAgent) -> String {
        if let inboxTarget = agent.inboxTarget?.trimmingCharacters(in: .whitespacesAndNewlines),
           !inboxTarget.isEmpty {
            return inboxTarget.lowercased()
        }
        return agent.name.lowercased()
    }

    private func synthesizeAgentId(for actor: OperatorActorResponse, projectName: String, fallbackName: String) -> String {
        if let identity = actor.identity?.trimmingCharacters(in: .whitespacesAndNewlines), !identity.isEmpty {
            return identity
        }
        if let fleetAgentName = actor.fleetAgentName?.trimmingCharacters(in: .whitespacesAndNewlines), !fleetAgentName.isEmpty {
            return "\(projectName):fleet:\(fleetAgentName)"
        }
        return actor.id.isEmpty ? "\(projectName):actor:\(fallbackName)" : actor.id
    }

    private func mapActorType(_ kind: OperatorActorResponse.ActorKind) -> FleetAgent.AgentType {
        switch kind {
        case .scheduled:
            return .scheduled
        case .triggered:
            return .triggered
        case .watcher:
            return .watcher
        case .adHoc:
            return .adhoc
        }
    }

    /**
     * Translate daemon actor lifecycle state into FleetBar-native status badges.
     *
     * Example:
     * - input: `{ actorState: .salvaged, runtimeStatus: nil }`
     * - output: `.salvaged`
     */
    private func mapActorStatus(_ actor: OperatorActorResponse) -> FleetAgent.AgentStatus {
        switch actor.runtimeStatus?.lowercased() {
        case "running":
            return .running
        case "queued":
            return .queued
        case "armed":
            return .armed
        case "scheduled":
            return .scheduled
        case "paused":
            return .paused
        case "failed":
            return .failed
        case "dead":
            return .dead
        case "idle":
            return .idle
        default:
            break
        }

        switch actor.actorState {
        case .running:
            return .running
        case .idle:
            return .idle
        case .salvaged:
            return .salvaged
        case .orphanReconciled:
            return .orphanReconciled
        case .historical:
            return .historical
        }
    }

    private func enrichProjectsFromBriefings() async {
        guard isDaemonRunning, !projects.isEmpty else { return }

        var nextProjects = projects
        await withTaskGroup(of: (String, FleetBriefing?).self) { group in
            for project in nextProjects {
                group.addTask { [baseURL] in
                    guard var components = URLComponents(string: "\(baseURL)/briefing/\(project.name)") else {
                        return (project.id, nil)
                    }
                    components.percentEncodedPath = "/briefing/\(project.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? project.name)"
                    components.queryItems = [URLQueryItem(name: "projectRoot", value: project.projectDir)]
                    guard let url = components.url else { return (project.id, nil) }
                    do {
                        let (data, response) = try await URLSession.shared.data(from: url)
                        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                            return (project.id, nil)
                        }
                        let envelope = try JSONDecoder().decode(BriefingEnvelope.self, from: data)
                        return (project.id, envelope.briefing)
                    } catch {
                        return (project.id, nil)
                    }
                }
            }

            for await (projectId, briefing) in group {
                guard let projectIndex = nextProjects.firstIndex(where: { $0.id == projectId }),
                      let briefing else { continue }
                for agentIndex in nextProjects[projectIndex].agents.indices {
                    let agentName = nextProjects[projectIndex].agents[agentIndex].name
                    let signal = latestSignal(for: agentName, in: briefing)
                    guard let signal else { continue }
                    nextProjects[projectIndex].agents[agentIndex].lastSummary = signal.summary
                    nextProjects[projectIndex].agents[agentIndex].recentFiles = signal.files
                    if let eventType = signal.eventType {
                        nextProjects[projectIndex].agents[agentIndex].lastEvent = eventType
                    }
                    let signalDate = Date(timeIntervalSince1970: signal.timestamp / 1000)
                    if nextProjects[projectIndex].agents[agentIndex].lastActivity.map({ signalDate > $0 }) ?? true {
                        nextProjects[projectIndex].agents[agentIndex].lastActivity = signalDate
                    }
                }
            }
        }

        projects = nextProjects
    }

    private func latestSignal(for agentName: String, in briefing: FleetBriefing) -> (summary: String, timestamp: Double, files: [String], eventType: String?)? {
        let activitySignals = briefing.recentActivity.compactMap { entry -> (String, Double, [String], String?)? in
            let haystack = "\(entry.agentId ?? "") \(entry.targetId ?? "") \(entry.details ?? "")".lowercased()
            guard haystack.contains(agentName.lowercased()) else { return nil }
            let summary = (entry.summary?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
                ?? (entry.details?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
            guard let summary else { return nil }
            let explicitFiles = (entry.files ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            let files = explicitFiles.isEmpty ? extractPaths(summary) : explicitFiles
            return (summary, entry.timestamp, files, entry.type)
        }

        let noteSignals = briefing.recentNotes.compactMap { note -> (String, Double, [String], String?)? in
            let matchesAgent = note.agentId == agentName
                || "\(note.sessionId) \(note.sessionPurpose ?? "") \(note.content)".lowercased().contains(agentName.lowercased())
            guard matchesAgent else { return nil }
            let summary = note.content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !summary.isEmpty else { return nil }
            return (summary, note.createdAt, extractPaths(summary), note.type)
        }

        return (activitySignals + noteSignals)
            .sorted { $0.1 > $1.1 }
            .first
            .map { ($0.0, $0.1, $0.2, $0.3) }
    }

    private func summarize(_ details: [String: StringCodable]?) -> String? {
        guard let details else { return nil }
        for key in ["error", "status", "message", "backend", "model", "attempt"] {
            if let value = details[key]?.value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return key == "status" ? "status: \(value)" : value
            }
        }
        return nil
    }

    private func extractPaths(_ text: String) -> [String] {
        let pattern = #"(?:[A-Za-z0-9._-]+/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)?"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let nsText = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length))
        let paths = matches
            .map { nsText.substring(with: $0.range) }
            .filter { $0.contains("/") }
        return Array(NSOrderedSet(array: paths).array as? [String] ?? []).prefix(4).map { $0 }
    }
}
