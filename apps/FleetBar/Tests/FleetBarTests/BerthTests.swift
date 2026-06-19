import XCTest
import SwiftUI
@testable import FleetBar

/// ADR-0084 Phase 2: FleetBar surfaces which daemon berth it is connected to.
/// These pin the wire contract (the `daemon.berth` object on `GET /status`) and
/// the hex-colour parsing the menu-bar chip depends on, so a daemon-side rename
/// or a malformed colour can't silently blank the indicator.
final class BerthTests: XCTestCase {
    private func decodeStatus(_ json: String) throws -> DaemonStatusResponse {
        try JSONDecoder().decode(DaemonStatusResponse.self, from: Data(json.utf8))
    }

    func testDecodesDevLatestBerthFromStatus() throws {
        let json = """
        {
          "status": "ok",
          "version": "3.20.0",
          "pid": 4242,
          "uptimeSeconds": 12,
          "uptimeHuman": "12s",
          "daemon": {
            "version": "3.20.0",
            "codeHash": "abc123",
            "startedAt": 1718800000000,
            "installDir": "/opt/pd",
            "nodeVersion": "v22.0.0",
            "berth": {
              "tier": "dev-latest",
              "label": "dev-latest",
              "color": "#3B82F6",
              "canonical": false,
              "port": 9886,
              "gitBranch": "main",
              "gitRev": "deadbee",
              "sourceDir": "/Users/x/port-daddy"
            }
          }
        }
        """
        let status = try decodeStatus(json)
        let berth = try XCTUnwrap(status.daemon?.berth)
        XCTAssertEqual(berth.tier, "dev-latest")
        XCTAssertEqual(berth.label, "dev-latest")
        XCTAssertEqual(berth.color, "#3B82F6")
        XCTAssertFalse(berth.canonical)
        XCTAssertEqual(berth.port, 9886)
        XCTAssertEqual(berth.gitBranch, "main")
    }

    /// A daemon that predates berth self-identity omits `berth` entirely. The
    /// chip must treat that as the canonical stable berth, not crash decoding.
    func testLegacyDaemonWithoutBerthDecodesToNil() throws {
        let json = """
        {
          "status": "ok",
          "version": "3.10.0",
          "pid": 99,
          "uptimeSeconds": 1,
          "uptimeHuman": "1s",
          "daemon": {
            "version": "3.10.0",
            "codeHash": "old",
            "startedAt": 1718000000000,
            "installDir": "/opt/pd",
            "nodeVersion": "v20.0.0"
          }
        }
        """
        let status = try decodeStatus(json)
        XCTAssertNotNil(status.daemon)
        XCTAssertNil(status.daemon?.berth)
    }

    func testHexParsesSixDigit() throws {
        let c = try XCTUnwrap(Fleet.Color.hex("#A855F7"))
        // Round-trip the components rather than compare opaque Color values.
        let resolved = c.resolveComponents()
        XCTAssertEqual(resolved.red, 0xA8 / 255.0, accuracy: 0.01)
        XCTAssertEqual(resolved.green, 0x55 / 255.0, accuracy: 0.01)
        XCTAssertEqual(resolved.blue, 0xF7 / 255.0, accuracy: 0.01)
    }

    func testHexParsesThreeDigitShorthand() throws {
        let c = try XCTUnwrap(Fleet.Color.hex("#0af"))
        let resolved = c.resolveComponents()
        XCTAssertEqual(resolved.red, 0.0, accuracy: 0.01)
        XCTAssertEqual(resolved.green, 0xAA / 255.0, accuracy: 0.01)
        XCTAssertEqual(resolved.blue, 0xFF / 255.0, accuracy: 0.01)
    }

    func testHexRejectsMalformed() {
        XCTAssertNil(Fleet.Color.hex("not-a-color"))
        XCTAssertNil(Fleet.Color.hex("#12"))
        XCTAssertNil(Fleet.Color.hex("#GGGGGG"))
    }
}

private extension SwiftUI.Color {
    /// Pull RGB components in a test-friendly way across platforms.
    func resolveComponents() -> (red: Double, green: Double, blue: Double) {
        let ns = NSColor(self).usingColorSpace(.sRGB) ?? NSColor(self)
        return (Double(ns.redComponent), Double(ns.greenComponent), Double(ns.blueComponent))
    }
}
