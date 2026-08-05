import SwiftUI

struct FleetControlCenter: View {
    @ObservedObject var store: FleetStore
    @ObservedObject var costStore: CostStore
    @ObservedObject var dispatchStore: DispatchStore
    @ObservedObject var proposalStore: FleetProposalStore
    @ObservedObject var backendStore: BackendStore
    @StateObject private var cloudFleetStore = CloudFleetStore()
    @StateObject private var squidHarnessStore = SquidHarnessStore()

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
        guard let project = store.projects.first(where: { $0.id == selectedProjectId }) else {
            return selectedProjectId
        }
        if let worktree = project.worktree, !worktree.isMain, let label = project.worktreeMenuLabel {
            return "\(project.name) · \(label)"
        }
        return project.name
    }

    private var selectedProject: FleetProject? {
        guard let selectedProjectId else { return nil }
        return store.projects.first(where: { $0.id == selectedProjectId })
    }

    private var selectedCostProject: ProjectCostStatus? {
        if let selectedProject {
            return costStore.liveProjects.first(where: { $0.projectDir == selectedProject.projectDir })
                ?? costStore.liveProjects.first(where: { $0.projectName == selectedProject.name })
        }
        return costStore.liveProjects.first(where: { $0.budgetUsdPerDay != nil })
            ?? costStore.liveProjects.first
    }

    private var totalBudgetCap: Double? {
        let total = costStore.liveProjects.compactMap(\.budgetUsdPerDay).reduce(0, +)
        return total > 0 ? total : nil
    }

    private var budgetBadgeValue: String {
        if let selectedProject, selectedProject.needsBudget {
            return "needs cap"
        }
        if let selectedCostProject, let budget = selectedCostProject.budgetUsdPerDay {
            return String(format: "$%.2f / $%.2f", selectedCostProject.totalUsd, budget)
        }
        if let selectedProject, let budget = selectedProject.budgetUsdPerDay {
            return String(format: "$%.2f / $%.2f", 0, budget)
        }
        if selectedProject != nil {
            return "no cap"
        }
        if let totalBudgetCap {
            return String(format: "$%.2f / $%.2f", costStore.todaySpend, totalBudgetCap)
        }
        return String(format: "$%.2f", costStore.todaySpend)
    }

    private var budgetBadgeDetail: String {
        if let selectedProject, selectedProject.needsBudget {
            return selectedProject.operatorNextAction
        }
        if selectedCostProject?.budgetUsdPerDay != nil {
            return "selected fleet daily cap"
        }
        if selectedProject?.budgetUsdPerDay != nil {
            return "configured daily cap"
        }
        if selectedProject != nil {
            return "selected fleet has no cap"
        }
        if let totalBudgetCap {
            return String(format: "all live fleet caps total $%.2f/day", totalBudgetCap)
        }
        return "no live fleet budget cap"
    }

    private var budgetBadgeColor: Color {
        if costStore.overBudgetProjectCount > 0 { return Fleet.Color.failure }
        if costStore.nearBudgetProjectCount > 0 { return Fleet.Color.warning }
        if selectedProject?.needsBudget == true { return Fleet.Color.warning }
        if selectedProject != nil {
            return selectedCostProject?.budgetUsdPerDay != nil || selectedProject?.budgetUsdPerDay != nil
                ? Fleet.Color.healthy
                : Fleet.Color.dormant
        }
        if totalBudgetCap != nil { return Fleet.Color.healthy }
        return Fleet.Color.dormant
    }

    private var selectedAgent: String? {
        get { selectedAgentStorage.isEmpty ? nil : selectedAgentStorage }
        nonmutating set { selectedAgentStorage = newValue ?? "" }
    }

    private var selectedTheme: String {
        get { selectedThemeRaw == "light" ? "light" : "dark" }
        nonmutating set { selectedThemeRaw = newValue == "light" ? "light" : "dark" }
    }

    private var fleetActionTitle: String {
        if let selectedProject {
            if selectedProject.needsBudget { return "Set Budget" }
            if selectedProject.remediation?.action == "fix_yaml" { return "Open YAML" }
            if selectedProject.remediation?.action == "create_fleet" || selectedProject.remediation?.action == "run_scan" { return "Setup" }
            return selectedProject.isRunning ? "Stop Fleet" : "Start Fleet"
        }
        return store.totalActive > 0 ? "Stop All" : "Start All"
    }

    private var fleetActionIcon: String {
        if let selectedProject {
            if selectedProject.needsBudget { return "wallet.pass" }
            if selectedProject.remediation?.action == "fix_yaml" { return "curlybraces" }
            if selectedProject.remediation?.action == "create_fleet" || selectedProject.remediation?.action == "run_scan" { return "wrench.and.screwdriver" }
            return selectedProject.isRunning ? "stop.fill" : "play.fill"
        }
        return store.totalActive > 0 ? "stop.fill" : "play.fill"
    }

    private var fleetActionColor: Color {
        if let selectedProject {
            if selectedProject.needsBudget { return Fleet.Color.warning }
            if selectedProject.remediation?.action == "fix_yaml" { return Fleet.Color.warning }
            if selectedProject.remediation?.action == "create_fleet" || selectedProject.remediation?.action == "run_scan" { return Fleet.Color.active }
            return selectedProject.isRunning ? Fleet.Color.failure : Fleet.Color.healthy
        }
        return store.totalActive > 0 ? Fleet.Color.failure : Fleet.Color.healthy
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
        .onChange(of: selectedProjectStorage) { _, _ in
            Task { await squidHarnessStore.refresh(projectDir: selectedProject?.projectDir) }
        }
    }

    private var topBar: some View {
        VStack(spacing: Fleet.Space.xs) {
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

                Spacer()

                HStack(spacing: Fleet.Space.xs) {
                    statusBadge(
                        title: store.isDaemonRunning ? "Daemon" : "Offline",
                        value: store.daemonLabel,
                        color: store.isDaemonRunning ? Fleet.Color.healthy : Fleet.Color.failure
                    )
                    statusBadge(
                        title: "Budget",
                        value: budgetBadgeValue,
                        color: budgetBadgeColor
                    )
                    statusBadge(
                        title: "Agents",
                        value: "\(store.totalActive)/\(store.totalAgents)",
                        color: store.totalActive > 0 ? Fleet.Color.active : Fleet.Color.dormant
                    )
                }
            }

            if let daemonStatus = store.daemonStatus {
                daemonReportStrip(status: daemonStatus)
            }

            if let selectedProject {
                selectedProjectReadinessStrip(selectedProject)
                SquidHarnessStrip(store: squidHarnessStore, projectDir: selectedProject.projectDir)
            }

            HStack(spacing: Fleet.Space.m) {
                projectMenu
                ScrollView(.horizontal, showsIndicators: false) {
                    surfaceStrip
                }
                Spacer(minLength: 0)
                commandControls
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, 6)
        .sheet(isPresented: $showingAddProject) {
            FleetAddProjectSheet()
        }
    }

    private var commandControls: some View {
        HStack(spacing: Fleet.Space.s) {
            ActionPill(
                title: selectedTheme == "dark" ? "Light" : "Dark",
                systemImage: selectedTheme == "dark" ? "sun.max" : "moon",
                color: Fleet.Color.active
            ) {
                selectedTheme = selectedTheme == "dark" ? "light" : "dark"
                reloadToken = UUID()
            }

            ActionPill(
                title: fleetActionTitle,
                systemImage: fleetActionIcon,
                color: fleetActionColor
            ) {
                Task {
                    if let selectedProject {
                        if selectedProject.needsBudget {
                            await store.setFleetBudget(
                                projectDir: selectedProject.projectDir,
                                usdPerDay: selectedProject.suggestedBudgetUsdPerDay
                            )
                            await costStore.refresh()
                        } else if selectedProject.remediation?.action == "fix_yaml" {
                            selectedSurface = .yaml
                        } else if selectedProject.remediation?.action == "create_fleet"
                            || selectedProject.remediation?.action == "run_scan" {
                            showingAddProject = true
                        } else if selectedProject.isRunning {
                            await store.stopFleet(projectDir: selectedProject.projectDir)
                        } else {
                            await store.startFleet(projectDir: selectedProject.projectDir)
                        }
                    } else if store.totalActive > 0 {
                        await store.stopFleet()
                    } else {
                        await store.startFleet()
                    }
                    reloadToken = UUID()
                }
            }

            ActionPill(
                title: store.isDaemonRunning ? "Reload" : "Start Daemon",
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
                title: "Visual Task",
                systemImage: "viewfinder",
                color: Fleet.Color.healthy
            ) {
                selectedSurface = .visual
                reloadToken = UUID()
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func daemonReportStrip(status: DaemonStatusResponse) -> some View {
        let runtimeState = status.runtime?.state ?? "unknown"
        let runtimeColor: Color = {
            if status.runtime?.degraded == true { return Fleet.Color.warning }
            if runtimeState == "nominal" || status.status == "ok" { return Fleet.Color.healthy }
            return Fleet.Color.failure
        }()
        let bosun = status.guardians?.bosun
        let daemon = status.daemon
        let buildVersion = daemon?.version ?? status.version
        let buildHash = daemon?.codeHash ?? "unknown"
        let recentActivity = status.history?.recentActivity.first
        let recentSpend = status.history?.recentSpend.first
        let recentSpendProject = recentSpend?.projectName
            ?? recentSpend?.projectDir.map { URL(fileURLWithPath: $0).lastPathComponent }
        let recentSummary = recentActivity?.summary
            ?? recentSpend.map { String(format: "$%.3f %@", $0.costUsd, $0.model) }
            ?? "No recent signal"
        let recentDetail = recentActivity?.agentId
            ?? recentActivity?.type.lowercased()
            ?? recentSpendProject
            ?? "history quiet"

        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Fleet.Space.xs) {
                compactTruthMetric(
                    icon: "checkmark.seal",
                    title: "Live Truth",
                    value: runtimeState,
                    detail: bosun?.reason ?? bosun?.state ?? status.uptimeHuman,
                    color: runtimeColor,
                    width: 300
                )

                compactTruthMetric(
                    icon: "shippingbox",
                    title: "Build",
                    value: buildVersion,
                    detail: "\(buildHash) · pid \(status.pid)",
                    color: Fleet.Color.active,
                    width: 220
                )

                compactTruthMetric(
                    icon: "wallet.pass",
                    title: "Budget",
                    value: budgetBadgeValue,
                    detail: budgetBadgeDetail,
                    color: budgetBadgeColor,
                    width: 220
                )

                compactTruthMetric(
                    icon: "waveform.path.ecg",
                    title: "Recent",
                    value: recentSummary,
                    detail: recentDetail,
                    color: recentSpend?.isEstimate == true ? Fleet.Color.warning : Fleet.Color.active,
                    width: 300
                )
            }
        }
        .frame(height: 46)
    }

    private func selectedProjectReadinessStrip(_ project: FleetProject) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: project.statusIcon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(project.statusColor)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Fleet.Space.xs) {
                    Text(project.statusLabel.uppercased())
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(project.statusColor)
                    Text(project.operatorSummary)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
                Text(project.operatorNextAction)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: Fleet.Space.m)

            HStack(spacing: Fleet.Space.xs) {
                statusMiniChip(
                    icon: "person.3",
                    value: "\(project.configuredAgentCount)",
                    detail: "agents",
                    color: project.configuredAgentCount > 0 ? Fleet.Color.active : Fleet.Color.dormant
                )
                statusMiniChip(
                    icon: "eye",
                    value: "\(project.configuredWatcherCount)",
                    detail: "watchers",
                    color: project.configuredWatcherCount > 0 ? Fleet.Color.warning : Fleet.Color.dormant
                )
                statusMiniChip(
                    icon: "wallet.pass",
                    value: formatBudget(project.budgetUsdPerDay),
                    detail: "cap",
                    color: project.needsBudget ? Fleet.Color.warning : (project.budgetUsdPerDay == nil ? Fleet.Color.dormant : Fleet.Color.healthy)
                )
            }
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, 7)
        .background(
            project.statusColor.opacity(0.08),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(project.statusColor.opacity(0.16), lineWidth: 1)
        )
    }

    private func statusMiniChip(icon: String, value: String, detail: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .semibold))
            Text(value)
                .font(.system(.caption2, design: .monospaced).weight(.semibold))
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .foregroundStyle(color)
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 4)
        .background(
            Color.primary.opacity(0.04),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
    }

    private func compactTruthMetric(icon: String, title: String, value: String, detail: String, color: Color, width: CGFloat) -> some View {
        HStack(alignment: .center, spacing: Fleet.Space.xs) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Fleet.Space.xs) {
                    Text(title.uppercased())
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text(value)
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                        .foregroundStyle(color)
                        .lineLimit(1)
                }
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
        }
        .frame(width: width, height: 42, alignment: .leading)
        .padding(.horizontal, Fleet.Space.s)
        .background(
            Fleet.Chrome.card,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
    }

    private var surfaceStrip: some View {
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

    @ViewBuilder
    private var content: some View {
        if selectedSurface.isNative {
            nativeSurfaceContent
        } else {
            embeddedSurfaceContent
        }
    }

    @ViewBuilder
    private var nativeSurfaceContent: some View {
        switch selectedSurface {
        case .proposals:
            FleetProposalSection(store: proposalStore)
        case .cloudfleet:
            ScrollView {
                CloudFleetSection(
                    store: cloudFleetStore,
                    localProjects: store.projects,
                    localDaemonURL: store.daemonURL,
                    compact: false
                )
            }
        case .nightshift:
            FleetControlNightshiftSection(store: dispatchStore)
        case .backend:
            // Backend renders in-process so the operator sees the same
            // BackendStore truth FleetBar's menubar uses, rather than riding
            // the embedded /fleet-ui/ WebView.
            FleetControlBackendSection(store: backendStore)
                .padding(.horizontal, Fleet.Space.l)
                .padding(.vertical, Fleet.Space.m)
        case .galaxy:
            FleetControlGalaxySection(
                daemonURL: store.daemonURL,
                project: selectedProject?.name ?? selectedProjectId
            )
            .padding(.horizontal, Fleet.Space.l)
            .padding(.vertical, Fleet.Space.m)
        default:
            // Fallback should never trigger — every native case must be wired.
            embeddedSurfaceContent
        }
    }

    private var embeddedSurfaceContent: some View {
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

                Text("FleetBar is now a native shell for the real `/fleet-ui/` surface. Start the daemon, then this window will load the live flow graph, YAML editor, inbox, sortie workspace, and semantic memory explorer.")
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

    private func formatBudget(_ budget: Double?) -> String {
        guard let budget else { return "none" }
        return String(format: "$%.0f/d", budget)
    }

    private func projectMenuSort(_ lhs: FleetProject, _ rhs: FleetProject) -> Bool {
        if lhs.sortRank != rhs.sortRank {
            return lhs.sortRank < rhs.sortRank
        }
        if lhs.worktree?.isMain != rhs.worktree?.isMain {
            return lhs.worktree?.isMain == true
        }
        return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }

    private var primaryProjectMenuProjects: [FleetProject] {
        let groups = Dictionary(grouping: store.projects) { project in
            if let worktree = project.worktree, worktree.siblingCount > 1 {
                return worktree.repoKey
            }
            return project.projectDir
        }

        return groups.values.compactMap { projects in
            projects.sorted(by: projectMenuSort).first(where: { $0.operatorState == .running })
                ?? projects.first(where: { $0.worktree?.isMain == true })
                ?? projects.sorted(by: projectMenuSort).first
        }
        .sorted(by: projectMenuSort)
    }

    private func linkedWorktrees(for project: FleetProject) -> [FleetProject] {
        guard let worktree = project.worktree, worktree.siblingCount > 1 else { return [] }
        return store.projects
            .filter { $0.id != project.id && $0.worktree?.repoKey == worktree.repoKey }
            .sorted(by: projectMenuSort)
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
                ForEach(primaryProjectMenuProjects) { project in
                    let linked = linkedWorktrees(for: project)
                    if linked.isEmpty {
                        Button {
                            chooseProject(project.id)
                        } label: {
                            projectMenuRow(project)
                        }
                    } else {
                        Menu {
                            Button {
                                chooseProject(project.id)
                            } label: {
                                Label(project.worktree?.isMain == true ? "Open main worktree" : "Open selected worktree", systemImage: project.statusIcon)
                            }
                            Divider()
                            ForEach(linked) { linkedProject in
                                Button {
                                    chooseProject(linkedProject.id)
                                } label: {
                                    projectMenuRow(linkedProject)
                                }
                            }
                        } label: {
                            projectMenuRow(project, linkedCount: linked.count)
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

    private func projectMenuRow(_ project: FleetProject, linkedCount: Int = 0) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: project.id == selectedProjectId ? "checkmark.circle.fill" : project.statusIcon)
                .foregroundStyle(project.id == selectedProjectId ? Fleet.Color.active : project.statusColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                HStack(spacing: Fleet.Space.xs) {
                    Text(project.worktreeMenuLabel ?? project.statusLabel)
                        .font(.caption2)
                        .foregroundStyle(project.worktreeMenuLabel == nil ? project.statusColor : .secondary)
                    if linkedCount > 0 {
                        Text("+\(linkedCount) linked")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(project.visibleAgentCount)")
                    .font(.system(.caption, design: .monospaced))
                Text(formatBudget(project.budgetUsdPerDay))
                    .font(.caption2)
                    .foregroundStyle(project.needsBudget ? Fleet.Color.warning : .secondary)
            }
        }
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
            selectedProjectId = nil
        }
        selectedAgent = nil
    }

    private func refreshAll() async {
        await store.refresh()
        await costStore.refresh()
        await dispatchStore.refresh()
        await backendStore.refresh()
        await cloudFleetStore.refresh()
        syncProjectSelection()
        await squidHarnessStore.refresh(projectDir: selectedProject?.projectDir)
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
                    Text("FleetBar uses the same project readiness model as the console: `.portdaddyrc` can manage services, and `pd-fleet.yml` manages agent fleets and budgets.")
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
                Text("1. Pick a repo folder.\n2. Run `pd init` there if service config is missing.\n3. Run `pd fleet init` for agents.\n4. Set `limits.budget_usd_per_day` before `pd fleet up`.")
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

            Text("Cold-start note: projects with service-only config still belong in the picker. Agent launches stay blocked until the fleet YAML has a positive daily budget.")
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
