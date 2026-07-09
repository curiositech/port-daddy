import SwiftUI
import AppKit

// MARK: - Operator Console Launcher
//
// Launches pd-console — the GPU-native operator console (ADR-0046). It opens its
// OWN native window, so we launch it as a GUI app, not inside a terminal.
//
// pd-console now ships in three *lanes* (core/pd-console/scripts/package-console.sh):
//   prod   → ~/Applications/pd-console-prod.app
//   latest → ~/Applications/pd-console-latest.app
//   dev    → ~/Applications/pd-console-dev-apps/pd-console_dev-<name>.app   (any number)
// plus the legacy single ~/Applications/pd-console.app for older installs.
//
// FleetBar discovers every lane on disk and offers a button per lane. Each launch
// can target a specific daemon berth (ADR-0084) by exporting PORT_DADDY_URL into
// the launched process — so "pd-console-latest pointed at the dev-latest daemon"
// is one click. The console's own in-app daemon picker can switch afterwards.

// MARK: - Console app model

/// A pd-console bundle discovered on disk, tagged by its build lane.
struct ConsoleApp: Identifiable, Hashable {
    enum Lane: Hashable {
        case prod
        case latest
        case dev(String)
        case legacy
    }

    let lane: Lane
    let path: String

    var id: String { path }

    /// Short human label for the button.
    var label: String {
        switch lane {
        case .prod:          return "Prod"
        case .latest:        return "Latest"
        case .dev(let name): return "Dev · \(name)"
        case .legacy:        return "Console"
        }
    }

    /// Lane tint — mirrors the Dock badge colours package-console.sh paints
    /// (prod blue, latest green, dev amber) so the FleetBar button matches the app.
    var tintHex: String {
        switch lane {
        case .prod:   return "#2563eb"
        case .latest: return "#10b981"
        case .dev:    return "#f59e0b"
        case .legacy: return "#6b7280"
        }
    }

    var tint: Color { Fleet.Color.hex(tintHex) ?? Fleet.Color.active }

    /// SF Symbol distinguishing the lane at a glance.
    var icon: String {
        switch lane {
        case .prod:   return "shippingbox.fill"
        case .latest: return "sparkles"
        case .dev:    return "hammer.fill"
        case .legacy: return "macwindow"
        }
    }

    /// Stable ordering for the button group: prod, latest, dev (a→z), legacy.
    var sortKey: String {
        switch lane {
        case .prod:          return "0"
        case .latest:        return "1"
        case .dev(let name): return "2\(name.lowercased())"
        case .legacy:        return "3"
        }
    }
}

enum OperatorConsoleLauncher {

    // MARK: - Discovery

    private static var home: String {
        FileManager.default.homeDirectoryForCurrentUser.path
    }

    /// Every pd-console bundle present on disk, ordered prod → latest → dev → legacy.
    static func discoverApps() -> [ConsoleApp] {
        let fm = FileManager.default
        var apps: [ConsoleApp] = []

        let prod = "\(home)/Applications/pd-console-prod.app"
        if fm.fileExists(atPath: prod) { apps.append(ConsoleApp(lane: .prod, path: prod)) }

        let latest = "\(home)/Applications/pd-console-latest.app"
        if fm.fileExists(atPath: latest) { apps.append(ConsoleApp(lane: .latest, path: latest)) }

        // Named dev builds live in their own folder, one .app per worktree/feature.
        let devDir = "\(home)/Applications/pd-console-dev-apps"
        if let entries = try? fm.contentsOfDirectory(atPath: devDir) {
            for entry in entries
            where entry.hasPrefix("pd-console_dev-") && entry.hasSuffix(".app") {
                let name = entry
                    .replacingOccurrences(of: "pd-console_dev-", with: "")
                    .replacingOccurrences(of: ".app", with: "")
                apps.append(ConsoleApp(lane: .dev(name), path: "\(devDir)/\(entry)"))
            }
        }

        // Legacy single-app installs (pre-lane) — only if no lane app was found,
        // so we don't show a redundant "Console" beside "Prod".
        if apps.isEmpty {
            for legacy in ["\(home)/Applications/pd-console.app", "/Applications/pd-console.app"]
            where fm.fileExists(atPath: legacy) {
                apps.append(ConsoleApp(lane: .legacy, path: legacy))
            }
        }

        return apps.sorted { $0.sortKey < $1.sortKey }
    }

