import SwiftUI
import Combine
import Foundation

// MARK: - Dispatch State Machine
//
// Mirror of the Port Daddy dispatch state machine introduced in PR #163:
//   proposed → claimed → in_progress → produced → review_pending
//      → accepted → settled
//      → rejected → salvage
//      → failed
//
// This file is the operator-facing read/write model for the Nightshift
// surface in Fleet Control Center. It polls the daemon at a 30s cadence
// and exposes a single `@Published` array the UI binds to.

enum DispatchState: String, Codable, CaseIterable, Identifiable {
    case proposed
    case claimed
    case inProgress = "in_progress"
    case produced
    case reviewPending = "review_pending"
    case accepted
    case rejected
    case settled
    case salvage
    case failed

    var id: String { rawValue }

    /// Human-facing label for state badges. Uppercase eyebrows only — body copy
    /// in the UI uses sentence case from elsewhere.
    var displayLabel: String {
        switch self {
        case .proposed:      return "Proposed"
        case .claimed:       return "Claimed"
        case .inProgress:    return "In Progress"
        case .produced:      return "Produced"
        case .reviewPending: return "Awaiting Review"
        case .accepted:      return "Accepted"
        case .rejected:      return "Rejected"
        case .settled:       return "Settled"
        case .salvage:       return "Salvage"
        case .failed:        return "Failed"
        }
    }

    var color: Color {
        switch self {
        case .proposed:      return Fleet.Color.dormant
        case .claimed:       return Fleet.Color.active
        case .inProgress:    return Fleet.Color.active
        case .produced:      return Fleet.Color.healthy
        case .reviewPending: return Fleet.Color.warning
        case .accepted:      return Fleet.Color.healthy
        case .rejected:      return Fleet.Color.failure
        case .settled:       return Fleet.Color.healthy
        case .salvage:       return Fleet.Color.warning
        case .failed:        return Fleet.Color.failure
        }
    }

    var icon: String {
        switch self {
        case .proposed:      return "tray"
        case .claimed:       return "hand.raised"
        case .inProgress:    return "gearshape.2"
        case .produced:      return "shippingbox"
        case .reviewPending: return "exclamationmark.bubble"
        case .accepted:      return "checkmark.seal"
        case .rejected:      return "xmark.octagon"
        case .settled:       return "checkmark.seal.fill"
        case .salvage:       return "wrench.adjustable"
        case .failed:        return "exclamationmark.triangle"
        }
    }

    /// Buckets the UI groups into:
    /// "queued + in flight", "awaiting review", "recent" (terminal states).
    var bucket: Bucket {
        switch self {
        case .proposed, .claimed, .inProgress, .produced:
            return .inFlight
        case .reviewPending:
            return .awaitingReview
        case .accepted, .rejected, .settled, .salvage, .failed:
            return .recent
        }
    }

    enum Bucket {
        case inFlight
        case awaitingReview
        case recent
    }
}

// MARK: - Snapshot

/// One row in the operator surface. Carries everything a card needs to render
/// without forcing the UI to re-fetch a detail view.
struct DispatchSnapshot: Identifiable, Equatable {
    let id: String
    let intent: String
    let state: DispatchState
    let branch: String?
    let prUrl: String?
    let costUsd: Double
    let startedAt: Date?
    let completedAt: Date?
    let transcriptId: String?
    let summary: String?       // one-line summary from /transcript-summary
    let lastEventAt: Date?

    var elapsedSeconds: TimeInterval? {
        guard let startedAt else { return nil }
        let end = completedAt ?? Date()
        return end.timeIntervalSince(startedAt)
    }

    var elapsedDisplay: String {
        guard let elapsed = elapsedSeconds else { return "—" }
        if elapsed < 60 { return String(format: "%.0fs", elapsed) }
        let minutes = Int(elapsed / 60)
        if minutes < 60 { return "\(minutes)m" }
        let hours = Double(minutes) / 60.0
        return String(format: "%.1fh", hours)
    }

    var costDisplay: String {
        if costUsd == 0 { return "$0.00" }
        return String(format: "$%.2f", costUsd)
    }
}

// MARK: - API envelopes
//
// Schema as documented in PR #143 / #163. If the daemon route shape diverges
// at integration time, only this layer needs to change — the @Published
// surface above is stable.

private struct DispatchListResponse: Decodable {
    let success: Bool
    let dispatches: [DispatchEnvelope]
}

private struct DispatchEnvelope: Decodable {
    let id: String
    let intent: String?
    let state: String
    let branch: String?
    let prUrl: String?
    let costUsd: Double?
    let startedAt: Double?
    let completedAt: Double?
    let transcriptId: String?
    let lastEventAt: Double?
}

private struct TranscriptSummaryEnvelope: Decodable {
    let success: Bool
    let summary: String?
}

// MARK: - Popper / Harbormaster status (best effort)

struct PopperStatusSnapshot: Equatable {
    let nextPopInSeconds: TimeInterval?
    let lastPopAt: Date?
    let lastIntent: String?
    let queuedCount: Int

