import SwiftUI
import Foundation

// MARK: - Spawn approvals (ADR-0093 L2, trust-gate HITL)
//
// Read/decide model for spawns the trust gate is holding: external-triggered
// agent runs that require an explicit operator yes/no before they execute.
// Distinct from DispatchStore's product-proposal queue — this gates SPAWNS.
//
// Polls GET /fleet/approvals while started (menu-bar popover open) and posts
// decisions to POST /fleet/approvals/:id/decision. The daemon broadcasts the
// resolution to every other surface (Control Center, pd-console, CLI).

struct SpawnApproval: Identifiable, Codable, Equatable {
    let id: String
    let project: String
    let agent: String
    let trigger: String
    let tier: String
    let reason: String
    let safeTools: [String]
    let timestamp: Double

    var age: String {
        let seconds = max(0, Date().timeIntervalSince1970 - timestamp / 1000)
        if seconds < 60 { return "\(Int(seconds))s" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        return "\(Int(seconds / 3600))h"
    }

    var tierLabel: String {
        tier.replacingOccurrences(of: "_", with: " ").lowercased()
    }
}

@MainActor
final class SpawnApprovalStore: ObservableObject {
    @Published var approvals: [SpawnApproval] = []
    @Published var lastError: String?
    @Published var decidingIds: Set<String> = []

    private let baseURL: String?
    private let session: URLSession
    private nonisolated(unsafe) var refreshTimer: Timer?
    private var isRefreshing = false

    init(baseURL: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL ?? DaemonLocation.availableBaseURL()
        self.session = session
    }

    func start() {
        Task { await self.refresh() }
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }

    nonisolated func stop() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let baseURL, let url = URL(string: "\(baseURL)/fleet/approvals") else { return }
        do {
            let (data, _) = try await session.data(from: url)
            struct Envelope: Codable { let proposals: [SpawnApproval] }
            let envelope = try JSONDecoder().decode(Envelope.self, from: data)
            approvals = envelope.proposals
            lastError = nil
        } catch {
            // Daemon down or old daemon without the route: show nothing rather
            // than a scary banner — the popover's connection state covers it.
            approvals = []
        }
    }

    func decide(_ id: String, decision: String, feedback: String? = nil) async {
        guard !decidingIds.contains(id) else { return }
        decidingIds.insert(id)
        defer { decidingIds.remove(id) }

        guard let baseURL, let url = URL(string: "\(baseURL)/fleet/approvals/\(id)/decision") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: String] = ["decision": decision]
        if let feedback, !feedback.isEmpty { payload["feedback"] = feedback }
        request.httpBody = try? JSONEncoder().encode(payload)

        do {
            let (data, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                struct ErrorBody: Codable { let error: String? }
                let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
                lastError = body?.error ?? "decision failed (HTTP \(http.statusCode))"
            } else {
                lastError = nil
            }
        } catch {
            lastError = error.localizedDescription
        }
        await refresh()
    }
}
