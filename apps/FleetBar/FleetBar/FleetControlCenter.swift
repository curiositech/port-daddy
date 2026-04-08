import SwiftUI

struct FleetControlCenter: View {
    @ObservedObject var store: FleetStore
    @ObservedObject var costStore: CostStore
    @Environment(\.openURL) private var openURL

    @AppStorage(FleetControlRoute.surfaceKey) private var selectedSurfaceRaw = FleetControlSurface.flow.rawValue
    @AppStorage(FleetControlRoute.projectKey) private var selectedProjectStorage = ""
    @AppStorage(FleetControlRoute.agentKey) private var selectedAgentStorage = ""
    @AppStorage("fleet.control.theme") private var selectedThemeRaw = "dark"

    @State private var reloadToken = UUID()
    @State private var webLoading = true
    @State private var webError: String?
    @State private var showingAddProject = false

    private var selectedSurface: FleetControlSurface {
        get { FleetControlSurface(rawValue: selectedSurfaceRaw) ?? .flow }
        nonmutating set { selectedSurfaceRaw = newValue.rawValue }
    }

    private var selectedProjectId: String? {
        get { selectedProjectStorage.isEmpty ? nil : selectedProjectStorage }
        nonmutating set { selectedProjectStorage = newValue ?? "" }
    }

    private var selectedProjectLabel: String {
        guard let selectedProjectId else { return "All projects" }
        return store.projects.first(where: { $0.id == selectedProjectId })?.name ?? selectedProjectId
    }

    private var selectedProject: FleetProject? {
        guard let selectedProjectId else { return nil }
        return store.projects.first(where: { $0.id == selectedProjectId })
    }

    private var selectedAgent: String? {
        get { selectedAgentStorage.isEmpty ? nil : selectedAgentStorage }
        nonmutating set { selectedAgentStorage = newValue ?? "" }
    }

    private var selectedTheme: String {
        get { selectedThemeRaw == "light" ? "light" : "dark" }
        nonmutating set { selectedThemeRaw = newValue == "light" ? "light" : "dark" }
    }

    private var embeddedControlPlaneURL: URL? {
        guard var components = URLComponents(string: "\(store.daemonURL)/fleet-ui/") else {
            return nil
        }

        var queryItems = [
            URLQueryItem(name: "daemon", value: store.daemonURL),
            URLQueryItem(name: "surface", value: selectedSurface.rawValue),
            URLQueryItem(name: "embed", value: "fleetbar"),
            URLQueryItem(name: "theme", value: selectedTheme),
        ]
        if let selectedProjectId, !selectedProjectId.isEmpty {
            queryItems.append(URLQueryItem(name: "project", value: selectedProjectId))
        }
        if let selectedAgent, !selectedAgent.isEmpty {
            queryItems.append(URLQueryItem(name: "agent", value: selectedAgent))
        }
        components.queryItems = queryItems
        return components.url
    }

