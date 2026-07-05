import XCTest
@testable import FleetBar

/// Pins the "Control Center opens pd-console when installed" policy: the general
/// console action prefers the GPU-native Rust cockpit and falls back to the web
/// control plane only when pd-console isn't on disk.
final class OperatorConsoleRouterTests: XCTestCase {
    func testPrefersNativeConsoleWhenInstalled() {
        XCTAssertEqual(OperatorConsoleRouter.target(nativeInstalled: true), .native)
    }

    func testFallsBackToWebWhenNotInstalled() {
        XCTAssertEqual(OperatorConsoleRouter.target(nativeInstalled: false), .web)
    }
}
