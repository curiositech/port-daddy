import SwiftUI
import Combine

// MARK: - Decodable Models

struct CostTotals: Decodable {
    let totalUsd: Double
    let spawnCount: Int
}

struct CostProjectSpend: Decodable {
    let projectName: String?
    let totalUsd: Double
    let spawnCount: Int
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

struct ProjectCostStatus: Identifiable {
    let projectName: String
    let totalUsd: Double
    let spawnCount: Int
    let topModel: String?
    let budgetUsdPerDay: Double?
    let remainingUsd: Double?
    let percentUsed: Double?
    let overBudget: Bool

    var id: String { projectName }
}

// MARK: - Cost Store

@MainActor
class CostStore: ObservableObject {
    @Published var todayTotals: CostTotals?
    @Published var byProject: [ProjectCostStatus] = []
    @Published var golden: GoldenSignals?

    private nonisolated(unsafe) var refreshTimer: Timer?
    private let baseURL: String

    var todaySpend: Double {
        todayTotals?.totalUsd ?? 0
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

    var budgetedProjectCount: Int {
        byProject.filter { $0.budgetUsdPerDay != nil }.count
    }

    var overBudgetProjectCount: Int {
        byProject.filter(\.overBudget).count
    }

    var nearBudgetProjectCount: Int {
        byProject.filter {
            guard let percentUsed = $0.percentUsed else { return false }
            return !$0.overBudget && percentUsed >= 80
        }.count
    }

    var hasAnyData: Bool {
        todayTotals != nil || golden != nil || !byProject.isEmpty
    }

    init() {
        self.baseURL = DaemonLocation.resolveBaseURL()

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
        async let budgetResult = fetchFleetBudgets()

        let (costData, goldenData, budgets) = await (costResult, goldenResult, budgetResult)

        if let cost = costData {
            todayTotals = cost.totals
        } else if !budgets.isEmpty {
            todayTotals = CostTotals(totalUsd: 0, spawnCount: 0)
        } else {
            todayTotals = nil
        }

        golden = goldenData
        byProject = mergeProjectCosts(spends: costData?.byProject ?? [], budgets: budgets)
    }

    // MARK: - Private Fetchers

    private func fetchCost() async -> CostResponse? {
        guard let url = URL(string: "\(baseURL)/metrics/cost") else { return nil }
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
        guard let url = URL(string: "\(baseURL)/metrics/golden") else { return nil }
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

    private func fetchFleetBudgets() async -> [String: Double] {
        guard let url = URL(string: "\(baseURL)/fleet") else { return [:] }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return [:]
            }
            let fleetStatus = try JSONDecoder().decode(CostFleetStatusResponse.self, from: data)
            var budgets: [String: Double] = [:]
            for fleet in fleetStatus.fleets {
                if let budget = await fetchBudget(for: fleet.project), budget > 0 {
                    budgets[fleet.project] = budget
                }
            }
            return budgets
        } catch {
            return [:]
        }
    }

    private func fetchBudget(for project: String) async -> Double? {
        guard let encodedProject = encodePathSegment(project),
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
        budgets: [String: Double]
    ) -> [ProjectCostStatus] {
        var projectMap: [String: CostProjectSpend] = [:]
        for spend in spends {
            let projectName = spend.projectName ?? "unscoped"
            projectMap[projectName] = spend
        }

        let projectNames = Set(projectMap.keys).union(budgets.keys)
        return projectNames.map { projectName in
            let spend = projectMap[projectName]
            let totalUsd = spend?.totalUsd ?? 0
            let budgetUsdPerDay = budgets[projectName]
            let remainingUsd = budgetUsdPerDay.map { max(0, $0 - totalUsd) }
            let percentUsed = budgetUsdPerDay.map { budget in
                budget > 0 ? min((totalUsd / budget) * 100, 999) : 0
            }
            let overBudget = budgetUsdPerDay.map { totalUsd > $0 } ?? false

            return ProjectCostStatus(
                projectName: projectName,
                totalUsd: totalUsd,
                spawnCount: spend?.spawnCount ?? 0,
                topModel: spend?.topModel,
                budgetUsdPerDay: budgetUsdPerDay,
                remainingUsd: remainingUsd,
                percentUsed: percentUsed,
                overBudget: overBudget
            )
        }
        .sorted { lhs, rhs in
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
