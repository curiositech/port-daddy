import XCTest
import ViewInspector
@testable import FleetBar

@MainActor
final class OperatorAccountStoreTests: XCTestCase {
    private let validToken = "pdu_" + String(repeating: "a", count: 64)

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testPendingKeepsExistingAccountUnchanged() async throws {
        let fixture = try makeFixture(existing: true)
        defer { fixture.remove() }
        let original = try Data(contentsOf: fixture.accountURL)
        StubURLProtocol.handler = { request in
            request.url?.path == "/auth/device/start"
                ? Self.startResponse
                : Self.json(status: 200, "{\"pending\":true,\"error\":\"authorization_pending\"}")
        }
        let store = makeStore(fixture)

        let authorization = await store.beginConnection()
        XCTAssertNotNil(authorization)
        let result = await store.pollConnectionOnce()
        XCTAssertEqual(result, .pending)
        XCTAssertEqual(try Data(contentsOf: fixture.accountURL), original)
    }

    func testExpiredCodeNeverPollsOrChangesExistingAccount() async throws {
        let fixture = try makeFixture(existing: true)
        defer { fixture.remove() }
        let original = try Data(contentsOf: fixture.accountURL)
        var now = Date(timeIntervalSince1970: 2_000_000_000)
        var tokenPolls = 0
        StubURLProtocol.handler = { request in
            if request.url?.path == "/auth/device/start" { return Self.startResponse }
            tokenPolls += 1
            return Self.json(status: 500, "{}")
        }
        let store = makeStore(fixture, now: { now })

        let authorization = await store.beginConnection()
        XCTAssertNotNil(authorization)
        now = now.addingTimeInterval(901)
        guard case .failed(let message) = await store.pollConnectionOnce() else {
            return XCTFail("expired flow must fail")
        }
        XCTAssertTrue(message.contains("expired"))
        XCTAssertEqual(tokenPolls, 0)
        XCTAssertEqual(try Data(contentsOf: fixture.accountURL), original)
    }

    func testRejectedAndCancelledConnectionsPreserveExistingAccount() async throws {
        let fixture = try makeFixture(existing: true)
        defer { fixture.remove() }
        let original = try Data(contentsOf: fixture.accountURL)
        StubURLProtocol.handler = { request in
            request.url?.path == "/auth/device/start"
                ? Self.startResponse
                : Self.json(status: 400, "{\"pending\":false,\"error\":\"access_denied\"}")
        }
        let rejected = makeStore(fixture)
        let rejectedAuthorization = await rejected.beginConnection()
        XCTAssertNotNil(rejectedAuthorization)
        guard case .failed(let message) = await rejected.pollConnectionOnce() else {
            return XCTFail("declined flow must fail")
        }
        XCTAssertEqual(message, "Account connection was declined.")
        XCTAssertEqual(try Data(contentsOf: fixture.accountURL), original)

        let cancelled = makeStore(fixture)
        let cancelledAuthorization = await cancelled.beginConnection()
        XCTAssertNotNil(cancelledAuthorization)
        cancelled.cancelConnection()
        XCTAssertEqual(try Data(contentsOf: fixture.accountURL), original)
        guard case .connected = cancelled.phase else {
            return XCTFail("cancel must restore the prior saved identity")
        }
    }

