import SwiftUI
import Combine
import Darwin

// MARK: - Data Model

struct FleetProject: Identifiable {
    let id: String  // projectDir
    let name: String
    let projectDir: String
    var agents: [FleetAgent]
    var startedAt: Date?

    var activeCount: Int { agents.filter { $0.status.isDeployed }.count }
    var idleCount: Int { agents.filter { $0.status == .idle || $0.status == .paused }.count }
    var failedCount: Int { agents.filter { $0.status == .failed }.count }
}

struct FleetAgent: Identifiable {
    let id: String  // identity (project:fleet:agent)
    let name: String
    let type: AgentType  // scheduled, triggered, watcher
    var status: AgentStatus
    var queueDepth: Int
    var lastActivity: Date?
    var lastEvent: String?
    var lastSummary: String?
    var recentFiles: [String]

    enum AgentType: String, Codable {
        case scheduled, triggered, watcher
    }

    enum AgentStatus: String {
        case running, queued, armed, scheduled, paused, idle, failed, dead

        var isDeployed: Bool {
            switch self {
            case .running, .queued, .armed, .scheduled:
                return true
            default:
                return false
            }
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
    let lastScanned: String
    let createdAt: String
    let frameworks: [String]
    let signals: [String]?
    let sources: [String]?
    let exists: Bool?
    let running: Bool?
    let configuredAgentCount: Int?
    let configuredWatcherCount: Int?
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
    @Published var expandedProjects: Set<String> = []
    @Published var preferences: FleetBarPreferences
    @Published var settingsMessage: String?

    private var sseTask: Task<Void, Never>?
    private nonisolated(unsafe) var pollTimer: Timer?
    private let baseURL: String

    var daemonURL: String { baseURL }

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

    // Menu bar display
    var menuBarIcon: String {
        guard isDaemonRunning else { return "sailboat" }
        let totalFailed = projects.reduce(0) { $0 + $1.failedCount }
        let totalActive = projects.reduce(0) { $0 + $1.activeCount }
        if totalFailed > 0 { return "exclamationmark.triangle.fill" }
        if totalActive > 0 { return "sailboat.fill" }
        return "sailboat"
    }

    var menuBarColor: Color {
        guard isDaemonRunning else { return .secondary }
        let totalFailed = projects.reduce(0) { $0 + $1.failedCount }
        let totalActive = projects.reduce(0) { $0 + $1.activeCount }
        if totalFailed > 0 { return Fleet.Color.warning }
        if totalActive > 0 { return Fleet.Color.healthy }
        return .secondary
    }

    @Published var isStartingDaemon = false

    var totalAgents: Int { projects.reduce(0) { $0 + $1.agents.count } }
    var totalActive: Int { projects.reduce(0) { $0 + $1.activeCount } }
    var totalFailed: Int { projects.reduce(0) { $0 + $1.failedCount } }

    init() {
        self.preferences = FleetBarPreferenceStore.load()
        self.baseURL = DaemonLocation.resolveBaseURL()

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
        do {
            let (data, response) = try await URLSession.shared.data(from: fleetURL)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                isDaemonRunning = false
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
            applyStatus(status, registeredProjects: registeredProjects)
            await enrichProjectsFromBriefings()
            lastRefresh = Date()
        } catch {
            isDaemonRunning = false
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

    private func startLaunchAgentDaemon() -> Bool {
        let uid = String(getuid())
        return runProcess(
            executable: URL(fileURLWithPath: "/bin/launchctl"),
            arguments: ["kickstart", "-k", "gui/\(uid)/com.portdaddy.daemon"]
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

    private func applyStatus(_ status: FleetStatusResponse, registeredProjects: [RegisteredProjectResponse] = []) {
        var runningProjectsByDir: [String: FleetProject] = [:]
        for fleet in status.fleets {
            let agents = fleet.agents.map { agent in
                // Preserve existing agent state (last event etc.) if we have it
                let existing = projects
                    .first(where: { $0.id == fleet.projectDir || $0.projectDir == fleet.projectDir || $0.name == fleet.project })?
                    .agents.first(where: { $0.name == agent.name })

                return FleetAgent(
                    id: "\(fleet.project):fleet:\(agent.name)",
                    name: agent.name,
                    type: FleetAgent.AgentType(rawValue: agent.type) ?? .triggered,
                    status: FleetAgent.AgentStatus(rawValue: agent.status) ?? (agent.running ? .running : agent.paused ? .paused : .idle),
                    queueDepth: agent.queueDepth ?? 0,
                    lastActivity: existing?.lastActivity,
                    lastEvent: existing?.lastEvent,
                    lastSummary: existing?.lastSummary,
                    recentFiles: existing?.recentFiles ?? []
                )
            }
            runningProjectsByDir[fleet.projectDir] = FleetProject(
                id: fleet.projectDir,
                name: fleet.project,
                projectDir: fleet.projectDir,
                agents: agents,
                startedAt: Date(timeIntervalSince1970: fleet.startedAt / 1000)
            )
        }
        for registeredProject in registeredProjects {
            guard runningProjectsByDir[registeredProject.root] == nil else { continue }
            runningProjectsByDir[registeredProject.root] = FleetProject(
                id: registeredProject.root,
                name: registeredProject.displayName ?? registeredProject.id,
                projectDir: registeredProject.root,
                agents: [],
                startedAt: nil
            )
        }
        let newProjects = Array(runningProjectsByDir.values)
            .sorted { lhs, rhs in
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
