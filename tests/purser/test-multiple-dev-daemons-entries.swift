+import XCTest
@testable import FleetBar

class TestMultipleDevDaemonsEntries: XCTestCase {
    func testMultipleEntriesSelectsCorrectLabel() throws {
        let home = try makeHome()
        try write(
            "[{
                \"label\": \"squid-3-28-rc\",
                \"tier\": \"codebase\",
                \"port\": 3174
            }, {
                \"label\": \"other\",
                \"tier\": \"codebase\",
                \"port\": 4242
            }]",
            to: ".port-daddy/dev-daemons.json",
            home: home
        )
        
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .dev(label: "squid-3-28-rc"),
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