// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PortholeMediaKit",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "PortholeMediaKit", targets: ["PortholeMediaKit"])],
    targets: [.target(name: "PortholeMediaKit"),
              .testTarget(name: "PortholeMediaKitTests", dependencies: ["PortholeMediaKit"])],
    swiftLanguageModes: [.v5]
)
