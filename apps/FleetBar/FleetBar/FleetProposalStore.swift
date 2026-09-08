import SwiftUI
import Combine
import Foundation

// MARK: - Fleet Proposal State

enum FleetProposalStatus: String, Codable, CaseIterable, Identifiable {
    case pending
    case approved
    case rejected
    case dispatched

    var id: String { rawValue }

    var displayLabel: String {
        switch self {
        case .pending: return "Pending"
        case .approved: return "Approved"
        case .rejected: return "Rejected"
        case .dispatched: return "Assigned"
        }
    }

    var color: Color {
        switch self {
        case .pending: return Fleet.Color.warning
        case .approved: return Fleet.Color.healthy
        case .rejected: return Fleet.Color.failure
        case .dispatched: return Fleet.Color.active
        }
    }

    var icon: String {
        switch self {
        case .pending: return "person.crop.circle.badge.questionmark"
        case .approved: return "checkmark.seal"
        case .rejected: return "xmark.octagon"
        case .dispatched: return "paperplane.circle"
        }
    }
}

struct FleetProposalLinkSnapshot: Equatable {
    let label: String
    let url: String
}

struct FleetProposalSnapshot: Identifiable, Equatable {
    let id: String
    let title: String
    let summary: String
    let proposalMarkdown: String
    let sourceShip: String
    let sourceKind: String
    let sourceRunId: String?
    let repoFullName: String?
    let prNumber: Int?
    let targetSpecialist: String?
    let assignmentType: String
    let budgetUsd: Double?
    let baseBranch: String
    let writePolicy: String
    let validationPlan: String?
    let expectedArtifacts: [String]
    let links: [FleetProposalLinkSnapshot]
    let status: FleetProposalStatus
    let dispatchId: String?
    let decisionNote: String?
    let decidedBy: String?
    let createdAt: Date
    let decidedAt: Date?
    let dispatchedAt: Date?

    var sourceDisplay: String {
        var parts = [sourceShip]
        if let repoFullName, !repoFullName.isEmpty {
            parts.append(repoFullName)
        }
        if let prNumber {
            parts.append("PR #\(prNumber)")
        }
        return parts.joined(separator: " · ")
    }

    var assignmentDisplay: String {
        targetSpecialist?.isEmpty == false ? targetSpecialist! : "auto-route specialist"
    }

    var budgetDisplay: String {
        guard let budgetUsd else { return "no proposal cap" }
        return String(format: "$%.2f cap", budgetUsd)
    }
}

private struct FleetProposalListResponse: Decodable {
    let success: Bool
    let proposals: [FleetProposalEnvelope]
    let pendingCount: Int?
}

private struct FleetProposalDecisionResponse: Decodable {
    let success: Bool
    let proposal: FleetProposalEnvelope
    let pendingCount: Int?
}

private struct FleetProposalEnvelope: Decodable {
    let id: String
    let title: String
    let summary: String
    let proposalMarkdown: String?
    let sourceShip: String
    let sourceKind: String?
    let sourceRunId: String?
    let repoFullName: String?
    let prNumber: Int?
    let targetSpecialist: String?
    let assignmentType: String?
    let budgetUsd: Double?
    let baseBranch: String?
    let writePolicy: String?
    let validationPlan: String?
    let expectedArtifacts: [String]?
    let links: [FleetProposalLinkEnvelope]?
    let status: String
    let dispatchId: String?
    let decisionNote: String?
    let decidedBy: String?
    let createdAt: Double
    let decidedAt: Double?
    let dispatchedAt: Double?
}

private struct FleetProposalLinkEnvelope: Decodable {
    let label: String
    let url: String
}

@MainActor
final class FleetProposalStore: ObservableObject {
    @Published private(set) var proposals: [FleetProposalSnapshot] = []
    @Published private(set) var pendingCount = 0
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var routeMissing = false

    private let baseURL: String?
    private nonisolated(unsafe) var refreshTimer: Timer?
    private let session: URLSession

    init(autoStart: Bool = true, baseURL: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL ?? DaemonLocation.availableBaseURL()
        self.session = session

        guard autoStart else { return }

        Task { await self.refresh() }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }

    deinit {
        refreshTimer?.invalidate()
    }

    var pending: [FleetProposalSnapshot] {
        proposals.filter { $0.status == .pending }
    }

