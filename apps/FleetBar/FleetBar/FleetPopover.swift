import SwiftUI

// MARK: - Main Popover

struct FleetPopover: View {
    @Environment(\.openWindow) private var openWindow
    @ObservedObject var store: FleetStore
    @ObservedObject var costStore: CostStore
    @State private var appeared = false
    @State private var showingSettings = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.5)
            if store.isDaemonRunning {
                quickActions
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
        .onAppear {
            withAnimation(.smooth(duration: 0.4)) { appeared = true }
        }
    }

    private var defaultConsoleProject: String? {
        store.projects.count == 1 ? store.projects[0].id : nil
    }

    private func openControlPlane(_ surface: FleetControlSurface, project: String? = nil) {
        FleetControlRoute.persist(surface: surface, project: project ?? defaultConsoleProject)
        openWindow(id: "fleet-control-center")
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

    private var quickActions: some View {
        HStack(spacing: Fleet.Space.s) {
            QuickActionButton(
                title: "Flow",
                systemImage: "point.3.connected.trianglepath.dotted",
                color: Fleet.Color.active
            ) {
                openControlPlane(.flow)
            }

            QuickActionButton(
                title: "Inbox",
                systemImage: "tray.full",
                color: Fleet.Color.warning
            ) {
                openControlPlane(.inbox)
            }

            QuickActionButton(
                title: "Sorties",
                systemImage: "paperplane",
                color: Fleet.Color.healthy
            ) {
                openControlPlane(.sorties)
            }

            QuickActionButton(
                title: "YAML",
                systemImage: "curlybraces",
                color: Fleet.Color.failure
            ) {
                openControlPlane(.yaml)
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Chrome.panelRaised)
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
                        onToggle: { withAnimation(Fleet.Motion.expandSpring) { store.toggleProject(project.id) } }
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

                    Text(project.id)
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
                ForEach(Array(project.agents.enumerated()), id: \.element.id) { index, agent in
                    AgentRow(agent: agent)
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
    @State private var justChanged = false

    var body: some View {
        HStack(spacing: Fleet.Space.s) {
            Spacer().frame(width: Fleet.Space.xl + Fleet.Space.xs)

            // Status indicator — living, contextual
            statusIndicator

            // Agent-specific icon — each agent has its own symbol
            Image(systemName: Fleet.agentIcon(for: agent.name))
                .font(.system(size: 10))
                .fontWeight(.regular)
                .foregroundStyle(agent.status == .failed ? Fleet.Color.failure : Fleet.Color.dormant)
                .frame(width: Fleet.Space.l)

            // Name — monospaced for alignment, medium weight for readability
            Text(agent.name)
                .font(.system(.caption, design: .monospaced).weight(.medium))
                .foregroundStyle(agent.status == .failed ? Fleet.Color.failure.opacity(0.9) : .primary)

            Spacer()

            // Event label — colored capsule for recent events
            if let lastEvent = agent.lastEvent {
                EventLabel(event: lastEvent)
            }

            // Relative time — barely visible until you look for it
            if let lastActivity = agent.lastActivity {
                Text(lastActivity, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
                    .frame(width: 52, alignment: .trailing)
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.xs + 2)
        .background(
            agent.status == .failed
                ? Fleet.Color.failure.opacity(0.04)
                : Color.clear
        )
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
        case "watcher_triggered": return "fired"
        default: return event
        }
    }

    private var color: Color {
        switch event {
        case "agent_started":     return Fleet.Color.active
        case "agent_completed":   return Fleet.Color.healthy
        case "agent_failed":      return Fleet.Color.failure
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

struct QuickActionButton: View {
    let title: String
    let systemImage: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Fleet.Space.s)
                .background(
                    color.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                )
        }
        .buttonStyle(.plain)
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
