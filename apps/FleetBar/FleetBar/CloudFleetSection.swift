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
            liveRuns
            selectedTranscript

            if let err = store.lastError {
                errorBanner(err)
            }
        }
        .padding(compact ? Fleet.Space.l : Fleet.Space.xl)
        .background(Fleet.Chrome.panel)
        .task {
            if store.lastRefresh == nil && !store.isRefreshing {
                await store.refresh()
            }
        }
    }

    private var header: some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: "cloud")
                .font(.body.weight(.semibold))
                .foregroundStyle(Fleet.Color.active)
            VStack(alignment: .leading, spacing: 2) {
                Text("Cloud Fleet")
                    .font(compact ? .caption.weight(.semibold) : .system(size: 18, weight: .semibold))
                Text("Live delivery state, timing estimates, failures, and durable executor transcripts")
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
                value: store.accountLabel,
                icon: store.needsReauthentication ? "person.crop.circle.badge.exclamationmark" : "cloud.fill",
                color: store.needsReauthentication || store.isSignedOut ? Fleet.Color.failure : Fleet.Color.active
            )
            scopeChip(
                title: "Safety",
                value: "read-only · account scoped",
                icon: "lock.shield.fill",
                color: Fleet.Color.healthy
            )
        }
    }

    private var metrics: some View {
        HStack(spacing: Fleet.Space.s) {
            metricCard(title: "local projects", value: "\(localProjects.count)", tint: Fleet.Color.healthy)
            metricCard(
                title: "cloud active",
                value: "\(store.activeRuns.count)",
                tint: store.activeRuns.isEmpty ? Fleet.Color.dormant : Fleet.Color.active
            )
            metricCard(
                title: "queue est.",
                value: store.health?.queueDepthEstimate.map(String.init) ?? "—",
                tint: (store.health?.queueDepthEstimate ?? 0) > 0 ? Fleet.Color.warning : Fleet.Color.dormant
            )
            metricCard(
                title: "known intents",
                value: store.health.map { String($0.knownIntents) } ?? "—",
                tint: store.hasCloudActivity ? Fleet.Color.active : Fleet.Color.dormant
            )
        }
    }

    @ViewBuilder
    private var liveRuns: some View {
        if store.isSignedOut {
            emptyCloudCard(
                icon: "person.crop.circle.badge.exclamationmark",
                message: "Sign in from FleetBar Credentials to inspect account-scoped Cloud Fleet runs."
            )
        } else if store.needsReauthentication {
            emptyCloudCard(
                icon: "key.slash.fill",
                message: "The saved Cloud Fleet session was rejected. Renew it from FleetBar Credentials."
            )
        } else if !store.runs.isEmpty {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                HStack {
                    Text(store.activeRuns.isEmpty ? "Recent logical runs" : "Live logical runs")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    if store.health?.paused == true {
                        Label("PAUSED", systemImage: "pause.circle.fill")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Fleet.Color.failure)
                    } else if let refreshed = store.lastRefresh {
                        Text("updated \(refreshed, style: .relative)")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                ForEach(store.runs.prefix(compact ? 4 : 12)) { run in
                    cloudRunRow(run)
                }
            }
        } else {
            emptyCloudCard(
                icon: store.isRefreshing ? "arrow.clockwise" : "tray",
                message: store.isRefreshing
                    ? "Reading the durable Cloud Fleet ledger…"
                    : "No Cloud Fleet run receipts are visible for this account yet."
            )
        }
    }

    private func emptyCloudCard(icon: String, message: String) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: icon)
                .foregroundStyle(store.isSignedOut || store.needsReauthentication ? Fleet.Color.warning : Fleet.Color.dormant)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Fleet.Space.m)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func cloudRunRow(_ run: CloudFleetRun) -> some View {
        Button {
            Task { await store.select(run) }
        } label: {
            VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.s) {
                    Circle()
                        .fill(runColor(run))
                        .frame(width: 8, height: 8)
                    Text(run.repo)
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                        .lineLimit(1)
                    Text("#\(run.prNumber)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Fleet.Color.active)
                    if !run.shortSha.isEmpty {
                        Text(run.shortSha)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                    Spacer(minLength: 0)
                    stateBadge(run)
                }
                HStack(spacing: Fleet.Space.s) {
                    Text(run.attemptLabel)
                        .font(.caption2)
                        .foregroundStyle(run.attemptCount > 1 ? Fleet.Color.warning : .secondary)
                    Spacer(minLength: 0)
                    Text(timingSummary(run))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let progress = run.progress() {
                    ProgressView(value: progress)
                        .progressViewStyle(.linear)
                        .tint(runColor(run))
                }
                if let lastError = run.lastError, !lastError.isEmpty {
                    Label(lastError, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(Fleet.Color.failure)
                        .lineLimit(compact ? 1 : 2)
                }
            }
            .padding(.horizontal, Fleet.Space.m)
            .padding(.vertical, Fleet.Space.s)
            .background(
                store.selectedRun?.id == run.id ? Fleet.Color.active.opacity(0.10) : Fleet.Chrome.card,
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    .strokeBorder(
                        store.selectedRun?.id == run.id ? Fleet.Color.active.opacity(0.38) : Color.clear,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var selectedTranscript: some View {
        if let run = store.selectedRun {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Run transcript · #\(run.prNumber)")
                            .font(.caption.weight(.semibold))
                        Text("\(store.steps.count) durable steps · actual timestamps · run-level estimates")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer()
                    if store.isLoadingDetail {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(run.id)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }

                if let detailError = store.detailError {
                    Label(detailError, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Fleet.Color.warning)
                } else if store.steps.isEmpty && !store.isLoadingDetail {
                    Text(run.hasTranscript
                         ? "The durable transcript is not readable yet."
                         : "This legacy receipt did not publish a durable transcript.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    let limit = compact ? 4 : 12
                    let visibleSteps = Array(store.steps.suffix(limit))
                    ForEach(visibleSteps) { step in
                        transcriptStep(step)
                    }
                    if store.steps.count > limit {
                        Text("Showing the latest \(limit) of \(store.steps.count) steps.")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .padding(Fleet.Space.m)
            .background(
                Fleet.Color.active.opacity(0.05),
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    .strokeBorder(Fleet.Color.active.opacity(0.18), lineWidth: 1)
            )
        }
    }

    private func transcriptStep(_ step: CloudFleetStep) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Text(String(format: "%02d", step.seq))
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .foregroundStyle(Fleet.Color.active)
                .frame(width: 24, alignment: .trailing)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: Fleet.Space.xs) {
                    Text(step.title)
                        .font(.caption.weight(.semibold))
                        .lineLimit(compact ? 1 : 2)
                    Spacer(minLength: 0)
                    if let ship = step.ship, !ship.isEmpty {
                        Text(ship)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Fleet.Color.active)
                    }
                }
                Text(step.explanation)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: Fleet.Space.s) {
                    Text("actual \(timestamp(step.createdAt))")
                    Text(step.expectedAt.map { "expected \(timestamp($0))" } ?? "step ETA unavailable")
                }
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, Fleet.Space.s)
        .overlay(alignment: .bottom) {
            Divider().opacity(0.28)
        }
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

    private func stateBadge(_ run: CloudFleetRun) -> some View {
        let terminalConclusion = run.conclusion.flatMap { $0.isEmpty ? nil : $0 }
        let label = run.isActive ? run.state : (terminalConclusion ?? run.state)
        return Text(label.replacingOccurrences(of: "_", with: " ").uppercased())
            .font(.caption2.weight(.bold))
            .foregroundStyle(runColor(run))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(
                runColor(run).opacity(0.10),
                in: Capsule(style: .continuous)
            )
    }

    private func runColor(_ run: CloudFleetRun) -> Color {
        if run.isFailure { return Fleet.Color.failure }
        switch run.state {
        case "running": return Fleet.Color.active
        case "admitting", "queued", "retrying": return Fleet.Color.warning
        case "superseded": return Fleet.Color.dormant
        default:
            return run.conclusion == "success" ? Fleet.Color.healthy : Fleet.Color.dormant
        }
    }

    private func timingSummary(_ run: CloudFleetRun) -> String {
        switch run.state {
        case "admitting":
            return run.expectedStartAt.map { "executor handoff \(timestamp($0))" }
                ?? "admission in progress"
        case "queued":
            let ahead = run.queueAheadEstimate.map { "≈\($0) ahead" }
            let start = run.expectedStartAt.map { "start \(timestamp($0))" }
            return [ahead, start].compactMap { $0 }.joined(separator: " · ").nilIfEmpty ?? "waiting for worker"
        case "running":
            return run.expectedFinishAt.map { "expected finish \(timestamp($0))" }
                ?? "finish estimate pending"
        case "retrying":
            return run.expectedStartAt.map { "retry \(timestamp($0))" }
                ?? "durable retry scheduled"
        case "superseded":
            return run.supersededBy.map { "replaced by \(String($0.prefix(14)))" }
                ?? "replaced by newer head"
        default:
            let finished = run.finishedAt.map { "finished \(timestamp($0))" }
            return [finished, duration(run.elapsedMs)].compactMap { $0 }.joined(separator: " · ")
        }
    }

    private func timestamp(_ epochSeconds: Double) -> String {
        guard epochSeconds > 0 else { return "—" }
        return Date(timeIntervalSince1970: epochSeconds)
            .formatted(.dateTime.month(.abbreviated).day().hour().minute().second())
    }

    private func duration(_ milliseconds: Double) -> String? {
        guard milliseconds > 0 else { return nil }
        let seconds = Int(milliseconds / 1000)
        if seconds >= 3600 {
            return String(format: "%dh %02dm", seconds / 3600, (seconds % 3600) / 60)
        }
        if seconds >= 60 {
            return String(format: "%dm %02ds", seconds / 60, seconds % 60)
        }
        return "\(seconds)s"
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