    func testSuccessAuthenticatesBeforeAtomicOwnerOnlySave() async throws {
        let fixture = try makeFixture(existing: false)
        defer { fixture.remove() }
        var paths: [String] = []
        StubURLProtocol.handler = { request in
            paths.append(request.url?.path ?? "")
            switch request.url?.path {
            case "/auth/device/start": return Self.startResponse
            case "/auth/device/token":
                return Self.json(status: 200, "{\"pending\":false,\"token\":\"\(self.validToken)\",\"login\":\"operator\"}")
            case "/auth/whoami":
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(self.validToken)")
                return Self.json(status: 200, "{\"code\":\"OK\",\"user\":{\"login\":\"operator\"}}")
            default: return Self.json(status: 404, "{}")
            }
        }
        let store = makeStore(fixture)

        let authorization = await store.beginConnection()
        XCTAssertNotNil(authorization)
        let result = await store.pollConnectionOnce()
        guard case .connected(let identity) = result else {
            return XCTFail("successful flow must connect, got \(result)")
        }
        XCTAssertEqual(identity.login, "operator")
        XCTAssertEqual(paths, ["/auth/device/start", "/auth/device/token", "/auth/whoami"])
        XCTAssertEqual(OperatorAccountFile.load(from: fixture.accountURL)?.token, validToken)
        let permissions = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: fixture.accountURL.path)[.posixPermissions] as? NSNumber
        )
        XCTAssertEqual(permissions.intValue & 0o777, 0o600)
    }

    func testFailedAuthenticationNeverReplacesPreviousCredential() async throws {
        let fixture = try makeFixture(existing: true)
        defer { fixture.remove() }
        let original = try Data(contentsOf: fixture.accountURL)
        StubURLProtocol.handler = { request in
            switch request.url?.path {
            case "/auth/device/start": return Self.startResponse
            case "/auth/device/token":
                return Self.json(status: 200, "{\"pending\":false,\"token\":\"\(self.validToken)\",\"login\":\"operator\"}")
            default: return Self.json(status: 401, "{}")
            }
        }
        let store = makeStore(fixture)

        let authorization = await store.beginConnection()
        XCTAssertNotNil(authorization)
        guard case .failed(let message) = await store.pollConnectionOnce() else {
            return XCTFail("unverified token must fail")
        }
        XCTAssertTrue(message.contains("previous connection is unchanged"))
        XCTAssertEqual(try Data(contentsOf: fixture.accountURL), original)
    }

    func testReconnectUsesTheSavedRelayForTheWholeDeviceFlow() async throws {
        let fixture = try makeFixture(existing: true)
        defer { fixture.remove() }
        var hosts: [String] = []
        StubURLProtocol.handler = { request in
            hosts.append(request.url?.host ?? "")
            switch request.url?.path {
            case "/auth/device/start": return Self.startResponse
            case "/auth/device/token":
                return Self.json(status: 200, "{\"pending\":false,\"token\":\"\(self.validToken)\",\"login\":\"operator\"}")
            case "/auth/whoami":
                return Self.json(status: 200, "{\"code\":\"OK\",\"user\":{\"login\":\"operator\"}}")
            default: return Self.json(status: 404, "{}")
            }
        }
        let store = makeStore(fixture)

        let authorization = await store.beginConnection()
        XCTAssertNotNil(authorization)
        let result = await store.pollConnectionOnce()
        guard case .connected = result else {
            return XCTFail("saved relay reconnection should complete")
        }

        XCTAssertEqual(hosts, ["previous.example", "previous.example", "previous.example"])
        XCTAssertEqual(OperatorAccountFile.load(from: fixture.accountURL)?.relayUrl, "https://previous.example")
    }

    func testDeviceFlowRejectsAnUntrustedAuthorizationPageWithoutOpeningIt() async throws {
        let fixture = try makeFixture(existing: false)
        defer { fixture.remove() }
        var opened: [URL] = []
        StubURLProtocol.handler = { _ in
            Self.json(
                status: 200,
                "{\"device_code\":\"device-secret\",\"user_code\":\"ABCD-1234\",\"verification_uri\":\"https://evil.example/login/device\",\"expires_in\":900,\"interval\":2}"
            )
        }
        let store = OperatorAccountStore(
            autoRefresh: false,
            session: StubURLProtocol.makeSession(),
            accountURL: fixture.accountURL,
            relayUrl: "https://relay.portdaddy.dev",
            openBrowser: { opened.append($0) }
        )

        let authorization = await store.beginConnection(openAuthorizationPage: true)
        XCTAssertNil(authorization)
        XCTAssertTrue(opened.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.accountURL.path))
    }

    func testRefreshReportsVerifiedIdentityAndRelayHealth() async throws {
        let fixture = try makeFixture(existing: true)
        defer { fixture.remove() }
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.host, "previous.example")
            return Self.json(status: 200, "{\"code\":\"OK\",\"user\":{\"login\":\"verified-operator\"}}")
        }
        let store = makeStore(fixture)

        await store.refresh()

        guard case .connected(let identity) = store.phase else {
            return XCTFail("verified saved account should be connected")
        }
        XCTAssertEqual(identity.login, "verified-operator")
        XCTAssertEqual(identity.relayUrl, "https://previous.example")
        XCTAssertNotNil(identity.lastVerified)
    }

    func testPublishedStateAndSettingsNeverRenderToken() throws {
        let identity = OperatorAccountStore.Identity(
            login: "operator",
            relayUrl: "https://relay.portdaddy.dev",
            lastVerified: Date(timeIntervalSince1970: 2_000_000_000)
        )
        let store = OperatorAccountStore.fixture(phase: .connected(identity))
        let inspected = try AccountSettingsView(store: store).inspect()

        XCTAssertNoThrow(try inspected.find(text: "Connected as @operator"))
        XCTAssertThrowsError(try inspected.find(text: validToken))
        XCTAssertFalse(String(describing: store.phase).contains("pdu_"))
    }

    func testSignOutRemovesOnlyLocalAccount() throws {
        let fixture = try makeFixture(existing: true)
        defer { fixture.remove() }
        let store = makeStore(fixture)
        store.signOut()
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.accountURL.path))
        XCTAssertEqual(store.phase, .signedOut)
    }

    func testRelayValidationRequiresHttpsExceptForLoopbackDevelopment() {
        XCTAssertTrue(OperatorAccountFile.isValidRelay("https://relay.portdaddy.dev"))
        XCTAssertTrue(OperatorAccountFile.isValidRelay("http://localhost:9876"))
        XCTAssertTrue(OperatorAccountFile.isValidRelay("http://127.0.0.1:9876"))
        XCTAssertTrue(OperatorAccountFile.isValidRelay("http://[::1]:9876"))
        XCTAssertFalse(OperatorAccountFile.isValidRelay("http://relay.example"))
        XCTAssertFalse(OperatorAccountFile.isValidRelay("https://operator:secret@relay.example"))
        XCTAssertFalse(OperatorAccountFile.isValidRelay("file:///tmp/relay"))
        XCTAssertFalse(OperatorAccountFile.isValidRelay("not a relay"))
    }

    private func makeStore(
        _ fixture: Fixture,
        now: @escaping () -> Date = Date.init
    ) -> OperatorAccountStore {
        OperatorAccountStore(
            autoRefresh: false,
            session: StubURLProtocol.makeSession(),
            accountURL: fixture.accountURL,
            relayUrl: "https://relay.portdaddy.dev",
            now: now,
            openBrowser: { _ in }
        )
    }

    private func makeFixture(existing: Bool) throws -> Fixture {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("coding/tmp/fleetbar-account-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let accountURL = directory.appendingPathComponent("account.json")
        if existing {
            let account = OperatorAccount(
                token: "pdu_" + String(repeating: "b", count: 64),
                relayUrl: "https://previous.example",
                login: "previous"
            )
            try OperatorAccountFile.saveAtomically(account, to: accountURL)
        }
        return Fixture(directory: directory, accountURL: accountURL)
    }

    private struct Fixture {
        let directory: URL
        let accountURL: URL
        func remove() { try? FileManager.default.removeItem(at: directory) }
    }

    private static let startResponse = json(
        status: 200,
        "{\"device_code\":\"device-secret\",\"user_code\":\"ABCD-1234\",\"verification_uri\":\"https://github.com/login/device\",\"expires_in\":900,\"interval\":2}"
    )

    private static func json(status: Int, _ body: String) -> StubURLProtocol.Stub {
        StubURLProtocol.Stub(status: status, body: body.data(using: .utf8)!)
    }
}
