import SwiftUI

@main
struct FleetBarApp: App {
    @StateObject private var store = FleetStore()

    var body: some Scene {
        MenuBarExtra {
            FleetPopover(store: store)
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
    }
}