    /// First raw pd-console binary that exists on disk (fallback when no .app).
    static func resolvedBinaryPath() -> String? {
        let candidates: [String] = [
            "\(home)/.port-daddy/bin/pd-console",
            "/usr/local/bin/pd-console",
            "/opt/homebrew/bin/pd-console",
        ]
        for path in candidates where FileManager.default.fileExists(atPath: path) {
            return path
        }
        if let pathResult = runShellCapture("/usr/bin/which", args: ["pd-console"]),
           !pathResult.isEmpty {
            return pathResult
        }
        return nil
    }

    /// True when pd-console can be launched somehow (any lane app or a raw binary).
    static func isInstalled() -> Bool {
        !discoverApps().isEmpty || resolvedBinaryPath() != nil
    }

    // MARK: - Launch

    /// Launch a specific console bundle, optionally pinned to a daemon berth's URL
    /// (exported as PORT_DADDY_URL so pd-console's DaemonClient::discover follows it).
    @MainActor
    static func launch(app: ConsoleApp, daemonURL: String? = nil) {
        let url = URL(fileURLWithPath: app.path)
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        if let daemonURL, !daemonURL.isEmpty {
            config.environment = ["PORT_DADDY_URL": daemonURL]
        }
        NSWorkspace.shared.openApplication(at: url, configuration: config)
    }

    /// Back-compat: launch the best available console (first lane, else raw binary)
    /// against the default daemon. Used by call-sites that don't pick a lane.
    @MainActor
    static func launch() {
        if let app = discoverApps().first {
            launch(app: app, daemonURL: nil)
            return
        }
        if let binaryPath = resolvedBinaryPath() {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: binaryPath)
            try? task.run()
        }
    }

    // MARK: - Private helpers

    private static func runShellCapture(_ command: String, args: [String] = []) -> String? {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: command)
        task.arguments = args
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n").first
    }
}

// MARK: - Console routing policy

/// Where FleetBar's general "Control Center" action opens.
enum OperatorConsoleTarget: Equatable {
    /// pd-console — the GPU-native Rust cockpit (preferred when installed).
    case native
    /// The embedded web control plane (fallback for machines without pd-console).
    case web
}

enum OperatorConsoleRouter {
    /// pd-console is the operator console when it's installed; the embedded web
    /// control plane is the fallback. This governs only the *general* "open the
    /// console" action — surface deep-links (yaml editing, a specific agent's
    /// activity) keep using the web view, which supports them and pd-console does
    /// not yet. Pure so the policy is unit-tested without launching anything.
    static func target(nativeInstalled: Bool) -> OperatorConsoleTarget {
        nativeInstalled ? .native : .web
    }
}

// MARK: - SwiftUI integration

/// A Button that launches the best available pd-console against the default daemon.
/// Kept for call-sites that just want "open the console"; the richer per-lane,
/// per-daemon picker is `ConsoleLauncherSection`.
struct LaunchOperatorConsoleButton: View {
    @State private var showingNotFoundAlert = false

    var body: some View {
        Button {
            if OperatorConsoleLauncher.isInstalled() {
                OperatorConsoleLauncher.launch()
            } else {
                showingNotFoundAlert = true
            }
        } label: {
            Label("Open Operator Console", systemImage: "macwindow")
                .font(.caption2.weight(.semibold))
        }
        .buttonStyle(.borderless)
        .foregroundStyle(Fleet.Color.active)
        .help("Open pd-console — the GPU-native operator console window")
        .alert("pd-console not found", isPresented: $showingNotFoundAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(ConsoleLauncherSection.installHint)
        }
    }
}

