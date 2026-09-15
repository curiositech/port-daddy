import XCTest
import SwiftUI
import ViewInspector
@testable import FleetBar

@MainActor
private final class StubInterruptionNotificationClient: InterruptionNotificationClient {
    var status: InterruptionNotificationAuthorization
    var requestResult = true
    var requestError: Error?
    var scheduleErrors: [Error] = []
    private(set) var permissionRequests = 0
    private(set) var scheduled: [InterruptionNotificationPlan] = []

    init(status: InterruptionNotificationAuthorization) {
        self.status = status
    }

    func authorizationStatus() async -> InterruptionNotificationAuthorization { status }

    func requestAuthorization() async throws -> Bool {
        permissionRequests += 1
        if let requestError { throw requestError }
        status = requestResult ? .authorized : .denied
        return requestResult
    }

    func schedule(_ plan: InterruptionNotificationPlan) async throws {
        if !scheduleErrors.isEmpty { throw scheduleErrors.removeFirst() }
        scheduled.append(plan)
    }
}

private struct NotificationTestError: LocalizedError {
    let errorDescription: String? = "notification test failure"
}

@MainActor
private final class StubInterruptionCapabilityClient: InterruptionCapabilityClient {
    var capability = "read_all_capability"
    var error: Error?
    private(set) var requests: [OperatorAccount] = []
    private(set) var invalidations = 0

    func readAllCapability(for account: OperatorAccount, using session: URLSession) async throws -> String {
        requests.append(account)
        if let error { throw error }
        return capability
    }

