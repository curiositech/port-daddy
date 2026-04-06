import SwiftUI

// MARK: - Cost Dashboard
//
// One glance should answer:
// how much today, how fast it is burning, and which fleet projects
// are near or over their actual configured ceilings.

struct CostDashboard: View {
    @ObservedObject var store: CostStore

    private var unbudgetedReference: Double {
        let maxSpend = store.byProject
            .filter { $0.budgetUsdPerDay == nil }
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
                if !store.byProject.isEmpty {
                    projectBars
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.m)
        .background(.ultraThinMaterial)
    }

    // MARK: - Hero Number

    private var heroNumber: some View {
        Text(spendFormatted)
            .font(.system(size: 32, weight: .medium, design: .monospaced))
            .foregroundStyle(spendColor)
            .contentTransition(.numericText())
    }

    private var spendFormatted: String {
        String(format: "$%.2f", store.todaySpend)
    }

    private var spendColor: Color {
        if store.overBudgetProjectCount > 0 { return Fleet.Color.failure }
        if store.nearBudgetProjectCount > 0 { return Fleet.Color.warning }
        return .secondary
    }

    // MARK: - Burn Rate Line

    private var burnRateLine: some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: "flame")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)

            Text("burning \(store.burnRateString)")
                .font(.caption)
                .foregroundStyle(.secondary)

            Image(systemName: "circle.fill")
                .font(.system(size: 3))
                .foregroundStyle(.quaternary)

            Text("\(store.spawnCountToday) spawns today")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let budgetLabel {
                Image(systemName: "circle.fill")
                    .font(.system(size: 3))
                    .foregroundStyle(.quaternary)

                Text(budgetLabel)
                    .font(.caption)
                    .foregroundStyle(budgetLabelColor)
            }
        }
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

    // MARK: - Project Bars

    private var projectBars: some View {
        VStack(spacing: Fleet.Space.s) {
            ForEach(store.byProject) { project in
                ProjectCostBar(
                    project: project,
                    fallbackReference: unbudgetedReference
                )
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
                Text(project.projectName)
                    .font(.system(.caption, design: .monospaced).weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer()

                Text(amountLabel)
                    .font(.system(.caption, design: .monospaced).weight(.medium))
                    .foregroundStyle(project.overBudget ? Fleet.Color.failure : .secondary)
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
