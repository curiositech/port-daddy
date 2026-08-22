import SwiftUI
import Combine

// MARK: - Decodable Models

struct CostTotals: Decodable {
    let totalUsd: Double
    let spawnCount: Int
    let estimatedCount: Int?
}

struct CostProjectSpend: Decodable {
    let projectName: String?
    let projectDir: String?
    let totalUsd: Double
    let spawnCount: Int
    let estimatedCount: Int?
    let topModel: String?
}

struct CostResponse: Decodable {
    let totals: CostTotals
    let byProject: [CostProjectSpend]
}

struct GoldenSignals: Decodable {
    let ratePerMin: Double
    let errorPct: Double
    let avgDurationMs: Double?
    let costPerHour: Double
    let counts: GoldenCounts
}

struct GoldenCounts: Decodable {
    let started: Int
    let completed: Int
    let failed: Int
}

struct CostFleetStatusResponse: Decodable {
    let fleets: [CostFleetProject]
}

struct CostFleetProject: Decodable {
    let project: String
    let projectDir: String
}

struct CostFleetConfigResponse: Decodable {
    let parsed: CostFleetConfig?
}

struct CostFleetConfig: Decodable {
    let limits: CostFleetLimits?
}

struct CostFleetLimits: Decodable {
    let budgetUsdPerDay: Double?
}

private struct LiveFleetBudget {
    let projectName: String
    let projectDir: String
    let budgetUsdPerDay: Double?
}

enum ProjectCostCategory: String {
    case liveFleet
    case historicalLabel
}

struct ProjectCostStatus: Identifiable {
    let projectName: String
    let projectDir: String?
    let category: ProjectCostCategory
    let totalUsd: Double
    let spawnCount: Int
    let estimatedCount: Int
    let topModel: String?
    let budgetUsdPerDay: Double?
    let remainingUsd: Double?
    let percentUsed: Double?
    let overBudget: Bool

    var id: String { "\(category.rawValue):\(projectDir ?? projectName)" }

    var displayName: String {
        if !projectName.isEmpty { return projectName }
        if let projectDir, !projectDir.isEmpty {
            return URL(fileURLWithPath: projectDir).lastPathComponent
        }
        return "unscoped"
    }
}

// MARK: - Cost Store

@MainActor
class CostStore: ObservableObject {
    @Published var todayTotals: CostTotals?
    @Published var liveProjects: [ProjectCostStatus] = []
    @Published var historicalBuckets: [ProjectCostStatus] = []
    @Published var golden: GoldenSignals?

    private nonisolated(unsafe) var refreshTimer: Timer?
    private let baseURL: String?

    var todaySpend: Double {
        liveProjects.reduce(0) { $0 + $1.totalUsd }
    }

    var burnRateString: String {
        guard let golden = golden else { return "--" }
        let rate = golden.costPerHour
        if rate < 0.01 {
            return "< $0.01/hr"
        }
        return String(format: "$%.2f/hr", rate)
    }

    var spawnCountToday: Int {
        todayTotals?.spawnCount ?? 0
    }

    var estimatedCountToday: Int {
        liveProjects.reduce(0) { $0 + $1.estimatedCount }
    }

    var exactCountToday: Int {
        max(0, liveProjects.reduce(0) { $0 + $1.spawnCount } - estimatedCountToday)
    }

    var budgetedProjectCount: Int {
        liveProjects.filter { $0.budgetUsdPerDay != nil }.count
    }

    var overBudgetProjectCount: Int {
        liveProjects.filter(\.overBudget).count
    }

    var nearBudgetProjectCount: Int {
        liveProjects.filter {
            guard let percentUsed = $0.percentUsed else { return false }
            return !$0.overBudget && percentUsed >= 80
        }.count
    }

    var historicalBucketCount: Int {
        historicalBuckets.count
    }

    var hasAnyData: Bool {
        todayTotals != nil || golden != nil || !liveProjects.isEmpty || !historicalBuckets.isEmpty
    }

    init(autoStart: Bool = true) {
        self.baseURL = DaemonLocation.availableBaseURL()

        guard autoStart else { return }

        Task {
            await refresh()
        }

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
        async let costResult = fetchCost()
        async let goldenResult = fetchGolden()
        async let fleetResult = fetchLiveFleetBudgets()

        let (costData, goldenData, liveFleets) = await (costResult, goldenResult, fleetResult)

        if let cost = costData {
            todayTotals = cost.totals
        } else if !liveFleets.isEmpty {
            todayTotals = CostTotals(totalUsd: 0, spawnCount: 0, estimatedCount: 0)
        } else {
            todayTotals = nil
        }

        golden = goldenData
        let merged = mergeProjectCosts(spends: costData?.byProject ?? [], liveFleets: liveFleets)
        liveProjects = merged.liveProjects
        historicalBuckets = merged.historicalBuckets
    }

    // MARK: - Private Fetchers

