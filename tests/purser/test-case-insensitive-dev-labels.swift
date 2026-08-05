+import XCTest
@testable import FleetBar

class TestCaseInsensitiveDevLabels: XCTestCase {
    func testDevLabelCaseInsensitivity() throws {
        let home = try makeHome()
        try write(
            "[{
                \"label\": \"DevLatest\",
                \"tier\": \"devlatest\",
                \"port\": 3174
            }]",
            to: ".port-daddy/dev-daemons.json",
            home: home
        )
        
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .dev(label: "DEVLATEST"),
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