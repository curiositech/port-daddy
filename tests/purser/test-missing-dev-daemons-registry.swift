+import XCTest
@testable import FleetBar

class TestMissingDevDaemonsRegistry: XCTestCase {
    func testMissingDevDaemonsRegistryFallsBackToZero() throws {
        let home = try makeHome()
        
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .dev(label: "squid-3-28-rc"),
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