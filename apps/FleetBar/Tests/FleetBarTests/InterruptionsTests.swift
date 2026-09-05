import XCTest
import SwiftUI
import ViewInspector
@testable import FleetBar

// Unit tests for the mandatory HITL UI contract (docs/hitl-interruptions.md
// §4, surface 1) against a stubbed relay. One test region per contract
// clause: poll shape + jitter, surfacing, blocked spawns, web-only
// answer/ack, honest empty/unknown states.

@MainActor
final class InterruptionsStoreTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private static let fixtureAccount = OperatorAccount(
        token: "pdu_test_token",
        relayUrl: "https://relay.example",
        login: "operator"
    )

    private func makeStore(
        account: OperatorAccount? = InterruptionsStoreTests.fixtureAccount,
        now: @escaping () -> Date = Date.init
    ) -> InterruptionsStore {
        InterruptionsStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account },
            now: now
        )
    }

    // MARK: Clause 1 — poll GET /v1/interruptions?state=open with the pdu_ token

    func testPollRequestCarriesBearerTokenPathAndOpenStateQuery() async {
        var seenRequests: [URLRequest] = []
        StubURLProtocol.handler = { request in
            seenRequests.append(request)
            return StubURLProtocol.Stub(status: 200, body: Self.emptyEnvelope)
        }

        let store = makeStore()
        await store.refresh()

        XCTAssertEqual(seenRequests.count, 1)
        let request = seenRequests[0]
        XCTAssertEqual(request.url?.host, "relay.example")
        XCTAssertEqual(request.url?.path, "/v1/interruptions")
        XCTAssertEqual(request.url?.query, "state=open")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer pdu_test_token")
        XCTAssertLessThanOrEqual(request.timeoutInterval, 10)
    }

    func testRelayPollDoesNotDependOnLocalDaemonAvailability() async {
        var requestedHosts: [String] = []
        StubURLProtocol.handler = { request in
            requestedHosts.append(request.url?.host ?? "")
            return StubURLProtocol.Stub(status: 200, body: Self.emptyEnvelope)
        }
        let store = makeStore()

        await store.refresh()

        XCTAssertEqual(requestedHosts, ["relay.example"])
        XCTAssertEqual(store.phase, .open([]))
    }

    func testHealthyPollDelayIsFullJitterWithinThirtySeconds() {
        var samples: [TimeInterval] = []
        for _ in 0..<200 {
            samples.append(InterruptionsStore.nextPollDelay(consecutiveFailures: 0))
        }
        XCTAssertTrue(samples.allSatisfy { $0 >= 0 && $0 <= 30 })
        // Full jitter, never a fixed offset: 200 draws must not collapse.
        XCTAssertGreaterThan(Set(samples.map { Int($0 * 1000) }).count, 10)
    }

    func testFailureBackoffCeilingGrowsAndCapsAtTenMinutes() {
        // The injected random returns the ceiling itself, exposing the bound.
        let ceiling = { (failures: Int) -> TimeInterval in
            InterruptionsStore.nextPollDelay(consecutiveFailures: failures) { range in
                range.upperBound
            }
        }
        XCTAssertEqual(ceiling(0), 30)
        XCTAssertEqual(ceiling(1), 60)
        XCTAssertEqual(ceiling(3), 240)
        XCTAssertEqual(ceiling(5), 600)
        XCTAssertEqual(ceiling(50), 600)
    }

    // MARK: Clause 2 — surface title, urgency, source agent, age; red when loud

    func testSuccessfulPollDecodesOpenAsksFromRelayShape() async throws {
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }

        let store = makeStore()
        await store.refresh()

        XCTAssertEqual(store.openCount, 2)
        XCTAssertEqual(store.consecutiveFailures, 0)
        let critical = try XCTUnwrap(store.openCritical)
        XCTAssertEqual(critical.id, "oi_crit")
        XCTAssertEqual(critical.title, "Sandbox missing — provision one")
        XCTAssertEqual(critical.sourceAgent, "purser")
        XCTAssertEqual(critical.urgency, .critical)
    }

    func testHighAndCriticalUrgencyRenderRedLowAndNormalDoNot() {
        XCTAssertEqual(InterruptionUrgency.critical.color, Fleet.Color.failure)
        XCTAssertEqual(InterruptionUrgency.high.color, Fleet.Color.failure)
        XCTAssertTrue(InterruptionUrgency.critical.isLoud)
        XCTAssertTrue(InterruptionUrgency.high.isLoud)
        XCTAssertNotEqual(InterruptionUrgency.normal.color, Fleet.Color.failure)
        XCTAssertNotEqual(InterruptionUrgency.low.color, Fleet.Color.failure)
    }

    func testAgeRendersCompactUnits() {
        let base = Date(timeIntervalSince1970: 1_777_000_000)
        let item = { (secondsAgo: Double) -> OperatorInterruption in
            OperatorInterruption(
                id: "oi", title: "t", urgency: .normal,
                sourceAgent: "a",
                createdAt: base.timeIntervalSince1970 - secondsAgo
            )
        }
        XCTAssertEqual(item(45).age(now: base), "45s")
        XCTAssertEqual(item(720).age(now: base), "12m")
        XCTAssertEqual(item(7200).age(now: base), "2h")
        XCTAssertEqual(item(200_000).age(now: base), "2d")
    }

    func testSectionRendersTitleUrgencySourceAgentAndAge() throws {
        let base = Date(timeIntervalSince1970: 1_777_000_000)
        let store = InterruptionsStore.fixture(phase: .open([
            OperatorInterruption(
                id: "oi_crit",
                title: "Sandbox missing — provision one",
                urgency: .critical,
                sourceAgent: "purser",
                createdAt: base.timeIntervalSince1970 - 90
            ),
        ]))
        let section = InterruptionsSection(store: store, now: { base })

        let inspected = try section.inspect()
        XCTAssertNoThrow(try inspected.find(text: "Sandbox missing — provision one"))
        XCTAssertNoThrow(try inspected.find(text: "CRITICAL"))
        XCTAssertNoThrow(try inspected.find(text: "from purser · 1m ago"))
        XCTAssertNoThrow(try inspected.find(text: "1"))
    }

    // MARK: Clause 3 — critical asks block NEW dependent work

    func testCriticalOpenAskYieldsSpawnBlockTitleHighDoesNot() {
        let critical = InterruptionsStore.fixture(phase: .open([
            OperatorInterruption(
                id: "oi_c", title: "Provision the sandbox", urgency: .critical,
                sourceAgent: "purser", createdAt: 0
            ),
        ]))
        XCTAssertEqual(critical.criticalSpawnBlockTitle, "Provision the sandbox")

        // High is loud but NON-critical asks warn, they do not block.
        let high = InterruptionsStore.fixture(phase: .open([
            OperatorInterruption(
                id: "oi_h", title: "Grant contents write", urgency: .high,
                sourceAgent: "shipwright", createdAt: 0
            ),
        ]))
        XCTAssertNil(high.criticalSpawnBlockTitle)
    }

    func testFailedRefreshPreservesLastKnownCriticalGate() async {
        var succeeds = true
        StubURLProtocol.handler = { _ in
            if succeeds {
                return StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
            }
            return StubURLProtocol.Stub(status: 503, body: Data())
        }
        let store = makeStore()

        await store.refresh()
        XCTAssertEqual(store.criticalSpawnBlockTitle, "Sandbox missing — provision one")

        succeeds = false
        await store.refresh()
        guard case .unknown = store.phase else { return XCTFail("failed poll must remain unknown") }
        XCTAssertEqual(store.criticalSpawnBlockTitle, "Sandbox missing — provision one")
    }

    func testAccountChangeWakesParkedPollAndUsesReplacementCredential() async {
        var account = OperatorAccount(
            token: "pdu_old", relayUrl: "https://old-relay.example", login: "operator"
        )
        var oldRequests = 0
        let replacementPolled = expectation(description: "replacement account polled")
        StubURLProtocol.handler = { request in
            if request.url?.host == "old-relay.example" {
                oldRequests += 1
                return StubURLProtocol.Stub(status: 401, body: Data())
            }
            XCTAssertEqual(request.url?.host, "new-relay.example")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer pdu_new")
            replacementPolled.fulfill()
            return StubURLProtocol.Stub(status: 200, body: Self.emptyEnvelope)
        }
        let store = InterruptionsStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account }
        )
        defer { store.stop() }

        await store.refresh()
        XCTAssertEqual(store.consecutiveFailures, InterruptionsStore.parkedFailures)

        account = OperatorAccount(
            token: "pdu_new", relayUrl: "https://new-relay.example", login: "operator"
        )
        store.accountDidChange()
        await fulfillment(of: [replacementPolled], timeout: 1)
        for _ in 0..<10 where store.phase != .open([]) { await Task.yield() }

        XCTAssertEqual(oldRequests, 1)
        XCTAssertEqual(store.phase, .open([]))
        XCTAssertEqual(store.consecutiveFailures, 0)
    }

    func testSpawnApprovalApproveIsDisabledWithReasonWhileCriticalAskOpen() throws {
        let approvalStore = SpawnApprovalStore(baseURL: "https://daemon.example")
        approvalStore.approvals = [Self.pendingApproval]

        let blocked = SpawnApprovalSection(
            store: approvalStore,
            criticalBlockTitle: "Provision the sandbox"
        )
        let inspected = try blocked.inspect()

        let approve = try inspected.find(button: "Approve")
        XCTAssertTrue(approve.isDisabled(), "Approve must be disabled while a critical ask is open")
        // The reason is the ask title, visible in the section body.
        XCTAssertNoThrow(try inspected.find(text: "Approvals paused: critical operator ask “Provision the sandbox” is open."))
        // Reject stays enabled: declining work is not new work.
        let reject = try inspected.find(button: "Reject")
        XCTAssertFalse(reject.isDisabled())
    }

    func testSpawnApprovalApproveIsEnabledWithoutCriticalAsk() throws {
        let approvalStore = SpawnApprovalStore(baseURL: "https://daemon.example")
        approvalStore.approvals = [Self.pendingApproval]

        let section = SpawnApprovalSection(store: approvalStore, criticalBlockTitle: nil)
        let inspected = try section.inspect()

        let approve = try inspected.find(button: "Approve")
        XCTAssertFalse(approve.isDisabled())
        XCTAssertThrowsError(try inspected.find(text: "Approvals paused: critical operator ask “Provision the sandbox” is open."))
    }

    func testAgentRowRunIsDisabledWhileCriticalAskOpen() throws {
        let row = AgentRow(
            agent: Self.controllableAgent,
            spawnBlockTitle: "Provision the sandbox",
            onInspect: {},
            onRunAgent: {},
            onPauseToggle: {},
            onOpenInEditor: { _ in },
            onRevealInFinder: { _ in }
        )
        let inspected = try row.inspect()
        let run = try inspected.find(button: "Run")
        XCTAssertTrue(run.isDisabled(), "Run starts NEW work and must be disabled while a critical ask is open")
    }

    func testAgentRowRunIsEnabledWithoutCriticalAsk() throws {
        let row = AgentRow(
            agent: Self.controllableAgent,
            spawnBlockTitle: nil,
            onInspect: {},
            onRunAgent: {},
            onPauseToggle: {},
            onOpenInEditor: { _ in },
            onRevealInFinder: { _ in }
        )
        let inspected = try row.inspect()
        let run = try inspected.find(button: "Run")
        XCTAssertFalse(run.isDisabled())
    }

    // MARK: Clause 4 — answer/ack deep-links to the web, never in-app

    func testAnswerPageURLDeepLinksToAccountInterruptions() {
        let store = InterruptionsStore.fixture(
            phase: .open([]),
            relayUrl: "https://relay.example"
        )
        XCTAssertEqual(
            store.answerPageURL?.absoluteString,
            "https://relay.example/account/interruptions"
        )
    }

    func testAnswerButtonOpensBrowserAndSendsNoRelayRequest() throws {
        // Any HTTP call here would mean an in-app answer path exists —
        // the bearer token must never be able to silence an escalation.
        var httpCalls = 0
        StubURLProtocol.handler = { _ in
            httpCalls += 1
            return StubURLProtocol.Stub(status: 200, body: Data())
        }

        let store = InterruptionsStore.fixture(phase: .open([
            OperatorInterruption(
                id: "oi_1", title: "Which database?", urgency: .normal,
                sourceAgent: "fleet-executor", createdAt: 0
            ),
        ]))
        var openedURLs: [URL] = []
        let section = InterruptionsSection(store: store, openAnswerPage: { openedURLs.append($0) })

        let inspected = try section.inspect()
        let answerButton = try inspected.find(button: "Answer on web")
        try answerButton.tap()

        XCTAssertEqual(openedURLs.map(\.absoluteString), ["https://relay.example/account/interruptions"])
        XCTAssertEqual(httpCalls, 0, "Answer/ack must never issue a relay request from FleetBar")
    }

    // MARK: Clause 5 — honest empty state; failed poll is unknown, never all clear

    func testStoreStartsUnknownBeforeAnyPoll() {
        let store = makeStore()
        guard case .unknown = store.phase else {
            return XCTFail("A store that has never polled must be unknown, got \(store.phase)")
        }
        XCTAssertNil(store.openCount)
    }

    func testEmptyPollIsHonestEmptyStateBackedByARealPoll() async throws {
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.emptyEnvelope)
        }
        let store = makeStore()
        await store.refresh()

        XCTAssertEqual(store.phase, .open([]))
        XCTAssertEqual(store.openCount, 0)

        let inspected = try InterruptionsSection(store: store).inspect()
        XCTAssertNoThrow(try inspected.find(text: "No open operator asks."))
    }

    func testFailedPollRendersUnknownNeverAllClear() async throws {
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        let store = makeStore()
        await store.refresh()
        XCTAssertEqual(store.openCount, 2)

        // The relay starts failing: the store must drop to unknown, not keep
        // claiming the last successful picture (or worse, an empty one).
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 500, body: Data())
        }
        await store.refresh()

        guard case .unknown = store.phase else {
            return XCTFail("A failed poll must render unknown, got \(store.phase)")
        }
        XCTAssertNil(store.openCount)
        XCTAssertEqual(store.consecutiveFailures, 1)

        let inspected = try InterruptionsSection(store: store).inspect()
        XCTAssertNoThrow(try inspected.find(text: "Status unknown — the last poll did not succeed."))
        XCTAssertThrowsError(try inspected.find(text: "No open operator asks."))
    }

    func testRejectedTokenParksBackoffAndSaysWhat() async {
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 401, body: Data())
        }
        let store = makeStore()
        await store.refresh()

        XCTAssertEqual(store.consecutiveFailures, InterruptionsStore.parkedFailures)
        guard case .unknown(let reason) = store.phase else {
            return XCTFail("A 401 must park as unknown, got \(store.phase)")
        }
        XCTAssertTrue(reason.contains("401"))
    }

    func testMissingAccountRendersSignedOutNotAllClear() async throws {
        let store = makeStore(account: nil)
        await store.refresh()

        XCTAssertEqual(store.phase, .signedOut)
        XCTAssertNil(store.openCount)

        let inspected = try InterruptionsSection(store: store).inspect()
        XCTAssertNoThrow(try inspected.find(text: "Status unknown — not signed in."))
        XCTAssertNoThrow(try inspected.find(text: "Connect your account in FleetBar so operator asks can surface here."))
        XCTAssertNoThrow(try inspected.find(button: "Open Account Settings"))
        XCTAssertThrowsError(try inspected.find(text: "Run pd account login so operator asks can surface here."))
        XCTAssertThrowsError(try inspected.find(text: "No open operator asks."))
    }

    // MARK: Menu bar badge

    func testMenuBarLabelShowsCountBadgeWhenAsksAreOpen() throws {
        let label = FleetMenuBarLabel(
            icon: "sailboat.fill",
            color: Fleet.Color.healthy,
            interruptionCount: 3,
            interruptionIsCritical: true
        )
        let inspected = try label.inspect()
        XCTAssertNoThrow(try inspected.find(text: "3"))
    }

    func testMenuBarLabelHidesBadgeWhenCountIsUnknowable() throws {
        // nil count = unknown; the badge must not render a reassuring number.
        let label = FleetMenuBarLabel(
            icon: "sailboat.fill",
            color: Fleet.Color.healthy,
            interruptionCount: nil,
            interruptionIsCritical: false
        )
        let inspected = try label.inspect()
        XCTAssertThrowsError(try inspected.find(text: "0"))
    }

    // MARK: Account file

    func testAccountFileLoadReadsTokenAndTrimsRelaySlash() throws {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("coding/tmp/fleetbar-interruptions-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("account.json")
        let token = "pdu_" + String(repeating: "a", count: 64)
        let json = "{ \(Self.q)token\(Self.q): \(Self.q)\(token)\(Self.q), \(Self.q)login\(Self.q): \(Self.q)erich\(Self.q), \(Self.q)relayUrl\(Self.q): \(Self.q)https://relay.example/\(Self.q) }"
        try json.data(using: .utf8)!.write(to: file)
        defer { try? FileManager.default.removeItem(at: dir) }

        let account = OperatorAccountFile.load(from: file)
        XCTAssertEqual(account?.token, token)
        XCTAssertEqual(account?.relayUrl, "https://relay.example")
        XCTAssertEqual(account?.login, "erich")
    }

    func testAccountFileLoadReturnsNilWithoutAToken() {
        let missing = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("coding/tmp/fleetbar-interruptions-tests-none", isDirectory: true)
            .appendingPathComponent("absent.json")
        XCTAssertNil(OperatorAccountFile.load(from: missing))
    }

    func testAccountFileUsesCanonicalPublicRelay() {
        XCTAssertEqual(OperatorAccountFile.defaultRelay, "https://relay.portdaddy.dev")
    }

    // MARK: Fixtures

    private static let q = "\u{22}"

    private static let pendingApproval = SpawnApproval(
        id: "ap_1",
        project: "port-daddy",
        agent: "qa",
        trigger: "github:push",
        tier: "safe_tools",
        reason: "external trigger requires operator approval",
        safeTools: ["Read", "Grep"],
        timestamp: Date().timeIntervalSince1970 * 1000
    )

    private static let controllableAgent = FleetAgent(
        id: "port-daddy:fleet:qa",
        name: "qa",
        type: .triggered,
        isConfiguredFleetAgent: true,
        inboxTarget: nil,
        purpose: nil,
        status: .idle,
        statusReason: nil,
        queueDepth: 0,
        lastActivity: nil,
        lastEvent: nil,
        lastSummary: nil,
        recentFiles: []
    )

    /// Relay publicShape envelope with zero open asks.
    private static let emptyEnvelope = """
    {
      "code": "OK",
      "error": null,
      "openCount": 0,
      "interruptions": []
    }
    """.data(using: .utf8)!

    /// Relay publicShape envelope: one critical + one normal open ask,
    /// critical first (the relay orders by urgency).
    private static let twoAskEnvelope = """
    {
      "code": "OK",
      "error": null,
      "openCount": 2,
      "interruptions": [
        {
          "id": "oi_crit",
          "installationId": null,
          "sourceAgent": "purser",
          "sourceSession": null,
          "title": "Sandbox missing — provision one",
          "body": "blockWithoutSandbox is set and no sandbox is provisioned.",
          "urgency": "critical",
          "state": "open",
          "answer": null,
          "createdAt": 1777000000,
          "nagCount": 1,
          "lastNaggedAt": null,
          "closedAt": null
        },
        {
          "id": "oi_norm",
          "installationId": null,
          "sourceAgent": "fleet-executor",
          "sourceSession": null,
          "title": "Which staging database should the migration target?",
          "body": "",
          "urgency": "normal",
          "state": "open",
          "answer": null,
          "createdAt": 1776999000,
          "nagCount": 0,
          "lastNaggedAt": null,
          "closedAt": null
        }
      ]
    }
    """.data(using: .utf8)!
}
