import SwiftUI
import AppKit

private struct RecentAgentHighlight: Identifiable {
    let projectId: String
    let projectDir: String
    let projectName: String
    let agent: FleetAgent

    var id: String { "\(projectId)::\(agent.id)" }
}

private func agentStatusColor(_ status: FleetAgent.AgentStatus) -> Color {
    switch status {
    case .running:
        return Fleet.Color.healthy
    case .queued, .armed, .scheduled, .orphanReconciled:
        return Fleet.Color.active
    case .paused, .salvaged:
        return Fleet.Color.warning
    case .failed:
        return Fleet.Color.failure
    case .dead:
        return Fleet.Color.dead
    case .historical:
        return Fleet.Color.dormant.opacity(0.8)
    case .idle:
        return Fleet.Color.dormant.opacity(0.45)
    }
}

// MARK: - Main Popover

struct FleetPopover: View {
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    @ObservedObject var store: FleetStore
    @ObservedObject var costStore: CostStore
    @ObservedObject var secretsStore: SecretsStore
    @ObservedObject var backendStore: BackendStore
    @StateObject private var budgetStore = BudgetPauseStore()
    @StateObject private var approvalStore = SpawnApprovalStore()
    @StateObject private var berthStore = BerthStore()
    @StateObject private var cloudFleetStore = CloudFleetStore()
    @AppStorage("fleet.control.theme") private var selectedThemeRaw = "dark"
    @State private var appeared = false
    @State private var showingSettings = false

    init(store: FleetStore, costStore: CostStore, secretsStore: SecretsStore = SecretsStore(autoStart: false), backendStore: BackendStore = BackendStore()) {
        self.store = store
        self.costStore = costStore
        self.secretsStore = secretsStore
        self.backendStore = backendStore
    }

