import XCTest
@testable import FleetBar

/// Pins `DaemonLocation.resolveBaseURL`'s discovery precedence and — the
/// point of this file — that a missing or malformed published port file
/// fails closed to `unpublishedSentinelPort` instead of silently guessing
/// `canonicalPreferredPort`. A guess that happens to hit some unrelated
/// process listening on 9876 is worse than a connection FleetBar can see
/// fail immediately.
final class DaemonLocationTests: XCTestCase {

    private let production = AppChannel.production
    private let devLatest = AppChannel.dev(label: "dev-latest")

    func testExplicitURLWinsOverEverything() {
        let url = DaemonLocation.resolveBaseURL(
            channel: devLatest,
            environment: ["PORT_DADDY_URL": "http://127.0.0.1:54321"],
            portFileContents: { "9999" })
        XCTAssertEqual(url, "http://127.0.0.1:54321")
    }

    func testExplicitURLIsTrimmed() {
        let url = DaemonLocation.resolveBaseURL(
            channel: production,
            environment: ["PORT_DADDY_URL": "  http://127.0.0.1:54321  "],
            portFileContents: { nil })
        XCTAssertEqual(url, "http://127.0.0.1:54321")
    }

    func testDevLatestChannelUsesFixedLaneIgnoringPortFile() {
        let url = DaemonLocation.resolveBaseURL(
            channel: devLatest,
            environment: [:],
            portFileContents: { "54321" })
        XCTAssertEqual(url, "http://127.0.0.1:\(DaemonLocation.devLatestPort)")
    }

    func testPublishedPortFileIsUsedVerbatimEvenWhenPreferredPortIsOccupied() {
        // The whole point of dynamic discovery: the daemon fell back off
        // canonicalPreferredPort (it was occupied) and published the port it
        // actually bound. FleetBar must follow that, not the preferred literal.
        let url = DaemonLocation.resolveBaseURL(
            channel: production,
            environment: [:],
            portFileContents: { "54321" })
        XCTAssertEqual(url, "http://127.0.0.1:54321")
        XCTAssertNotEqual(url, "http://127.0.0.1:\(DaemonLocation.canonicalPreferredPort)")
    }

    func testMissingPublicationFailsClosedInsteadOfGuessingPreferredPort() {
        let url = DaemonLocation.resolveBaseURL(
            channel: production,
            environment: [:],
            portFileContents: { nil })
        XCTAssertEqual(url, "http://127.0.0.1:\(DaemonLocation.unpublishedSentinelPort)")
        XCTAssertNotEqual(url, "http://127.0.0.1:\(DaemonLocation.canonicalPreferredPort)")
    }

    func testMalformedPublicationFailsClosed() {
        for malformed in ["", "   ", "not-a-port", "9876abc", "-9876"] {
            let url = DaemonLocation.resolveBaseURL(
                channel: production,
                environment: [:],
                portFileContents: { malformed })
            XCTAssertEqual(
                url, "http://127.0.0.1:\(DaemonLocation.unpublishedSentinelPort)",
                "expected fail-closed sentinel for malformed publication \(malformed.debugDescription)")
        }
    }

    func testZeroPortPublicationFailsClosed() {
        let url = DaemonLocation.resolveBaseURL(
            channel: production,
            environment: [:],
            portFileContents: { "0" })
        XCTAssertEqual(url, "http://127.0.0.1:\(DaemonLocation.unpublishedSentinelPort)")
    }

    func testCustomLoopbackHostIsHonoredInEveryBranch() {
        let env = ["PORT_DADDY_TCP_HOST": "10.0.0.5"]
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(channel: devLatest, environment: env, portFileContents: { nil }),
            "http://10.0.0.5:\(DaemonLocation.devLatestPort)")
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(channel: production, environment: env, portFileContents: { "54321" }),
            "http://10.0.0.5:54321")
        XCTAssertEqual(
            DaemonLocation.resolveBaseURL(channel: production, environment: env, portFileContents: { nil }),
            "http://10.0.0.5:\(DaemonLocation.unpublishedSentinelPort)")
    }

    func testZeroArgOverloadStillResolves() {
        // The production entry point every existing call site uses. Just
        // proves the convenience overload compiles and returns a well-formed
        // http:// URL against the real environment/port-file/channel.
        let url = DaemonLocation.resolveBaseURL()
        XCTAssertTrue(url.hasPrefix("http://"), "expected http:// URL, got \(url)")
    }
}
