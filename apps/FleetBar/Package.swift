// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FleetBar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "FleetBar",
            path: "FleetBar"
        ),
    ]
)