/// The Tools section the user asked for: a "Fleet Control Center" button plus a
/// button-group for every installed pd-console lane (prod / latest / dev-NAME).
/// Each console button is a menu that lets the operator pick which daemon berth
/// to launch it against (names, not ports). Tapping the button launches against
/// the active daemon.
struct ConsoleLauncherSection: View {
    /// Discovered berths (daemons) to offer as launch targets.
    let berths: [Berth]
    /// The currently-active daemon URL (the plain-tap target).
    let activeDaemonURL: String?
    /// Opens the in-app Fleet Control Center window.
    let openControlCenter: () -> Void
    /// Opens the Fleet Control Center directly to the Cloud Fleet surface.
    let openCloudFleet: () -> Void
    /// Opens the Fleet Control Center directly to visual task intake.
    let openVisualTask: () -> Void

    @State private var apps: [ConsoleApp] = OperatorConsoleLauncher.discoverApps()

    static let installHint = """
    pd-console isn't installed yet. Build a lane with:

      core/pd-console/scripts/package-console.sh --prod      (pd-console-prod.app)
      core/pd-console/scripts/package-console.sh --latest    (pd-console-latest.app)
      core/pd-console/scripts/package-console.sh --devbuild <name>

    or place the binary at ~/.port-daddy/bin/pd-console.
    """

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            Text("TOOLS")
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(Fleet.Chrome.tertiaryText)

            toolAction(
                title: "Fleet Control Center",
                subtitle: "Open the operator window",
                systemImage: "sailboat.fill",
                color: Fleet.Color.active,
                action: openControlCenter
            )
            .help("Open the Fleet Control Center window")

            toolAction(
                title: "Cloud Fleet",
                subtitle: "Local daemon + remote runs",
                systemImage: "cloud",
                color: Fleet.Color.active,
                action: openCloudFleet
            )
            .help("Open Cloud Fleet local and remote activity")

            toolAction(
                title: "Send Visual Task",
                subtitle: "Annotate a screenshot for an agent",
                systemImage: "viewfinder",
                color: Fleet.Color.healthy,
                action: openVisualTask
            )
            .help("Open Fleet Control Center to visual task intake")

            if apps.isEmpty {
                Text("pd-console not installed — run package-console.sh --prod / --latest")
                    .font(.caption2)
                    .foregroundStyle(Fleet.Chrome.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(apps) { app in
                    consoleRow(app)
                }
            }
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.s)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { apps = OperatorConsoleLauncher.discoverApps() }
    }

    private func toolAction(
        title: String,
        subtitle: String,
        systemImage: String,
        color: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: Fleet.Space.s) {
                Image(systemName: systemImage)
                    .font(.system(.caption, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(color)
                    .frame(width: 22, height: 22)
                    .background(
                        color.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(Fleet.Chrome.tertiaryText)
                        .lineLimit(1)
                }

                Spacer(minLength: Fleet.Space.s)
            }
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, Fleet.Space.s)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                color.opacity(0.07),
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    .stroke(color.opacity(0.18), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    @ViewBuilder
    private func consoleRow(_ app: ConsoleApp) -> some View {
        HStack(spacing: Fleet.Space.s) {
            // Primary tap: launch against the active daemon.
            Button {
                OperatorConsoleLauncher.launch(app: app, daemonURL: activeDaemonURL)
            } label: {
                Label("pd-console · \(app.label)", systemImage: app.icon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(app.tint)
            }
            .buttonStyle(.borderless)
            .help("Launch pd-console (\(app.label)) against the active daemon")

            Spacer(minLength: 0)

            // Per-daemon launch: pick which berth this build talks to.
            if !berths.isEmpty {
                Menu {
                    ForEach(berths) { berth in
                        Button {
                            OperatorConsoleLauncher.launch(app: app, daemonURL: berth.url)
                        } label: {
                            Text("\(berth.label)  ·  :\(berth.port)")
                        }
                    }
                } label: {
                    Image(systemName: "point.3.connected.trianglepath.dotted")
                        .font(.caption2)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("Launch \(app.label) against a specific daemon berth")
            }
        }
    }
}