    private var recentAgentHighlights: [RecentAgentHighlight] {
        store.projects
            .flatMap { project in
                project.agents.compactMap { agent in
                    let hasSignal = agent.lastActivity != nil
                        || !(agent.lastSummary?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
                        || !agent.recentFiles.isEmpty
                    guard hasSignal else { return nil }
                    return RecentAgentHighlight(
                        projectId: project.id,
                        projectDir: project.projectDir,
                        projectName: project.name,
                        agent: agent
                    )
                }
            }
            .sorted { lhs, rhs in
                let left = lhs.agent.lastActivity ?? .distantPast
                let right = rhs.agent.lastActivity ?? .distantPast
                return left > right
            }
            .prefix(6)
            .map { $0 }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.5)
            ScrollView {
                VStack(spacing: 0) {
                    popoverContent
                }
                .frame(maxWidth: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider().opacity(0.5)
            footer
        }
        .background(Fleet.Chrome.popoverBackground)
        .preferredColorScheme(selectedThemeRaw == "light" ? .light : .dark)
        .onAppear {
            withAnimation(.smooth(duration: 0.4)) { appeared = true }
            budgetStore.start()
            approvalStore.start()
        }
        .onDisappear {
            budgetStore.stop()
            approvalStore.stop()
        }
    }

    @ViewBuilder
    private var popoverContent: some View {
        VStack(spacing: 0) {
            // HITL first: spawns held by the trust gate lead everything else
            // in the dropdown (ADR-0093 — a pending human gate is unmissable).
            SpawnApprovalSection(store: approvalStore)
            if store.versionSkew.needsAttention {
                versionSkewBanner(store.versionSkew)
                Divider().opacity(0.5)
            }
            if !budgetStore.pendingKills.isEmpty {
                budgetPauseBanner
                Divider().opacity(0.5)
            }
            // Berth switcher (ADR-0084): always available — switch to a live berth
            // even when the current connection is down.
            BerthManagerView(store: store, berthStore: berthStore)
            Divider().opacity(0.5)
            // Tools: Fleet Control Center + a button per installed pd-console lane
            // (prod / latest / dev-NAME), each launchable against a chosen berth.
            ConsoleLauncherSection(
                berths: berthStore.berths,
                activeDaemonURL: store.daemonURL,
                openControlCenter: { openControlPlane(.flow) },
                openCloudFleet: { openControlPlane(.cloudfleet) },
                openVisualTask: { openControlPlane(.visual) }
            )
            Divider().opacity(0.5)
            if store.isDaemonRunning {
                BackendStatusRow(store: backendStore)
                Divider().opacity(0.5)
            }
            if let daemonStatus = store.daemonStatus, store.isDaemonRunning {
                daemonReportSection(status: daemonStatus)
                Divider().opacity(0.5)
            }
            if store.isDaemonRunning && !recentAgentHighlights.isEmpty {
                recentActivitySection
                Divider().opacity(0.5)
            }
            if store.isDaemonRunning {
                CloudFleetSection(
                    store: cloudFleetStore,
                    localProjects: store.projects,
                    localDaemonURL: store.daemonURL,
                    compact: true
                )
                Divider().opacity(0.5)
                consoleStatusSection
                Divider().opacity(0.5)
                CostDashboard(store: costStore)
                Divider().opacity(0.5)
            }
            if showingSettings {
                BackendPicker(store: backendStore)
                Divider().opacity(0.5)
                settingsPanel
                Divider().opacity(0.5)
            }
            if store.projects.isEmpty {
                emptyState
            } else {
                projectList
            }
        }
    }

    private var defaultConsoleProject: String? {
        if let expanded = store.expandedProjects.first,
           store.projects.contains(where: { $0.id == expanded }) {
            return expanded
        }
        if let active = store.projects.first(where: { $0.activeCount > 0 }) {
            return active.id
        }
        return store.projects.first?.id
    }

    private func openControlPlane(_ surface: FleetControlSurface, project: String? = nil, agent: String? = nil) {
        FleetControlRoute.persist(surface: surface, project: project ?? defaultConsoleProject, agent: agent)
        FleetBarAppChrome.presentControlCenter()
        if !FleetBarAppChrome.focusExistingControlCenter() {
            openWindow(id: "fleet-control-center")
        }
    }

    /// The general "open the operator console" action. Prefers pd-console — the
    /// GPU-native Rust cockpit — when installed, and falls back to the embedded
    /// web control plane otherwise. Surface deep-links keep calling
    /// `openControlPlane` directly (the web view supports them; pd-console doesn't yet).
    @MainActor
    private func openOperatorConsole() {
        switch OperatorConsoleRouter.target(nativeInstalled: OperatorConsoleLauncher.isInstalled()) {
        case .native:
            OperatorConsoleLauncher.launch()
        case .web:
            openControlPlane(.flow)
        }
    }

    private func resolveAgentFileURL(projectDir: String, filePath: String) -> URL {
        if filePath.hasPrefix("/") {
            return URL(fileURLWithPath: filePath)
        }
        return URL(fileURLWithPath: projectDir)
            .appendingPathComponent(filePath)
    }

    private func openAgentFileInEditor(projectDir: String, filePath: String) {
        NSWorkspace.shared.open(resolveAgentFileURL(projectDir: projectDir, filePath: filePath))
    }

    private func revealAgentFileInFinder(projectDir: String, filePath: String) {
        NSWorkspace.shared.activateFileViewerSelecting([
            resolveAgentFileURL(projectDir: projectDir, filePath: filePath)
        ])
    }

    /// Renders one compact Daemon Report metric.
    ///
    /// Sample input:
    /// `label: "Runtime", value: "nominal", color: Fleet.Color.healthy`
    ///
    /// Sample output:
    /// A small uppercase label above a single-line monospaced value.
    private func daemonReportRow(label: String, value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.medium))
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Renders a full-width Daemon Report diagnostic that must remain legible.
    ///
    /// Sample input:
    /// `label: "Bosun", value: "idle — daemon heartbeat writer active"`
    ///
    /// Sample output:
    /// A full-width report row whose value wraps instead of truncating.
    private func daemonReportDiagnostic(label: String, value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.medium))
                .foregroundStyle(color)
                .lineLimit(nil)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func daemonHistoryLine(summary: String, detail: String, timestampMs: Double, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.s) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(summary)
                    .font(.caption2)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if !detail.isEmpty {
                        Text(detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Text(Date(timeIntervalSince1970: timestampMs / 1000), style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    /// The loud daemon-health alarm banner. Uses an SF Symbol (never an emoji)
    /// in a WCAG-contrasting alert color, with body-sized text (no tiny fonts).
    @ViewBuilder
    private func healthAlarmBanner(severity: HealthSeverity, runtimeState: String?) -> some View {
        let isCritical = severity == .critical
        let tint = isCritical ? Fleet.Color.failure : Fleet.Color.warning
        let symbol = isCritical ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill"
        let title = isCritical ? "Daemon health CRITICAL" : "Daemon degraded"
        let subtitle = isCritical
            ? "Core daemon health is failing\(runtimeState.map { " — runtime \($0)" } ?? "")"
            : "Functional, but the daemon reports a degradation\(runtimeState.map { " — runtime \($0)" } ?? "")"

        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(tint)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(Fleet.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(tint.opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(tint.opacity(0.5), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). \(subtitle)")
    }

    private func daemonReportSection(status: DaemonStatusResponse) -> some View {
        let runtimeColor: Color = status.runtime?.degraded == true ? Fleet.Color.warning : Fleet.Color.healthy
        let bosun = status.guardians?.bosun
        let bosunColor: Color = {
            switch bosun?.state {
            case "healthy":
                return Fleet.Color.healthy
            case "disabled":
                return Fleet.Color.dormant
            default:
                return Fleet.Color.warning
            }
        }()
        let recentActivity = Array(status.history?.recentActivity.prefix(2) ?? [])
        let severity = store.daemonSeverity

        return VStack(alignment: .leading, spacing: Fleet.Space.s) {
            // LOUD alarm banner when the daemon's health is degraded — the
            // section visibly changes colour instead of staying quietly green.
            if severity != .ok {
                healthAlarmBanner(severity: severity, runtimeState: status.runtime?.state)
            }

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Daemon Report")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("Runtime, build, guardian, and fresh history")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                if let lastActivity = status.history?.lastActivityAt {
                    Text(Date(timeIntervalSince1970: lastActivity / 1000), style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                HStack(spacing: Fleet.Space.m) {
                    daemonReportRow(label: "Runtime", value: status.runtime?.state ?? status.status, color: runtimeColor)
                    daemonReportRow(label: "Version", value: status.daemon?.version ?? status.version, color: Fleet.Color.active)
                    daemonReportRow(
                        label: "Berth",
                        value: status.daemon?.berth?.label ?? "stable",
                        color: status.daemon?.berth.flatMap { Fleet.Color.hex($0.color) } ?? Fleet.Color.warning
                    )
                    daemonReportRow(label: "Code hash", value: status.daemon?.codeHash ?? "unknown")
                }
                daemonReportDiagnostic(label: "Bosun", value: bosun?.reason ?? bosun?.state ?? "n/a", color: bosunColor)
            }

            if !recentActivity.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(recentActivity) { entry in
                        daemonHistoryLine(
                            summary: entry.summary,
                            detail: entry.agentId ?? entry.type.lowercased(),
                            timestampMs: entry.timestamp,
                            color: Fleet.Color.active
                        )
                    }
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Chrome.panel)
    }

    private var settingsPanel: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            HStack {
                Text("Companion Settings")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                Spacer()

                Text(store.isDaemonRunning ? "Connected" : "Offline")
                    .font(.caption2)
                    .foregroundStyle(store.isDaemonRunning ? Fleet.Color.healthy : Fleet.Color.warning)
            }

            Toggle(isOn: Binding(
                get: { store.preferences.launchFleetBarOnDaemonStart },
                set: { store.setLaunchFleetBarOnDaemonStart($0) }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Launch FleetBar when Port Daddy starts")
                        .font(.caption.weight(.medium))
                    Text("Daemon-owned preference for the menu bar companion on macOS.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .toggleStyle(.switch)

            if let message = store.settingsMessage {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.m)
        .background(Fleet.Chrome.panel)
    }

    private var recentActivitySection: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Recent Work")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("Non-empty notes, mutations, and last-active hints")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                Button {
                    openControlPlane(.activity)
                } label: {
                    Text("Open")
                        .font(.caption2.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .foregroundStyle(Fleet.Color.active)
            }

            VStack(spacing: Fleet.Space.s) {
                ForEach(recentAgentHighlights) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: Fleet.Space.s) {
                            Circle()
                                .fill(agentStatusColor(item.agent.status))
                                .frame(width: 7, height: 7)
                            Text(item.agent.name)
                                .font(.system(.caption, design: .monospaced).weight(.semibold))
                                .foregroundStyle(.primary)
                            Text(item.projectName)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                            Spacer()
                            if let lastActivity = item.agent.lastActivity {
                                Text(lastActivity, style: .relative)
                                    .font(.caption2)
                                    .foregroundStyle(.quaternary)
                            }
                            Button {
                                openControlPlane(.activity, project: item.projectId, agent: item.agent.name)
                            } label: {
                                Text("Inspect")
                                    .font(.caption2.weight(.semibold))
                            }
                            .buttonStyle(.borderless)
                            .foregroundStyle(Fleet.Color.active)
                        }

                        if let summary = item.agent.lastSummary,
                           !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(summary)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }

                        if !item.agent.recentFiles.isEmpty {
                            HStack(spacing: 4) {
                                ForEach(Array(item.agent.recentFiles.prefix(2)), id: \.self) { filePath in
                                    FleetFileQuickActions(
                                        filePath: filePath,
                                        onOpenInEditor: {
                                            openAgentFileInEditor(projectDir: item.projectDir, filePath: filePath)
                                        },
                                        onRevealInFinder: {
                                            revealAgentFileInFinder(projectDir: item.projectDir, filePath: filePath)
                                        }
                                    )
                                }
                                Spacer(minLength: 0)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Fleet.Space.m)
                    .padding(.vertical, Fleet.Space.s)
                    .background(
                        Fleet.Chrome.card,
                        in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    )
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Chrome.panel)
    }

    // MARK: - Header
    //
    // The header adapts its tone to fleet health:
    // - CALM: neutral, barely there
    // - ACTIVE: warm blue accent
    // - ALERT: amber warmth
    // - CRITICAL: muted red presence

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                HStack(spacing: Fleet.Space.s) {
                    Text("Fleet")
                        .font(.headline)

                    // Subtle health dot in the title — the whole app's pulse
                    if store.isDaemonRunning && !store.projects.isEmpty {
                        Circle()
                            .fill(headerAccent)
                            .frame(width: 6, height: 6)
                            .opacity(store.totalActive > 0 ? 1 : 0.4)
                    }

                    // Berth identity (ADR-0084): which daemon am I talking to —
                    // stable / dev-latest / codebase. Always shown when running so
                    // the operator never confuses a dev daemon for the canonical one.
                    if store.isDaemonRunning {
                        berthChip
                    }
                }

                if store.isDaemonRunning {
                    Text(headerSubtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Label {
                        Text("Daemon offline")
                            .font(.caption)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .symbolRenderingMode(.hierarchical)
                            .font(.caption)
                    }
                    .foregroundStyle(Fleet.Color.failure)
                }
            }

            Spacer()

            HStack(spacing: Fleet.Space.s) {
                Button {
                    openControlPlane(.visual)
                } label: {
                    Label("Visual Task", systemImage: "viewfinder")
                        .labelStyle(.iconOnly)
                        .fontWeight(.medium)
                        .foregroundStyle(Fleet.Color.healthy)
                }
                .buttonStyle(.borderless)
                .help("Send a screenshot or selected region to an agent")
                .accessibilityLabel("Visual Task")

                if store.isDaemonRunning {
                    Button {
                        Task { await store.reloadFleet() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .fontWeight(.medium)
                    }
                    .buttonStyle(.borderless)
                    .help("Reload configs")

                    // PLAY/STOP is per-project. With one runnable project fire on it;
                    // with multiple, open Fleet Control Center where the operator picks —
                    // never silently launch all fleets everywhere.
                    Button {
                        Task {
                            if store.totalActive == 0 {
                                let runnable = store.projects.filter { !$0.isRunning }
                                if runnable.count == 1, let only = runnable.first {
                                    await store.startFleet(projectDir: only.projectDir)
                                } else if let focus = defaultConsoleProject,
                                          let project = store.projects.first(where: { $0.id == focus && !$0.isRunning }) {
                                    await store.startFleet(projectDir: project.projectDir)
                                } else {
                                    openControlPlane(.flow)
                                }
                            } else {
                                if let focus = defaultConsoleProject,
                                   let project = store.projects.first(where: { $0.id == focus && $0.isRunning }) {
                                    await store.stopFleet(projectDir: project.projectDir)
                                } else {
                                    openControlPlane(.flow)
                                }
                            }
                        }
                    } label: {
                        Image(systemName: store.totalActive == 0 ? "play.fill" : "stop.fill")
                            .fontWeight(.medium)
                            .foregroundStyle(store.totalActive == 0 ? Fleet.Color.healthy : Fleet.Color.failure)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.borderless)
                    .help(store.totalActive == 0 ? "Start fleet (focused project only)" : "Stop fleet (focused project only)")
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.m)
    }

    // The berth this FleetBar is connected to (ADR-0084). A daemon that predates
    // berth self-identity reports no `berth`; we treat that as the canonical
    // stable berth so the chip is always meaningful.
    private var berth: DaemonBerthResponse? {
        store.daemonStatus?.daemon?.berth
    }

    // Color-coded berth pill. Canonical `stable` renders quietly (it's the
    // expected default); a non-canonical `dev-latest` / `codebase` berth renders
    // with a filled, higher-contrast pill — "heads up, this isn't stable".
    @ViewBuilder
    private var berthChip: some View {
        let b = berth
        let tier = b?.tier ?? "stable"
        let label = b?.label ?? "stable"
        let canonical = b?.canonical ?? true
        let tint = b.flatMap { Fleet.Color.hex($0.color) } ?? berthFallbackColor(tier)
        let tooltip = berthTooltip(b)

        HStack(spacing: 4) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
            Text(label.uppercased())
                .font(.system(size: 11, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(canonical ? AnyShapeStyle(.secondary) : AnyShapeStyle(tint))
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(
            Capsule().fill(tint.opacity(canonical ? 0.10 : 0.20))
        )
        .overlay(
            Capsule().strokeBorder(tint.opacity(canonical ? 0.0 : 0.55), lineWidth: 1)
        )
        .help(tooltip)
        .accessibilityLabel("Connected to \(label) berth")
    }

    // Fallback colours mirror `BERTH_COLORS` in shared/daemon-berths.ts for the
    // legacy-daemon (no berth reported) path; the live path uses the daemon's hex.
    private func berthFallbackColor(_ tier: String) -> Color {
        switch tier {
        case "dev-latest": return Fleet.Color.active   // blue — bleeding edge
        case "codebase":   return Color(red: 0.66, green: 0.33, blue: 0.97) // purple
        default:           return Fleet.Color.warning  // amber — stable "as ever"
        }
    }

    private func berthTooltip(_ b: DaemonBerthResponse?) -> String {
        guard let b else {
            // When berth identity is unavailable (daemon still starting, older daemon
            // version, or unreachable), show the actual endpoint FleetBar resolved —
            // never inferring a berth from a preferred port number. With no resolved
            // endpoint at all, say so plainly rather than inventing one.
            guard let daemonURL = store.daemonURL else {
                return "Control plane unavailable · \(store.controlPlaneUnavailableReason?.summary ?? "no endpoint resolved")"
            }
            guard let url = URL(string: daemonURL), let port = url.port else {
                return "Daemon berth unknown · \(daemonURL)"
            }
            return "Daemon berth unknown · port \(port)"
        }
        var parts = ["\(b.label) berth · port \(b.port)"]
        if let branch = b.gitBranch, !branch.isEmpty {
            let rev = b.gitRev.map { " @ \($0)" } ?? ""
            parts.append("\(branch)\(rev)")
        }
        if let dir = b.sourceDir, !dir.isEmpty { parts.append(dir) }
        return parts.joined(separator: "\n")
    }

    private var headerAccent: Color {
        if store.totalFailed > 0 { return Fleet.Color.failure }
        if store.totalActive > 0 { return Fleet.Color.healthy }
        return Fleet.Color.dormant
    }

    private var headerSubtitle: String {
        let active = store.totalActive
        let total  = store.totalAgents
        if store.projectsNeedingBudget > 0 {
            return "\(store.projectsNeedingBudget) need budget, \(active)/\(total) active"
        }
        if active == 0 && total == 0 { return "No agents" }
        if active == 0 { return "\(total) idle" }
        return "\(active) active, \(total - active) idle"
    }

    private var consoleStatusSection: some View {
        let budgetBlocked = store.projects.filter(\.needsBudget)
        let readyStopped = store.projects.filter { $0.operatorState == .ready }

        return VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Control Center")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("Shared project readiness, budgets, and control-plane truth")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                Button {
                    openOperatorConsole()
                } label: {
                    Label("Open", systemImage: "macwindow")
                        .font(.caption2.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .foregroundStyle(Fleet.Color.active)
            }

            HStack(spacing: Fleet.Space.s) {
                ConsoleMetric(
                    title: "projects",
                    value: "\(store.projects.count)",
                    color: Fleet.Color.active
                )
                ConsoleMetric(
                    title: "budget",
                    value: "\(budgetBlocked.count)",
                    color: budgetBlocked.isEmpty ? Fleet.Color.healthy : Fleet.Color.warning
                )
                ConsoleMetric(
                    title: "ready",
                    value: "\(readyStopped.count)",
                    color: readyStopped.isEmpty ? Fleet.Color.dormant : Fleet.Color.healthy
                )
                ConsoleMetric(
                    title: "agents",
                    value: "\(store.totalActive)/\(store.totalAgents)",
                    color: store.totalActive > 0 ? Fleet.Color.healthy : Fleet.Color.dormant
                )
            }

            if let blocker = budgetBlocked.first {
                HStack(spacing: Fleet.Space.s) {
                    Image(systemName: blocker.statusIcon)
                        .foregroundStyle(blocker.statusColor)
                    Text("\(blocker.name): \(blocker.operatorNextAction)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Spacer()
                    Button("Set $\(Int(blocker.suggestedBudgetUsdPerDay))/day") {
                        Task {
                            await store.setFleetBudget(
                                projectDir: blocker.projectDir,
                                usdPerDay: blocker.suggestedBudgetUsdPerDay
                            )
                            await costStore.refresh()
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Fleet.Color.warning)
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Chrome.panel)
    }

    // MARK: - Empty State
    //
    // The harbor is empty. Lighthouse pulsing.
    // One icon, one line, one action.

    /// Surfaces a version mismatch between the running FleetBar app and the
    /// daemon. The app is a separately-downloaded `.app`; `brew upgrade
    /// port-daddy` moves the daemon but never the menu bar app, so the two drift
    /// and the operator needs a nudge plus the exact remediation.
    @ViewBuilder
    private func versionSkewBanner(_ skew: FleetVersionSkew) -> some View {
        switch skew {
        case .upToDate:
            EmptyView()

        case let .appBehindDaemon(app, daemon):
            versionSkewCard(
                icon: "arrow.down.circle.fill",
                tint: Fleet.Color.warning,
                title: "FleetBar is out of date",
                detail: "This app is \(app); the daemon is already \(daemon). Download the latest FleetBar to match.",
                versionLine: "app \(app)  →  daemon \(daemon)",
                primaryLabel: "Download FleetBar \(daemon)",
                primaryAction: { NSWorkspace.shared.open(FleetVersion.downloadPageURL) },
                // A Developer-ID-signed build means the release pipeline signs +
                // notarizes every artifact, so the download needs no manual
                // checksum ritual — Gatekeeper verifies it. Only unsigned/ad-hoc
                // builds keep the caveat.
                footnote: FleetVersion.isSignedBuild
                    ? "Signed & notarized — Gatekeeper verifies the download automatically."
                    : "Unsigned build — the download page lists the checksum to verify."
            )

        case let .daemonBehindApp(app, daemon):
            // FleetBar can't run `brew` or kill a live daemon itself, so we hand
            // the operator the exact command rather than a button that pretends
            // to restart (startDaemon() no-ops when a daemon is already running).
            versionSkewCard(
                icon: "exclamationmark.arrow.triangle.2.circlepath",
                tint: Fleet.Color.active,
                title: "Daemon is behind this app",
                detail: "FleetBar is \(app) but the running daemon is \(daemon). Upgrade Port Daddy, then restart the daemon, so they match.",
                versionLine: "app \(app)  →  daemon \(daemon)",
                primaryLabel: "Copy `brew upgrade port-daddy`",
                primaryAction: {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("brew upgrade port-daddy", forType: .string)
                },
                footnote: "Run the copied command in a terminal, then restart the daemon from the menu."
            )
        }
    }

    private func versionSkewCard(
        icon: String,
        tint: Color,
        title: String,
        detail: String,
        versionLine: String,
        primaryLabel: String,
        primaryAction: @escaping () -> Void,
        footnote: String
    ) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack(spacing: Fleet.Space.s) {
                Image(systemName: icon)
                    .foregroundStyle(tint)
                Text(title)
                    .font(.caption.weight(.semibold))
                Spacer()
                Text(versionLine)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Fleet.Space.s) {
                Button(action: primaryAction) {
                    Text(primaryLabel)
                        .font(.caption.weight(.medium))
                }
                .controlSize(.small)
                .tint(tint)
            }
            Text(footnote)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Fleet.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.10))
    }

    private var budgetPauseBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                Text("Pending budget kills · \(budgetStore.pendingKills.count)")
                    .font(.headline)
                Spacer()
                Text("grace \(Int(budgetStore.graceMs / 1000))s")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            // Note: budgetStore.start() is called on the popover's onAppear,
            // not here — banner only renders when there are pending kills.
            ForEach(budgetStore.pendingKills) { kill in
                VStack(alignment: .leading, spacing: 4) {
                    Text(kill.agentId)
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                    Text("project: \(kill.project) · spent $\(String(format: "%.4f", kill.spentTodayUsd))/$\(String(format: "%.2f", kill.budgetUsdPerDay))/day")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("reason: \(kill.reason) · expires in \(secondsRemaining(kill.expiresAt))s")
                        .font(.caption2)
                        .foregroundStyle(.red)
                    HStack(spacing: 6) {
                        Button("Raise +$5") {
                            Task { await budgetStore.raise(agentId: kill.agentId, topUpUsd: 5) }
                        }
                        .controlSize(.small)
                        Button("+60s") {
                            Task { await budgetStore.extendGrace(agentId: kill.agentId) }
                        }
                        .controlSize(.small)
                        Button("Kill now") {
                            Task { await budgetStore.killNow(agentId: kill.agentId) }
                        }
                        .controlSize(.small)
                        .tint(.red)
                    }
                }
                .padding(8)
                .background(Color.red.opacity(0.08))
                .cornerRadius(6)
            }
            if let err = budgetStore.lastError {
                Text(err).font(.caption2).foregroundStyle(.red)
            }
        }
        .padding(12)
    }

    private func secondsRemaining(_ expiresAt: TimeInterval) -> Int {
        let now = Date().timeIntervalSince1970 * 1000
        return max(0, Int((expiresAt - now) / 1000))
    }

    private var emptyState: some View {
        VStack(spacing: Fleet.Space.l) {
            Image(systemName: "sailboat")
                .font(.system(size: 40, weight: .ultraLight))
                .foregroundStyle(.quaternary)
                .symbolEffect(.pulse.byLayer, options: .repeating.speed(0.5), isActive: !store.isDaemonRunning)

            VStack(spacing: Fleet.Space.xs) {
                if store.isDaemonRunning {
                    Text("Harbor is quiet")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Text("Add pd-fleet.yml to a project")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                } else {
                    Text("Harbor is dark")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)

                    Button {
                        store.startDaemon()
                    } label: {
                        HStack(spacing: Fleet.Space.xs) {
                            if store.isStartingDaemon {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Starting...")
                                    .font(.caption.weight(.medium))
                            } else {
                                Image(systemName: "power")
                                    .fontWeight(.semibold)
                                Text("Start Daemon")
                                    .font(.caption.weight(.medium))
                            }
                        }
                        .foregroundStyle(Fleet.Color.healthy)
                        .padding(.horizontal, Fleet.Space.m)
                        .padding(.vertical, Fleet.Space.s)
                        .background(
                            Fleet.Color.healthy.opacity(0.1),
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isStartingDaemon)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
        .padding(.vertical, Fleet.Space.xl)
    }

    // MARK: - Project List

    private var projectList: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(store.projects.enumerated()), id: \.element.id) { index, project in
                ProjectSection(
                    project: project,
                    isExpanded: store.expandedProjects.contains(project.id),
                    onToggle: { withAnimation(Fleet.Motion.expandSpring) { store.toggleProject(project.id) } },
                    onOpenProject: {
                        openControlPlane(.flow, project: project.id)
                    },
                    onOpenVisualTask: {
                        openControlPlane(.visual, project: project.id)
                    },
                    onRemediateProject: {
                        handleProjectRemediation(project)
                    },
                    onInspectAgent: { agentName in
                        openControlPlane(.activity, project: project.id, agent: agentName)
                    },
                    onRunAgent: { agentName in
                        Task { await store.runAgent(projectDir: project.projectDir, agentName: agentName) }
                    },
                    onPauseToggle: { agentName, isPaused in
                        Task {
                            if isPaused {
                                await store.resumeAgent(projectDir: project.projectDir, agentName: agentName)
                            } else {
                                await store.pauseAgent(projectDir: project.projectDir, agentName: agentName)
                            }
                        }
                    },
                    onOpenInEditor: { filePath in
                        openAgentFileInEditor(projectDir: project.projectDir, filePath: filePath)
                    },
                    onRevealInFinder: { filePath in
                        revealAgentFileInFinder(projectDir: project.projectDir, filePath: filePath)
                    }
                )
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 8)
                .animation(
                    Fleet.Motion.expandSpring.delay(Double(index) * Fleet.Motion.sectionStagger),
                    value: appeared
                )
            }
        }
    }

    // MARK: - Footer
    //
    // Whisper-quiet. The user glances here, never stares.

    /// Connection glyph: available+live, available+polling, or unavailable.
    private var footerSymbol: String {
        guard store.isControlPlaneAvailable else { return "bolt.horizontal.circle" }
        return store.isConnected
            ? "antenna.radiowaves.left.and.right"
            : "antenna.radiowaves.left.and.right.slash"
    }

    /// Three-state footer label. "Unavailable" is distinct from "Polling": the
    /// latter means we have an endpoint and are waiting; the former means no
    /// endpoint was resolved at all, so no request is even being made.
    private var footerLabel: String {
        guard store.isControlPlaneAvailable else { return "Control plane unavailable" }
        return store.isConnected ? "Live" : "Polling"
    }

    /// Tooltip: the resolved source, or the typed unavailable reason.
    private var footerHelp: String {
        if let source = store.endpointSource {
            return "Endpoint from \(source.label) · \(store.daemonLabel)"
        }
        return store.controlPlaneUnavailableReason?.summary ?? "No daemon endpoint resolved."
    }

    private var footer: some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: footerSymbol)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(store.isControlPlaneAvailable
                    ? (store.isConnected ? Fleet.Color.healthy : Fleet.Color.warning)
                    : Fleet.Color.failure)
                .symbolEffect(.variableColor.iterative, isActive: store.isConnected)
                .contentTransition(.symbolEffect(.replace))

            Text(footerLabel)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .help(footerHelp)

            Spacer()

            if let last = store.lastRefresh {
                Text(last, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
            }

            Button {
                openOperatorConsole()
            } label: {
                Label("Control Center", systemImage: "macwindow")
            }
            .buttonStyle(.borderless)
            .font(.caption2)
            .foregroundStyle(Fleet.Color.active)
            .help("Open the operator console — pd-console if installed, else the web control plane")

            Button {
                openSettings()
            } label: {
                Label("Secrets", systemImage: "key.fill")
            }
            .buttonStyle(.borderless)
            .font(.caption2)
            .foregroundStyle(Fleet.Color.active)
            .help("Manage daemon secrets and credentials")
            .accessibilityLabel("Open secrets manager")

            LaunchOperatorConsoleButton()
                .font(.caption2)

            Button {
                withAnimation(Fleet.Motion.snappy) {
                    showingSettings.toggle()
                }
            } label: {
                Image(systemName: showingSettings ? "slider.horizontal.3" : "gearshape")
            }
            .buttonStyle(.borderless)
            .font(.caption2)
            .foregroundStyle(.quaternary)
            .help(showingSettings ? "Hide settings" : "Show settings")

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
            .buttonStyle(.borderless)
            .font(.caption2)
            .foregroundStyle(.quaternary)
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Chrome.panel)
    }

    private func handleProjectRemediation(_ project: FleetProject) {
        switch project.remediation?.action {
        case "set_budget":
            Task {
                await store.setFleetBudget(
                    projectDir: project.projectDir,
                    usdPerDay: project.suggestedBudgetUsdPerDay
                )
                await costStore.refresh()
            }
        case "start_fleet":
            Task { await store.startFleet(projectDir: project.projectDir) }
        case "fix_yaml":
            openControlPlane(.yaml, project: project.id)
        default:
            openControlPlane(.flow, project: project.id)
        }
    }
}

private struct ConsoleMetric: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(.caption, design: .monospaced).weight(.semibold))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 6)
        .background(
            Fleet.Chrome.card,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
    }
}

