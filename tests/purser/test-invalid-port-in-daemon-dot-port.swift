+import XCTest
@testable import FleetBar

class TestInvalidPortInDaemonDotPort: XCTestCase {
    func testNonNumericPortFallsBackToZero() throws {
        let home = try makeHome()
        try write("invalid", to: ".port-daddy/daemon.port", home: home)
        
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .production,
                environment: [:],
                homeDirectory: home
            ),
            "http://127.0.0.1:0"
        )
    }

    private func makeHome() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("fleetbar-daemon-location-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }
}