// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PortholeStageCapture",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "PortholeStageCore", targets: ["PortholeStageCore"]),
        .executable(name: "PortholeStageCapture", targets: ["PortholeStageCapture"]),
        .executable(name: "PortholeStageFixture", targets: ["PortholeStageFixture"]),
    ],
    targets: [
        .target(name: "PortholeStageCore"),
        .executableTarget(
            name: "PortholeStageCapture",
            dependencies: ["PortholeStageCore"]
        ),
        .executableTarget(
            name: "PortholeStageFixture",
            dependencies: ["PortholeStageCore"]
        ),
        .testTarget(
            name: "PortholeStageCoreTests",
            dependencies: ["PortholeStageCore"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
