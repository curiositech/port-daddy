import SwiftUI

@main
struct FleetBarApp: App {
    private static let controlCenterWindowID = "fleet-control-center"
    @StateObject private var store = FleetStore()
    @StateObject private var costStore = CostStore()

    var body: some Scene {
        MenuBarExtra {
            FleetPopover(store: store, costStore: costStore)
                .frame(width: 380, height: 520)
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

        WindowGroup("Fleet Control Center", id: Self.controlCenterWindowID) {
            FleetControlCenter(store: store, costStore: costStore)
        }
    }
}
