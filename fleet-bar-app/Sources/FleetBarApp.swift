import SwiftUI
import AppKit

@main
struct FleetBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        MenuBarExtra("PortDaddy", systemImage: "antenna.radiowaves.left.and.right") {
            FleetBarMenuView()
                .environment(\.colorScheme, .dark)
        }
        .menuBarExtraStyle(.window)
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Ensure app stays in menu bar
        NSApp.setActivationPolicy(.accessory)
    }
}

struct FleetBarMenuView: View {
    @State private var isExpanded = false
    @State private var selectedMode: FleetBarMode = .compact
    @StateObject private var viewModel = FleetLiveViewModel()

    enum FleetBarMode {
        case compact    // Quick stats in menu bar
        case expanded   // Full Port Daddy dashboard
    }

    var body: some View {
        if isExpanded {
            ExpandedDashboardView(
                isExpanded: $isExpanded,
                viewModel: viewModel
            )
        } else {
            CompactMenuView(
                isExpanded: $isExpanded,
                viewModel: viewModel
            )
        }
    }
}

// MARK: - Compact Mode (Menu Bar Quick View)

struct CompactMenuView: View {
    @Binding var isExpanded: Bool
    @ObservedObject var viewModel: FleetLiveViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("PortDaddy : Agentic Control Plane")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundColor(.init(hex: "CC3D2E")) // Cinnabar

                Spacer()

                Button(action: { isExpanded = true }) {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .background(Color.init(hex: "1E1B18").opacity(0.8))

            Divider()

            // Project Agents (Compact)
            if viewModel.projects.isEmpty {
                VStack(alignment: .center, spacing: 8) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 24))
                        .foregroundColor(.gray)

                    Text("No active projects")
                        .font(.caption)
                        .foregroundColor(.gray)
                }
                .frame(maxWidth: .infinity)
                .padding(16)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(viewModel.projects, id: \.self) { project in
                            CompactProjectCard(
                                project: project,
                                agents: viewModel.agents.filter { $0.project == project }
                            )
                        }
                    }
                    .padding(12)
                }
                .frame(maxHeight: 300)
            }

            Divider()

            // Quick Actions
            HStack(spacing: 8) {
                Button(action: { viewModel.refresh() }) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .font(.caption)
                }
                .buttonStyle(.bordered)

                Spacer()

                Button(action: { isExpanded = true }) {
                    Label("Configure", systemImage: "slider.horizontal.3")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
            }
            .padding(12)
            .background(Color.init(hex: "1E1B18").opacity(0.5))
        }
        .frame(width: 400)
        .onAppear {
            viewModel.startPolling()
        }
    }
}

struct CompactProjectCard: View {
    let project: String
    let agents: [AgentModel]

    var activeAgents: Int { agents.filter { $0.isActive }.count }
    var recentStories: Int { agents.reduce(0) { $0 + $1.recentStoryCount } }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(project)
                        .font(.system(.caption, design: .monospaced))
                        .fontWeight(.semibold)

                    HStack(spacing: 8) {
                        Label("\(agents.count)", systemImage: "antenna.radiowaves.left.and.right")
                            .font(.system(size: 10))
                            .foregroundColor(.init(hex: "CC3D2E"))

                        Label("\(recentStories)", systemImage: "clock.badge")
                            .font(.system(size: 10))
                            .foregroundColor(.init(hex: "D4C5A9"))
                    }
                }

                Spacer()

                if activeAgents > 0 {
                    VStack(alignment: .center, spacing: 2) {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 8, height: 8)

                        Text("\(activeAgents)")
                            .font(.system(size: 10, weight: .semibold))
                    }
                }
            }

            // Agent microcards
            HStack(spacing: 4) {
                ForEach(agents.prefix(3), id: \.id) { agent in
                    Text(agent.name.prefix(3).uppercased())
                        .font(.system(size: 8, weight: .semibold))
                        .frame(width: 20, height: 20)
                        .background(agentColor(agent))
                        .foregroundColor(.white)
                        .cornerRadius(3)
                }

                if agents.count > 3 {
                    Text("+\(agents.count - 3)")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundColor(.gray)
                }
            }
        }
        .padding(8)
        .background(Color.init(hex: "2A2622"))
        .cornerRadius(6)
    }

    private func agentColor(_ agent: AgentModel) -> Color {
        if !agent.isActive { return Color.gray }
        return Color(hue: Double(agent.id.hashValue % 360) / 360, saturation: 0.6, brightness: 0.8)
    }
}

// MARK: - Expanded Mode (Full Dashboard)

struct ExpandedDashboardView: View {
    @Binding var isExpanded: Bool
    @ObservedObject var viewModel: FleetLiveViewModel
    @State private var selectedTab: DashboardTab = .stories

    enum DashboardTab {
        case stories
        case triggers
        case channels
        case config
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("PortDaddy Fleet Config")
                    .font(.headline)

                Spacer()

                Button(action: { isExpanded = false }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .background(Color.init(hex: "1E1B18"))
            .border(Color.init(hex: "CC3D2E"), width: 1)

            // Tab Navigation
            HStack(spacing: 0) {
                TabButton("Stories", tab: .stories, selectedTab: $selectedTab)
                TabButton("Triggers", tab: .triggers, selectedTab: $selectedTab)
                TabButton("Channels", tab: .channels, selectedTab: $selectedTab)
                TabButton("Config", tab: .config, selectedTab: $selectedTab)
            }
            .background(Color.init(hex: "2A2622"))

            // Content
            Group {
                switch selectedTab {
                case .stories:
                    StoriesTabView(viewModel: viewModel)
                case .triggers:
                    TriggersTabView(viewModel: viewModel)
                case .channels:
                    ChannelsTabView(viewModel: viewModel)
                case .config:
                    ConfigTabView(viewModel: viewModel)
                }
            }

            Spacer()
        }
        .frame(width: 800, height: 600)
        .background(Color.init(hex: "1A1816"))
    }
}

