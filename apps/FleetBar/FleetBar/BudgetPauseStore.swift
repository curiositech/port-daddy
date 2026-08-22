// BudgetPauseStore.swift
// FleetBar — operator surface for the budget pause-and-ask flow.
//
// Subscribes to two SSE channels off the daemon:
//   /msg/budget:pending/subscribe   — new pending kill armed
//   /msg/budget:resolved/subscribe  — pending resolved (raise|kill|grace|expired)
//
// The store keeps an in-memory `pendingKills` array; on each event it
// re-fetches /budget/pending for the authoritative list (events are signals,
// not a delta protocol). Three actions per row hit
// /budget/pending/<agentId>/resolve:
//   - raise +$5  → action=raise, topUpUsd=5
//   - kill now   → action=kill
//   - +60s grace → action=grace
//
// Why a separate store from FleetStore: budget pause is a distinct concern
// with its own lifecycle (it can fire when no fleet is even running). Keeping
// it modular means the FleetPopover can opt in by observing this store
// without forcing FleetStore to grow another responsibility.

import Foundation
import Combine

struct PendingKill: Codable, Identifiable, Equatable {
    let agentId: String
    let project: String
    let reason: String
    let createdAt: TimeInterval
    let expiresAt: TimeInterval
    let spentTodayUsd: Double
    let budgetUsdPerDay: Double
    let extendedCount: Int

    var id: String { agentId }
}

struct PendingKillsResponse: Codable {
    let success: Bool?
    let pending: [PendingKill]
    let graceMs: Double?
}

@MainActor
final class BudgetPauseStore: ObservableObject {
    @Published private(set) var pendingKills: [PendingKill] = []
    @Published private(set) var graceMs: Double = 60_000
    @Published private(set) var isConnected: Bool = false
    @Published var lastError: String?

    private let baseURL: String?
    private var pendingTask: Task<Void, Never>?
    private var resolvedTask: Task<Void, Never>?

    /// Resolves the daemon URL via DaemonLocation (explicit configuration →
    /// published discovery). NEVER invent a port here — the daemon may run on
    /// a non-default port or be unavailable until it publishes one.
    init(baseURL: String? = nil) {
        self.baseURL = baseURL ?? DaemonLocation.availableBaseURL()
    }

    // 2026-07-08 (issue #676 investigation): `start()` used to assign fresh
    // subscribe() tasks straight into pendingTask/resolvedTask with no guard.
    // FleetPopover's onAppear calls start() every time the popover is shown,
    // and if onAppear ever fires twice without a matching onDisappear in
    // between (observed AppKit/SwiftUI popover-content quirk — a re-shown
    // popover's content view can re-fire onAppear without a preceding
    // onDisappear), the previous Task references were silently overwritten.
    // An unstructured `Task { }` is NOT cancelled just because its handle is
    // dropped — it keeps running (and its SSE connection stays open)
    // forever, with no way left to reach it. Each missed teardown leaked two
    // permanent connections to the daemon. stop() first makes start() safe
    // to call any number of times in a row.
    func start() {
        stop()
        Task { await refresh() }
        pendingTask = subscribe(channel: "budget:pending")
        resolvedTask = subscribe(channel: "budget:resolved")
    }

    func stop() {
        pendingTask?.cancel()
        resolvedTask?.cancel()
        pendingTask = nil
        resolvedTask = nil
        // Cancellation can unwind a Task without ever reaching the `catch`
        // block in subscribe() that sets isConnected = false (Task.cancel()
        // just marks cancelled; the loop's `while !Task.isCancelled` check or
        // an in-flight await noticing cancellation is what actually exits
        // it, and that exit path does not necessarily throw). Set it
        // explicitly here so the UI never reads "connected" after stop().
        isConnected = false
    }

    // Safety net for the case `stop()` is never called at all before this
    // object deallocates (e.g. a view-identity change that recreates the
    // @StateObject without SwiftUI ever running onDisappear first). Mirrors
    // FleetStore's existing `deinit { sseTask?.cancel() }` pattern — without
    // this, a missed stop() leaked the same way a missed cancel-before-start
    // did above.
    deinit {
        pendingTask?.cancel()
        resolvedTask?.cancel()
    }

    /// One-shot fetch. Sets pendingKills to authoritative server list.
    func refresh() async {
        guard let baseURL, let url = URL(string: "\(baseURL)/budget/pending") else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                lastError = "HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)"
                return
            }
            let decoded = try JSONDecoder().decode(PendingKillsResponse.self, from: data)
            self.pendingKills = decoded.pending
            if let g = decoded.graceMs { self.graceMs = g }
            self.lastError = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    /// Operator action — raise wallet + clear pending.
    func raise(agentId: String, topUpUsd: Double, newBudgetUsdPerDay: Double? = nil) async {
        var body: [String: Any] = ["action": "raise", "topUpUsd": topUpUsd]
        if let n = newBudgetUsdPerDay { body["newBudgetUsdPerDay"] = n }
        await resolve(agentId: agentId, body: body)
    }

    /// Operator action — skip grace, fire SIGTERM now.
    func killNow(agentId: String) async {
        await resolve(agentId: agentId, body: ["action": "kill"])
    }

    /// Operator action — extend grace window. Up to 2 extensions per pending.
    func extendGrace(agentId: String) async {
        await resolve(agentId: agentId, body: ["action": "grace"])
    }

    private func resolve(agentId: String, body: [String: Any]) async {
        guard let baseURL, let url = URL(string: "\(baseURL)/budget/pending/\(agentId)/resolve") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                let errMsg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "HTTP \(http.statusCode)"
                self.lastError = errMsg
            } else {
                self.lastError = nil
            }
            await refresh()
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    /// Subscribe to an SSE channel. Reconnects with backoff on failure.
    /// Each non-ack message triggers a refresh — events are wakeups, not
    /// state deltas. Simpler than maintaining a parallel reducer.
    private func subscribe(channel: String) -> Task<Void, Never> {
        let baseURL = self.baseURL
        return Task { [weak self] in
            guard let baseURL, let url = URL(string: "\(baseURL)/msg/\(channel)/subscribe") else { return }
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
                        // Skip the {"channel":"<name>"} subscription-ack frame.
                        if let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           dict.count == 1, dict["channel"] != nil {
                            continue
                        }
                        // Any real event → re-fetch authoritative list.
                        await self?.refresh()
                    }
                } catch {
                    await MainActor.run { self?.isConnected = false }
                }
                // Reconnect backoff.
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}