    var nextPopDisplay: String {
        guard let seconds = nextPopInSeconds, seconds > 0 else { return "due now" }
        if seconds < 60 { return String(format: "%.0fs", seconds) }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let leftover = minutes % 60
        return "\(hours)h \(leftover)m"
    }
}

struct HarbormasterStatusSnapshot: Equatable {
    let queueDepth: Int
    let mergingCount: Int
    let lastMergeAt: Date?
    let lastMergeBranch: String?
}

private struct PopperStatusResponse: Decodable {
    let success: Bool
    let nextPopInSeconds: Double?
    let lastPopAt: Double?
    let lastIntent: String?
    let queuedCount: Int?
}

private struct HarbormasterStatusResponse: Decodable {
    let success: Bool
    let queueDepth: Int?
    let mergingCount: Int?
    let lastMergeAt: Double?
    let lastMergeBranch: String?
}

// MARK: - DispatchStore

/// Polls the daemon for dispatch rows + transcript summaries + roadmap-popper
/// and harbormaster status. Refreshes every 30s; expose `refresh()` for
/// manual pulls (after Approve/Reject/Propose actions).
@MainActor
final class DispatchStore: ObservableObject {
    @Published private(set) var dispatches: [DispatchSnapshot] = []
    @Published private(set) var popperStatus: PopperStatusSnapshot?
    @Published private(set) var harbormasterStatus: HarbormasterStatusSnapshot?
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var isRefreshing = false

    /// The daemon route catalogue is documented but the routes themselves are
    /// still being shipped by the parallel daemon-side agent. When the daemon
    /// returns 404 on `/dispatches`, we surface this so the UI can show the
    /// honest "daemon route missing" banner instead of pretending things are fine.
    @Published private(set) var dispatchRouteMissing = false

    private let baseURL: String?
    // `nonisolated(unsafe)` so the nonisolated `deinit` may invalidate the timer
    // under Swift 6 strict concurrency (a non-Sendable `Timer?` is otherwise
    // inaccessible from deinit). Mirrors CostStore/SecretsStore, which already
    // compile clean on the Swift 6.2 toolchain CI uses.
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

    /// Pulls the latest dispatch list, enriches each row with a transcript
    /// summary, and refreshes popper + harbormaster banners. Safe to call from
    /// the main actor; concurrent calls coalesce via `isRefreshing`.
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        async let dispatchesResult = fetchDispatches()
        async let popperResult = fetchPopperStatus()
        async let harborResult = fetchHarbormasterStatus()

        let (dispatchEnvelopes, popper, harbor) = await (dispatchesResult, popperResult, harborResult)

        if let envelopes = dispatchEnvelopes {
            dispatchRouteMissing = false
            let summaries = await fetchSummaries(for: envelopes)
            dispatches = envelopes
                .compactMap { env -> DispatchSnapshot? in
                    guard let state = DispatchState(rawValue: env.state) else { return nil }
                    return DispatchSnapshot(
                        id: env.id,
                        intent: (env.intent ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                        state: state,
                        branch: env.branch,
                        prUrl: env.prUrl,
                        costUsd: env.costUsd ?? 0,
                        startedAt: env.startedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
                        completedAt: env.completedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
                        transcriptId: env.transcriptId,
                        summary: summaries[env.id],
                        lastEventAt: env.lastEventAt.map { Date(timeIntervalSince1970: $0 / 1000) }
                    )
                }
                .sorted { lhs, rhs in
                    let lhsKey = lhs.lastEventAt ?? lhs.startedAt ?? Date.distantPast
                    let rhsKey = rhs.lastEventAt ?? rhs.startedAt ?? Date.distantPast
                    return lhsKey > rhsKey
                }
        } else if dispatchRouteMissing {
            dispatches = []
        }

        popperStatus = popper
        harbormasterStatus = harbor
        lastRefresh = Date()
    }

    // MARK: - Grouped accessors used by the UI

    var inFlight: [DispatchSnapshot] {
        dispatches.filter { $0.state.bucket == .inFlight }
    }

    var awaitingReview: [DispatchSnapshot] {
        dispatches.filter { $0.state.bucket == .awaitingReview }
    }

    /// Recent terminal states from the last 24h (when timestamps are available).
    /// Falls back to "any terminal state" if the daemon didn't report a timestamp,
    /// so the operator never sees an empty "Recent" card when work clearly happened.
    var recent: [DispatchSnapshot] {
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        return dispatches.filter { snap in
            guard snap.state.bucket == .recent else { return false }
            guard let ts = snap.completedAt ?? snap.lastEventAt else { return true }
            return ts >= cutoff
        }
    }

    // MARK: - Operator actions

