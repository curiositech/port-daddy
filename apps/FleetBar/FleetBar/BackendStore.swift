import SwiftUI
import Combine

// MARK: - Decodable Models — mirrors GET /fleet/models response shape.
//
// The daemon's /fleet/models endpoint returns one BackendEntry per backend
// in lib/backend-catalog.ts. We surface only the fields FleetBar actually
// renders; extra keys are ignored by Codable.

struct BackendCatalogResponse: Decodable {
    let success: Bool?
    let forcedCliBackend: String?
    let pdUseCliBackend: String?
    let backends: [BackendEntry]
}

struct BackendEntry: Decodable, Identifiable {
    let id: String
    let name: String
    let models: [String]?
    let available: Bool?
    let launchable: Bool?
    let recommended: Bool?
    let costModel: String?
    let framing: String?
    let description: String?
    let tagline: String?
    let pdUseCliBackendValue: String?
    let isForcedByEnv: Bool?
    let readinessStatus: String?
    let readinessSummary: String?
    let readinessNextStep: String?

    var isReady: Bool {
        (available ?? false) || (launchable ?? false)
    }

    /// Subscription / local / metered / cli — drives the badge color and copy.
    var costKind: BackendCostKind {
        switch costModel {
        case "subscription": return .subscription
        case "local":        return .local
        case "metered":      return .metered
        case "cli":          return .cli
        default:             return .unknown
        }
    }

    var isSubscriptionBacked: Bool {
        costKind == .subscription
    }

    var isFree: Bool {
        costKind == .subscription || costKind == .local
    }
}

enum BackendCostKind {
    case subscription
    case local
    case metered
    case cli
    case unknown

    var badgeText: String {
        switch self {
        case .subscription: return "FREE — subscription"
        case .local:        return "FREE — local"
        case .metered:      return "metered"
        case .cli:          return "cli"
        case .unknown:      return "—"
        }
    }

    var color: Color {
        switch self {
        case .subscription: return Fleet.Color.healthy
        case .local:        return Fleet.Color.healthy
        case .metered:      return Fleet.Color.warning
        case .cli:          return Fleet.Color.active
        case .unknown:      return Fleet.Color.dormant
        }
    }
}

// MARK: - Cost-by-backend summary (mirrors GET /metrics/cost.byBackend rows)

struct BackendCostRow: Decodable, Identifiable {
    let backend: String
    let totalUsd: Double?
    let total_usd: Double?
    let spawnCount: Int?
    let spawn_count: Int?

    var id: String { backend }
    var amountUsd: Double { totalUsd ?? total_usd ?? 0 }
    var count: Int { spawnCount ?? spawn_count ?? 0 }
}

struct BackendCostMetricsResponse: Decodable {
    let totals: CostTotals?
    let byBackend: [BackendCostRow]?
}

// MARK: - BackendStore
//
// Polls /fleet/models every 30s. Surfaces:
//   - Active backend (forcedCliBackend env override, if any)
//   - The full catalog, ranked so subscription/free options sit at the top
//   - Today's spend rolled up by backend (from /metrics/cost?since=86400)
//
// FleetBar binds the popover's Backend section to this store.

@MainActor
class BackendStore: ObservableObject {
    @Published var backends: [BackendEntry] = []
    @Published var forcedCliBackend: String?
    @Published var pdUseCliBackendEnv: String?
    @Published var costByBackend: [BackendCostRow] = []
    @Published var loadedOnce: Bool = false
    @Published var lastError: String?

    private nonisolated(unsafe) var refreshTimer: Timer?
    private let baseURL: String