// MARK: - Project Section

struct ProjectSection: View {
    let project: FleetProject
    let isExpanded: Bool
    let onToggle: () -> Void
    let onOpenProject: () -> Void
    let onOpenVisualTask: () -> Void
    let onRemediateProject: () -> Void
    let onInspectAgent: (String) -> Void
    let onRunAgent: (String) -> Void
    let onPauseToggle: (String, Bool) -> Void
    let onOpenInEditor: (String) -> Void
    let onRevealInFinder: (String) -> Void

    private var orderedAgents: [FleetAgent] {
        project.agents.sorted { lhs, rhs in
            switch (lhs.lastActivity, rhs.lastActivity) {
            case let (left?, right?):
                if left != right { return left > right }
            case (.some, nil):
                return true
            case (nil, .some):
                return false
            case (nil, nil):
                break
            }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: Fleet.Space.s) {
                    // Disclosure — single chevron, animated rotation
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .animation(Fleet.Motion.snappy, value: isExpanded)
                        .frame(width: 12)

                    Image(systemName: project.statusIcon)
                        .font(.system(size: 12))
                        .fontWeight(.medium)
                        .foregroundStyle(project.statusColor)

                    Text(project.name)
                        .font(.subheadline.weight(.medium))

                    Spacer()

                    StatusTextCapsule(
                        label: project.statusLabel,
                        color: project.statusColor,
                        icon: project.statusIcon
                    )

                    // Status capsules — only appear when meaningful
                    if project.failedCount > 0 {
                        StatusCapsule(
                            count: project.failedCount,
                            color: Fleet.Color.failure,
                            icon: "xmark.circle.fill"
                        )
                    }
                    if project.activeCount > 0 {
                        StatusCapsule(
                            count: project.activeCount,
                            color: Fleet.Color.healthy,
                            icon: "circle.fill"
                        )
                    }

                    Text("\(project.visibleAgentCount)")
                        .font(.caption2)
                        .foregroundStyle(.quaternary)
                }
                .padding(.horizontal, Fleet.Space.l)
                .padding(.vertical, Fleet.Space.m)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Agent rows — staggered cascade
            if isExpanded {
                ProjectReadinessRow(
                    project: project,
                    onOpenProject: onOpenProject,
                    onOpenVisualTask: onOpenVisualTask,
                    onRemediateProject: onRemediateProject
                )

                if orderedAgents.isEmpty {
                    Text("No live agent rows yet")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Fleet.Space.l)
                        .padding(.bottom, Fleet.Space.s)
                } else {
                    ForEach(Array(orderedAgents.enumerated()), id: \.element.id) { index, agent in
                        AgentRow(
                            agent: agent,
                            onInspect: { onInspectAgent(agent.name) },
                            onRunAgent: { onRunAgent(agent.name) },
                            onPauseToggle: { onPauseToggle(agent.name, agent.status == .paused) },
                            onOpenInEditor: onOpenInEditor,
                            onRevealInFinder: onRevealInFinder
                        )
                            .transition(
                                .asymmetric(
                                    insertion: .opacity
                                        .combined(with: .offset(y: -4))
                                        .animation(
                                            Fleet.Motion.expandSpring
                                                .delay(Double(index) * Fleet.Motion.rowStagger)
                                        ),
                                    removal: .opacity.animation(.smooth(duration: 0.12))
                                )
                            )
                    }
                }
            }
        }
    }
}

