+import XCTest
@testable import FleetBar

class TestEmptyExplicitURL: XCTestCase {
    func testEmptyEnvironmentURLIsIgnored() throws {
        let home = try makeHome()
        
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .production,
                environment: ["PORT_DADDY_URL": ""],
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