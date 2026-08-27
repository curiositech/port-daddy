import Combine
import Foundation

// MARK: - Doctrine evidence models

/// Status is evidence-state, never a permission tier. In particular,
/// `provisional` is an advisory with an experiment trail, not permission to
/// merge, deploy, spend, or take another irreversible action.
enum FleetDoctrineStatus: String, Codable, CaseIterable, Identifiable {
    case candidate
    case provisional
    case established
    case contested
    case deprecated

    var id: String { rawValue }

    var displayLabel: String {
        rawValue.capitalized
    }
}

enum FleetDoctrineFidelity: String, Codable {
    case notRun = "not-run"
    case matched
    case mismatched
}

enum FleetDoctrineApplicationResponse: String, Codable, CaseIterable, Identifiable {
    case follow
    case adapt
    case reject

    var id: String { rawValue }
    var displayLabel: String { rawValue.capitalized }
}

enum FleetDoctrineOutcomeVerdict: String, Codable, CaseIterable, Identifiable {
    case helped
    case harmed
    case inconclusive

    var id: String { rawValue }
    var displayLabel: String { rawValue.capitalized }
}

struct FleetDoctrineCounts: Codable, Equatable {
    let episodes: Int
    let candidates: Int
    let provisional: Int
    let established: Int
    let contested: Int
}

struct FleetDoctrineStatusSnapshot: Codable, Equatable {
    let success: Bool
    let advisory: Bool
    let canonicalStore: String
    let counts: FleetDoctrineCounts
}

struct FleetDoctrineProvenance: Codable, Equatable {
    let model: String?
    let modelVersion: String?
    let harness: String?
    let worktree: String?
    let environment: String?
}

struct FleetDoctrineCandidateSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let doctrineId: String?
    let episodeId: String
    let projectDir: String
    let actorId: String
    let citations: [String]
    let occurredAt: String
    let decisionClass: String
    let title: String
    let when: String
    let prefer: String
    let over: String
    let because: String
    let unless: [String]
    let school: String?
    let skillRefs: [String]
    let status: FleetDoctrineStatus
    let reviewerId: String?
    let experimentId: String?
    let admissionCitations: [String]
    let contestedReason: String?

    var evidenceCitations: [String] {
        Array(Set(admissionCitations + citations)).sorted()
    }
}

struct FleetDoctrineEpisodeSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let projectDir: String
    let actorId: String
    let citations: [String]
    let occurredAt: String
    let decisionClass: String
    let summary: String
    let historicalAction: String
    let alternatives: [String]
    let cues: [String]
    let fidelity: String
    let provenance: FleetDoctrineProvenance
}

struct FleetDoctrineTreatmentRunSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let experimentId: String
    let arm: String
    let action: String
    let outcome: String
    let fidelity: FleetDoctrineFidelity
    let notes: String?
    let occurredAt: String
    let citations: [String]
}

struct FleetDoctrineExperimentSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let candidateId: String
    let projectDir: String
    let actorId: String
    let citations: [String]
    let occurredAt: String
    let hypothesis: String
    let primaryOutcome: String
    let control: String
    let treatment: String
    let sham: String?
    let runs: [FleetDoctrineTreatmentRunSnapshot]
}

struct FleetDoctrineRetrievalSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let decisionId: String
    let decisionClass: String
    let projectDir: String
    let actorId: String
    let occurredAt: String
    let doctrineIds: [String]
    let citations: [String]
}

struct FleetDoctrineApplicationSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let retrievalId: String
    let doctrineId: String
    let projectDir: String
    let actorId: String
    let occurredAt: String
    let response: FleetDoctrineApplicationResponse
    let decision: String
    let note: String?
    let citations: [String]
}

struct FleetDoctrineOutcomeSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let applicationId: String
    let doctrineId: String
    let projectDir: String
    let actorId: String
    let occurredAt: String
    let verdict: FleetDoctrineOutcomeVerdict
    let summary: String
    let verifiedBy: String
    let citations: [String]
}

struct FleetDoctrineDetailSnapshot: Codable, Equatable {
    let doctrine: FleetDoctrineCandidateSnapshot
    let episode: FleetDoctrineEpisodeSnapshot?
    let experiment: FleetDoctrineExperimentSnapshot?
    let retrievals: [FleetDoctrineRetrievalSnapshot]
    let applications: [FleetDoctrineApplicationSnapshot]
    let outcomes: [FleetDoctrineOutcomeSnapshot]
}

