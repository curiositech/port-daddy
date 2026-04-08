import SwiftUI
import AppKit

private struct RecentAgentHighlight: Identifiable {
    let projectId: String
    let projectDir: String
    let projectName: String
    let agent: FleetAgent

    var id: String { "\(projectId)::\(agent.id)" }
}

// MARK: - Main Popover

struct FleetPopover: View {
    @Environment(\.openWindow) private var openWindow
    @ObservedObject var store: FleetStore
    @ObservedObject var costStore: CostStore
    @AppStorage("fleet.control.theme") private var selectedThemeRaw = "dark"
    @State private var appeared = false
    @State private var showingSettings = false

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
            if store.isDaemonRunning && !recentAgentHighlights.isEmpty {
                recentActivitySection
                Divider().opacity(0.5)
            }
            if store.isDaemonRunning {
                CostDashboard(store: costStore)
                Divider().opacity(0.5)
            }
            if showingSettings {
                settingsPanel
                Divider().opacity(0.5)
            }
            if store.projects.isEmpty {
                emptyState
            } else {
                projectList
            }
            Divider().opacity(0.5)
            footer
        }
        .background(Fleet.Chrome.popoverBackground)
        .preferredColorScheme(selectedThemeRaw == "light" ? .light : .dark)
        .onAppear {
            withAnimation(.smooth(duration: 0.4)) { appeared = true }
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
                                .fill(item.agent.status.isDeployed ? Fleet.Color.healthy : Fleet.Color.dormant.opacity(0.45))
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

            if store.isDaemonRunning {
                HStack(spacing: Fleet.Space.s) {
                    Button {
                        Task { await store.reloadFleet() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .fontWeight(.medium)
                    }
                    .buttonStyle(.borderless)
                    .help("Reload configs")

                    Button {
                        Task {
                            if store.projects.isEmpty {
                                await store.startFleet()
                            } else {
                                await store.stopFleet()
                            }
                        }
                    } label: {
                        Image(systemName: store.projects.isEmpty ? "play.fill" : "stop.fill")
                            .fontWeight(.medium)
                            .foregroundStyle(store.projects.isEmpty ? Fleet.Color.healthy : Fleet.Color.failure)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.borderless)
                    .help(store.projects.isEmpty ? "Start fleet" : "Stop fleet")
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.m)
    }

    private var headerAccent: Color {
        if store.totalFailed > 0 { return Fleet.Color.failure }
        if store.totalActive > 0 { return Fleet.Color.healthy }
        return Fleet.Color.dormant
    }

    private var headerSubtitle: String {
        let active = store.totalActive
        let total  = store.totalAgents
        if active == 0 && total == 0 { return "No agents" }
        if active == 0 { return "\(total) idle" }
        return "\(active) active, \(total - active) idle"
    }

    // MARK: - Empty State
    //
    // The harbor is empty. Lighthouse pulsing.
    // One icon, one line, one action.

    private var emptyState: some View {
        VStack(spacing: Fleet.Space.l) {
            Spacer()

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

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Project List

    private var projectList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(Array(store.projects.enumerated()), id: \.element.id) { index, project in
                    ProjectSection(
                        project: project,
                        isExpanded: store.expandedProjects.contains(project.id),
                        onToggle: { withAnimation(Fleet.Motion.expandSpring) { store.toggleProject(project.id) } },
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
    }

    // MARK: - Footer
    //
    // Whisper-quiet. The user glances here, never stares.

    private var footer: some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: store.isConnected
                  ? "antenna.radiowaves.left.and.right"
                  : "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(store.isConnected ? Fleet.Color.healthy : Fleet.Color.warning)
                .symbolEffect(.variableColor.iterative, isActive: store.isConnected)
                .contentTransition(.symbolEffect(.replace))

            Text(store.isConnected ? "Live" : "Polling")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Spacer()

            if let last = store.lastRefresh {
                Text(last, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
            }

            Button {
                openControlPlane(.flow)
            } label: {
                Label("Console", systemImage: "macwindow")
            }
            .buttonStyle(.borderless)
            .font(.caption2)
            .foregroundStyle(Fleet.Color.active)
            .help("Open the fleet control plane")

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
}

// MARK: - Project Section

struct ProjectSection: View {
    let project: FleetProject
    let isExpanded: Bool
    let onToggle: () -> Void
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

                    // Folder — weight matches text
                    Image(systemName: "folder.fill")
                        .font(.system(size: 12))
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)

                    Text(project.name)
                        .font(.subheadline.weight(.medium))

                    Spacer()

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

                    Text("\(project.agents.count)")
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
                Button(agent.status == .paused ? "Resume" : "Pause", action: onPauseToggle)
                    .buttonStyle(.borderless)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(agent.status == .paused ? Fleet.Color.healthy : Fleet.Color.warning)
                Button("Run", action: onRunAgent)
                    .buttonStyle(.borderless)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Fleet.Color.active)
            }
            if let lastSummary = agent.lastSummary, !lastSummary.isEmpty {
                Text(lastSummary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
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

    @ViewBuilder
    private var statusIndicator: some View {
        switch agent.status {
        case .running:
            Image(systemName: "circle.fill")
                .font(.system(size: 7))
                .foregroundStyle(Fleet.Color.healthy)
                .symbolEffect(.pulse, isActive: true)

        case .armed, .scheduled:
            Circle()
                .fill(Fleet.Color.active.opacity(0.7))
                .frame(width: 7, height: 7)

        case .paused:
            Image(systemName: "pause.circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Fleet.Color.warning)

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
        default: return .secondary
        }
    }
}

// MARK: - Status Capsule

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
    }())
    .frame(width: 380, height: 520)
}