struct TabButton: View {
    let label: String
    let tab: ExpandedDashboardView.DashboardTab
    @Binding var selectedTab: ExpandedDashboardView.DashboardTab

    var isSelected: Bool { selectedTab == tab }

    var body: some View {
        Button(action: { selectedTab = tab }) {
            Text(label)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(isSelected ? .white : .gray)
                .frame(maxWidth: .infinity)
                .padding(12)
                .background(isSelected ? Color.init(hex: "CC3D2E") : Color.clear)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Tab Views

struct StoriesTabView: View {
    @ObservedObject var viewModel: FleetLiveViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Agent Stories & Timeline")
                .font(.headline)
                .padding(.horizontal, 16)
                .padding(.top, 16)

            // TODO: Stories timeline with artifacts
            VStack(alignment: .center, spacing: 8) {
                Image(systemName: "clock.badge")
                    .font(.system(size: 32))
                    .foregroundColor(.gray)

                Text("Coming soon: Agent timelines, decisions, artifacts")
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            .frame(maxWidth: .infinity)
            .padding(32)

            Spacer()
        }
    }
}

struct TriggersTabView: View {
    @ObservedObject var viewModel: FleetLiveViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Triggers & Events")
                .font(.headline)
                .padding(.horizontal, 16)
                .padding(.top, 16)

            // TODO: File → Agent trigger visualization
            VStack(alignment: .center, spacing: 8) {
                Image(systemName: "bolt.badge")
                    .font(.system(size: 32))
                    .foregroundColor(.gray)

                Text("Coming soon: Event → Agent trigger mapping")
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            .frame(maxWidth: .infinity)
            .padding(32)

            Spacer()
        }
    }
}

struct ChannelsTabView: View {
    @ObservedObject var viewModel: FleetLiveViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Message Channels")
                .font(.headline)
                .padding(.horizontal, 16)
                .padding(.top, 16)

            // TODO: Radio visualization — who's listening/broadcasting
            VStack(alignment: .center, spacing: 8) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 32))
                    .foregroundColor(.gray)

                Text("Coming soon: Agent radios and channel visibility")
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            .frame(maxWidth: .infinity)
            .padding(32)

            Spacer()
        }
    }
}

struct ConfigTabView: View {
    @ObservedObject var viewModel: FleetLiveViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Fleet Configuration")
                .font(.headline)
                .padding(.horizontal, 16)
                .padding(.top, 16)

            // TODO: Prompt editor, trigger editor, add new agent
            VStack(alignment: .center, spacing: 8) {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 32))
                    .foregroundColor(.gray)

                Text("Coming soon: Visual config editor with YAML sync")
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            .frame(maxWidth: .infinity)
            .padding(32)

            Spacer()
        }
    }
}

// MARK: - Data Models

struct AgentModel: Identifiable {
    let id: String
    let name: String
    let project: String
    let isActive: Bool
    let recentStoryCount: Int
    let listeningChannels: [String]
    let broadcastingChannels: [String]
}

class FleetLiveViewModel: ObservableObject {
    @Published var projects: [String] = []
    @Published var agents: [AgentModel] = []
    @Published var isLoading = false
    @Published var lastError: String?

    private var pollingTimer: Timer?
    private let portDaddyURL = "http://localhost:9876"

    func startPolling() {
        refresh()
        pollingTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    func stopPolling() {
        pollingTimer?.invalidate()
    }

    func refresh() {
        Task {
            await fetchFleetData()
        }
    }

    @MainActor
    private func fetchFleetData() async {
        isLoading = true

        do {
            let url = URL(string: "\(portDaddyURL)/fleet")!
            let (data, _) = try await URLSession.shared.data(from: url)

            let fleetStatus = try JSONDecoder().decode(FleetStatus.self, from: data)

            projects = fleetStatus.projects.map { $0.name }

            agents = fleetStatus.projects.flatMap { project in
                project.agents.map { agent in
                    AgentModel(
                        id: agent.id,
                        name: agent.name,
                        project: project.name,
                        isActive: agent.isActive,
                        recentStoryCount: agent.recentStories.count,
                        listeningChannels: agent.listeningChannels,
                        broadcastingChannels: agent.broadcastingChannels
                    )
                }
            }

            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }

        isLoading = false
    }

    deinit {
        stopPolling()
    }
}

// MARK: - API Response Models

struct FleetStatus: Codable {
    let projects: [ProjectStatus]
}

struct ProjectStatus: Codable {
    let name: String
    let agents: [AgentStatus]
}

struct AgentStatus: Codable {
    let id: String
    let name: String
    let isActive: Bool
    let recentStories: [String]
    let listeningChannels: [String]
    let broadcastingChannels: [String]
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let rgb = Int(hex, radix: 16)!

        let red = Double((rgb >> 16) & 0xFF) / 255.0
        let green = Double((rgb >> 8) & 0xFF) / 255.0
        let blue = Double(rgb & 0xFF) / 255.0

        self.init(red: red, green: green, blue: blue)
    }
}
