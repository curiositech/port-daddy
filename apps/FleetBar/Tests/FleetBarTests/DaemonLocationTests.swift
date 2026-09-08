import XCTest
@testable import FleetBar

/// Pins `DaemonLocation.resolve`'s precedence and its typed available/unavailable
/// contract. The mature invariant (this file's point): there is no fabricated
/// URL and no port-0 sentinel — an unresolved control plane resolves to
/// `.unavailable(reason)` with `url == nil`, so no request can ever be built.
final class DaemonLocationTests: XCTestCase {

    /// Resolve with no port file and no named-profile publication unless the
    /// test supplies them.
    private func resolve(
        _ environment: [String: String],
        portFile: String? = nil,
        profilePort: @escaping (String) -> Int? = { _ in nil },
        files: [String: String] = [:]
    ) -> DaemonEndpoint {
        DaemonLocation.resolve(
            environment: environment,
            portFileContents: { portFile },
            namedProfilePort: profilePort,
            fileReader: { files[$0] })
    }

    // MARK: - Precedence

    func testExplicitURLWinsOverEverything() {
        let endpoint = resolve(
            ["PORT_DADDY_URL": "http://127.0.0.1:54321", "PORT_DADDY_PORT": "40000"],
            portFile: "41000",
            profilePort: { _ in 42000 })
        XCTAssertEqual(endpoint, .available(url: "http://127.0.0.1:54321", source: .explicitURL))
    }

    func testExplicitURLIsTrimmed() {
        let endpoint = resolve(["PORT_DADDY_URL": "  http://127.0.0.1:54321  "])
        XCTAssertEqual(endpoint.url, "http://127.0.0.1:54321")
        XCTAssertEqual(endpoint.source, .explicitURL)
    }

    func testExplicitURLNormalizesALoneTrailingSlashToABaseURL() {
        let endpoint = resolve(["PORT_DADDY_URL": "https://[::1]:54321/"])
        XCTAssertEqual(endpoint.url, "https://[::1]:54321")
        XCTAssertEqual(endpoint.source, .explicitURL)
    }

    func testExplicitPortBeatsPortFileAndProfile() {
        let endpoint = resolve(
            ["PORT_DADDY_PORT": "54321", "PD_ACTIVE_DAEMON": "dev-latest"],
            portFile: "41000",
            profilePort: { _ in 42000 })
        XCTAssertEqual(endpoint, .available(url: "http://127.0.0.1:54321", source: .explicitPort))
    }

    func testExplicitPortFileBeatsProfileAndPublishedFile() {
        let endpoint = resolve(
            ["PORT_DADDY_PORT_FILE": "/x/port", "PD_ACTIVE_DAEMON": "dev-latest"],
            portFile: "41000",
            profilePort: { _ in 42000 },
            files: ["/x/port": "54321"])
        XCTAssertEqual(endpoint, .available(url: "http://127.0.0.1:54321", source: .explicitPortFile))
    }

    func testNamedProfileBeatsPublishedPortFile() {
        let endpoint = resolve(
            ["PD_ACTIVE_DAEMON": "dev-latest"],
            portFile: "41000",
            profilePort: { $0 == "dev-latest" ? 54321 : nil })
        XCTAssertEqual(endpoint, .available(url: "http://127.0.0.1:54321", source: .namedProfile(label: "dev-latest")))
    }

    func testPublishedPortFileUsedVerbatimWhenNothingExplicit() {
        // The whole point of dynamic discovery: the daemon fell off its preferred
        // port and published whatever it actually bound. FleetBar follows that.
        let endpoint = resolve([:], portFile: "54321")
        XCTAssertEqual(endpoint, .available(url: "http://127.0.0.1:54321", source: .publishedPortFile))
    }

    func testPublishedStablePortValidatesThePublishedFileDirectly() {
        XCTAssertNil(DaemonLocation.publishedStablePort(portFileContents: { nil }))
        for malformed in ["", "not-a-port", "0", "65536"] {
            XCTAssertNil(DaemonLocation.publishedStablePort(portFileContents: { malformed }))
        }
        XCTAssertEqual(
            DaemonLocation.publishedStablePort(portFileContents: { " 54321\n" }),
            54321)
    }

    // MARK: - Named profile edge cases

    func testProfileSelectedButNotPublishedFailsClosed() {
        let endpoint = resolve(["PD_ACTIVE_DAEMON": "ghost"], portFile: "41000", profilePort: { _ in nil })
        XCTAssertEqual(endpoint, .unavailable(.profileNotPublished(label: "ghost")))
        XCTAssertNil(endpoint.url)
    }

    func testProfilePublishedOutOfRangeFailsClosed() {
        let endpoint = resolve(["PD_ACTIVE_DAEMON": "dev-latest"], profilePort: { _ in 70000 })
        XCTAssertEqual(endpoint, .unavailable(.profilePortOutOfRange(label: "dev-latest", value: 70000)))
        XCTAssertNil(endpoint.url)
    }