    private var browserControlPlaneURL: URL? {
        guard var components = URLComponents(string: "\(store.daemonURL)/fleet-ui/") else {
            return nil
        }

        var queryItems = [
            URLQueryItem(name: "daemon", value: store.daemonURL),
            URLQueryItem(name: "surface", value: selectedSurface.rawValue),
            URLQueryItem(name: "theme", value: selectedTheme),
        ]
        if let selectedProjectId, !selectedProjectId.isEmpty {
            queryItems.append(URLQueryItem(name: "project", value: selectedProjectId))
        }
        if let selectedAgent, !selectedAgent.isEmpty {
            queryItems.append(URLQueryItem(name: "agent", value: selectedAgent))
        }
        components.queryItems = queryItems
        return components.url
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Divider()
            content
        }
        .frame(minWidth: 1120, minHeight: 720)
        .background(Fleet.Chrome.popoverBackground)
        .preferredColorScheme(selectedTheme == "light" ? .light : .dark)
        .task {
            await refreshAll()
        }
        .onAppear {
            FleetBarAppChrome.presentControlCenter()
        }
        .onDisappear {
            FleetBarAppChrome.setDockVisible(false)
        }
        .onReceive(store.$projects) { _ in
            syncProjectSelection()
        }
    }

    private var topBar: some View {
        HStack(spacing: Fleet.Space.m) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Fleet Control Center")
                    .font(.system(size: 18, weight: .semibold))
                HStack(spacing: 6) {
                    Text("Native shell over the live control plane")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let selectedProjectId,
                       let project = store.projects.first(where: { $0.id == selectedProjectId }) {
                        Text("·")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text(project.name)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }

            projectMenu

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Fleet.Space.xs) {
                    ForEach(FleetControlSurface.allCases) { surface in
                        Button {
                            selectedSurface = surface
                        } label: {
                            Label(surface.title, systemImage: surface.icon)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(selectedSurface == surface ? .primary : .secondary)
                                .padding(.horizontal, Fleet.Space.m)
                                .padding(.vertical, 7)
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
            }

            Spacer()

            HStack(spacing: Fleet.Space.xs) {
                statusBadge(
                    title: store.isDaemonRunning ? "Daemon" : "Offline",
                    value: store.daemonLabel,
                    color: store.isDaemonRunning ? Fleet.Color.healthy : Fleet.Color.failure
                )
                statusBadge(
                    title: "Spend",
                    value: String(format: "$%.2f", costStore.todaySpend),
                    color: costStore.overBudgetProjectCount > 0
                        ? Fleet.Color.failure
                        : costStore.nearBudgetProjectCount > 0
                            ? Fleet.Color.warning
                            : Fleet.Color.active
                )
                statusBadge(
                    title: "Agents",
                    value: "\(store.totalActive)/\(store.totalAgents)",
                    color: store.totalActive > 0 ? Fleet.Color.active : Fleet.Color.dormant
                )
            }

            ActionPill(
                title: selectedTheme == "dark" ? "Light" : "Dark",
                systemImage: selectedTheme == "dark" ? "sun.max" : "moon",
                color: Fleet.Color.active
            ) {
                selectedTheme = selectedTheme == "dark" ? "light" : "dark"
                reloadToken = UUID()
            }

            ActionPill(
                title: store.isDaemonRunning ? "Reload" : "Start",
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
                title: "Add Project",
                systemImage: "plus",
                color: Fleet.Color.healthy
            ) {
                showingAddProject = true
            }

            ActionPill(
                title: "Browser",
                systemImage: "safari",
                color: Fleet.Color.warning,
                action: openInBrowser
            )
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, 10)
        .sheet(isPresented: $showingAddProject) {
            FleetAddProjectSheet()
        }
    }

    private var content: some View {
        ZStack {
            if store.isDaemonRunning, let embeddedControlPlaneURL {
                FleetControlPlaneWebView(
                    url: embeddedControlPlaneURL,
                    reloadToken: reloadToken,
                    isLoading: $webLoading,
                    errorMessage: $webError
                )
                .padding(.horizontal, Fleet.Space.s)
                .padding(.vertical, Fleet.Space.xs)
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
                .font(.system(.caption2, design: .monospaced).weight(.medium))
                .foregroundStyle(color)
        }
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 6)
        .background(
            Color.primary.opacity(0.05),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
    }

    private var projectMenu: some View {
        Menu {
            Button {
                chooseProject(nil)
            } label: {
                Label("All projects", systemImage: "square.grid.2x2")
            }

            if !store.projects.isEmpty {
                Divider()
                ForEach(store.projects) { project in
                    Button {
                        chooseProject(project.id)
                    } label: {
                        HStack {
                            Image(systemName: project.id == selectedProjectId ? "checkmark.circle.fill" : "folder")
                            Text(project.name)
                            Spacer()
                            Text("\(project.agents.count)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Divider()
            Button {
                showingAddProject = true
            } label: {
                Label("Add project…", systemImage: "plus")
            }
        } label: {
            HStack(spacing: Fleet.Space.xs) {
                Image(systemName: selectedProjectId == nil ? "square.grid.2x2" : "folder")
                    .font(.caption.weight(.semibold))
                Text(selectedProjectLabel)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, Fleet.Space.m)
            .padding(.vertical, Fleet.Space.s)
            .background(
                Color.primary.opacity(0.05),
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )
        }
        .menuStyle(.borderlessButton)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func chooseProject(_ projectId: String?) {
        selectedProjectId = projectId
        selectedAgent = nil
        reloadToken = UUID()
    }

    private func syncProjectSelection() {
        guard !store.projects.isEmpty else {
            selectedProjectId = nil
            selectedAgent = nil
            return
        }

        if let selectedProjectId, store.projects.contains(where: { $0.id == selectedProjectId }) {
            if let selectedAgent,
               let project = store.projects.first(where: { $0.id == selectedProjectId }),
               !project.agents.contains(where: { $0.name == selectedAgent }) {
                self.selectedAgent = nil
            }
            return
        }

        if selectedProjectStorage.isEmpty {
            selectedProjectId = nil
        } else {
            selectedProjectId = store.projects.first?.id
        }
        selectedAgent = nil
    }

    private func refreshAll() async {
        await store.refresh()
        await costStore.refresh()
        syncProjectSelection()
    }

    private func openInBrowser() {
        guard let browserControlPlaneURL else { return }
        openURL(browserControlPlaneURL)
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

private struct FleetAddProjectSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var copiedCommand: String?

    private let recommendedPath = "<project-dir>"
    private let quickstartCommands: [(title: String, caption: String, command: String)] = [
        (
            title: "Full onboarding",
            caption: "Scaffold Port Daddy, starter fleet, hooks, and MCP in one pass.",
            command: "cd <project-dir>\npd init"
        ),
        (
            title: "Starter fleet only",
            caption: "Create pd-fleet.yml plus the post-commit trigger without touching editor integration.",
            command: "cd <project-dir>\npd fleet init"
        ),
        (
            title: "Start background agents",
            caption: "Make the project show up in Fleet Control Center by starting its fleet on this daemon.",
            command: "cd <project-dir>\npd fleet up"
        ),
        (
            title: "Install MCP + skill",
            caption: "Attach Port Daddy to Claude/Cursor/Windsurf after the project itself is ready.",
            command: "pd mcp install"
        ),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.l) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Add Project To Port Daddy")
                        .font(.title3.weight(.semibold))
                    Text("A project becomes real in the control center once it has a `pd-fleet.yml` and that fleet is started on this daemon.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") {
                    dismiss()
                }
                .buttonStyle(.borderless)
            }

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                Text("Recommended path")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text("1. Pick a repo folder.\n2. Run `pd init` there.\n3. Run `pd fleet up` in that repo.\n4. Reopen or reload Fleet Control Center.")
                    .font(.body)
                    .foregroundStyle(.primary)
            }

            ForEach(quickstartCommands, id: \.title) { item in
                VStack(alignment: .leading, spacing: Fleet.Space.s) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.headline)
                            Text(item.caption)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(copiedCommand == item.title ? "Copied" : "Copy") {
                            copyToPasteboard(item.command)
                            copiedCommand = item.title
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    Text(item.command.replacingOccurrences(of: recommendedPath, with: "<project-dir>"))
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Fleet.Space.m)
                        .background(
                            Color.primary.opacity(0.05),
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                        )
                }
            }

            Text("Cold-start note: `pd fleet init` only writes the starter files. The project will not appear in the live fleet list until `pd fleet up` starts it on this daemon.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)
        }
        .padding(Fleet.Space.xxl)
        .frame(minWidth: 760, minHeight: 560)
        .background(Fleet.Chrome.popoverBackground)
    }

    private func copyToPasteboard(_ string: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(string, forType: .string)
    }
}