    func invalidate() {
        invalidations += 1
    }
}

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
        now: @escaping () -> Date = Date.init,
        notificationClient: InterruptionNotificationClient? = nil,
        capabilityClient: InterruptionCapabilityClient? = nil,
        preferences: UserDefaults? = nil,
        loadNotificationHistory: @escaping () -> [String] = { [] },
        saveNotificationHistory: @escaping ([String]) -> Void = { _ in }
    ) -> InterruptionsStore {
        let client = notificationClient ?? StubInterruptionNotificationClient(status: .notDetermined)
        let defaults = preferences ?? UserDefaults(suiteName: "FleetBar.InterruptionsTests.\(UUID().uuidString)")!
        return InterruptionsStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account },
            capabilityClient: capabilityClient ?? StubInterruptionCapabilityClient(),
            now: now,
            notificationClient: client,
            preferences: defaults,
            loadNotificationHistory: loadNotificationHistory,
            saveNotificationHistory: saveNotificationHistory
        )
    }

    // MARK: Clause 1 — exchange once, then poll with a short-lived capability

    func testPollRequestCarriesMacaroonPathAndOpenStateQuery() async {
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
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Macaroon read_all_capability")
        XCTAssertLessThanOrEqual(request.timeoutInterval, 10)
    }

    func testSystemCapabilityClientUsesBearerOnlyForGrantAndCachesShortLivedReadGrant() async throws {
        var seenRequests: [URLRequest] = []
        StubURLProtocol.handler = { request in
            seenRequests.append(request)
            let expires = Date().timeIntervalSince1970 * 1_000 + 300_000
            let body = """
            {"macaroon":"read_cap","verb":"operator-interruption:read-all","userId":"u1","expiresAt":\(expires)}
            """.data(using: .utf8)!
            return StubURLProtocol.Stub(status: 200, body: body)
        }
        let client = SystemInterruptionCapabilityClient()
        let session = StubURLProtocol.makeSession()

        let first = try await client.readAllCapability(for: Self.fixtureAccount, using: session)
        let second = try await client.readAllCapability(for: Self.fixtureAccount, using: session)

        XCTAssertEqual(first, "read_cap")
        XCTAssertEqual(second, "read_cap")
        XCTAssertEqual(seenRequests.count, 1, "an unexpired grant is reused in memory")
        let request = try XCTUnwrap(seenRequests.first)
        XCTAssertEqual(request.url?.path, "/v1/interruptions/grant")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer pdu_test_token")
        let body = try XCTUnwrap(request.interruptionBodyData)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["verb"] as? String, "operator-interruption:read-all")
        XCTAssertEqual(json["ttlSeconds"] as? Int, 300)
        XCTAssertNil(json["sourceAgent"])
        XCTAssertNil(json["sourceSession"])
    }

    func testRejectedReadCapabilityIsInvalidatedBeforeRetry() async {
        let capabilities = StubInterruptionCapabilityClient()
        StubURLProtocol.handler = { _ in StubURLProtocol.Stub(status: 401, body: Data()) }
        let store = makeStore(capabilityClient: capabilities)

        await store.refresh()

        XCTAssertEqual(capabilities.invalidations, 1)
        XCTAssertEqual(store.consecutiveFailures, InterruptionsStore.parkedFailures)
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

    func testOpenCountUsesRelayTotalInsteadOfTruncatedVisibleRows() async {
        let envelope = Self.twoAskEnvelopeString
            .replacingOccurrences(of: "\(Self.q)openCount\(Self.q): 2", with: "\(Self.q)openCount\(Self.q): 125")
            .data(using: .utf8)!
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: envelope)
        }
        let store = makeStore()

        await store.refresh()

        XCTAssertEqual(store.openItems.count, 2)
        XCTAssertEqual(store.openCount, 125)
    }

    func testTruncatedPageDoesNotForgetNotificationReceiptForHiddenOpenAsk() async {
        let envelope = Self.twoAskEnvelopeString
            .replacingOccurrences(of: "\(Self.q)openCount\(Self.q): 2", with: "\(Self.q)openCount\(Self.q): 125")
            .data(using: .utf8)!
        StubURLProtocol.handler = { _ in StubURLProtocol.Stub(status: 200, body: envelope) }
        var saved: [String] = []
        let store = makeStore(
            loadNotificationHistory: { ["hidden-still-open"] },
            saveNotificationHistory: { saved = $0 }
        )

        await store.refresh()

        XCTAssertTrue(saved.isEmpty, "a truncated page cannot prove the hidden ask closed")
    }

    func testNewOpenAsksNotifyOnceAndRepeatedPollDoesNotRenotify() async {
        let notifications = StubInterruptionNotificationClient(status: .authorized)
        let preferences = UserDefaults(suiteName: "FleetBar.InterruptionsTests.\(UUID().uuidString)")!
        preferences.set(true, forKey: InterruptionNotificationPreferences.alertsEnabledKey)
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        let store = makeStore(notificationClient: notifications, preferences: preferences)

        await store.refreshNotificationAuthorization()
        await store.refresh()
        await store.refresh()

        XCTAssertEqual(
            notifications.scheduled.map(\.identifier),
            ["pd-operator-interruption-oi_crit", "pd-operator-interruption-oi_norm"]
        )
    }

    func testExistingMacOSAuthorizationDoesNotOptInToNewAlertChannel() async {
        let notifications = StubInterruptionNotificationClient(status: .authorized)
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        let store = makeStore(notificationClient: notifications)

        await store.refreshNotificationAuthorization()
        await store.refresh()

        XCTAssertFalse(store.systemAlertsEnabled)
        XCTAssertFalse(store.soundsForLoudAsks)
        XCTAssertTrue(notifications.scheduled.isEmpty)
    }

    func testExplicitPermissionEnablesAlertsAndLoudSoundsAndCanBeTurnedOff() async {
        let notifications = StubInterruptionNotificationClient(status: .notDetermined)
        let preferences = UserDefaults(suiteName: "FleetBar.InterruptionsTests.\(UUID().uuidString)")!
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        let store = makeStore(notificationClient: notifications, preferences: preferences)
        await store.refresh()

        await store.requestNotificationPermission()

        XCTAssertEqual(notifications.permissionRequests, 1)
        XCTAssertTrue(store.systemAlertsEnabled)
        XCTAssertTrue(store.soundsForLoudAsks)
        XCTAssertTrue(preferences.bool(forKey: InterruptionNotificationPreferences.alertsEnabledKey))
        XCTAssertTrue(preferences.bool(forKey: InterruptionNotificationPreferences.soundsEnabledKey))
        XCTAssertEqual(notifications.scheduled.count, 2)
        XCTAssertTrue(notifications.scheduled.first(where: { $0.identifier.contains("oi_crit") })?.playSound == true)

        store.setSoundsForLoudAsks(false)
        store.setSystemAlertsEnabled(false)
        XCTAssertFalse(preferences.bool(forKey: InterruptionNotificationPreferences.alertsEnabledKey))
        XCTAssertFalse(preferences.bool(forKey: InterruptionNotificationPreferences.soundsEnabledKey))
    }

    func testPersistedNotificationReceiptPreventsRelaunchSpam() async {
        var history: [String] = []
        let firstNotifications = StubInterruptionNotificationClient(status: .authorized)
        let preferences = UserDefaults(suiteName: "FleetBar.InterruptionsTests.\(UUID().uuidString)")!
        preferences.set(true, forKey: InterruptionNotificationPreferences.alertsEnabledKey)
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }

        let first = makeStore(
            notificationClient: firstNotifications,
            preferences: preferences,
            loadNotificationHistory: { history },
            saveNotificationHistory: { history = $0 }
        )
        await first.refreshNotificationAuthorization()
        await first.refresh()
        XCTAssertEqual(firstNotifications.scheduled.count, 2)
        XCTAssertEqual(history, ["oi_crit", "oi_norm"])

        let relaunchedNotifications = StubInterruptionNotificationClient(status: .authorized)
        let relaunched = makeStore(
            notificationClient: relaunchedNotifications,
            preferences: preferences,
            loadNotificationHistory: { history },
            saveNotificationHistory: { history = $0 }
        )
        await relaunched.refreshNotificationAuthorization()
        await relaunched.refresh()
        XCTAssertTrue(relaunchedNotifications.scheduled.isEmpty)
    }

    func testPollingNeverPromptsForNotificationPermission() async {
        let notifications = StubInterruptionNotificationClient(status: .notDetermined)
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        let store = makeStore(notificationClient: notifications)

        await store.refresh()

        XCTAssertEqual(notifications.permissionRequests, 0)
        XCTAssertTrue(notifications.scheduled.isEmpty)
    }

    func testExplicitPermissionRequestSchedulesAlreadyVisibleAsks() async {
        let notifications = StubInterruptionNotificationClient(status: .notDetermined)
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        let store = makeStore(notificationClient: notifications)
        await store.refresh()

        await store.requestNotificationPermission()

        XCTAssertEqual(notifications.permissionRequests, 1)
        XCTAssertEqual(store.notificationAuthorization, .authorized)
        XCTAssertEqual(notifications.scheduled.count, 2)
    }

    func testSchedulingFailureCreatesNoReceiptAndRetriesNextPoll() async {
        var history: [String] = []
        let notifications = StubInterruptionNotificationClient(status: .authorized)
        let preferences = UserDefaults(suiteName: "FleetBar.InterruptionsTests.\(UUID().uuidString)")!
        preferences.set(true, forKey: InterruptionNotificationPreferences.alertsEnabledKey)
        notifications.scheduleErrors = [NotificationTestError()]
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.emptyEnvelope)
        }
        let store = makeStore(
            notificationClient: notifications,
            preferences: preferences,
            loadNotificationHistory: { history },
            saveNotificationHistory: { history = $0 }
        )
        await store.refreshNotificationAuthorization()

        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        await store.refresh()
        XCTAssertEqual(history, ["oi_norm"], "only the successfully scheduled ask may mint a receipt")

        await store.refresh()
        XCTAssertEqual(Set(history), Set(["oi_crit", "oi_norm"]))
        XCTAssertEqual(notifications.scheduled.count, 2)
    }

    func testNotificationPlanNeverContainsSensitiveRelayText() {
        let item = OperatorInterruption(
            id: "oi_secret",
            title: "TOKEN=top-secret",
            body: "Bearer private-value",
            urgency: .critical,
            sourceAgent: "agent-secret",
            createdAt: 0
        )
        let plan = InterruptionNotificationPlan.make(for: item, soundsEnabled: true)
        let visible = [plan.title, plan.subtitle, plan.body].joined(separator: " ")

        XCTAssertFalse(visible.contains(item.title))
        XCTAssertFalse(visible.contains(item.body))
        XCTAssertFalse(visible.contains(item.sourceAgent))
        XCTAssertTrue(plan.playSound)
    }

    func testSoundIsOnlyForEnabledHighOrCriticalAsks() {
        for urgency in InterruptionUrgency.allCases {
            let item = OperatorInterruption(
                id: urgency.rawValue,
                title: "ask",
                urgency: urgency,
                sourceAgent: "agent",
                createdAt: 0
            )
            XCTAssertEqual(
                InterruptionNotificationPlan.make(for: item, soundsEnabled: true).playSound,
                urgency.isLoud
            )
            XCTAssertFalse(InterruptionNotificationPlan.make(for: item, soundsEnabled: false).playSound)
        }
    }

    func testTurningSystemAlertsOffLeavesMenuQueueTruthIntact() async {
        let notifications = StubInterruptionNotificationClient(status: .authorized)
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.twoAskEnvelope)
        }
        let store = makeStore(notificationClient: notifications)
        await store.refreshNotificationAuthorization()
        store.setSystemAlertsEnabled(false)

        await store.refresh()

        XCTAssertEqual(store.openCount, 2)
        XCTAssertTrue(notifications.scheduled.isEmpty)
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
                body: "The test runner cannot start until an operator chooses an isolated sandbox.",
                urgency: .critical,
                sourceAgent: "purser",
                createdAt: base.timeIntervalSince1970 - 90
            ),
        ]))
        let section = InterruptionsSection(store: store, now: { base })

        let inspected = try section.inspect()
        XCTAssertNoThrow(try inspected.find(text: "Sandbox missing — provision one"))
        XCTAssertNoThrow(try inspected.find(text: "CRITICAL"))
        XCTAssertNoThrow(try inspected.find(text: "DECISION NEEDED"))
        XCTAssertNoThrow(try inspected.find(text: "Why blocked: The test runner cannot start until an operator chooses an isolated sandbox."))
        XCTAssertNoThrow(try inspected.find(text: "Reply goes to purser · filed 1m ago"))
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
        let answerButton = try inspected.find(button: "Respond securely")
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
        XCTAssertNoThrow(try inspected.find(text: "No agent is waiting for a decision."))
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
        XCTAssertThrowsError(try inspected.find(text: "No agent is waiting for a decision."))
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
        XCTAssertThrowsError(try inspected.find(text: "No agent is waiting for a decision."))
    }

    // MARK: Menu bar badge

    func testMenuBarLabelShowsCountBadgeWhenAsksAreOpen() throws {
        let label = FleetMenuBarLabel(
            icon: "sailboat.fill",
            color: Fleet.Color.healthy,
            interruptionCount: 3,
            interruptionIsLoud: true
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
            interruptionIsLoud: false
        )
        let inspected = try label.inspect()
        XCTAssertThrowsError(try inspected.find(text: "0"))
    }

    // MARK: Account file

    func testAccountFileLoadsMetadataAndKeychainBearerAndTrimsRelaySlash() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("fleetbar-interruptions-tests", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("account.json")
        let json = "{ \(Self.q)createdAt\(Self.q): 1, \(Self.q)login\(Self.q): \(Self.q)erich\(Self.q), \(Self.q)relayUrl\(Self.q): \(Self.q)https://relay.example/\(Self.q) }"
        try json.data(using: .utf8)!.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }

        let encoded = Data("pdu_abc".utf8).base64EncodedString()
        let account = OperatorAccountFile.load(from: file, environment: [:], loadSecret: { encoded })
        XCTAssertEqual(account?.token, "pdu_abc")
        XCTAssertEqual(account?.relayUrl, "https://relay.example")
        XCTAssertEqual(account?.login, "erich")

        // PD_ACCOUNTS_RELAY_URL wins over the stored relay, like the CLI.
        let overridden = OperatorAccountFile.load(
            from: file,
            environment: ["PD_ACCOUNTS_RELAY_URL": "https://staging.example/"],
            loadSecret: { encoded }
        )
        XCTAssertEqual(overridden?.relayUrl, "https://staging.example")
    }

    func testAccountFileLoadReturnsNilWithoutKeychainBearer() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("fleetbar-interruptions-tests-no-secret", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("account.json")
        try "{\"createdAt\":1,\"login\":\"erich\",\"relayUrl\":\"https://relay.example\"}"
            .data(using: .utf8)!.write(to: file)
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertNil(OperatorAccountFile.load(from: file, environment: [:], loadSecret: { nil }))
    }

    func testFleetBarRejectsLegacyPlaintextTokenMetadata() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("fleetbar-interruptions-tests-legacy", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("account.json")
        try "{\"createdAt\":1,\"login\":\"erich\",\"relayUrl\":\"https://relay.example\",\"token\":\"pdu_plaintext\"}"
            .data(using: .utf8)!.write(to: file)
        defer { try? FileManager.default.removeItem(at: dir) }
        let encoded = Data("pdu_keychain".utf8).base64EncodedString()
        XCTAssertNil(OperatorAccountFile.load(from: file, environment: [:], loadSecret: { encoded }))
    }

    func testAccountFileLoadReturnsNilWhenMetadataIsMissing() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("fleetbar-interruptions-tests-none", isDirectory: true)
            .appendingPathComponent("absent.json")
        XCTAssertNil(OperatorAccountFile.load(from: missing, environment: [:], loadSecret: { "ignored" }))
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
    private static let twoAskEnvelopeString = """
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
    """

    private static let twoAskEnvelope = twoAskEnvelopeString.data(using: .utf8)!
}

private extension URLRequest {
    var interruptionBodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: 1024)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