// Internal (not private) so @testable FleetBar can inspect the row directly.
// The remediation button's affordance regressed once before (caption2 +
// borderless); pinning it via unit tests is worth the broader visibility.
struct ProjectReadinessRow: View {
    let project: FleetProject
    let onOpenProject: () -> Void
    let onOpenVisualTask: () -> Void
    let onRemediateProject: () -> Void

    /// SF Symbol for each remediation action. Picked so the icon reinforces
    /// the verb (a play-glyph for "Start fleet", a dollar-sign for "Set
    /// budget", a wrench for "Fix YAML", etc.) and the button reads as a
    /// button at a glance, not as static text.
    private func remediationIcon(for action: String) -> String {
        switch action {
        case "start_fleet":  return "play.fill"
        case "set_budget":   return "dollarsign.circle"
        case "fix_yaml":     return "wrench.adjustable"
        case "create_fleet": return "plus.circle"
        case "run_scan":     return "magnifyingglass"
        default:             return "arrow.right.circle"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: project.statusIcon)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(project.statusColor)
                .frame(width: Fleet.Space.l)

            VStack(alignment: .leading, spacing: 3) {
                Text(project.operatorSummary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(project.operatorNextAction)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }

            Spacer(minLength: Fleet.Space.s)

            Button {
                onOpenVisualTask()
            } label: {
                Image(systemName: "viewfinder")
            }
            .buttonStyle(.borderless)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Fleet.Color.healthy)
            .help("Open visual task intake")

            Button {
                onOpenProject()
            } label: {
                Image(systemName: "macwindow")
            }
            .buttonStyle(.borderless)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Fleet.Color.active)
            .help("Open console")

