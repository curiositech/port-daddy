import Foundation

// MARK: - Coast Guard receipt read model
//
// This is deliberately a completion read-path, not a current-posture claim.
// A row appears only when the daemon's in-memory spawned-agent history has an
// actual Coast Guard receipt. Missing evidence stays missing.

struct CoastGuardEgressTotals: Codable, Equatable {
    let requests: Int
    let bytes: Int
    let blocked: Int
    let injected: Int
}

struct CoastGuardReceiptSummary: Codable, Equatable, Identifiable {
    let agentId: String
    let backend: String
    let confined: Bool
    let mechanism: String
    let egress: CoastGuardEgressTotals?

    var id: String { agentId }
}

@MainActor
final class CoastGuardReceiptStore: ObservableObject {
    @Published private(set) var receipts: [CoastGuardReceiptSummary] = []

    private let baseURL: String?
    private let session: URLSession
    private nonisolated(unsafe) var refreshTimer: Timer?
    private var isRefreshing = false

    init(baseURL: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL ?? DaemonLocation.availableBaseURL()
        self.session = session
    }

    func start() {
        Task { await refresh() }
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

        guard let baseURL, let url = URL(string: "\(baseURL)/spawn") else {
            receipts = []
            return
        }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                receipts = []
                return
            }
            receipts = try Self.decodeReceipts(data)
        } catch {
            // Never display stale confinement facts after the daemon disappears.
            receipts = []
        }
    }

    static func decodeReceipts(_ data: Data) throws -> [CoastGuardReceiptSummary] {
        struct SpawnedAgent: Codable {
            let coastGuard: CoastGuardReceiptSummary?
        }
        struct Envelope: Codable {
            let agents: [SpawnedAgent]
        }
        return try JSONDecoder().decode(Envelope.self, from: data).agents.compactMap(\.coastGuard)
    }
}