    private func fetchCost() async -> CostResponse? {
        guard let baseURL, let url = URL(string: "\(baseURL)/metrics/cost") else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            return try JSONDecoder().decode(CostResponse.self, from: data)
        } catch {
            return nil
        }
    }

    private func fetchGolden() async -> GoldenSignals? {
        guard let baseURL, let url = URL(string: "\(baseURL)/metrics/golden") else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            return try JSONDecoder().decode(GoldenSignals.self, from: data)
        } catch {
            return nil
        }
    }

    private func fetchLiveFleetBudgets() async -> [LiveFleetBudget] {
        guard let baseURL, let url = URL(string: "\(baseURL)/fleet") else { return [] }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return []
            }
            let fleetStatus = try JSONDecoder().decode(CostFleetStatusResponse.self, from: data)
            var fleets: [LiveFleetBudget] = []
            for fleet in fleetStatus.fleets {
                fleets.append(
                    LiveFleetBudget(
                        projectName: fleet.project,
                        projectDir: fleet.projectDir,
                        budgetUsdPerDay: await fetchBudget(for: fleet.projectDir)
                    )
                )
            }
            return fleets
        } catch {
            return []
        }
    }

    private func fetchBudget(for project: String) async -> Double? {
        guard let baseURL,
              let encodedProject = encodePathSegment(project),
              let url = URL(string: "\(baseURL)/fleet/config/\(encodedProject)") else {
            return nil
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            let config = try JSONDecoder().decode(CostFleetConfigResponse.self, from: data)
            return config.parsed?.limits?.budgetUsdPerDay
        } catch {
            return nil
        }
    }

    private func mergeProjectCosts(
        spends: [CostProjectSpend],
        liveFleets: [LiveFleetBudget]
    ) -> (liveProjects: [ProjectCostStatus], historicalBuckets: [ProjectCostStatus]) {
        var consumedSpendIndices = Set<Int>()
        let liveProjects = sortProjectRows(
            liveFleets.map { fleet in
                let exactMatches = spends.indices.filter { index in
                    !consumedSpendIndices.contains(index) && spends[index].projectDir == fleet.projectDir
                }
                let matchedIndices: [Int]
                if exactMatches.isEmpty {
                    matchedIndices = spends.indices.filter { index in
                        !consumedSpendIndices.contains(index)
                            && spends[index].projectDir == nil
                            && spends[index].projectName == fleet.projectName
                    }
                } else {
                    matchedIndices = exactMatches
                }
                consumedSpendIndices.formUnion(matchedIndices)
                return aggregateProjectStatus(
                    projectName: fleet.projectName,
                    projectDir: fleet.projectDir,
                    category: .liveFleet,
                    spends: matchedIndices.map { spends[$0] },
                    budgetUsdPerDay: fleet.budgetUsdPerDay
                )
            }
        )

        let historicalBuckets = sortProjectRows(
            spends.enumerated()
                .filter { !consumedSpendIndices.contains($0.offset) }
                .map { _, spend in
                    aggregateProjectStatus(
                        projectName: spend.projectName ?? "unscoped",
                        projectDir: spend.projectDir,
                        category: .historicalLabel,
                        spends: [spend],
                        budgetUsdPerDay: nil
                    )
                }
        )

        return (liveProjects, historicalBuckets)
    }

    private func aggregateProjectStatus(
        projectName: String,
        projectDir: String?,
        category: ProjectCostCategory,
        spends: [CostProjectSpend],
        budgetUsdPerDay: Double?
    ) -> ProjectCostStatus {
        let totalUsd = spends.reduce(0) { $0 + $1.totalUsd }
        let spawnCount = spends.reduce(0) { $0 + $1.spawnCount }
        let estimatedCount = spends.reduce(0) { $0 + ($1.estimatedCount ?? 0) }
        let topModel = spends.max(by: { $0.spawnCount < $1.spawnCount })?.topModel
        let remainingUsd = budgetUsdPerDay.map { max(0, $0 - totalUsd) }
        let percentUsed = budgetUsdPerDay.map { budget in
            budget > 0 ? min((totalUsd / budget) * 100, 999) : 0
        }
        let overBudget = budgetUsdPerDay.map { totalUsd > $0 } ?? false

        return ProjectCostStatus(
            projectName: projectName,
            projectDir: projectDir,
            category: category,
            totalUsd: totalUsd,
            spawnCount: spawnCount,
            estimatedCount: estimatedCount,
            topModel: topModel,
            budgetUsdPerDay: budgetUsdPerDay,
            remainingUsd: remainingUsd,
            percentUsed: percentUsed,
            overBudget: overBudget
        )
    }

    private func sortProjectRows(_ rows: [ProjectCostStatus]) -> [ProjectCostStatus] {
        rows.sorted { lhs, rhs in
            if lhs.overBudget != rhs.overBudget {
                return lhs.overBudget && !rhs.overBudget
            }
            let lhsPercent = lhs.percentUsed ?? -1
            let rhsPercent = rhs.percentUsed ?? -1
            if lhsPercent != rhsPercent {
                return lhsPercent > rhsPercent
            }
            return lhs.totalUsd > rhs.totalUsd
        }
    }

    private func encodePathSegment(_ value: String) -> String? {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed)
    }
}
