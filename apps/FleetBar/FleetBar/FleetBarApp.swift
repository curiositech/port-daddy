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
    @StateObject private var proposalStore = FleetProposalStore()
    @StateObject private var backendStore = BackendStore()
    @StateObject private var interruptionsStore = InterruptionsStore()
    @StateObject private var accountStore = OperatorAccountStore()

    var body: some Scene {
        MenuBarExtra {
            FleetPopover(
                store: store,
                costStore: costStore,
                secretsStore: secretsStore,
                backendStore: backendStore,
                interruptionsStore: interruptionsStore
            )
                .frame(width: 440, height: 760)
        } label: {
            FleetMenuBarLabel(
                icon: store.menuBarIcon,
                color: store.menuBarColor,
                interruptionCount: interruptionsStore.openCount,
                interruptionIsCritical: interruptionsStore.openCritical != nil
            )
        }
        .menuBarExtraStyle(.window)

        WindowGroup("Fleet Control Center", id: Self.controlCenterWindowID) {
            FleetControlCenter(
                store: store,
                costStore: costStore,
                dispatchStore: dispatchStore,
                proposalStore: proposalStore,
                backendStore: backendStore,
                interruptionsStore: interruptionsStore
            )
        }
        .defaultSize(width: 1360, height: 860)

        // Standard macOS Settings window hosts account and Secrets panes. Reachable via
        // the popover footer and the app menu (Cmd-,).
        Settings {
            FleetSettingsWindow(
                secretsStore: secretsStore,
                accountStore: accountStore,
                onAccountChanged: {
                    interruptionsStore.accountDidChange()
                }
            )
        }
    }
}

/// Settings (Preferences) window. Currently a single Secrets pane; structured
/// as a TabView so future panes drop in alongside it.
struct FleetSettingsWindow: View {
    @ObservedObject var secretsStore: SecretsStore
    @ObservedObject var accountStore: OperatorAccountStore
    var onAccountChanged: () -> Void = {}

    var body: some View {
        TabView {
            AccountSettingsView(store: accountStore, onConnectionChanged: onAccountChanged)
                .tabItem {
                    Label("Account", systemImage: "person.crop.circle")
                }
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

    /// Open operator-interruption count (nil = unknowable: signed out or a
    /// failed poll — the badge stays hidden rather than claiming zero).
    /// Non-zero renders a count badge; critical turns it red (HITL §4.2).
    var interruptionCount: Int? = nil
    var interruptionIsCritical: Bool = false

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
            if let interruptionCount, interruptionCount > 0 {
                Text("\(interruptionCount)")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(interruptionIsCritical ? Color.red : tint)
                    .accessibilityLabel("\(interruptionCount) open operator interruptions")
            }
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
