+import XCTest
@testable import FleetBar

class TestLegacyConsoleUrlInProduction: XCTestCase {
    func testLegacyConsoleUrlDoesNotOverridePublishedPort() throws {
        let home = try makeHome()
        try write("http://127.0.0.1:9900\n", to: ".port-daddy/console.daemon.url", home: home)
        try write("3174\n", to: ".port-daddy/daemon.port", home: home)
        
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .production,
                environment: [:],
                homeDirectory: home
            ),
            "http://127.0.0.1:3174"
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