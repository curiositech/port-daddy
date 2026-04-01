import SwiftUI
import Combine

// MARK: - Data Model

struct FleetProject: Identifiable {
    let id: String  // project name
    var agents: [FleetAgent]
    var startedAt: Date?

    var activeCount: Int { agents.filter { $0.status == .running }.count }
    var idleCount: Int { agents.filter { $0.status == .idle }.count }
    var failedCount: Int { agents.filter { $0.status == .failed }.count }
}

struct FleetAgent: Identifiable {
    let id: String  // identity (project:fleet:agent)
    let name: String
    let type: AgentType  // scheduled, triggered, watcher
    var status: AgentStatus
    var lastActivity: Date?
    var lastEvent: String?

    enum AgentType: String, Codable {
        case scheduled, triggered, watcher
    }

    enum AgentStatus: String {
        case running, idle, failed, dead
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

struct FleetResponse: Decodable {
    let project: String
    let projectDir: String
    let agents: [AgentResponse]
    let watchers: Int
    let channels: Int
    let startedAt: Double
}

struct AgentResponse: Decodable {
    let name: String
    let type: String
    let running: Bool
    let uptime: Double
}

struct SSEEvent: Decodable {
    let type: String
    let agent: String?
    let identity: String?
    let project: String?
    let timestamp: Double?
}

// MARK: - Fleet Store

@MainActor
class FleetStore: ObservableObject {
    @Published var projects: [FleetProject] = []
    @Published var isConnected = false
    @Published var isDaemonRunning = false
    @Published var lastRefresh: Date?
    @Published var expandedProjects: Set<String> = []

    private var sseTask: Task<Void, Never>?
    private nonisolated(unsafe) var pollTimer: Timer?
    private let baseURL: String

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
        // Read port from Port Daddy's port file
        let portFile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy/daemon.port")
        let port: Int
        if let portStr = try? String(contentsOf: portFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           let p = Int(portStr) {
            port = p
        } else {
            port = 9876
        }
        self.baseURL = "http://localhost:\(port)"

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

        // Try launchctl first (if installed as LaunchAgent), fall back to pd start
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-c", """
            if launchctl list | grep -q com.portdaddy.daemon; then
                launchctl kickstart gui/$(id -u)/com.portdaddy.daemon
            elif command -v pd &>/dev/null; then
                pd start
            else
                # Find pd in common locations
                for p in /usr/local/bin/pd "$HOME/.npm-global/bin/pd" "$HOME/port-daddy-stable/bin/port-daddy-cli.ts"; do
                    [ -x "$p" ] && "$p" start && break
                done
            fi
            """]
        process.standardOutput = nil
        process.standardError = nil

        do {
            try process.run()
            process.waitUntilExit()

            // Poll for daemon to come up (give it 5 seconds)
            Task {
                for _ in 0..<10 {
                    try? await Task.sleep(for: .milliseconds(500))
                    await refresh()
                    if isDaemonRunning {
                        isStartingDaemon = false
                        return
                    }
                }
                isStartingDaemon = false
            }
        } catch {
            isStartingDaemon = false
        }
    }

    // MARK: - HTTP API

    func refresh() async {
        guard let url = URL(string: "\(baseURL)/fleet") else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                isDaemonRunning = false
                return
            }
            isDaemonRunning = true
            let status = try JSONDecoder().decode(FleetStatusResponse.self, from: data)
            applyStatus(status)
            lastRefresh = Date()
        } catch {
            isDaemonRunning = false
        }
    }

    func startFleet() async {
        guard let url = URL(string: "\(baseURL)/fleet/start") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func stopFleet() async {
        guard let url = URL(string: "\(baseURL)/fleet/stop") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)
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

    private func applyStatus(_ status: FleetStatusResponse) {
        var newProjects: [FleetProject] = []
        for fleet in status.fleets {
            let agents = fleet.agents.map { agent in
                // Preserve existing agent state (last event etc.) if we have it
                let existing = projects
                    .first(where: { $0.id == fleet.project })?
                    .agents.first(where: { $0.name == agent.name })

                return FleetAgent(
                    id: "\(fleet.project):fleet:\(agent.name)",
                    name: agent.name,
                    type: FleetAgent.AgentType(rawValue: agent.type) ?? .triggered,
                    status: agent.running ? .running : .idle,
                    lastActivity: existing?.lastActivity,
                    lastEvent: existing?.lastEvent
                )
            }
            newProjects.append(FleetProject(
                id: fleet.project,
                agents: agents,
                startedAt: Date(timeIntervalSince1970: fleet.startedAt / 1000)
            ))
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
        guard let projectIdx = projects.firstIndex(where: { $0.id == project }) else { return }
        guard let agentIdx = projects[projectIdx].agents.firstIndex(where: { $0.name == agent }) else { return }

        let now = Date()
        projects[projectIdx].agents[agentIdx].lastActivity = now
        projects[projectIdx].agents[agentIdx].lastEvent = event.type

        switch event.type {
        case "agent_started":
            projects[projectIdx].agents[agentIdx].status = .running
        case "agent_completed":
            projects[projectIdx].agents[agentIdx].status = .idle
        case "agent_failed":
            projects[projectIdx].agents[agentIdx].status = .failed
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
}
