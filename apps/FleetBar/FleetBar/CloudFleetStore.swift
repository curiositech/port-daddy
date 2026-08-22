import Foundation

struct CloudFleetTelemetryTotals: Decodable, Equatable {
    let events: Int
    let uniqueDeliveries: Int
    let shipEvents: Int
    let checkRunEvents: Int
    let commentEvents: Int
    let errorEvents: Int
    let costUsd: Double
    let estimatedCostEvents: Int
    let unknownCostEvents: Int
}

struct CloudFleetRepoSummary: Decodable, Identifiable, Equatable {
    let owner: String?
    let repo: String?
    let events: Int
    let pullRequests: Int
    let costUsd: Double
    let lastSeen: Double

    var id: String { "\(owner ?? "_")/\(repo ?? "_")" }
    var displayName: String {
        guard let owner, let repo else { return "unknown repo" }
        return "\(owner)/\(repo)"
    }
}

struct CloudFleetShipSummary: Decodable, Identifiable, Equatable {
    let ship: String
    let events: Int
    let clean: Int
    let findings: Int
    let errors: Int
    let costUsd: Double
    let lastSeen: Double

    var id: String { ship }
}

struct CloudFleetBackendSummary: Decodable, Identifiable, Equatable {
    let backend: String
    let model: String?
    let events: Int
    let costUsd: Double
    let estimatedCostEvents: Int

    var id: String { "\(backend):\(model ?? "_")" }
}

struct CloudFleetTelemetryEvent: Decodable, Identifiable, Equatable {
    let id: String
    let ts: Double
    let source: String
    let provider: String
    let appSlug: String?
    let deliveryId: String?
    let event: String
    let action: String?
    let owner: String?
    let repo: String?
    let prNumber: Int?
    let sha: String?
    let ship: String?
    let role: String?
    let status: String
    let conclusion: String?
    let backend: String?
    let model: String?
    let durationMs: Double?
    let inputTokens: Int?
    let cachedInputTokens: Int?
    let outputTokens: Int?
    let costUsd: Double?
    let costIsEstimate: Bool?
    let commentUrl: String?
    let checkRunId: Int?

    var repoDisplay: String {
        guard let owner, let repo else { return "unknown repo" }
        return "\(owner)/\(repo)"
    }
}

struct CloudFleetTelemetrySummary: Decodable, Equatable {
    let success: Bool
    let generatedAt: Double
    let since: Double
    let totals: CloudFleetTelemetryTotals
    let byRepo: [CloudFleetRepoSummary]
    let byShip: [CloudFleetShipSummary]
    let byBackend: [CloudFleetBackendSummary]
    let recent: [CloudFleetTelemetryEvent]
}

@MainActor
final class CloudFleetStore: ObservableObject {
    @Published private(set) var summary: CloudFleetTelemetrySummary?
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var routeMissing = false

    private var baseURL: String?
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

    var hasCloudActivity: Bool {
        (summary?.totals.events ?? 0) > 0
    }

    var resolvedBaseURL: String? {
        baseURL
    }

    func rebind(baseURL nextBaseURL: String?) {
        let next = nextBaseURL ?? DaemonLocation.availableBaseURL()
        guard next != baseURL else { return }

        baseURL = next
        summary = nil
        lastRefresh = nil
        lastError = nil
        routeMissing = false
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let baseURL, var components = URLComponents(string: "\(baseURL)/telemetry/cloud-app") else { return }
        components.queryItems = [
            URLQueryItem(name: "since", value: "86400"),
            URLQueryItem(name: "limit", value: "8"),
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
                summary = nil
                lastError = "Daemon route /telemetry/cloud-app is not available yet."
                return
            }
            guard http.statusCode == 200 else {
                lastError = "Cloud Fleet telemetry HTTP \(http.statusCode)."
                return
            }

            summary = try JSONDecoder().decode(CloudFleetTelemetrySummary.self, from: data)
            routeMissing = false
            lastRefresh = Date()
            lastError = nil
        } catch {
            lastError = "Cloud Fleet telemetry error: \(error.localizedDescription)"
        }
    }
}
