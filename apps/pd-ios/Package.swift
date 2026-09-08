// swift-tools-version: 6.0
import PackageDescription

// Port Daddy iOS operator surface (ADR-0125), defined the way every other
// Swift surface in this repo is defined: a SwiftPM package, no .xcodeproj,
// no XcodeGen, no Tuist. apps/FleetBar/Package.swift is the pattern this
// mirrors, including the non-default `path:` overrides (sources next to the
// manifest rather than under Sources/).
//
// Two deliberate differences from FleetBar:
//
//  1. The compiled target is a LIBRARY, not an executableTarget. `swift build`
//     cannot target iOS, so the compile gate is
//     `xcodebuild -destination 'generic/platform=iOS Simulator'` against this
//     package's generated scheme (see .github/workflows/ci.yml, job `pd-ios`).
//     A library target is what xcodebuild can build and test for a simulator
//     without an Xcode project existing.
//
//  2. No dependencies. FleetBar pulls ViewInspector for SwiftUI assertions;
//     this package keeps the gate hermetic and puts the testable logic in
//     plain value types (ControlVerbs, MaritimeSignals, RoadmapProjection)
//     instead of asserting against view trees.
//
// The app's `@main` entry lives in App/PortDaddyApp.swift, which is NOT part
// of any target here — SwiftPM cannot produce an iOS .app bundle. It is six
// lines of shim for the Xcode app target that the distribution lane will add.
// Everything with logic in it lives in PortDaddyKit and is therefore compiled
// and tested by CI.
// The package, the library product and the target all share one name so that
// `xcodebuild -scheme PortDaddyKit` is unambiguous — a package whose name and
// product differ generates two schemes and CI has to guess which one carries
// the test action.
let package = Package(
    name: "PortDaddyKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "PortDaddyKit", targets: ["PortDaddyKit"]),
    ],
    targets: [
        .target(
            name: "PortDaddyKit",
            path: "PortDaddy",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "PortDaddyKitTests",
            dependencies: ["PortDaddyKit"],
            path: "Tests"
        ),
    ]
)