struct FleetDoctrinePacketSnapshot: Codable, Equatable {
    let receipt: FleetDoctrineRetrievalSnapshot
    let doctrines: [FleetDoctrineCandidateSnapshot]
    let advisory: Bool
    let retrievalPolicy: String
}

struct FleetDoctrineAdmissionReadiness: Equatable {
    let isReady: Bool
    let label: String
    let detail: String
}

func fleetDoctrineAdmissionReadiness(_ experiment: FleetDoctrineExperimentSnapshot?) -> FleetDoctrineAdmissionReadiness {
    guard let experiment else {
        return FleetDoctrineAdmissionReadiness(
            isReady: false,
            label: "Experiment required",
            detail: "A candidate needs a preregistered experiment before it can be admitted."
        )
    }
    let hasMatchedControl = experiment.runs.contains { $0.arm == "control" && $0.fidelity == .matched }
    let hasMatchedTreatment = experiment.runs.contains { $0.arm == "treatment" && $0.fidelity == .matched }
    guard hasMatchedControl && hasMatchedTreatment else {
        var missing: [String] = []
        if !hasMatchedControl { missing.append("matched factual control") }
        if !hasMatchedTreatment { missing.append("matched treatment") }
        return FleetDoctrineAdmissionReadiness(
            isReady: false,
            label: "Evidence incomplete",
            detail: "Admission remains disabled until \(missing.joined(separator: " and ")) run\(missing.count == 1 ? " is" : "s are") recorded."
        )
    }
    return FleetDoctrineAdmissionReadiness(
        isReady: true,
        label: "Factual gate met",
        detail: "Matched factual control and treatment runs are present. Admission remains advisory and provisional by default."
    )
}

private struct FleetDoctrineCandidatesResponse: Decodable {
    let candidates: [FleetDoctrineCandidateSnapshot]
}

private struct FleetDoctrineAdmissionResponse: Decodable {
    let doctrine: DoctrineID

    struct DoctrineID: Decodable {
        let doctrineId: String
    }
}

private struct FleetDoctrineApplicationResponseEnvelope: Decodable {
    let application: FleetDoctrineApplicationSnapshot
}

private struct FleetDoctrineOutcomeResponseEnvelope: Decodable {
    let outcome: FleetDoctrineOutcomeSnapshot
}

private struct FleetDoctrineErrorEnvelope: Decodable {
    let error: String?
}

// MARK: - Store

@MainActor
final class FleetDoctrineStore: ObservableObject {
    static let operatorActorID = "fleetbar-operator"

    @Published private(set) var status: FleetDoctrineStatusSnapshot?
    @Published private(set) var candidates: [FleetDoctrineCandidateSnapshot] = []
    @Published private(set) var detail: FleetDoctrineDetailSnapshot?
    @Published private(set) var packet: FleetDoctrinePacketSnapshot?
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var lastNotice: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isLoadingDetail = false
    @Published private(set) var activeAction: String?
    @Published private(set) var routeMissing = false

    private let baseURL: String?
    private let session: URLSession
    private var selectedDoctrineID: String?

    init(baseURL: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL ?? DaemonLocation.availableBaseURL()
        self.session = session
    }

    var selectedCandidate: FleetDoctrineCandidateSnapshot? {
        guard let selectedDoctrineID else { return nil }
        return candidates.first(where: { $0.doctrineId == selectedDoctrineID })
    }

    var admissionReadiness: FleetDoctrineAdmissionReadiness {
        fleetDoctrineAdmissionReadiness(detail?.experiment)
    }

    func refresh(projectDir: String? = nil) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        lastError = nil

