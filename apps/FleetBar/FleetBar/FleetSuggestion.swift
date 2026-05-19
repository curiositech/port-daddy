import SwiftUI

// MARK: - Suggestion model

enum FleetSuggestionSeverity: Int, Comparable {
    case info = 0, warning = 1, critical = 2
    static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }

    var color: Color {
        switch self {
        case .info: return Fleet.Color.active
        case .warning: return Fleet.Color.warning
        case .critical: return Fleet.Color.failure
        }
    }

    var icon: String {
        switch self {
        case .info: return "lightbulb"
        case .warning: return "exclamationmark.triangle"
        case .critical: return "exclamationmark.circle.fill"
        }
    }
}

struct FleetSuggestionAction: Identifiable {
    enum Role { case primary, secondary }
    let id: String
    let label: String
    let role: Role
    let execute: @MainActor () -> Void
}

struct FleetSuggestion: Identifiable {
    let id: String
    let title: String
    let detail: String
    let severity: FleetSuggestionSeverity
    let isRetry: Bool
    let actions: [FleetSuggestionAction]

    init(id: String, title: String, detail: String, severity: FleetSuggestionSeverity, isRetry: Bool = false, actions: [FleetSuggestionAction]) {
        self.id = id; self.title = title; self.detail = detail
        self.severity = severity; self.isRetry = isRetry; self.actions = actions
    }
}

// MARK: - Failure categorization

private enum FailureCategory {
    case cleanExit          // "no current body, recent work history"
    case spawnRateLimit     // "hourly spawn limit"
    case spawnConcurrentLimit
    case noBackend          // "no launchable backend"
    case budgetCap
    case timeout
    case claudeCliTelemetry // "exact telemetry required" — claude-cli isn't emitting usage JSON
    case cloudflareAI       // "cloudflare workers ai" / "workers ai" backend failure
    case generic(String)

    static func from(_ raw: String) -> FailureCategory {
        let s = raw.lowercased()
        if s.contains("no current body") && (s.contains("recent work") || s.contains("history")) { return .cleanExit }
        if s.contains("hourly spawn limit") { return .spawnRateLimit }
        if s.contains("concurrent spawn limit") { return .spawnConcurrentLimit }
        if s.contains("no launchable backend") || s.contains("no backend") { return .noBackend }
        if s.contains("budget") || s.contains("cost cap") { return .budgetCap }
        if s.contains("exact telemetry required") { return .claudeCliTelemetry }
        if s.contains("cloudflare") || s.contains("workers ai") { return .cloudflareAI }
        if s.contains("timeout") || s.contains("timed out") { return .timeout }
        return .generic(raw)
    }

    var detail: String {
        switch self {
        case .cleanExit:
            return "The process ended with no active body — finished, crashed silently, or killed. Run it again to continue, or inspect logs to see what it last did."
        case .spawnRateLimit:
            return "Hit the hourly spawn cap. The agent can't start right now — it will be eligible again soon. Watch logs in the meantime."
        case .spawnConcurrentLimit:
            return "Too many agents running at once. Free up a slot by pausing one, then this agent can start."
        case .noBackend:
            return "No backend is configured or ready for this agent. Add an API key in Settings, or edit the fleet config to specify a model."
        case .budgetCap:
            return "Stopped by the daily budget cap. Raise the limit to let this agent continue spending."
        case .claudeCliTelemetry:
            return "Claude CLI ran but didn't emit the usage JSON Port Daddy needs for cost tracking. Usually clears on retry — if it keeps failing, re-authenticate with `claude` in your terminal."
        case .cloudflareAI:
            return "Cloudflare Workers AI returned an error. Could be a transient API issue, a bad CF_API_TOKEN, or the model quota being exhausted. Run again to test; if it keeps failing, edit the config to switch backends or check your Cloudflare account."
        case .timeout:
            return "Agent timed out — it likely stalled or took too long. Inspect the last run to see where it got stuck."
        case .generic(let raw):
            let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? "No failure details recorded — inspect logs to investigate." : String(t.prefix(160))
        }
    }
}

// MARK: - Builder

