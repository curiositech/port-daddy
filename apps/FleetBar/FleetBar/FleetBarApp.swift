import SwiftUI
import AppKit

enum FleetBarAppChrome {
    private static let controlCenterWindowIdentifier = "fleet-control-center"

    @MainActor
    static func setDockVisible(_ visible: Bool) {
        NSApp.setActivationPolicy(visible ? .regular : .accessory)
    }

    @MainActor
    static func presentControlCenter() {
        setDockVisible(true)
        NSApp.activate(ignoringOtherApps: true)
    }

    @MainActor
    static func focusExistingControlCenter() -> Bool {
        guard let window = NSApp.windows.first(where: {
            $0.identifier?.rawValue == controlCenterWindowIdentifier || $0.title == "Fleet Control Center"
        }) else {
            return false
        }
        setDockVisible(true)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return true
    }
}

/// Hosts launch-time AppKit concerns that SwiftUI's `App` lifecycle does not
/// expose directly — currently the single-instance guard.
final class FleetBarAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // One FleetBar per build. If a newer peer already owns the menu bar, quit
        // rather than stack a second icon.
        if case .yield = SingleInstanceGuard.enforce() {
            NSApp.terminate(nil)
        }
    }
}

@main
struct FleetBarApp: App {
    private static let controlCenterWindowID = "fleet-control-center"
    @NSApplicationDelegateAdaptor(FleetBarAppDelegate.self) private var appDelegate
    @StateObject private var store = FleetStore()
    @StateObject private var costStore = CostStore()
    @StateObject private var secretsStore = SecretsStore()
    @StateObject private var dispatchStore = DispatchStore()
    @StateObject private var backendStore = BackendStore()

    var body: some Scene {
        MenuBarExtra {
            FleetPopover(store: store, costStore: costStore, secretsStore: secretsStore, backendStore: backendStore)
                .frame(width: 440, height: 760)
        } label: {
            FleetMenuBarLabel(icon: store.menuBarIcon, color: store.menuBarColor)
        }
        .menuBarExtraStyle(.window)

        WindowGroup("Fleet Control Center", id: Self.controlCenterWindowID) {
            FleetControlCenter(store: store, costStore: costStore, dispatchStore: dispatchStore, backendStore: backendStore)
        }
        .defaultSize(width: 1360, height: 860)

        // Standard macOS Settings window hosts the Secrets pane. Reachable via
        // the popover footer and the app menu (Cmd-,).
        Settings {
            FleetSettingsWindow(secretsStore: secretsStore)
        }
    }
}

/// Settings (Preferences) window. Currently a single Secrets pane; structured
/// as a TabView so future panes drop in alongside it.
struct FleetSettingsWindow: View {
    @ObservedObject var secretsStore: SecretsStore

    var body: some View {
        TabView {
            SecretsView(store: secretsStore)
                .tabItem {
                    Label("Secrets", systemImage: "key.fill")
                }
        }
        .frame(width: 520, height: 600)
    }
}

struct FleetMenuBarLabel: View {
    let icon: String
    let color: Color
    /// Set for non-production builds so a dev FleetBar is visibly distinct from the
    /// installed one. `nil` on the shipped app.
    var devBadge: String? = AppChannel.current.menuBarBadge

    /// Per-channel accent so a dev FleetBar is a visibly different colour in the
    /// menu bar; `nil` on production, where we keep the daemon-state colour.
    private var channelAccent: Color? {
        AppChannel.current.accentColorHex.flatMap { Fleet.Color.hex($0) }
    }

    var body: some View {
        let tint = channelAccent ?? color
        HStack(spacing: 3) {
            Image(systemName: icon)
                .symbolRenderingMode(.monochrome)
                .foregroundStyle(tint)
            if let devBadge {
                // Uppercase, bold, tracked-out tag — reads larger than its point
                // size, the only sanctioned small-label form.
                Text(devBadge)
                    .font(.system(size: 9, weight: .heavy))
                    .tracking(0.5)
                    .foregroundStyle(tint)
                    .accessibilityLabel("development build \(devBadge)")
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(devBadge == nil ? "Fleet" : "Fleet — development build")
    }
}
