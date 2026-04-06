import SwiftUI

struct FleetControlCenter: View {
    @ObservedObject var store: FleetStore
    @ObservedObject var costStore: CostStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Fleet.Space.l) {
                header
                controlStrip
                CostDashboard(store: costStore)
                daemonTruth
                projectsSection
            }
            .padding(Fleet.Space.xxl)
        }
        .frame(minWidth: 860, minHeight: 620)
        .background(.regularMaterial)
        .task {
            await store.refresh()
            await costStore.refresh()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Text("Fleet Control Center")
                .font(.system(size: 24, weight: .semibold))

            HStack(spacing: Fleet.Space.s) {
                Label(store.isDaemonRunning ? "Daemon live" : "Daemon offline",
                      systemImage: store.isDaemonRunning ? "dot.radiowaves.left.and.right" : "bolt.slash")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(store.isDaemonRunning ? Fleet.Color.healthy : Fleet.Color.failure)

                Text(store.daemonLabel)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)

                Text(store.isCanonicalDaemon ? "stable 9876" : "custom daemon")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(store.isCanonicalDaemon ? Fleet.Color.active : Fleet.Color.warning)
                    .padding(.horizontal, Fleet.Space.s)
                    .padding(.vertical, 4)
                    .background(
                        (store.isCanonicalDaemon ? Fleet.Color.active : Fleet.Color.warning).opacity(0.1),
                        in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                    )
            }

            Text("Native fleet controls stay pointed at one daemon. Stable 9876 is the default operator surface; dev daemons should only be used when you explicitly opt into them.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var controlStrip: some View {
        HStack(spacing: Fleet.Space.m) {
            ActionButton(
                title: store.isDaemonRunning ? "Reload Fleet" : "Start Daemon",
                subtitle: store.isDaemonRunning ? "Refresh configs and status" : "Kick the launch agent or CLI",
                icon: store.isDaemonRunning ? "arrow.clockwise" : "play.fill",
                color: store.isDaemonRunning ? Fleet.Color.active : Fleet.Color.healthy
            ) {
                Task {
                    if store.isDaemonRunning {
                        await store.reloadFleet()
                        await costStore.refresh()
                    } else {
                        store.startDaemon()
                    }
                }
            }

            ActionButton(
                title: store.projects.isEmpty ? "Start Fleet" : "Stop Fleet",
                subtitle: store.projects.isEmpty ? "Start registered project fleets" : "Stop the registered fleets",
                icon: store.projects.isEmpty ? "bolt.fill" : "stop.fill",
                color: store.projects.isEmpty ? Fleet.Color.healthy : Fleet.Color.failure
            ) {
                Task {
                    if store.projects.isEmpty {
                        await store.startFleet()
                    } else {
                        await store.stopFleet()
                    }
                    await costStore.refresh()
                }
            }

            ActionButton(
                title: "Refresh Spend",
                subtitle: "Pull live cost and budget state",
                icon: "dollarsign.circle",
                color: Fleet.Color.warning
            ) {
                Task { await costStore.refresh() }
            }
        }
    }

    private var daemonTruth: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Text("Operator truth")
                .font(.headline)

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                TruthRow(
                    title: "Connection",
                    message: store.isConnected ? "Live SSE stream attached." : "Polling fallback or disconnected.",
                    tone: store.isConnected ? Fleet.Color.healthy : Fleet.Color.warning
                )
                TruthRow(
                    title: "Project count",
                    message: "\(store.projects.count) project fleets loaded, \(store.totalAgents) total agents, \(store.totalActive) active right now.",
                    tone: store.totalActive > 0 ? Fleet.Color.active : Fleet.Color.dormant
                )
                TruthRow(
                    title: "Default target",
                    message: store.isCanonicalDaemon
                        ? "This companion is pointed at the canonical stable daemon."
                        : "This companion is pointed at a non-canonical daemon. That should be an intentional override, not the default state.",
                    tone: store.isCanonicalDaemon ? Fleet.Color.active : Fleet.Color.warning
                )
            }
        }
        .padding(Fleet.Space.l)
        .background(
            Color.primary.opacity(0.03),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
    }

    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            Text("Project fleets")
                .font(.headline)

            if store.projects.isEmpty {
                RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    .fill(Color.primary.opacity(0.03))
                    .overlay(
                        VStack(alignment: .leading, spacing: Fleet.Space.s) {
                            Text("No registered fleets")
                                .font(.subheadline.weight(.semibold))
                            Text("Add a pd-fleet.yml to a project and register it with the stable daemon. The menu bar should show one coherent fleet, not a split-brain view across multiple daemons.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(Fleet.Space.l)
                    )
                    .frame(height: 120)
            } else {
                LazyVStack(spacing: Fleet.Space.m) {
                    ForEach(store.projects) { project in
                        ProjectSnapshotCard(project: project)
                    }
                }
            }
        }
    }
}

private struct ActionButton: View {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                Image(systemName: icon)
                    .foregroundStyle(color)
                    .font(.system(size: 16, weight: .semibold))
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Fleet.Space.l)
            .background(
                color.opacity(0.08),
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct TruthRow: View {
    let title: String
    let message: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tone)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ProjectSnapshotCard: View {
    let project: FleetProject

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.id)
                        .font(.headline)
                    if let startedAt = project.startedAt {
                        Text("Started \(startedAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                HStack(spacing: Fleet.Space.s) {
                    SnapshotBadge(count: project.activeCount, label: "active", color: Fleet.Color.healthy)
                    SnapshotBadge(count: project.idleCount, label: "idle", color: Fleet.Color.dormant)
                    if project.failedCount > 0 {
                        SnapshotBadge(count: project.failedCount, label: "failed", color: Fleet.Color.failure)
                    }
                }
            }

            Divider()

            LazyVStack(spacing: Fleet.Space.s) {
                ForEach(project.agents) { agent in
                    HStack {
                        Image(systemName: Fleet.agentIcon(for: agent.name))
                            .foregroundStyle(agent.status == .running ? Fleet.Color.healthy : agent.status == .failed ? Fleet.Color.failure : .secondary)
                            .frame(width: 18)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(agent.name)
                                .font(.subheadline.weight(.medium))
                            Text(agent.status.rawValue)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        if let lastEvent = agent.lastEvent {
                            Text(lastEvent.replacingOccurrences(of: "_", with: " "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(Fleet.Space.l)
        .background(
            Color.primary.opacity(0.03),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
    }
}

private struct SnapshotBadge: View {
    let count: Int
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(count)")
                .font(.system(.caption, design: .rounded).weight(.bold))
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 6)
        .background(
            color.opacity(0.08),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
        )
    }
}

#Preview {
    FleetControlCenter(store: FleetStore(), costStore: CostStore())
}