            if let remediation = project.remediation {
                // Remediation calls (Start fleet, Set budget, etc.) used to be
                // borderless caption2 text — they looked like static labels and
                // disappeared next to the SF Symbol "Open console" button.
                // Capsule + chrome border + semibold callout makes it obvious
                // this is a button and respects the 14pt-equivalent floor for
                // interactive text. Icon picked per remediation action so the
                // affordance is reinforced visually.
                Button(action: onRemediateProject) {
                    HStack(spacing: 4) {
                        Image(systemName: remediationIcon(for: remediation.action))
                            .font(.system(size: 11, weight: .semibold))
                        Text(remediation.title)
                            .font(.callout.weight(.semibold))
                    }
                    .padding(.horizontal, Fleet.Space.s)
                    .padding(.vertical, 4)
                    .background(
                        project.statusColor.opacity(0.12),
                        in: Capsule()
                    )
                    .overlay(
                        Capsule().stroke(project.statusColor.opacity(0.55), lineWidth: 1)
                    )
                    .foregroundStyle(project.statusColor)
                }
                .buttonStyle(.plain)
                .help(remediation.detail.isEmpty ? remediation.title : remediation.detail)
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.bottom, Fleet.Space.s)
    }
}

// MARK: - Agent Row
//
// Each agent is a character with a name, a role, and a state.
// The row communicates all three without labels.

