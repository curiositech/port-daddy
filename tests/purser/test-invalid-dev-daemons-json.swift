+import XCTest
@testable import FleetBar

class TestInvalidDevDaemonsJSON: XCTestCase {
    func testInvalidJSONInDevDaemonsRegistryFallsBackToZero() throws {
        let home = try makeHome()
        try write("{ invalid json }", to: ".port-daddy/dev-daemons.json", home: home)
        
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

    private func write(_ value: String, to relativePath: String, home: URL) throws {
        let destination = home.appendingPathComponent(relativePath)
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data(value.utf8).write(to: destination, options: .atomic)
    }
}