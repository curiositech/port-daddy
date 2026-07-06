import SwiftUI

struct CloudFleetSection: View {
    @ObservedObject var store: CloudFleetStore
    let localProjects: [FleetProject]
    let localDaemonURL: String?
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            header
            scopeStrip
            metrics
            recentCloudActivity

            if let err = store.lastError {
                errorBanner(err)
            }
        }
        .padding(compact ? Fleet.Space.l : Fleet.Space.xl)
        .background(Fleet.Chrome.panel)
        .task { await store.refresh() }
    }

    private var header: some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: "cloud")
                .font(.body.weight(.semibold))
                .foregroundStyle(Fleet.Color.active)
            VStack(alignment: .leading, spacing: 2) {
                Text("Cloud Fleet")
                    .font(compact ? .caption.weight(.semibold) : .system(size: 18, weight: .semibold))
                Text("Local daemon state beside remote GitHub App and Worker activity")
                    .font(compact ? .caption2 : .system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button {
                Task { await store.refresh() }
            } label: {
                Label(store.isRefreshing ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.borderless)
            .foregroundStyle(Fleet.Color.active)
            .disabled(store.isRefreshing)
        }
    }

    private var scopeStrip: some View {
        HStack(spacing: Fleet.Space.s) {
            scopeChip(
                title: "Local",
                value: localDaemonURL ?? "daemon offline",
                icon: "desktopcomputer",
                color: localDaemonURL == nil ? Fleet.Color.failure : Fleet.Color.healthy
            )
            scopeChip(
                title: "Cloud",
                value: store.routeMissing ? "route missing" : "telemetry ledger",
                icon: "cloud.fill",
                color: store.routeMissing ? Fleet.Color.failure : Fleet.Color.active
            )
            scopeChip(
                title: "Write policy",
                value: "approval gated",
                icon: "hand.raised.fill",
                color: Fleet.Color.warning
            )
        }
    }

    private var metrics: some View {
        HStack(spacing: Fleet.Space.s) {
            metricCard(title: "local projects", value: "\(localProjects.count)", tint: Fleet.Color.healthy)
            metricCard(title: "local active", value: "\(localProjects.reduce(0) { $0 + $1.activeCount })", tint: Fleet.Color.active)
            metricCard(title: "cloud events", value: "\(store.summary?.totals.events ?? 0)", tint: store.hasCloudActivity ? Fleet.Color.active : Fleet.Color.dormant)
            metricCard(title: "cloud cost", value: formatCost(store.summary?.totals.costUsd), tint: Fleet.Color.warning)
        }
    }

    @ViewBuilder
    private var recentCloudActivity: some View {
        if let summary = store.summary, !summary.recent.isEmpty {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                Text("Recent cloud runs")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(summary.recent.prefix(compact ? 3 : 8)) { event in
                    cloudEventRow(event)
                }
            }
        } else {
            emptyCloudCard
        }
    }

    private var emptyCloudCard: some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: store.routeMissing ? "exclamationmark.triangle.fill" : "tray")
                .foregroundStyle(store.routeMissing ? Fleet.Color.failure : Fleet.Color.dormant)
            Text(store.routeMissing ? "This daemon does not expose Cloud Fleet telemetry yet." : "No cloud fleet events recorded in the last 24 hours.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Fleet.Space.m)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func cloudEventRow(_ event: CloudFleetTelemetryEvent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.s) {
            Circle()
                .fill(event.conclusion == "failure" || event.status == "error" ? Fleet.Color.failure : Fleet.Color.active)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Fleet.Space.xs) {
                    Text(event.ship ?? event.role ?? "cloud ship")
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                    Text(event.repoDisplay)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    if let prNumber = event.prNumber {
                        Text("#\(prNumber)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Fleet.Color.active)
                    }
                }
                Text([event.event, event.action, event.status, event.conclusion].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Text(Date(timeIntervalSince1970: event.ts / 1000), style: .relative)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func scopeChip(title: String, value: String, icon: String, color: Color) -> some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 1) {
                Text(title.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                Text(value)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 7)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .strokeBorder(color.opacity(0.22), lineWidth: 1)
        )
    }

    private func metricCard(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Fleet.Space.s)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func errorBanner(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(Fleet.Color.warning)
            .padding(Fleet.Space.s)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Fleet.Color.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func formatCost(_ value: Double?) -> String {
        guard let value else { return "$0.00" }
        return String(format: "$%.2f", value)
    }
}