struct AgentRow: View {
    let agent: FleetAgent
    let onInspect: () -> Void
    let onRunAgent: () -> Void
    let onPauseToggle: () -> Void
    let onOpenInEditor: (String) -> Void
    let onRevealInFinder: (String) -> Void
    @State private var justChanged = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: Fleet.Space.s) {
                Spacer().frame(width: Fleet.Space.xl + Fleet.Space.xs)

                statusIndicator

                Image(systemName: Fleet.agentIcon(for: agent.name))
                    .font(.system(size: 10))
                    .fontWeight(.regular)
                    .foregroundStyle(agent.status == .failed ? Fleet.Color.failure : Fleet.Color.dormant)
                    .frame(width: Fleet.Space.l)

                Text(agent.name)
                    .font(.system(.caption, design: .monospaced).weight(.medium))
                    .foregroundStyle(agent.status == .failed ? Fleet.Color.failure.opacity(0.9) : .primary)

                Spacer()

                if agent.type == .scheduled {
                    Text("job")
                        .font(.system(.caption2, design: .rounded).weight(.semibold))
                        .foregroundStyle(Fleet.Color.warning)
                        .padding(.horizontal, Fleet.Space.xs + 1)
                        .padding(.vertical, 2)
                        .background(
                            Fleet.Color.warning.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                        )
                }

                if let lastEvent = agent.lastEvent {
                    EventLabel(event: lastEvent)
                }

                if let lastActivity = agent.lastActivity {
                    Text(lastActivity, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.quaternary)
                        .frame(width: 52, alignment: .trailing)
                }
                if agent.canControl {
                    Button(agent.status == .paused ? "Resume" : "Pause", action: onPauseToggle)
                        .buttonStyle(.borderless)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(agent.status == .paused ? Fleet.Color.healthy : Fleet.Color.warning)
                    Button("Run", action: onRunAgent)
                        .buttonStyle(.borderless)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Fleet.Color.active)
                }
            }
            if let purpose = agent.purpose, !purpose.isEmpty {
                Text(purpose)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, Fleet.Space.xl + Fleet.Space.xs + Fleet.Space.s + Fleet.Space.l)
            }
            if let lastSummary = agent.lastSummary, !lastSummary.isEmpty {
                Text(lastSummary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding(.leading, Fleet.Space.xl + Fleet.Space.xs + Fleet.Space.s + Fleet.Space.l)
            }
            if let statusReason = agent.statusReason,
               !statusReason.isEmpty,
               statusReason != agent.lastSummary {
                Text(statusReason)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, Fleet.Space.xl + Fleet.Space.xs + Fleet.Space.s + Fleet.Space.l)
            }
            if let recoveryHint {
                Label {
                    Text(recoveryHint)
                        .font(.caption2.weight(.medium))
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.caption2)
                }
                .foregroundStyle(Fleet.Color.warning)
                .padding(.leading, Fleet.Space.xl + Fleet.Space.xs + Fleet.Space.s + Fleet.Space.l)
            }
            if !agent.recentFiles.isEmpty {
                HStack(spacing: 4) {
                    Spacer().frame(width: Fleet.Space.xl + Fleet.Space.xs + Fleet.Space.s + Fleet.Space.l)
                    ForEach(agent.recentFiles.prefix(2), id: \.self) { filePath in
                        FleetFileQuickActions(
                            filePath: filePath,
                            onOpenInEditor: { onOpenInEditor(filePath) },
                            onRevealInFinder: { onRevealInFinder(filePath) }
                        )
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.xs + 2)
        .background(
            agent.status == .failed
                ? Fleet.Color.failure.opacity(0.04)
                : Color.clear
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onInspect)
        .onChange(of: agent.status) { justChanged = true }
    }

    private var recoveryHint: String? {
        let diagnostic = [
            agent.lastSummary,
            agent.statusReason,
            agent.lastEvent,
        ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()

        if diagnostic.contains("hourly spawn limit") {
            return "Next: wait for the hourly spawn window to clear, then run this agent again."
        }
        if diagnostic.contains("concurrent spawn limit") {
            return "Next: wait for active spawns to finish, or pause another running agent."
        }
        if diagnostic.contains("exact telemetry required") && diagnostic.contains("codex") {
            return "Next: run `codex exec --json \"print ok\"`; if usage appears, run this agent again. If usage is missing, fix Codex auth/CLI."
        }
        if diagnostic.contains("no launchable backend") {
            return "Next: switch this agent to a launchable backend/model, or fix backend readiness."
        }

        return nil
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch agent.status {
        case .running:
            Image(systemName: "circle.fill")
                .font(.system(size: 7))
                .foregroundStyle(Fleet.Color.healthy)
                .symbolEffect(.pulse, isActive: true)

        case .queued:
            Image(systemName: "hourglass.circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Fleet.Color.active)

        case .armed, .scheduled:
            Circle()
                .fill(Fleet.Color.active.opacity(0.7))
                .frame(width: 7, height: 7)

        case .paused:
            Image(systemName: "pause.circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Fleet.Color.warning)

        case .salvaged:
            Image(systemName: "wrench.and.screwdriver.fill")
                .font(.system(size: 9))
                .foregroundStyle(Fleet.Color.warning)

        case .orphanReconciled:
            Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Fleet.Color.active)

        case .historical:
            Image(systemName: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                .font(.system(size: 9))
                .foregroundStyle(Fleet.Color.dormant)

        case .idle:
            Circle()
                .fill(Fleet.Color.dormant.opacity(0.4))
                .frame(width: 7, height: 7)

        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Fleet.Color.failure)
                .symbolEffect(.bounce, value: justChanged)

        case .dead:
            Image(systemName: "circle.dashed")
                .font(.system(size: 8))
                .foregroundStyle(Fleet.Color.dead)
        }
    }
}

struct FleetFileQuickActions: View {
    let filePath: String
    let onOpenInEditor: () -> Void
    let onRevealInFinder: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(filePath)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Fleet.Color.active)
                .lineLimit(1)
            HStack(spacing: 4) {
                Button("Editor", action: onOpenInEditor)
                    .buttonStyle(.borderless)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.primary)
                Button("Finder", action: onRevealInFinder)
                    .buttonStyle(.borderless)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            Fleet.Color.active.opacity(0.08),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
    }
}