        do {
            let status: FleetDoctrineStatusSnapshot = try await get(path: "/doctrine/status")
            var query: [URLQueryItem] = []
            if let projectDir, !projectDir.isEmpty {
                query.append(URLQueryItem(name: "projectDir", value: projectDir))
            }
            let candidateResponse: FleetDoctrineCandidatesResponse = try await get(path: "/doctrine/candidates", query: query)
            self.status = status
            candidates = candidateResponse.candidates.sorted { $0.occurredAt > $1.occurredAt }
            routeMissing = false
            lastRefresh = Date()

            if let selectedDoctrineID,
               candidates.contains(where: { $0.doctrineId == selectedDoctrineID }) {
                await loadDetail(doctrineID: selectedDoctrineID)
            } else if let firstID = candidates.first?.doctrineId {
                await loadDetail(doctrineID: firstID)
            } else {
                self.selectedDoctrineID = nil
                detail = nil
                packet = nil
            }
        } catch let error as FleetDoctrineStoreError {
            handle(error)
        } catch {
            lastError = "Doctrine evidence error: \(error.localizedDescription)"
        }
    }

    func select(doctrineID: String?) async {
        packet = nil
        lastNotice = nil
        guard let doctrineID else {
            selectedDoctrineID = nil
            detail = nil
            return
        }
        await loadDetail(doctrineID: doctrineID)
    }

    func admit(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) async {
        guard let experiment = detail.experiment, admissionReadiness.isReady else { return }
        activeAction = "admit"
        defer { activeAction = nil }
        do {
            let _: FleetDoctrineAdmissionResponse = try await post(
                path: "/doctrine/candidates/\(candidate.id)/admit",
                body: [
                    "experimentId": experiment.id,
                    "projectDir": candidate.projectDir,
                    "actorId": Self.operatorActorID,
                    "citations": citations(for: candidate, detail: detail),
                    "reviewerId": Self.operatorActorID,
                    "status": "provisional",
                ]
            )
            lastNotice = "Provisional advisory admitted. It cannot authorize a merge, spend, deployment, or other irreversible action."
            await refresh(projectDir: candidate.projectDir)
        } catch let error as FleetDoctrineStoreError {
            handle(error)
        } catch {
            lastError = "Could not admit doctrine: \(error.localizedDescription)"
        }
    }

    func contest(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot, reason: String) async {
        guard let doctrineID = candidate.doctrineId, reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 else { return }
        activeAction = "contest"
        defer { activeAction = nil }
        do {
            let _: EmptyResponse = try await post(
                path: "/doctrine/\(doctrineID)/contest",
                body: [
                    "projectDir": candidate.projectDir,
                    "actorId": Self.operatorActorID,
                    "citations": citations(for: candidate, detail: detail),
                    "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
                    "severity": "medium",
                ]
            )
            lastNotice = "Contradiction recorded. The advisory is now visibly contested until evidence supports a revision."
            await refresh(projectDir: candidate.projectDir)
        } catch let error as FleetDoctrineStoreError {
            handle(error)
        } catch {
            lastError = "Could not record contradiction: \(error.localizedDescription)"
        }
    }

    func retrieve(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot, decisionID: String, decisionClass: String) async {
        let trimmedDecisionID = decisionID.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDecisionClass = decisionClass.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDecisionID.isEmpty, !trimmedDecisionClass.isEmpty else { return }
        activeAction = "retrieve"
        defer { activeAction = nil }
        do {
            let nextPacket: FleetDoctrinePacketSnapshot = try await post(
                path: "/doctrine/orders",
                body: [
                    "projectDir": candidate.projectDir,
                    "actorId": Self.operatorActorID,
                    "citations": citations(for: candidate, detail: detail),
                    "decisionId": trimmedDecisionID,
                    "decisionClass": trimmedDecisionClass,
                ]
            )
            packet = nextPacket
            lastNotice = nextPacket.doctrines.isEmpty
                ? "Retrieval receipt recorded with no matching admitted doctrine."
                : "Retrieval receipt recorded. The packet is advisory, not an approval."
        } catch let error as FleetDoctrineStoreError {
            handle(error)
        } catch {
            lastError = "Could not record retrieval receipt: \(error.localizedDescription)"
        }
    }

    func recordApplication(
        packet: FleetDoctrinePacketSnapshot,
        doctrine: FleetDoctrineCandidateSnapshot,
        response: FleetDoctrineApplicationResponse,
        decision: String,
        note: String?
    ) async {
        guard let doctrineID = doctrine.doctrineId, !decision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        activeAction = "application:\(doctrineID)"
        defer { activeAction = nil }
        do {
            let _: FleetDoctrineApplicationResponseEnvelope = try await post(
                path: "/doctrine/retrievals/\(packet.receipt.id)/application",
                body: [
                    "projectDir": doctrine.projectDir,
                    "actorId": Self.operatorActorID,
                    "citations": Array(Set(packet.receipt.citations + doctrine.evidenceCitations)).sorted(),
                    "doctrineId": doctrineID,
                    "response": response.rawValue,
                    "decision": decision.trimmingCharacters(in: .whitespacesAndNewlines),
                    "note": note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
                ]
            )
            lastNotice = "Application receipt recorded. Verification is still pending."
            await loadDetail(doctrineID: doctrineID)
        } catch let error as FleetDoctrineStoreError {
            handle(error)
        } catch {
            lastError = "Could not record application: \(error.localizedDescription)"
        }
    }

    func recordOutcome(
        application: FleetDoctrineApplicationSnapshot,
        candidate: FleetDoctrineCandidateSnapshot,
        detail: FleetDoctrineDetailSnapshot,
        verdict: FleetDoctrineOutcomeVerdict,
        summary: String,
        verifiedBy: String
    ) async {
        let trimmedSummary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedVerifiedBy = verifiedBy.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSummary.isEmpty, !trimmedVerifiedBy.isEmpty else { return }
        activeAction = "outcome:\(application.id)"
        defer { activeAction = nil }
        do {
            let _: FleetDoctrineOutcomeResponseEnvelope = try await post(
                path: "/doctrine/applications/\(application.id)/outcome",
                body: [
                    "projectDir": candidate.projectDir,
                    "actorId": Self.operatorActorID,
                    "citations": citations(for: candidate, detail: detail),
                    "verdict": verdict.rawValue,
                    "summary": trimmedSummary,
                    "verifiedBy": trimmedVerifiedBy,
                ]
            )
            lastNotice = "Verified outcome recorded as \(verdict.displayLabel.lowercased())."
            if let doctrineID = candidate.doctrineId {
                await loadDetail(doctrineID: doctrineID)
            }
        } catch let error as FleetDoctrineStoreError {
            handle(error)
        } catch {
            lastError = "Could not record outcome: \(error.localizedDescription)"
        }
    }

    private func loadDetail(doctrineID: String) async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }
        do {
            let nextDetail: FleetDoctrineDetailSnapshot = try await get(path: "/doctrine/\(doctrineID)")
            selectedDoctrineID = doctrineID
            detail = nextDetail
            routeMissing = false
        } catch let error as FleetDoctrineStoreError {
            handle(error)
        } catch {
            lastError = "Could not load doctrine evidence: \(error.localizedDescription)"
        }
    }

    private func citations(for candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) -> [String] {
        Array(Set(candidate.evidenceCitations + (detail.experiment?.citations ?? []) + candidate.citations)).sorted()
    }

    private func get<T: Decodable>(path: String, query: [URLQueryItem] = []) async throws -> T {
        guard let baseURL, var components = URLComponents(string: "\(baseURL)\(path)") else { throw FleetDoctrineStoreError.unavailable }
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw FleetDoctrineStoreError.unavailable }
        let (data, response) = try await session.data(from: url)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable>(path: String, body: [String: Any]) async throws -> T {
        guard let baseURL, let url = URL(string: "\(baseURL)\(path)") else {
            throw FleetDoctrineStoreError.unavailable
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw FleetDoctrineStoreError.unavailable }
        if http.statusCode == 404 { throw FleetDoctrineStoreError.routeMissing }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(FleetDoctrineErrorEnvelope.self, from: data)
            throw FleetDoctrineStoreError.server(error?.error ?? "Doctrine evidence HTTP \(http.statusCode).")
        }
    }

    private func handle(_ error: FleetDoctrineStoreError) {
        switch error {
        case .routeMissing:
            routeMissing = true
            candidates = []
            detail = nil
            packet = nil
            lastError = "The doctrine evidence routes are not available in this daemon build."
        case .unavailable:
            lastError = "Doctrine evidence is unavailable because the daemon cannot be reached."
        case let .server(message):
            lastError = message
        }
    }
}

private enum FleetDoctrineStoreError: Error {
    case unavailable
    case routeMissing
    case server(String)
}

private struct EmptyResponse: Decodable {}
