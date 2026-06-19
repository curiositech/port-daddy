import SwiftUI

// MARK: - Cost Dashboard
//
// One glance should answer:
// how much today, how fast it is burning, and which fleet projects
// are near or over their actual configured ceilings.

struct CostDashboard: View {
    @ObservedObject var store: CostStore

    private var liveReference: Double {
        let maxSpend = store.liveProjects
            .filter { $0.budgetUsdPerDay == nil }
            .map(\.totalUsd)
            .max() ?? 0
        return max(maxSpend, 1)
    }

    private var historicalReference: Double {
        let maxSpend = store.historicalBuckets
            .map(\.totalUsd)
            .max() ?? 0
        return max(maxSpend, 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            if !store.hasAnyData {
                noDataState
            } else {
                heroNumber
                burnRateLine
                if !store.liveProjects.isEmpty {
                    liveProjectBars
                }
                if !store.historicalBuckets.isEmpty {
                    historicalSpendSection
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.m)
        .background(Fleet.Chrome.panel)
    }

    // MARK: - Hero Number

    private var heroNumber: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.xs) {
            Text(spendFormatted)
                .font(.system(size: 32, weight: .medium, design: .monospaced))
                .foregroundStyle(spendColor)
                .contentTransition(.numericText())

            Text(heroScopeLabel)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
    }

    private var spendFormatted: String {
        String(format: "$%.2f", store.todaySpend)
    }

    private var spendColor: Color {
        if store.overBudgetProjectCount > 0 { return Fleet.Color.failure }
        if store.nearBudgetProjectCount > 0 { return Fleet.Color.warning }
        return .secondary
    }

    private var heroScopeLabel: String {
        if !store.liveProjects.isEmpty {
            return "live fleet spend · last 24h"
        }
        if store.historicalBucketCount > 0 {
            return "headline excludes historical labels below"
        }
        return "no live fleet spend recorded"
    }

    // MARK: - Burn Rate Line

    private var burnRateLine: some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: "circle.grid.2x2")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)

            Text(scopeLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            if !store.liveProjects.isEmpty {
                Image(systemName: "circle.fill")
                    .font(.system(size: 3))
                    .foregroundStyle(.quaternary)

                Text(telemetryLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let budgetLabel {
                Image(systemName: "circle.fill")
                    .font(.system(size: 3))
                    .foregroundStyle(.quaternary)

                Text(budgetLabel)
                    .font(.caption)
                    .foregroundStyle(budgetLabelColor)
            }

            if store.historicalBucketCount > 0 {
                Image(systemName: "circle.fill")
                    .font(.system(size: 3))
                    .foregroundStyle(.quaternary)

                Text("\(store.historicalBucketCount) historical label\(store.historicalBucketCount == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private var scopeLabel: String {
        if !store.liveProjects.isEmpty {
            return "\(store.liveProjects.count) live fleet\(store.liveProjects.count == 1 ? "" : "s")"
        }
        if store.historicalBucketCount > 0 {
            return "history only"
        }
        return "no live fleets"
    }

    private var budgetLabel: String? {
        if store.overBudgetProjectCount > 0 {
            return "\(store.overBudgetProjectCount) over cap"
        }
        if store.nearBudgetProjectCount > 0 {
            return "\(store.nearBudgetProjectCount) near cap"
        }
        if store.budgetedProjectCount > 0 {
            return "\(store.budgetedProjectCount) budgeted"
        }
        return nil
    }

    private var budgetLabelColor: Color {
        if store.overBudgetProjectCount > 0 { return Fleet.Color.failure }
        if store.nearBudgetProjectCount > 0 { return Fleet.Color.warning }
        return .secondary
    }

    private var telemetryLabel: String {
        var segments: [String] = []
        if store.exactCountToday > 0 {
            segments.append("\(store.exactCountToday) exact session\(store.exactCountToday == 1 ? "" : "s")")
        }
        if store.estimatedCountToday > 0 {
            segments.append("\(store.estimatedCountToday) legacy estimated")
        }
        return segments.joined(separator: " · ")
    }

    // MARK: - Project Bars

    private var liveProjectBars: some View {
        VStack(spacing: Fleet.Space.s) {
            ForEach(store.liveProjects) { project in
                ProjectCostBar(
                    project: project,
                    fallbackReference: liveReference
                )
            }
        }
        .padding(.top, Fleet.Space.xs)
    }

    private var historicalSpendSection: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Text("Historical spend labels")
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(.secondary)

            Text("From /metrics/cost historical telemetry, including legacy estimates. These are not current fleets.")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)

            VStack(spacing: Fleet.Space.s) {
                ForEach(store.historicalBuckets) { project in
                    ProjectCostBar(
                        project: project,
                        fallbackReference: historicalReference
                    )
                }
            }
        }
        .padding(.top, Fleet.Space.xs)
    }

    // MARK: - No Data State

    private var noDataState: some View {
        HStack {
            Image(systemName: "chart.bar")
                .font(.system(size: 14))
                .foregroundStyle(.quaternary)
            Text("No spend data yet")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Fleet.Space.xs)
    }
}

// MARK: - Project Cost Bar

struct ProjectCostBar: View {
    let project: ProjectCostStatus
    let fallbackReference: Double

    private var reference: Double {
        project.budgetUsdPerDay ?? fallbackReference
    }

    private var fraction: Double {
        guard reference > 0 else { return 0 }
        return min(project.totalUsd / reference, 1.0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: Fleet.Space.s) {
                Text(project.displayName)
                    .font(.system(.caption, design: .monospaced).weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                if project.category == .historicalLabel {
                    Text("history")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                Text(amountLabel)
                    .font(.system(.caption, design: .monospaced).weight(.medium))
                    .foregroundStyle(project.overBudget ? Fleet.Color.failure : .secondary)
            }

            if project.category == .historicalLabel, let projectDir = project.projectDir, !projectDir.isEmpty {
                Text(projectDir)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(Color.primary.opacity(0.06))
                        .frame(height: 3)

                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(barColor)
                        .frame(width: max(geo.size.width * fraction, 2), height: 3)
                }
            }
            .frame(height: 3)
        }
    }

    private var amountLabel: String {
        if let budget = project.budgetUsdPerDay {
            return String(format: "$%.2f / $%.2f", project.totalUsd, budget)
        }
        return String(format: "$%.2f", project.totalUsd)
    }

    private var barColor: Color {
        if project.overBudget { return Fleet.Color.failure }
        if let percentUsed = project.percentUsed, percentUsed >= 80 { return Fleet.Color.warning }
        if project.budgetUsdPerDay != nil { return Fleet.Color.healthy }
        return Fleet.Color.active
    }
}