// MARK: - Event Label

struct EventLabel: View {
    let event: String

    var body: some View {
        Text(label)
            .font(.system(.caption2, design: .rounded).weight(.medium))
            .foregroundStyle(color)
            .padding(.horizontal, Fleet.Space.xs + 2)
            .padding(.vertical, 2)
            .background(
                color.opacity(0.08),
                in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
            )
    }

    private var label: String {
        switch event {
        case "agent_started":     return "running"
        case "agent_completed":   return "done"
        case "agent_failed":      return "failed"
        case "agent_paused":      return "paused"
        case "agent_resumed":     return "armed"
        case "watcher_triggered": return "fired"
        case "salvaged":          return "salvaged"
        case "orphan_reconciled": return "reconciled"
        case "historical":        return "history"
        case "idle":              return "idle"
        default: return event
        }
    }

    private var color: Color {
        switch event {
        case "agent_started":     return Fleet.Color.active
        case "agent_completed":   return Fleet.Color.healthy
        case "agent_failed":      return Fleet.Color.failure
        case "agent_paused":      return Fleet.Color.warning
        case "agent_resumed":     return Fleet.Color.active
        case "watcher_triggered": return Fleet.Color.warning
        case "salvaged":          return Fleet.Color.warning
        case "orphan_reconciled": return Fleet.Color.active
        case "historical":        return Fleet.Color.dormant
        case "idle":              return Fleet.Color.dormant
        default: return .secondary
        }
    }
}

// MARK: - Status Capsule

struct StatusTextCapsule: View {
    let label: String
    let color: Color
    let icon: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 7))
            Text(label)
                .font(.system(.caption2, design: .rounded).weight(.medium))
        }
        .foregroundStyle(color)
        .padding(.horizontal, Fleet.Space.xs + 2)
        .padding(.vertical, 2)
        .background(
            color.opacity(0.08),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
    }
}

struct StatusCapsule: View {
    let count: Int
    let color: Color
    let icon: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 7))
            Text("\(count)")
                .font(.system(.caption2, design: .rounded).weight(.medium))
        }
        .foregroundStyle(color)
        .padding(.horizontal, Fleet.Space.xs + 2)
        .padding(.vertical, 2)
        .background(
            color.opacity(0.08),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
    }
}

// MARK: - Preview

#Preview("Fleet Running") {
    FleetPopover(store: {
        let store = FleetStore()
        return store
    }(), costStore: {
        let store = CostStore()
        return store
    }(), backendStore: {
        let store = BackendStore(autoStart: false)
        return store
    }())
    .frame(width: 380, height: 520)
}
