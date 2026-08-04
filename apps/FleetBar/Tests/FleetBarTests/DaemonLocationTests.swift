import XCTest
@testable import FleetBar

final class DaemonLocationTests: XCTestCase {
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

    func testProductionUsesThePublishedDynamicPort() throws {
        let home = try makeHome()
        try write("3174\n", to: ".port-daddy/daemon.port", home: home)

        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(channel: .production, environment: [:], homeDirectory: home),
            "http://127.0.0.1:3174"
        )
    }

    func testLegacyConsoleSelectorCannotShadowThePublishedEndpoint() throws {
        let home = try makeHome()
        let legacyName = ["console", "daemon", "url"].joined(separator: ".")
        try write("http://127.0.0.1:9900\n", to: ".port-daddy/\(legacyName)", home: home)
        try write("3174\n", to: ".port-daddy/daemon.port", home: home)

        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(channel: .production, environment: [:], homeDirectory: home),
            "http://127.0.0.1:3174"
        )
    }

    func testDevBuildUsesItsNamedBerthRegistryEntry() throws {
        let home = try makeHome()
        try write(
            """
            [{"label":"squid-3-28-rc","tier":"codebase","port":3174,
              "sourceDir":"/worktree","pid":42,"gitRev":"abc123","color":"#A855F7"}]
            """,
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

    func testMissingNamedBerthDoesNotSilentlyFallBackToStable() throws {
        let home = try makeHome()
        try write("3174\n", to: ".port-daddy/daemon.port", home: home)

        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .dev(label: "missing-feature"),
                environment: [:],
                homeDirectory: home
            ),
            "http://127.0.0.1:0"
        )
    }

    func testExplicitNamedDaemonURLWins() throws {
        let home = try makeHome()
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(
                channel: .production,
                environment: ["PORT_DADDY_URL": "http://127.0.0.1:4319/"],
                homeDirectory: home
            ),
            "http://127.0.0.1:4319"
        )
    }
}