    /// The single "current backend" the FleetBar status row should show.
    /// Priority:
    ///   1. PD_USE_CLI_BACKEND override (this is the explicit "use my Claude Max" knob)
    ///   2. Highest-spend backend in today's window (live truth)
    ///   3. First subscription-backed available backend (recommended)
    ///   4. First available backend
    ///   5. nil (nothing usable)
    var headlineBackend: BackendEntry? {
        if let forced = forcedCliBackend, let entry = backends.first(where: { $0.id == forced }) {
            return entry
        }
        if let topSpend = costByBackend.max(by: { $0.amountUsd < $1.amountUsd }),
           let entry = backends.first(where: { $0.id == topSpend.backend }),
           topSpend.amountUsd > 0 {
            return entry
        }
        if let sub = backends.first(where: { $0.isSubscriptionBacked && $0.isReady }) {
            return sub
        }
        if let ready = backends.first(where: { $0.isReady }) {
            return ready
        }
        return nil
    }

    /// Headline framing copy for the menubar row.
    /// Example: "Fleet running on Claude Code (FREE — Claude Max subscription)"
    var headlineLine: String {
        guard let entry = headlineBackend else {
            return "No backend ready. Install `claude` or `codex` to use your subscription."
        }
        let framing = entry.framing ?? entry.name
        return "Fleet on \(entry.name) — \(framing)"
    }

    var todaySpendUsd: Double {
        costByBackend.reduce(0) { $0 + $1.amountUsd }
    }

    var todaySpendLabel: String {
        let total = todaySpendUsd
        // Subscription / local routes don't accrue marginal cost; show $0 / FREE.
        if total < 0.005 { return "$0 today" }
        if total < 1 { return String(format: "$%.2f today", total) }
        return String(format: "$%.2f today", total)
    }

    /// True if every spawn today went through a subscription/local backend.
    /// Drives the "FREE" badge on the spend row.
    var todaySpendIsAllFree: Bool {
        guard !costByBackend.isEmpty else { return false }
        return costByBackend.allSatisfy { row in
            guard let entry = backends.first(where: { $0.id == row.backend }) else { return false }
            return entry.isFree
        }
    }

    /// Backend list ranked for the picker: subscription/free first, then ready.
    var rankedForPicker: [BackendEntry] {
        backends.sorted { lhs, rhs in
            // Forced first.
            if (lhs.isForcedByEnv ?? false) != (rhs.isForcedByEnv ?? false) {
                return lhs.isForcedByEnv ?? false
            }
            // Subscription before everything else.
            if lhs.isSubscriptionBacked != rhs.isSubscriptionBacked {
                return lhs.isSubscriptionBacked
            }
            // Ready before not-ready.
            if lhs.isReady != rhs.isReady {
                return lhs.isReady
            }
            // Free (subscription/local) before paid.
            if lhs.isFree != rhs.isFree {
                return lhs.isFree
            }
            return lhs.id < rhs.id
        }
    }

    init(autoStart: Bool = true) {
        self.baseURL = DaemonLocation.resolveBaseURL()
        guard autoStart else { return }

        Task { await refresh() }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }

    deinit {
        refreshTimer?.invalidate()
    }

    func refresh() async {
        async let modelsResult = fetchBackends()
        async let costResult = fetchCostByBackend()

        let (models, cost) = await (modelsResult, costResult)
        if let models {
            backends = models.backends
            forcedCliBackend = models.forcedCliBackend
            pdUseCliBackendEnv = models.pdUseCliBackend
            lastError = nil
        }
        costByBackend = cost
        loadedOnce = true
    }

    // MARK: - Fetchers

    private func fetchBackends() async -> BackendCatalogResponse? {
        guard let url = URL(string: "\(baseURL)/fleet/models") else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                lastError = "HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1) from /fleet/models"
                return nil
            }
            return try JSONDecoder().decode(BackendCatalogResponse.self, from: data)
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    private func fetchCostByBackend() async -> [BackendCostRow] {
        guard let url = URL(string: "\(baseURL)/metrics/cost?since=86400") else { return [] }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return []
            }
            let decoded = try JSONDecoder().decode(BackendCostMetricsResponse.self, from: data)
            return decoded.byBackend ?? []
        } catch {
            return []
        }
    }
}
