import UserNotifications
import SwiftUI

// MARK: - Notification Manager
//
// Tracks fleet state changes and fires macOS notifications when conditions are met.
// Designed to be called once per FleetStore.refresh() cycle.

@MainActor
final class FleetNotificationManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = FleetNotificationManager()

    private var authorised = false
    private var knownFailed: Set<String> = []
    private var knownBudgetKills: Set<String> = []
    private var daemonWasRunning: Bool? = nil

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            Task { @MainActor [weak self] in
                self?.authorised = granted
            }
        }
    }

    // Call this after every FleetStore.refresh() to detect state transitions.
    func observe(projects: [FleetProject], isDaemonRunning: Bool) {
        guard authorised else { return }
        detectAgentFailures(projects: projects)
        detectDaemonOffline(isDaemonRunning: isDaemonRunning)
    }

    func observeBudgetKills(kills: [PendingKill]) {
        guard authorised else { return }
        let ids = Set(kills.map(\.agentId))
        let newKills = ids.subtracting(knownBudgetKills)
        for agentId in newKills {
            guard let kill = kills.first(where: { $0.agentId == agentId }) else { continue }
            post(
                id: "budget-kill:\(agentId)",
                title: "Budget cap hit: \(agentId)",
                body: "\(kill.project) spent $\(String(format: "%.3f", kill.spentTodayUsd)) of $\(String(format: "%.2f", kill.budgetUsdPerDay))/day"
            )
        }
        knownBudgetKills = ids
    }

    // MARK: - Delegate (show notification even when app is foreground)

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    // MARK: - Private

    private func detectAgentFailures(projects: [FleetProject]) {
        var currentFailed: Set<String> = []
        for project in projects {
            for agent in project.agents where agent.status == .failed {
                let id = "\(project.id):\(agent.name)"
                currentFailed.insert(id)
                if !knownFailed.contains(id) {
                    let detail = agent.statusReason ?? agent.lastSummary ?? "No details"
                    post(
                        id: "agent-failed:\(id)",
                        title: "\(agent.name) failed",
                        body: String(detail.prefix(140))
                    )
                }
            }
        }
        knownFailed = currentFailed
    }

    private func detectDaemonOffline(isDaemonRunning: Bool) {
        if let was = daemonWasRunning, was && !isDaemonRunning {
            post(id: "daemon-offline", title: "Port Daddy daemon went offline", body: "The fleet is dark. FleetBar will keep polling.")
        }
        daemonWasRunning = isDaemonRunning
    }

    private func post(id: String, title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }
}