    // MARK: - Missing publication

    func testMissingPublicationFailsClosedNeverGuesses() {
        let endpoint = resolve([:], portFile: nil)
        XCTAssertEqual(endpoint, .unavailable(.noPublication))
        XCTAssertNil(endpoint.url)
        XCTAssertFalse(endpoint.isAvailable)
    }

    // MARK: - Malformed state (validation)

    func testMalformedPublishedPortFailsClosed() {
        for malformed in ["", "   ", "not-a-port", "9876abc", "-9876", "0", "65536", "70000", "0x1f90", "+80"] {
            let endpoint = resolve([:], portFile: malformed)
            XCTAssertNil(endpoint.url, "expected no URL for malformed published port \(malformed.debugDescription)")
            if malformed.trimmingCharacters(in: .whitespaces).isEmpty {
                XCTAssertEqual(endpoint, .unavailable(.noPublication))
            } else {
                XCTAssertEqual(endpoint, .unavailable(.malformedPublication(malformed)))
            }
        }
    }

    func testMalformedExplicitPortFailsClosed() {
        for malformed in ["0", "-1", "abc", "12ab", "65536", "99999"] {
            let endpoint = resolve(["PORT_DADDY_PORT": malformed])
            XCTAssertEqual(endpoint, .unavailable(.invalidExplicitPort(malformed)))
            XCTAssertNil(endpoint.url)
        }
    }

    func testMalformedExplicitURLFailsClosed() {
        for malformed in [
            "ftp://127.0.0.1:8080",
            "not a url",
            "http://",
            "://nohost",
            "http://host:70000",
            "http://127.0.0.1",
            "https://localhost",
            "http://127.0.0.1:54321/api",
            "http://127.0.0.1:54321?debug=1",
            "http://127.0.0.1:54321#status",
            "http://operator@127.0.0.1:54321",
        ] {
            let endpoint = resolve(["PORT_DADDY_URL": malformed])
            XCTAssertEqual(endpoint, .unavailable(.invalidExplicitURL(malformed)))
            XCTAssertNil(endpoint.url)
        }
    }

    func testExplicitPortFileMissingOrMalformedFailsClosed() {
        // File path set but the file has no valid port.
        let missing = resolve(["PORT_DADDY_PORT_FILE": "/x/port"], files: [:])
        XCTAssertEqual(missing, .unavailable(.invalidExplicitPortFile(path: "/x/port")))
        XCTAssertNil(missing.url)

        let malformed = resolve(["PORT_DADDY_PORT_FILE": "/x/port"], files: ["/x/port": "nope"])
        XCTAssertEqual(malformed, .unavailable(.invalidExplicitPortFile(path: "/x/port")))
    }

    // MARK: - Host resolution

    func testCustomLoopbackHostIsHonoredInEveryPortBranch() {
        let env = ["PORT_DADDY_TCP_HOST": "10.0.0.5"]
        XCTAssertEqual(
            resolve(env.merging(["PORT_DADDY_PORT": "54321"]) { a, _ in a }).url,
            "http://10.0.0.5:54321")
        XCTAssertEqual(resolve(env, portFile: "54321").url, "http://10.0.0.5:54321")
        XCTAssertNil(resolve(env, portFile: nil).url)
    }

    // MARK: - Provenance / canonical identity (never a preferred number)

    func testCanonicalIdentityDerivesFromPublicationNotAPort() {
        XCTAssertTrue(DaemonEndpointSource.publishedPortFile.isCanonicalPublication)
        XCTAssertFalse(DaemonEndpointSource.explicitURL.isCanonicalPublication)
        XCTAssertFalse(DaemonEndpointSource.namedProfile(label: "dev-latest").isCanonicalPublication)
    }

    func testValidatedPortRejectsZeroAndOutOfRange() {
        XCTAssertNil(DaemonLocation.validatedPort("0"))
        XCTAssertNil(DaemonLocation.validatedPort("65536"))
        XCTAssertEqual(DaemonLocation.validatedPort("1"), 1)
        XCTAssertEqual(DaemonLocation.validatedPort("0080"), 80)
        XCTAssertEqual(DaemonLocation.validatedPort("65535"), 65535)
    }

    // MARK: - Live convenience overload

    func testAvailableBaseURLReturnsOptionalNeverASentinel() {
        // Whatever the real environment, the convenience is either a well-formed
        // http URL or nil — never a fabricated one and never a :0 sentinel.
        if let url = DaemonLocation.availableBaseURL() {
            XCTAssertTrue(url.hasPrefix("http://") || url.hasPrefix("https://"))
            XCTAssertFalse(url.hasSuffix(":0"))
        }
    }
}