    /// Submit a new dispatch intent. Mirrors `pd dispatch propose <text>` /
    /// `POST /dispatches`. Returns the created id when the daemon responds.
    @discardableResult
    func propose(intent: String) async -> String? {
        let trimmed = intent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            lastError = "Dispatch intent cannot be empty."
            return nil
        }
        guard let baseURL, let url = URL(string: "\(baseURL)/dispatches") else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["intent": trimmed])

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                lastError = "Propose: no response from daemon."
                return nil
            }
            guard (200..<300).contains(http.statusCode) else {
                lastError = decodeErrorMessage(data: data, fallback: "Propose failed (HTTP \(http.statusCode)).")
                return nil
            }
            lastError = nil
            let id = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? String
            await refresh()
            return id
        } catch {
            lastError = "Propose failed: \(error.localizedDescription)"
            return nil
        }
    }

    /// Mirrors `pd review <id> --accept`. POST /dispatches/:id/review with
    /// `{ "decision": "accept" }`.
    func approve(id: String) async {
        await postReview(id: id, decision: "accept", reason: nil)
    }

    /// Mirrors `pd review <id> --reject "<reason>"`. The reject path REQUIRES
    /// a reason — the UI gates the button on a non-empty input.
    func reject(id: String, reason: String) async {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            lastError = "Rejection reason cannot be empty."
            return
        }
        await postReview(id: id, decision: "reject", reason: trimmed)
    }

    private func postReview(id: String, decision: String, reason: String?) async {
        guard let baseURL, let url = URL(string: "\(baseURL)/dispatches/\(id)/review") else { return }
        var body: [String: Any] = ["decision": decision]
        if let reason { body["reason"] = reason }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                lastError = "Review: no response from daemon."
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                lastError = decodeErrorMessage(data: data, fallback: "Review failed (HTTP \(http.statusCode)).")
                return
            }
            lastError = nil
            await refresh()
        } catch {
            lastError = "Review failed: \(error.localizedDescription)"
        }
    }

    // MARK: - HTTP fetchers

    private func fetchDispatches() async -> [DispatchEnvelope]? {
        guard let baseURL, var components = URLComponents(string: "\(baseURL)/dispatches") else { return nil }
        components.queryItems = [URLQueryItem(name: "state", value: "*")]
        guard let url = components.url else { return nil }

        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse else {
                lastError = "Daemon unreachable."
                return nil
            }
            if http.statusCode == 404 {
                dispatchRouteMissing = true
                lastError = "Daemon route /dispatches not implemented yet (PR #143 / #163)."
                return nil
            }
            guard http.statusCode == 200 else {
                lastError = "Dispatch list HTTP \(http.statusCode)."
                return nil
            }
            let decoded = try JSONDecoder().decode(DispatchListResponse.self, from: data)
            lastError = nil
            return decoded.dispatches
        } catch {
            lastError = "Dispatch list error: \(error.localizedDescription)"
            return nil
        }
    }

    private func fetchSummaries(for envelopes: [DispatchEnvelope]) async -> [String: String] {
        await withTaskGroup(of: (String, String?).self) { group in
            for env in envelopes {
                group.addTask { [baseURL, session] in
                    guard let baseURL, let url = URL(string: "\(baseURL)/dispatches/\(env.id)/transcript-summary") else {
                        return (env.id, nil)
                    }
                    do {
                        let (data, response) = try await session.data(from: url)
                        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                            return (env.id, nil)
                        }
                        let envelope = try JSONDecoder().decode(TranscriptSummaryEnvelope.self, from: data)
                        return (env.id, envelope.summary)
                    } catch {
                        return (env.id, nil)
                    }
                }
            }
            var out: [String: String] = [:]
            for await (id, summary) in group {
                if let summary { out[id] = summary }
            }
            return out
        }
    }

    private func fetchPopperStatus() async -> PopperStatusSnapshot? {
        guard let baseURL, let url = URL(string: "\(baseURL)/popper/status") else { return nil }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            let decoded = try JSONDecoder().decode(PopperStatusResponse.self, from: data)
            return PopperStatusSnapshot(
                nextPopInSeconds: decoded.nextPopInSeconds,
                lastPopAt: decoded.lastPopAt.map { Date(timeIntervalSince1970: $0 / 1000) },
                lastIntent: decoded.lastIntent,
                queuedCount: decoded.queuedCount ?? 0
            )
        } catch {
            return nil
        }
    }

    private func fetchHarbormasterStatus() async -> HarbormasterStatusSnapshot? {
        guard let baseURL, let url = URL(string: "\(baseURL)/harbormaster/status") else { return nil }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            let decoded = try JSONDecoder().decode(HarbormasterStatusResponse.self, from: data)
            return HarbormasterStatusSnapshot(
                queueDepth: decoded.queueDepth ?? 0,
                mergingCount: decoded.mergingCount ?? 0,
                lastMergeAt: decoded.lastMergeAt.map { Date(timeIntervalSince1970: $0 / 1000) },
                lastMergeBranch: decoded.lastMergeBranch
            )
        } catch {
            return nil
        }
    }

    private func decodeErrorMessage(data: Data, fallback: String) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let msg = json["error"] as? String { return msg }
            if let msg = json["message"] as? String { return msg }
        }
        return fallback
    }
}
