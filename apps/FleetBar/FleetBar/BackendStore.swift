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

/// Single rollup returned by BackendStore.fetchCost(since:) — used by the
/// Fleet Control Center Backend section's window selector (Today / Week /
/// Month). Doesn't mutate the BackendStore's published state because the
/// menubar always pins to today; the FCC section uses its own window.
struct BackendCostWindow {
    let rows: [BackendCostRow]
    let totalUsd: Double
    let totalSpawns: Int

    static let empty = BackendCostWindow(rows: [], totalUsd: 0, totalSpawns: 0)
}

// MARK: - Spawn forecast (mirrors GET /fleet/forecast)
//
// "How many LLM calls per hour, on which models, is this machine armed to
// make?" — deterministic cron-scheduled rates (as the engine really runs
// them) plus observed spawn.started counters.

struct SpawnForecastResponse: Decodable {
    let success: Bool?
    let forcedCliBackend: String?
    let totals: ForecastTotals?
    let projects: [ForecastProject]?
    let observed: ForecastObserved?
}

struct ForecastTotals: Decodable {
    let scheduledPerHour: Double
    let byModel: [ForecastModelRate]
}

struct ForecastModelRate: Decodable, Identifiable {
    let backend: String
    let model: String
    let perHour: Double
    var id: String { "\(backend)::\(model)" }
}

struct ForecastProject: Decodable, Identifiable {
    let project: String
    let projectDir: String?
    let running: Bool
    let scheduledPerHour: Double
    let scheduledPerHourRaw: Double?
    let maxSpawnsPerHour: Double?
    let eventAgentCount: Int?
    // Project names aren't guaranteed unique across checkouts (two worktrees
    // of the same repo, or two repos with the same folder name); key off the
    // daemon's `projectDir` when present so SwiftUI diffing never collides,
    // falling back to the name for older daemons that predate this field.
    var id: String { projectDir ?? project }
}

struct ForecastObserved: Decodable {
    let lastHour: Double
    let last24h: Double?
    let last24hPerHour: Double
    let byModelLastHour: [ForecastDimCount]?
    let byModelLast24h: [ForecastDimCount]?
}

struct ForecastDimCount: Decodable, Identifiable {
    let value: String
    let count: Double
    var id: String { value }
}

/// Shared persistence for the `~/.port-daddy-cli-backend` file. Both the
/// menubar BackendPicker and the Fleet Control Center Backend section
/// call into this helper so the write path stays in one place — the
/// daemon picks up this file on next restart, and `pd backend use` writes
/// the same path from the CLI.
enum BackendCLIPersistence {
    static var path: String {
        ("~/.port-daddy-cli-backend" as NSString).expandingTildeInPath
    }

    static func write(_ value: String) {
        let payload = "\(value)\n"
        try? payload.write(toFile: path, atomically: true, encoding: .utf8)
    }

    static func clear() {
        try? FileManager.default.removeItem(atPath: path)
    }
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
    @Published var forecast: SpawnForecastResponse?
    @Published var loadedOnce: Bool = false
    @Published var lastError: String?

    private nonisolated(unsafe) var refreshTimer: Timer?
    private let baseURL: String?

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
        self.baseURL = DaemonLocation.availableBaseURL()
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
        async let forecastResult = fetchForecast()

        let (models, cost, fc) = await (modelsResult, costResult, forecastResult)
        if let models {
            backends = models.backends
            forcedCliBackend = models.forcedCliBackend
            pdUseCliBackendEnv = models.pdUseCliBackend
            lastError = nil
        }
        costByBackend = cost
        // Assign unconditionally (even nil) — a failed/degraded fetch must
        // clear a previous forecast, not leave a stale one on screen after
        // the daemon restarts on an older build or a request blips.
        forecast = fc
        loadedOnce = true
    }

    /// One-line armed-rate summary for the menubar row, e.g.
    /// "≈ 9.5/hr armed · 4 last hr". Nil until the forecast loads.
    var forecastSummaryLine: String? {
        guard let fc = forecast, let totals = fc.totals else { return nil }
        var parts: [String] = []
        parts.append(String(format: "≈ %.1f calls/hr armed", totals.scheduledPerHour))
        if let observed = fc.observed {
            parts.append(String(format: "%.0f last hr", observed.lastHour))
        }
        return parts.joined(separator: " · ")
    }

    /// The dominant forecast model line, e.g. "mostly gpt-5.4-mini".
    var forecastTopModelLine: String? {
        guard let top = forecast?.totals?.byModel.first, top.perHour > 0 else { return nil }
        return "mostly \(top.model)"
    }

    // MARK: - Fetchers

    private func fetchBackends() async -> BackendCatalogResponse? {
        guard let baseURL, let url = URL(string: "\(baseURL)/fleet/models") else { return nil }
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

    private func fetchForecast() async -> SpawnForecastResponse? {
        guard let baseURL, let url = URL(string: "\(baseURL)/fleet/forecast") else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(SpawnForecastResponse.self, from: data)
        } catch {
            // Older daemons don't serve /fleet/forecast — degrade silently.
            return nil
        }
    }

    private func fetchCostByBackend() async -> [BackendCostRow] {
        let window = await fetchCost(since: 86400)
        return window.rows
    }

    /// Stateless rollup fetch for arbitrary windows. The FCC Backend section
    /// uses this to swap between Today / Week / Month without disturbing the
    /// menubar's pinned-to-today truth.
    func fetchCost(since secondsAgo: Int) async -> BackendCostWindow {
        guard let baseURL, let url = URL(string: "\(baseURL)/metrics/cost?since=\(secondsAgo)") else {
            return .empty
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return .empty
            }
            let decoded = try JSONDecoder().decode(BackendCostMetricsResponse.self, from: data)
            let rows = decoded.byBackend ?? []
            // CostTotals shape lives in CostStore.swift; the field names there
            // are snake-case + camelCase tolerant. Roll up locally so this
            // method doesn't depend on the wire field name.
            let total = rows.reduce(0.0) { $0 + $1.amountUsd }
            let spawns = rows.reduce(0) { $0 + $1.count }
            return BackendCostWindow(rows: rows, totalUsd: total, totalSpawns: spawns)
        } catch {
            return .empty
        }
    }
}