enum FleetSuggestionBuilder {
    @MainActor
    static func build(
        from store: FleetStore,
        retriedIds: Set<String> = [],
        openControlPlane: @escaping @MainActor (FleetControlSurface, String?, String?) -> Void,
        openSettings: @escaping @MainActor () -> Void = {}
    ) -> [FleetSuggestion] {
        var out: [FleetSuggestion] = []

        for project in store.projects {
            if project.needsBudget {
                out.append(FleetSuggestion(
                    id: "budget:\(project.id)",
                    title: "\(project.name) needs a budget cap",
                    detail: project.operatorNextAction,
                    severity: .warning,
                    actions: [
                        FleetSuggestionAction(id: "set", label: "Set $\(Int(project.suggestedBudgetUsdPerDay))/day", role: .primary) {
                            Task { await store.setFleetBudget(projectDir: project.projectDir, usdPerDay: project.suggestedBudgetUsdPerDay) }
                        },
                        FleetSuggestionAction(id: "open", label: "Open project", role: .secondary) {
                            openControlPlane(.flow, project.id, nil)
                        },
                    ]
                ))
            }

            for agent in project.agents where agent.status == .failed {
                let suggestionId = "failed:\(project.id):\(agent.name)"
                let isRetry = retriedIds.contains(suggestionId)
                let rawReason = agent.statusReason ?? agent.lastSummary ?? ""
                let category = FailureCategory.from(rawReason)
                let title = isRetry ? "\(agent.name) failed again" : "\(agent.name) failed"
                let actions = agentActions(
                    category: category,
                    store: store,
                    project: project,
                    agent: agent,
                    openControlPlane: openControlPlane,
                    openSettings: openSettings
                )
                out.append(FleetSuggestion(
                    id: suggestionId,
                    title: title,
                    detail: category.detail,
                    severity: .critical,
                    isRetry: isRetry,
                    actions: actions
                ))
            }
        }

        return out.sorted { $0.severity > $1.severity }
    }

    @MainActor
    private static func agentActions(
        category: FailureCategory,
        store: FleetStore,
        project: FleetProject,
        agent: FleetAgent,
        openControlPlane: @escaping @MainActor (FleetControlSurface, String?, String?) -> Void,
        openSettings: @escaping @MainActor () -> Void
    ) -> [FleetSuggestionAction] {
        let viewLogs = FleetSuggestionAction(id: "inspect", label: "Inspect logs", role: .secondary) {
            openControlPlane(.activity, project.id, agent.name)
        }
        let runAgain = FleetSuggestionAction(id: "run", label: "Run Again", role: .primary) {
            Task { await store.runAgent(projectDir: project.projectDir, agentName: agent.name) }
        }

        switch category {
        case .cleanExit:
            return [runAgain, viewLogs]

        case .spawnRateLimit:
            // Can't run now — only useful action is viewing logs
            return [viewLogs]

        case .spawnConcurrentLimit:
            return [
                FleetSuggestionAction(id: "flow", label: "Manage agents", role: .primary) {
                    openControlPlane(.flow, project.id, nil)
                },
                viewLogs,
            ]

        case .noBackend:
            return [
                FleetSuggestionAction(id: "settings", label: "Open Settings", role: .primary) {
                    openSettings()
                },
                FleetSuggestionAction(id: "yaml", label: "Edit config", role: .secondary) {
                    openControlPlane(.yaml, project.id, nil)
                },
            ]

        case .budgetCap:
            let bump = project.suggestedBudgetUsdPerDay + 5
            return [
                FleetSuggestionAction(id: "budget", label: "Raise +$5/day", role: .primary) {
                    Task { await store.setFleetBudget(projectDir: project.projectDir, usdPerDay: bump) }
                },
                viewLogs,
            ]

        case .claudeCliTelemetry:
            return [runAgain, viewLogs]

        case .cloudflareAI:
            return [
                runAgain,
                FleetSuggestionAction(id: "yaml", label: "Edit config", role: .secondary) {
                    openControlPlane(.yaml, project.id, nil)
                },
            ]

        case .timeout, .generic:
            return [runAgain, viewLogs]
        }
    }
}
