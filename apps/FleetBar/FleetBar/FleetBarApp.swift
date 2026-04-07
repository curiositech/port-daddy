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

@main
struct FleetBarApp: App {
    private static let controlCenterWindowID = "fleet-control-center"
    @StateObject private var store = FleetStore()
    @StateObject private var costStore = CostStore()

    var body: some Scene {
        MenuBarExtra {
            FleetPopover(store: store, costStore: costStore)
                .frame(width: 440, height: 760)
        } label: {
            Label {
                Text("Fleet")
            } icon: {
                Image(systemName: store.menuBarIcon)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(store.menuBarColor)
            }
        }
        .menuBarExtraStyle(.window)

        Window("Fleet Control Center", id: Self.controlCenterWindowID) {
            FleetControlCenter(store: store, costStore: costStore)
        }
        .defaultSize(width: 1360, height: 860)
    }
}
