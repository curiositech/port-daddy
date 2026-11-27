import SwiftUI
import PortDaddyKit

@main
struct PortDaddyApp: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            // The existing hosted fixture capture lane can set a known theme
            // and text size. A normal launch follows the system; the Release
            // binary never interprets these arguments.
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("--relay-proof-light") {
                proofView(.light, ax5: arguments.contains("--relay-proof-ax5"))
            } else if arguments.contains("--relay-proof-dark") {
                proofView(.dark, ax5: arguments.contains("--relay-proof-ax5"))
            } else {
                RelayBetaView()
            }
            #else
            RelayBetaView()
            #endif
        }
    }

    #if DEBUG
    @ViewBuilder
    private func proofView(_ scheme: ColorScheme, ax5: Bool) -> some View {
        if ax5 {
            RelayBetaView().preferredColorScheme(scheme).dynamicTypeSize(.accessibility5)
        } else {
            RelayBetaView().preferredColorScheme(scheme).dynamicTypeSize(.large)
        }
    }
    #endif
}
