// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FleetBar",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/nalexn/ViewInspector", from: "0.10.3"),
    ],
    targets: [
        .executableTarget(
            name: "FleetBar",
            path: "FleetBar"
        ),
        .testTarget(
            name: "FleetBarTests",
            dependencies: [
                "FleetBar",
                .product(name: "ViewInspector", package: "ViewInspector"),
            ],
            path: "Tests"
        ),
    ]
)
