import SwiftUI

struct FleetControlCenter: View {
    @ObservedObject var store: FleetStore
    @ObservedObject var costStore: CostStore
    @Environment(\.openURL) private var openURL

    @AppStorage(FleetControlRoute.surfaceKey) private var selectedSurfaceRaw = FleetControlSurface.flow.rawValue
    @AppStorage(FleetControlRoute.projectKey) private var selectedProjectStorage = ""

    @State private var reloadToken = UUID()
    @State private var webLoading = true
    @State private var webError: String?

    private var selectedSurface: FleetControlSurface {
        get { FleetControlSurface(rawValue: selectedSurfaceRaw) ?? .flow }
        nonmutating set { selectedSurfaceRaw = newValue.rawValue }
    }

    private var selectedProjectId: String? {
        get { selectedProjectStorage.isEmpty ? nil : selectedProjectStorage }
        nonmutating set { selectedProjectStorage = newValue ?? "" }
    }

    private var selectedProjectLabel: String {
        selectedProjectId ?? "All projects"
    }

    private var controlPlaneURL: URL? {
        guard var components = URLComponents(string: "\(store.daemonURL)/fleet-ui/") else {
            return nil
        }

        var queryItems = [
            URLQueryItem(name: "daemon", value: store.daemonURL),
            URLQueryItem(name: "surface", value: selectedSurface.rawValue),
        ]
        if let selectedProjectId, !selectedProjectId.isEmpty {
            queryItems.append(URLQueryItem(name: "project", value: selectedProjectId))
        }
        components.queryItems = queryItems
        return components.url
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Divider()
            surfaceStrip
            Divider()
            content
        }
        .frame(minWidth: 1180, minHeight: 780)
        .background(Fleet.Chrome.popoverBackground)
        .task {
            await refreshAll()
        }
        .onReceive(store.$projects) { _ in
            syncProjectSelection()
        }
    }

    private var topBar: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack(alignment: .center, spacing: Fleet.Space.m) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Fleet Control Center")
                        .font(.system(size: 24, weight: .semibold))

                    Text("One native shell around the real control plane. Flow, YAML, inbox, and sorties should all come from the same daemon-backed surface.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                HStack(spacing: Fleet.Space.s) {
                    statusBadge(
                        title: store.isDaemonRunning ? "Daemon live" : "Daemon offline",
                        value: store.daemonLabel,
                        color: store.isDaemonRunning ? Fleet.Color.healthy : Fleet.Color.failure
                    )
                    statusBadge(
                        title: "Spend today",
                        value: String(format: "$%.2f", costStore.todaySpend),
                        color: costStore.overBudgetProjectCount > 0
                            ? Fleet.Color.failure
                            : costStore.nearBudgetProjectCount > 0
                                ? Fleet.Color.warning
                                : Fleet.Color.active
                    )
                    statusBadge(
                        title: "Agents",
                        value: "\(store.totalActive) active / \(store.totalAgents)",
                        color: store.totalActive > 0 ? Fleet.Color.active : Fleet.Color.dormant
                    )
                }
            }

            HStack(spacing: Fleet.Space.m) {
                Menu {
                    Button("All projects") {
                        selectedProjectId = nil
                    }
                    Divider()
                    ForEach(store.projects) { project in
                        Button(project.id) {
                            selectedProjectId = project.id
                        }
                    }
                } label: {
                    Label(selectedProjectLabel, systemImage: "folder")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, Fleet.Space.m)
                        .padding(.vertical, Fleet.Space.s)
                        .background(
                            Color.primary.opacity(0.05),
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                        )
                }
                .buttonStyle(.plain)

                Text(store.isCanonicalDaemon ? "Stable 9876" : "Custom daemon")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(store.isCanonicalDaemon ? Fleet.Color.active : Fleet.Color.warning)
                    .padding(.horizontal, Fleet.Space.s)
                    .padding(.vertical, 6)
                    .background(
                        (store.isCanonicalDaemon ? Fleet.Color.active : Fleet.Color.warning).opacity(0.1),
                        in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                    )

                Spacer()

                ActionPill(
                    title: store.isDaemonRunning ? "Reload" : "Start daemon",
                    systemImage: store.isDaemonRunning ? "arrow.clockwise" : "play.fill",
                    color: store.isDaemonRunning ? Fleet.Color.active : Fleet.Color.healthy
                ) {
                    Task {
                        if store.isDaemonRunning {
                            await refreshAll()
                            reloadToken = UUID()
                        } else {
                            store.startDaemon()
                        }
                    }
                }

                ActionPill(
                    title: "Browser",
                    systemImage: "safari",
                    color: Fleet.Color.warning,
                    action: openInBrowser
                )
            }
        }
        .padding(Fleet.Space.xxl)
    }

    private var surfaceStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Fleet.Space.s) {
                ForEach(FleetControlSurface.allCases) { surface in
                    Button {
                        selectedSurface = surface
                    } label: {
                        Label(surface.title, systemImage: surface.icon)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(selectedSurface == surface ? .primary : .secondary)
                            .padding(.horizontal, Fleet.Space.m)
                            .padding(.vertical, Fleet.Space.s)
                            .background(
                                (selectedSurface == surface
                                    ? Fleet.Color.active.opacity(0.14)
                                    : Color.primary.opacity(0.04)),
                                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Fleet.Space.xxl)
            .padding(.vertical, Fleet.Space.m)
        }
    }

    private var content: some View {
        ZStack {
            if store.isDaemonRunning, let controlPlaneURL {
                FleetControlPlaneWebView(
                    url: controlPlaneURL,
                    reloadToken: reloadToken,
                    isLoading: $webLoading,
                    errorMessage: $webError
                )
                .padding(Fleet.Space.l)
            } else {
                offlineState
            }

            if webLoading && store.isDaemonRunning {
                ProgressView("Loading control plane…")
                    .controlSize(.regular)
                    .padding(.horizontal, Fleet.Space.l)
                    .padding(.vertical, Fleet.Space.m)
                    .background(.ultraThinMaterial, in: Capsule())
            }

            if let webError, store.isDaemonRunning {
                VStack {
                    Spacer()
                    errorBanner(message: webError)
                }
                .padding(Fleet.Space.xxl)
            }
        }
    }

    private var offlineState: some View {
        VStack(spacing: Fleet.Space.l) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Fleet.Color.failure)

            Text("Control plane unavailable")
                .font(.title3.weight(.semibold))

            Text("FleetBar is now a native shell for the real `/fleet-ui/` surface. Start the daemon, then this window will load the live flow graph, YAML editor, inbox, and sortie workspace.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 560)

            HStack(spacing: Fleet.Space.m) {
                ActionPill(
                    title: "Start daemon",
                    systemImage: "play.fill",
                    color: Fleet.Color.healthy
                ) {
                    store.startDaemon()
                }

                ActionPill(
                    title: "Retry",
                    systemImage: "arrow.clockwise",
                    color: Fleet.Color.active
                ) {
                    Task { await refreshAll() }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Fleet.Space.xxl)
    }

    private func errorBanner(message: String) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Fleet.Color.warning)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer()
            Button("Retry") {
                reloadToken = UUID()
            }
            .buttonStyle(.borderless)
            .foregroundStyle(Fleet.Color.active)
        }
        .padding(Fleet.Space.m)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func statusBadge(title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.medium))
                .foregroundStyle(color)
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, Fleet.Space.s)
        .background(
            Color.primary.opacity(0.05),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
    }

    private func syncProjectSelection() {
        guard !store.projects.isEmpty else {
            selectedProjectId = nil
            return
        }

        if let selectedProjectId, store.projects.contains(where: { $0.id == selectedProjectId }) {
            return
        }

        selectedProjectId = store.projects.first?.id
    }

    private func refreshAll() async {
        await store.refresh()
        await costStore.refresh()
        syncProjectSelection()
    }

    private func openInBrowser() {
        guard let controlPlaneURL else { return }
        openURL(controlPlaneURL)
    }
}

private struct ActionPill: View {
    let title: String
    let systemImage: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
                .padding(.horizontal, Fleet.Space.m)
                .padding(.vertical, Fleet.Space.s)
                .background(
                    color.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                )
        }
        .buttonStyle(.plain)
    }
}
