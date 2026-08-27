import SwiftUI
import PortDaddyKit

// The iOS app's `@main` entry point.
//
// This file is deliberately NOT compiled by apps/pd-ios/Package.swift, because
// SwiftPM cannot build an iOS .app bundle. It is the one file the Xcode app
// target will own once a distribution lane exists; until then nothing compiles
// it and CI does not prove it. Keep it this small — every line with judgement
// in it belongs in PortDaddyKit, where the simulator build and the XCTest
// suite can hold it to account.
@main
struct PortDaddyApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