    var recentDecisions: [FleetProposalSnapshot] {
        proposals.filter { $0.status != .pending }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let baseURL, var components = URLComponents(string: "\(baseURL)/fleet-proposals") else { return }
        components.queryItems = [
            URLQueryItem(name: "status", value: "all"),
            URLQueryItem(name: "limit", value: "80"),
        ]
        guard let url = components.url else { return }

        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse else {
                lastError = "Daemon unreachable."
                return
            }
            if http.statusCode == 404 {
                routeMissing = true
                proposals = []
                pendingCount = 0
                lastError = "Daemon route /fleet-proposals is not available yet."
                return
            }
            guard http.statusCode == 200 else {
                lastError = "Fleet proposals HTTP \(http.statusCode)."
                return
            }

            let decoded = try JSONDecoder().decode(FleetProposalListResponse.self, from: data)
            routeMissing = false
            pendingCount = decoded.pendingCount ?? decoded.proposals.filter { $0.status == FleetProposalStatus.pending.rawValue }.count
            proposals = decoded.proposals.compactMap(Self.snapshot(from:)).sorted { lhs, rhs in
                lhs.createdAt > rhs.createdAt
            }
            lastRefresh = Date()
            lastError = nil
        } catch {
            lastError = "Fleet proposals error: \(error.localizedDescription)"
        }
    }

    func approve(id: String) async {
        await postDecision(id: id, action: "approve", body: [
            "decidedBy": "fleetbar",
            "dispatch": true,
        ])
    }

    func reject(id: String, reason: String) async {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 3 else {
            lastError = "Rejection reason must be at least 3 characters."
            return
        }
        await postDecision(id: id, action: "reject", body: [
            "decidedBy": "fleetbar",
            "reason": trimmed,
        ])
    }

    private func postDecision(id: String, action: String, body: [String: Any]) async {
        guard let baseURL, let url = URL(string: "\(baseURL)/fleet-proposals/\(id)/\(action)") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                lastError = "Fleet proposal \(action): no response from daemon."
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                lastError = decodeErrorMessage(data: data, fallback: "Fleet proposal \(action) failed (HTTP \(http.statusCode)).")
                return
            }
            let decoded = try? JSONDecoder().decode(FleetProposalDecisionResponse.self, from: data)
            if let pendingCount = decoded?.pendingCount {
                self.pendingCount = pendingCount
            }
            lastError = nil
            await refresh()
        } catch {
            lastError = "Fleet proposal \(action) failed: \(error.localizedDescription)"
        }
    }

    private static func snapshot(from envelope: FleetProposalEnvelope) -> FleetProposalSnapshot? {
        guard let status = FleetProposalStatus(rawValue: envelope.status) else { return nil }
        return FleetProposalSnapshot(
            id: envelope.id,
            title: envelope.title,
            summary: envelope.summary,
            proposalMarkdown: envelope.proposalMarkdown ?? envelope.summary,
            sourceShip: envelope.sourceShip,
            sourceKind: envelope.sourceKind ?? "cloud-fleet",
            sourceRunId: envelope.sourceRunId,
            repoFullName: envelope.repoFullName,
            prNumber: envelope.prNumber,
            targetSpecialist: envelope.targetSpecialist,
            assignmentType: envelope.assignmentType ?? "specialist-pr",
            budgetUsd: envelope.budgetUsd,
            baseBranch: envelope.baseBranch ?? "main",
            writePolicy: envelope.writePolicy ?? "approved-dispatch-only",
            validationPlan: envelope.validationPlan,
            expectedArtifacts: envelope.expectedArtifacts ?? [],
            links: (envelope.links ?? []).map { FleetProposalLinkSnapshot(label: $0.label, url: $0.url) },
            status: status,
            dispatchId: envelope.dispatchId,
            decisionNote: envelope.decisionNote,
            decidedBy: envelope.decidedBy,
            createdAt: Date(timeIntervalSince1970: envelope.createdAt / 1000),
            decidedAt: envelope.decidedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
            dispatchedAt: envelope.dispatchedAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        )
    }

    private func decodeErrorMessage(data: Data, fallback: String) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let msg = json["error"] as? String { return msg }
            if let msg = json["message"] as? String { return msg }
        }
        return fallback
    }
}
