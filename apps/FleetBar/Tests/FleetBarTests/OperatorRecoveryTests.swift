import CryptoKit
import Foundation
import ViewInspector
import XCTest
@testable import FleetBar

private final class OperatorRecoveryURLProtocol: URLProtocol {
    struct Stub {
        let status: Int
        let body: Data
    }

    nonisolated(unsafe) static var handler: ((URLRequest) -> Stub)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        let stub = handler(request)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: stub.status,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OperatorRecoveryURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

@MainActor
private final class StubOperatorPresenceSigner: OperatorPresenceSigning {
    var availability: OperatorPresenceSignerAvailability
    var signedChallenges: [Data] = []
    var reasons: [String] = []
    var signature: OperatorPresenceSignature
    var beforeReturning: (() async -> Void)?

    init(
        availability: OperatorPresenceSignerAvailability = .available(deviceKeyId: "device-key-1"),
        signature: OperatorPresenceSignature = .init(
            deviceKeyId: "device-key-1",
            publicKeyX963: Data([0x04, 0x01, 0x02]),
            signatureDer: Data([0x30, 0x01, 0x01])
        )
    ) {
        self.availability = availability
        self.signature = signature
    }

    func sign(challenge: Data, reason: String) async throws -> OperatorPresenceSignature {
        signedChallenges.append(challenge)
        reasons.append(reason)
        await beforeReturning?()
        return signature
    }
}

private final class StubOperatorEnrollmentKeyHandler: OperatorEnrollmentKeyHandling, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var preparedChallenges: [Data] = []
    private(set) var activationDigests: [String] = []
    private(set) var activationCommandDigests: [String] = []
    private(set) var exitCodes: [Int32] = []

    private let material: OperatorPresenceEnrollmentMaterial

    init() {
        let publicKey = Data([0x04] + Array(repeating: 0x11, count: 64))
        let digest = sha256Digest(publicKey).dropFirst("sha256:".count)
        material = OperatorPresenceEnrollmentMaterial(
            deviceKeyId: "se-p256:\(digest)",
            publicKeyX963: publicKey,
            applicationTag: "test-key",
            state: .pending
        )
    }

    func prepare(challenge: Data, reason: String) throws
        -> (OperatorPresenceEnrollmentMaterial, Data) {
        lock.lock()
        preparedChallenges.append(challenge)
        lock.unlock()
        return (material, Data([0x30, 0x01, 0x01]))
    }

    func activate(
        material: OperatorPresenceEnrollmentMaterial,
        responseDigest: String,
        activationCommandDigest: String
    ) throws -> OperatorPresenceEnrollmentMaterial {
        lock.lock()
        activationDigests.append(responseDigest)
        activationCommandDigests.append(activationCommandDigest)
        lock.unlock()
        return OperatorPresenceEnrollmentMaterial(
            deviceKeyId: material.deviceKeyId,
            publicKeyX963: material.publicKeyX963,
            applicationTag: material.applicationTag,
            state: .active
        )
    }

    func recordExit(_ code: Int32) {
        lock.lock()
        exitCodes.append(code)
        lock.unlock()
    }
}

@MainActor
final class OperatorRecoveryTests: XCTestCase {
    nonisolated private static let challenge = Data([0x00, 0x01, 0x7f, 0x80, 0xff])
    nonisolated private static let actionHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

    override func tearDown() {
        OperatorRecoveryURLProtocol.handler = nil
        super.tearDown()
    }

    func testRefreshUsesOnlyCanonicalOperatorRecoveryRouteAndDecodesPendingScope() async {
        var requests: [URLRequest] = []
        OperatorRecoveryURLProtocol.handler = { request in
            requests.append(request)
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let signer = StubOperatorPresenceSigner()
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: signer
        )

        await store.refresh()

        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests[0].httpMethod, "GET")
        XCTAssertEqual(requests[0].url?.path, "/operator-recovery")
        XCTAssertEqual(requests[0].url?.query, "limit=20")
        XCTAssertFalse(requests[0].url?.path.contains("fleet/approvals") ?? true)
        XCTAssertEqual(store.recoveries.count, 1)
        XCTAssertEqual(store.recoveries[0].status, .pending)
        XCTAssertEqual(store.recoveries[0].scope.claims, [
            .init(
                claimId: 101,
                nodeId: "claim-node:one",
                disposition: .transfer,
                repoId: "port-daddy",
                worldKind: "worktree",
                worldId: "worktree-recovery",
                gitOid: nil,
                selectorKind: "symbol",
                filePath: "lib/operator-recovery.ts",
                startLine: 120,
                endLine: 188,
                symbol: nil,
                symbolPath: "OperatorRecovery.consume",
                sessionId: "session-old",
                purpose: "repair operator presence",
                agentId: "agent-repair-operator-presence",
                phase: "in_progress",
                mode: "X",
                intent: "resume exact authority",
                claimedAt: 1_899_999_900_000,
                releasedAt: nil,
                observedBy: "operator",
                confidence: 1,
                legacySessionFileId: nil
            ),
            .init(
                claimId: 102,
                nodeId: "claim-node:two",
                disposition: .release,
                repoId: "port-daddy",
                worldKind: "worktree",
                worldId: "worktree-recovery",
                gitOid: nil,
                selectorKind: "range",
                filePath: "tests/unit/operator-recovery.test.ts",
                startLine: 40,
                endLine: 88,
                symbol: nil,
                symbolPath: nil,
                sessionId: "session-old",
                purpose: "repair operator presence",
                agentId: "agent-repair-operator-presence",
                phase: "in_progress",
                mode: "X",
                intent: "release exact test claim",
                claimedAt: 1_899_999_901_000,
                releasedAt: nil,
                observedBy: nil,
                confidence: 0.875,
                legacySessionFileId: 42
            ),
        ])
        XCTAssertTrue(store.canDecide(store.recoveries[0]))
    }

    func testRefreshDecodesBackendCustodyPendingWithoutFailingTheList() async {
        OperatorRecoveryURLProtocol.handler = { _ in
            let item = try! JSONSerialization.jsonObject(with: Self.decisionEnvelope(
                status: "custody-pending",
                successorSessionId: "session-successor",
                events: [
                    ["eventId": "event-consumed", "kind": "grant-consumed"],
                    ["eventId": "event-bound", "kind": "session-bound"],
                ],
                includeCustody: false
            ))
            return .init(status: 200, body: Self.listEnvelope(items: [item]))
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )

        await store.refresh()

        XCTAssertEqual(store.recoveries.count, 1)
        XCTAssertEqual(store.recoveries[0].status, .custodyPending)
        XCTAssertEqual(store.recoveries[0].successorSessionId, "session-successor")
        XCTAssertNil(store.lastError)
    }

    func testApproveSignsDaemonBytesVerbatimAndPostsTypedDecision() async throws {
        var requests: [URLRequest] = []
        OperatorRecoveryURLProtocol.handler = { request in
            requests.append(request)
            if request.httpMethod == "POST" {
                return .init(status: 200, body: Self.decisionEnvelope(
                    status: "consumed",
                    successorSessionId: "session-successor",
                    events: [
                        ["eventId": "event-consumed", "kind": "grant-consumed"],
                        ["eventId": "event-bound", "kind": "session-bound"],
                        ["eventId": "event-custody", "kind": "context-custody-installed"],
                    ],
                    includeCustody: true
                ))
            }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let signer = StubOperatorPresenceSigner()
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: signer
        )
        await store.refresh()

        await store.decide(store.recoveries[0], decision: .approve)

        XCTAssertEqual(signer.signedChallenges, [Self.recoveryChallenge(decision: "approve")])
        XCTAssertEqual(signer.reasons, ["Approve this exact Port Daddy recovery with Touch ID"])
        let post = try XCTUnwrap(requests.first(where: { $0.httpMethod == "POST" }))
        XCTAssertEqual(post.url?.path, "/operator-recovery/recovery-1/decision")
        XCTAssertFalse(post.url?.path.contains("fleet/approvals") ?? true)
        let body = try XCTUnwrap(post.operatorRecoveryBodyData)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(object["decision"], "approve")
        XCTAssertEqual(object["deviceKeyId"], "device-key-1")
        XCTAssertEqual(object["publicKeyX963Base64"], Data([0x04, 0x01, 0x02]).base64EncodedString())
        XCTAssertEqual(object["signatureDerBase64"], Data([0x30, 0x01, 0x01]).base64EncodedString())
        XCTAssertEqual(
            object["challengeDigest"],
            sha256Digest(Self.recoveryChallenge(decision: "approve"))
        )
        XCTAssertEqual(requests.filter { $0.httpMethod == "GET" }.count, 1)
        XCTAssertEqual(store.recoveries[0].status, .consumed)
        XCTAssertEqual(store.recoveries[0].binding?.successorSessionId, "session-successor")
        XCTAssertEqual(store.recoveries[0].bodyCredential?.bodyId, "body-receipt-1")
        XCTAssertEqual(store.recoveries[0].bodyCredential?.scopeProfile, "session-body-v1")
        XCTAssertEqual(store.recoveries[0].bodyCredential?.scope.sessionId, "session-successor")
        XCTAssertEqual(store.recoveries[0].custody?.contextSlot, "codex-thread-7")
        XCTAssertNil(store.lastError)
    }

    func testCustodyPendingDecodesAndApprovalKeepsTheBackendReceiptWithoutPolling() async throws {
        var getCount = 0
        OperatorRecoveryURLProtocol.handler = { request in
            if request.httpMethod == "POST" {
                return .init(status: 200, body: Self.decisionEnvelope(
                    status: "custody-pending",
                    successorSessionId: "session-successor",
                    events: [
                        ["eventId": "event-consumed", "kind": "grant-consumed"],
                        ["eventId": "event-bound", "kind": "session-bound"],
                    ],
                    includeCustody: false
                ))
            }
            getCount += 1
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        await store.decide(store.recoveries[0], decision: .approve)

        XCTAssertEqual(getCount, 1)
        XCTAssertEqual(store.recoveries[0].status, .custodyPending)
        XCTAssertEqual(store.recoveries[0].displayState, .custodyPending)
        XCTAssertEqual(store.recoveries[0].displayReceipt?.title, "Successor bound; custody pending")
        XCTAssertEqual(store.recoveries[0].binding?.transferredClaimNodeIds, ["claim-node:one"])
        XCTAssertNil(store.recoveries[0].custody)
        XCTAssertNil(store.lastError)
    }

    func testApproveRejectsAResponseThatDidNotSettleOrReturnBinding() async {
        OperatorRecoveryURLProtocol.handler = { request in
            if request.httpMethod == "POST" {
                return .init(status: 200, body: Self.recoveryItem(
                    status: "approved",
                    events: [["eventId": "event-approved", "kind": "approved"]]
                ))
            }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        await store.decide(store.recoveries[0], decision: .approve)

        XCTAssertEqual(store.recoveries[0].status, .pending)
        XCTAssertEqual(
            store.lastError,
            "Approval did not reach a usable terminal state (approved). Review the daemon receipt."
        )
    }

    func testApproveRejectsConsumedResponseWithoutBindingReceipt() async {
        OperatorRecoveryURLProtocol.handler = { request in
            if request.httpMethod == "POST" {
                return .init(status: 200, body: Self.recoveryItem(
                    status: "consumed",
                    successorSessionId: "session-successor",
                    events: [["eventId": "event-bound", "kind": "session-bound"]]
                ))
            }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        await store.decide(store.recoveries[0], decision: .approve)

        XCTAssertEqual(store.recoveries[0].status, .pending)
        XCTAssertEqual(
            store.lastError,
            "The approved recovery omitted its successor binding receipt. Recovery remains locked."
        )
    }

    func testApproveRejectsConsumedResponseWithoutInstalledCustodyReceipt() async {
        OperatorRecoveryURLProtocol.handler = { request in
            if request.httpMethod == "POST" {
                return .init(status: 200, body: Self.decisionEnvelope(
                    status: "consumed",
                    successorSessionId: "session-successor",
                    events: [
                        ["eventId": "event-consumed", "kind": "grant-consumed"],
                        ["eventId": "event-bound", "kind": "session-bound"],
                    ],
                    includeCustody: false
                ))
            }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        await store.decide(store.recoveries[0], decision: .approve)

        XCTAssertEqual(store.recoveries[0].status, .pending)
        XCTAssertEqual(
            store.lastError,
            "The consumed recovery omitted its exact-slot custody receipt. Recovery remains locked."
        )
    }

    func testUnavailableSignerFailsClosedBeforePostingDecision() async {
        var postCount = 0
        OperatorRecoveryURLProtocol.handler = { request in
            if request.httpMethod == "POST" { postCount += 1 }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let reason = "Exact signed FleetBar provenance is unavailable."
        let signer = StubOperatorPresenceSigner(
            availability: .unavailable(code: "UNTRUSTED_BUILD", reason: reason)
        )
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: signer
        )
        await store.refresh()

        await store.decide(store.recoveries[0], decision: .approve)

        XCTAssertEqual(postCount, 0)
        XCTAssertTrue(signer.signedChallenges.isEmpty)
        XCTAssertEqual(store.lastError, reason)
    }

    func testChallengeDigestDriftFailsBeforeTouchIDOrNetworkMutation() async {
        var postCount = 0
        OperatorRecoveryURLProtocol.handler = { request in
            if request.httpMethod == "POST" { postCount += 1 }
            return .init(status: 200, body: Self.pendingEnvelope(challengeDigest: "sha256:deadbeef"))
        }
        let signer = StubOperatorPresenceSigner()
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: signer
        )
        await store.refresh()

        XCTAssertEqual(postCount, 0)
        XCTAssertTrue(signer.signedChallenges.isEmpty)
        XCTAssertTrue(store.recoveries.isEmpty)
        XCTAssertEqual(
            store.lastError,
            "The daemon recovery contract did not match the exact scope shown here. Recovery remains locked."
        )
    }

    func testEveryDisplayedSigningCoordinateMustMatchEvenWithARecomputedDigest() async {
        for field in [
            "worktree",
            "actorId",
            "actionHash",
            "decision",
            "enrollmentActivationEventId",
            "claim.filePath",
        ] {
            var postCount = 0
            OperatorRecoveryURLProtocol.handler = { request in
                if request.httpMethod == "POST" { postCount += 1 }
                return .init(status: 200, body: Self.mutatedPendingEnvelope(field: field))
            }
            let signer = StubOperatorPresenceSigner()
            let store = OperatorRecoveryStore(
                baseURL: "http://fleetbar.test",
                session: OperatorRecoveryURLProtocol.makeSession(),
                signer: signer
            )

            await store.refresh()

            XCTAssertTrue(store.recoveries.isEmpty, "\(field) must fail before display")
            XCTAssertTrue(signer.signedChallenges.isEmpty, "\(field) must fail before Touch ID")
            XCTAssertEqual(postCount, 0, "\(field) must fail before POST")
            XCTAssertEqual(
                store.lastError,
                "The daemon recovery contract did not match the exact scope shown here. Recovery remains locked."
            )
        }
    }

    func testFailedRefreshPreservesEvidenceButDisablesStaleActions() async throws {
        var failRefresh = false
        OperatorRecoveryURLProtocol.handler = { _ in
            if failRefresh {
                return .init(status: 503, body: Data(#"{"code":"OPERATOR_RECOVERY_UNAVAILABLE"}"#.utf8))
            }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()
        let prior = try XCTUnwrap(store.recoveries.first)
        XCTAssertTrue(store.canDecide(prior, decision: .approve))

        failRefresh = true
        await store.refresh()

        XCTAssertEqual(store.recoveries.first, prior)
        XCTAssertFalse(store.canDecide(prior, decision: .approve))
        XCTAssertNotNil(store.lastError)
    }

    func testAmbiguousPostReconcilesThroughTheExactRecoveryReadback() async throws {
        var requests: [String] = []
        OperatorRecoveryURLProtocol.handler = { request in
            requests.append("\(request.httpMethod ?? "?") \(request.url?.path ?? "?")")
            if request.httpMethod == "POST" {
                return .init(status: 200, body: Data("not-json".utf8))
            }
            if request.url?.path == "/operator-recovery/recovery-1" {
                return .init(status: 200, body: Self.decisionEnvelope(
                    status: "consumed",
                    successorSessionId: "session-successor",
                    events: [
                        ["eventId": "event-consumed", "kind": "grant-consumed"],
                        ["eventId": "event-bound", "kind": "session-bound"],
                        ["eventId": "event-custody", "kind": "context-custody-installed"],
                    ],
                    includeCustody: true
                ))
            }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        await store.decide(try XCTUnwrap(store.recoveries.first), decision: .approve)

        XCTAssertEqual(store.recoveries.first?.status, .consumed)
        XCTAssertNil(store.lastError)
        XCTAssertEqual(requests, [
            "GET /operator-recovery",
            "POST /operator-recovery/recovery-1/decision",
            "GET /operator-recovery/recovery-1",
        ])
    }

    func testTouchIDCompletionCannotPostAfterTheDisplayedLedgerAdvances() async throws {
        var postCount = 0
        var advanced = false
        OperatorRecoveryURLProtocol.handler = { request in
            if request.httpMethod == "POST" { postCount += 1 }
            if advanced {
                let item = try! JSONSerialization.jsonObject(with: Self.recoveryItem(events: [
                    ["eventId": "event-created", "kind": "challenge-created"],
                    ["eventId": "event-drift", "kind": "drift-refused"],
                ]))
                return .init(status: 200, body: Self.listEnvelope(items: [item]))
            }
            return .init(status: 200, body: Self.pendingEnvelope())
        }
        let signer = StubOperatorPresenceSigner()
        let entered = expectation(description: "Touch ID signer entered")
        var release: CheckedContinuation<Void, Never>?
        signer.beforeReturning = {
            entered.fulfill()
            await withCheckedContinuation { continuation in release = continuation }
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: signer
        )
        await store.refresh()
        let displayed = try XCTUnwrap(store.recoveries.first)
        let decision = Task { await store.decide(displayed, decision: .approve) }
        await fulfillment(of: [entered], timeout: 1)
        advanced = true
        await store.refresh()
        release?.resume()
        await decision.value

        XCTAssertEqual(postCount, 0)
        XCTAssertEqual(store.recoveries.first?.events.last?.eventId, "event-drift")
        XCTAssertEqual(store.lastError, OperatorPresenceSigningError.keyReferenceInvalid.localizedDescription)
    }

    func testListRejectsAConsumedReceiptWhoseClaimDispositionDrifts() async {
        OperatorRecoveryURLProtocol.handler = { _ in
            var item = try! JSONSerialization.jsonObject(with: Self.decisionEnvelope(
                status: "consumed",
                successorSessionId: "session-successor",
                events: [
                    ["eventId": "event-consumed", "kind": "grant-consumed"],
                    ["eventId": "event-bound", "kind": "session-bound"],
                    ["eventId": "event-custody", "kind": "context-custody-installed"],
                ],
                includeCustody: true
            )) as! [String: Any]
            var binding = item["binding"] as! [String: Any]
            binding["transferredClaimNodeIds"] = ["claim-node:two"]
            item["binding"] = binding
            return .init(status: 200, body: Self.listEnvelope(items: [item]))
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )

        await store.refresh()

        XCTAssertTrue(store.recoveries.isEmpty)
        XCTAssertEqual(
            store.lastError,
            "The daemon recovery contract did not match the exact scope shown here. Recovery remains locked."
        )
    }

    func testDisplayStateProjectsDriftAndReplayRefusals() throws {
        let decoder = JSONDecoder()
        let drift = try decoder.decode(
            OperatorRecoveryItem.self,
            from: Self.recoveryItem(events: [["eventId": "event-drift", "kind": "drift-refused"]])
        )
        let replay = try decoder.decode(
            OperatorRecoveryItem.self,
            from: Self.recoveryItem(events: [["eventId": "event-replay", "kind": "replay-refused"]])
        )

        XCTAssertEqual(drift.displayState, .driftRefused)
        XCTAssertEqual(replay.displayState, .replayRefused)
    }

    func testDecisionAvailabilityMatchesAuthorityStateAndCanonicalPrompt() async throws {
        let decoder = JSONDecoder()
        let pending = try decoder.decode(
            OperatorRecoveryItem.self,
            from: Self.recoveryItem(status: "pending", events: [["eventId": "event-created", "kind": "challenge-created"]])
        )
        let approved = try decoder.decode(
            OperatorRecoveryItem.self,
            from: Self.recoveryItem(status: "approved", events: [["eventId": "event-approved", "kind": "approved"]])
        )
        let denied = try decoder.decode(
            OperatorRecoveryItem.self,
            from: Self.recoveryItem(status: "denied", events: [["eventId": "event-denied", "kind": "denied"]])
        )
        OperatorRecoveryURLProtocol.handler = { _ in
            .init(status: 200, body: Self.pendingEnvelope())
        }
        let pendingStore = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await pendingStore.refresh()
        let currentPending = try XCTUnwrap(pendingStore.recoveries.first)
        XCTAssertEqual(currentPending, pending)
        XCTAssertTrue(pendingStore.canDecide(currentPending, decision: .approve))
        XCTAssertTrue(pendingStore.canDecide(currentPending, decision: .deny))
        XCTAssertFalse(pendingStore.canDecide(currentPending, decision: .revoke))

        let approvedObject = try XCTUnwrap(JSONSerialization.jsonObject(with: Self.recoveryItem(
            status: "approved",
            events: [["eventId": "event-approved", "kind": "approved"]]
        )) as? [String: Any])
        OperatorRecoveryURLProtocol.handler = { _ in
            .init(status: 200, body: Self.listEnvelope(items: [approvedObject]))
        }
        let approvedStore = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await approvedStore.refresh()
        let currentApproved = try XCTUnwrap(approvedStore.recoveries.first)
        XCTAssertEqual(currentApproved, approved)
        XCTAssertFalse(approvedStore.canDecide(currentApproved, decision: .approve))
        XCTAssertFalse(approvedStore.canDecide(currentApproved, decision: .deny))
        XCTAssertTrue(approvedStore.canDecide(currentApproved, decision: .revoke))

        XCTAssertNil(denied.prompt(for: .approve))
        XCTAssertNil(denied.prompt(for: .deny))
        XCTAssertNil(denied.prompt(for: .revoke))
    }

    func testReceiptsDistinguishTerminalDriftReplayAndExpiryStates() throws {
        let decoder = JSONDecoder()
        let cases: [(String, String, String, String)] = [
            ("approved", "approved", "event-approved", "Recovery approved"),
            ("custody-pending", "session-bound", "event-bound", "Successor bound; custody pending"),
            ("denied", "denied", "event-denied", "Recovery denied"),
            ("expired", "expired", "event-expired", "Recovery expired"),
            ("revoked", "grant-revoked", "event-revoked", "Recovery revoked"),
            ("consumed", "session-bound", "event-bound", "Continuity restored"),
            ("pending", "drift-refused", "event-drift", "Recovery refused after drift"),
            ("consumed", "replay-refused", "event-replay", "Continuity restored"),
        ]

        for (status, eventKind, eventId, title) in cases {
            let item = try decoder.decode(
                OperatorRecoveryItem.self,
                from: Self.recoveryItem(
                    status: status,
                    successorSessionId: status == "consumed" ? "session-successor" : nil,
                    events: [["eventId": eventId, "kind": eventKind]]
                )
            )
            XCTAssertEqual(item.displayReceipt?.title, title)
            XCTAssertEqual(item.displayReceipt?.ledgerReceipt.terminalEventId, eventId)
        }
    }

    func testConsumedStatusWinsOverTrailingSecretRetirementAudit() throws {
        let decoder = JSONDecoder()
        let item = try decoder.decode(
            OperatorRecoveryItem.self,
            from: Self.recoveryItem(
                status: "consumed",
                successorSessionId: "session-successor",
                events: [
                    ["eventId": "event-installed", "kind": "context-custody-installed"],
                    ["eventId": "event-retired", "kind": "drift-refused"],
                ]
            )
        )

        XCTAssertEqual(item.displayState, .consumed)
        XCTAssertEqual(item.displayReceipt?.title, "Continuity restored")
        XCTAssertEqual(item.displayReceipt?.ledgerReceipt.terminalEventId, "event-retired")
    }

    func testApprovedCardMakesRevokeReachableAndShowsLedgerReceipt() async throws {
        OperatorRecoveryURLProtocol.handler = { _ in
            let item = try! JSONSerialization.jsonObject(with: Self.recoveryItem(
                status: "approved",
                events: [["eventId": "event-approved", "kind": "approved"]]
            ))
            return .init(status: 200, body: Self.listEnvelope(items: [item]))
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        let inspected = try OperatorRecoverySection(store: store).inspect()
        XCTAssertNoThrow(try inspected.find(text: "Recovery approved"))
        XCTAssertNoThrow(try inspected.find(text: "event-approved"))
        XCTAssertNoThrow(try inspected.find(text: "Revoke approved recovery"))
        XCTAssertThrowsError(try inspected.find(text: "Approve with Touch ID"))
        XCTAssertThrowsError(try inspected.find(text: "Deny"))
    }

    func testConsumedCardRendersBindingCustodyAndExactClaimDispositionReceipt() async throws {
        OperatorRecoveryURLProtocol.handler = { _ in
            .init(status: 200, body: Self.listEnvelope(items: [
                try! JSONSerialization.jsonObject(with: Self.decisionEnvelope(
                    status: "consumed",
                    successorSessionId: "session-successor",
                    events: [
                        ["eventId": "event-consumed", "kind": "grant-consumed"],
                        ["eventId": "event-bound", "kind": "session-bound"],
                        ["eventId": "event-custody", "kind": "context-custody-installed"],
                    ],
                    includeCustody: true
                )),
            ]))
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        let inspected = try OperatorRecoverySection(store: store).inspect()
        XCTAssertNoThrow(try inspected.find(text: "Continuity restored"))
        XCTAssertNoThrow(try inspected.find(text: "session-successor"))
        XCTAssertNoThrow(try inspected.find(text: "claim-node:one"))
        XCTAssertNoThrow(try inspected.find(text: "claim-node:two"))
        XCTAssertNoThrow(try inspected.find(text: "body-receipt-1"))
        XCTAssertNoThrow(try inspected.find(text: "session-body-v1"))
        XCTAssertNoThrow(try inspected.find(text: "local"))
        XCTAssertNoThrow(try inspected.find(text: "codex-thread-7"))
        XCTAssertNoThrow(try inspected.find(text: "/Users/operator/coding/port-daddy-recovery"))
        XCTAssertNoThrow(try inspected.find(text: "0600"))
        XCTAssertNoThrow(try inspected.find(text: "TRANSFER"))
        XCTAssertNoThrow(try inspected.find(text: "RELEASE"))
        XCTAssertThrowsError(try inspected.find(text: "raw-body-credential-must-never-render"))
        XCTAssertThrowsError(try inspected.find(text: "raw-body-jti-must-never-render"))
    }

    func testScopeRenderingRejectsSecretSignatureAndJtiFields() async throws {
        OperatorRecoveryURLProtocol.handler = { _ in
            let item = try! JSONSerialization.jsonObject(with: Self.recoveryItem(
                events: [["eventId": "event-created", "kind": "challenge-created"]],
                addForbiddenFields: true
            ))
            return .init(status: 200, body: Self.listEnvelope(items: [item]))
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        XCTAssertTrue(store.recoveries.isEmpty)
        XCTAssertEqual(
            store.lastError,
            "The daemon recovery contract did not match the exact scope shown here. Recovery remains locked."
        )
    }

    func testDaemonErrorProseCannotLeakAuthoritySecretsIntoChrome() async {
        OperatorRecoveryURLProtocol.handler = { _ in
            .init(
                status: 409,
                body: Data(#"{"code":"OPERATOR_RECOVERY_GRANT_REPLAYED","error":"raw-credential raw-signature raw-jti"}"#.utf8)
            )
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )

        await store.refresh()

        XCTAssertEqual(
            store.lastError,
            "This one-shot recovery action was already used or made terminal."
        )
        XCTAssertFalse(store.lastError?.contains("raw-credential") ?? true)
        XCTAssertFalse(store.lastError?.contains("raw-signature") ?? true)
        XCTAssertFalse(store.lastError?.contains("raw-jti") ?? true)
    }

    func testRecoveryCardShowsBoundedScopeAndHumanActions() async throws {
        OperatorRecoveryURLProtocol.handler = { _ in
            .init(status: 200, body: Self.pendingEnvelope())
        }
        let store = OperatorRecoveryStore(
            baseURL: "http://fleetbar.test",
            session: OperatorRecoveryURLProtocol.makeSession(),
            signer: StubOperatorPresenceSigner()
        )
        await store.refresh()

        let inspected = try OperatorRecoverySection(store: store).inspect()
        XCTAssertNoThrow(try inspected.find(text: "Operator recovery"))
        XCTAssertNoThrow(try inspected.find(text: "PROVENANCE BOUND"))
        XCTAssertNoThrow(try inspected.find(text: "Restore actor continuity"))
        XCTAssertNoThrow(try inspected.find(text: "Signed recovery scope"))
        XCTAssertNoThrow(try inspected.find(text: "port-daddy"))
        XCTAssertNoThrow(try inspected.find(text: "local"))
        XCTAssertNoThrow(try inspected.find(text: "/Users/operator/coding/port-daddy-recovery"))
        XCTAssertNoThrow(try inspected.find(text: "codex/recovery"))
        XCTAssertNoThrow(try inspected.find(text: "session-old"))
        XCTAssertNoThrow(try inspected.find(text: "agent-repair-operator-presence"))
        XCTAssertNoThrow(try inspected.find(text: "repair operator presence"))
        XCTAssertNoThrow(try inspected.find(text: Self.actionHash))
        XCTAssertNoThrow(try inspected.find(text: "codex-thread-7"))
        XCTAssertNoThrow(try inspected.find(text: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"))
        XCTAssertNoThrow(try inspected.find(text: "recovery-nonce-7"))
        XCTAssertNoThrow(try inspected.find(text: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"))
        XCTAssertNoThrow(try inspected.find(text: "device-key-1"))
        XCTAssertNoThrow(try inspected.find(text: "operator-authority-event:enrolled-1"))
        XCTAssertNoThrow(try inspected.find(text: "Exact claim map"))
        XCTAssertNoThrow(try inspected.find(text: "lib/operator-recovery.ts"))
        XCTAssertNoThrow(try inspected.find(text: "Symbol path OperatorRecovery.consume \u{00b7} Lines 120\u{2013}188"))
        XCTAssertNoThrow(try inspected.find(text: "tests/unit/operator-recovery.test.ts"))
        XCTAssertNoThrow(try inspected.find(text: "Lines 40\u{2013}88"))
        XCTAssertNoThrow(try inspected.find(text: "worktree · worktree-recovery"))
        XCTAssertNoThrow(try inspected.find(text: "resume exact authority"))
        XCTAssertNoThrow(try inspected.find(text: "in_progress · X"))
        XCTAssertNoThrow(try inspected.find(text: "0.875"))
        XCTAssertNoThrow(try inspected.find(text: "TRANSFER"))
        XCTAssertNoThrow(try inspected.find(text: "RELEASE"))
        XCTAssertNoThrow(try inspected.find(text: "Approve with Touch ID"))
        XCTAssertNoThrow(try inspected.find(text: "Deny"))
    }

    func testBuildIdentityIsExactAndLocalTestBuildFailsClosed() {
        XCTAssertTrue(FleetVersion.productionDesignatedRequirement.contains("identifier \"ai.portdaddy.FleetBar\""))
        XCTAssertTrue(FleetVersion.productionDesignatedRequirement.contains("subject.OU] = \"P5H9P59X2M\""))
        XCTAssertTrue(FleetVersion.productionDesignatedRequirement.contains("1.2.840.113635.100.6.1.13"))
        XCTAssertFalse(FleetVersion.isExactProductionBuild)

        let signer = SecureEnclaveOperatorPresenceSigner(exactProductionBuild: { false })
        XCTAssertEqual(
            signer.availability,
            .unavailable(
                code: "UNTRUSTED_BUILD",
                reason: OperatorPresenceSigningError.untrustedBuild.localizedDescription
            )
        )
    }

    func testNativeHelperSignsExactChallengeAndBindsEveryRequestField() throws {
        let handler = StubOperatorEnrollmentKeyHandler()
        let request = Self.enrollmentHelperRequest(nowMs: 1_000_000)
        let response = try OperatorEnrollmentHelper.prepareForTesting(
            request: request,
            keyHandler: handler,
            nowMs: 1_000_000
        )

        XCTAssertEqual(handler.preparedChallenges, [Self.challenge])
        XCTAssertEqual(response.protocolVersion, 2)
        XCTAssertEqual(response.requestId, request.requestId)
        XCTAssertEqual(response.nonce, request.nonce)
        XCTAssertEqual(response.daemonGeneration, request.daemonGeneration)
        XCTAssertEqual(response.bootstrapId, request.bootstrapId)
        XCTAssertEqual(response.expiresAtMs, request.expiresAtMs)
        XCTAssertEqual(response.challengeDigest, request.challengeDigest)
        XCTAssertEqual(response.keyState, .pending)
        XCTAssertEqual(
            response.keyDigest,
            sha256Digest(Data(base64Encoded: response.publicKeyX963Base64)!)
        )
    }

    func testPendingKeySurvivesInterruptedAckAndActivatesOnlyAfterExactAck() throws {
        let handler = StubOperatorEnrollmentKeyHandler()

        let interrupted = try runHelperExchange(handler: handler, sendAck: false)
        XCTAssertEqual(interrupted.response.keyState, .pending)
        XCTAssertEqual(handler.activationDigests, [])
        XCTAssertEqual(handler.exitCodes.last, 64)

        let completed = try runHelperExchange(handler: handler, sendAck: true)
        XCTAssertEqual(completed.response.deviceKeyId, interrupted.response.deviceKeyId)
        XCTAssertEqual(completed.response.publicKeyX963Base64, interrupted.response.publicKeyX963Base64)
        XCTAssertEqual(handler.activationDigests, [completed.responseDigest])
        XCTAssertEqual(handler.activationCommandDigests, [completed.activationReceipt?.activationCommandDigest])
        XCTAssertEqual(completed.activationReceipt?.keyState, .active)
        XCTAssertEqual(handler.exitCodes.last, 0)
        XCTAssertEqual(handler.preparedChallenges, [Self.challenge, Self.challenge])
    }

    func testNativeHelperRejectsOversizeAndNonCanonicalChallengeFrames() throws {
        XCTAssertThrowsError(try OperatorEnrollmentHelper.frame(
            Data(repeating: 0, count: OperatorEnrollmentHelper.maxFrameBytes + 1)
        ))

        let handler = StubOperatorEnrollmentKeyHandler()
        let valid = Self.enrollmentHelperRequest(nowMs: 1_000_000)
        let malformed = OperatorEnrollmentHelperRequest(
            protocolVersion: valid.protocolVersion,
            operation: valid.operation,
            requestId: valid.requestId,
            nonce: valid.nonce,
            daemonGeneration: valid.daemonGeneration,
            bootstrapId: valid.bootstrapId,
            expiresAtMs: valid.expiresAtMs,
            challengeBytesBase64: valid.challengeBytesBase64 + "=",
            challengeDigest: valid.challengeDigest
        )
        XCTAssertThrowsError(try OperatorEnrollmentHelper.prepareForTesting(
            request: malformed,
            keyHandler: handler,
            nowMs: 1_000_000
        ))
        XCTAssertTrue(handler.preparedChallenges.isEmpty)
    }

    func testNativeHelperRefusesTrailingInputBeforeActivation() throws {
        let handler = StubOperatorEnrollmentKeyHandler()
        _ = try runHelperExchange(
            handler: handler,
            sendAck: true,
            trailingInput: Data([0xff])
        )
        XCTAssertEqual(handler.activationDigests.count, 1)
        XCTAssertEqual(handler.exitCodes.last, 64)
    }

    private struct HelperExchangeResult {
        let response: OperatorEnrollmentHelperResponse
        let responseDigest: String
        let activationReceipt: OperatorEnrollmentActivationReceipt?
    }

    private func runHelperExchange(
        handler: StubOperatorEnrollmentKeyHandler,
        sendAck: Bool,
        trailingInput: Data = Data()
    ) throws -> HelperExchangeResult {
        let input = Pipe()
        let output = Pipe()
        let activation = Pipe()
        let diagnostics = Pipe()
        let finished = expectation(description: "native helper exits")
        DispatchQueue.global(qos: .userInitiated).async {
            let code = OperatorEnrollmentHelper.run(
                input: input.fileHandleForReading,
                output: output.fileHandleForWriting,
                activationOutput: activation.fileHandleForWriting,
                errorOutput: diagnostics.fileHandleForWriting,
                keyHandler: handler,
                nowMs: { 1_000_000 }
            )
            handler.recordExit(code)
            try? output.fileHandleForWriting.close()
            try? activation.fileHandleForWriting.close()
            try? diagnostics.fileHandleForWriting.close()
            finished.fulfill()
        }

        let request = Self.enrollmentHelperRequest(nowMs: 1_000_000)
        let requestPayload = try JSONEncoder().encode(request)
        try input.fileHandleForWriting.write(contentsOf: OperatorEnrollmentHelper.frame(requestPayload))
        let responsePayload = try OperatorEnrollmentHelper.readFrame(from: output.fileHandleForReading)
        let response = try JSONDecoder().decode(OperatorEnrollmentHelperResponse.self, from: responsePayload)
        let responseDigest = sha256Digest(responsePayload)

        var activationReceipt: OperatorEnrollmentActivationReceipt?
        if sendAck {
            let command = OperatorEnrollmentActivationCommand(
                protocolVersion: 2,
                operation: "activate-enrollment",
                requestId: request.requestId,
                nonce: request.nonce,
                daemonGeneration: request.daemonGeneration,
                bootstrapId: request.bootstrapId,
                expiresAtMs: request.expiresAtMs,
                challengeDigest: request.challengeDigest,
                deviceKeyId: response.deviceKeyId,
                keyDigest: response.keyDigest,
                responseDigest: responseDigest,
                enrollmentEventId: "operator-recovery:request-1:enrollment-pinned:test",
                activationEventId: "operator-recovery:request-1:enrollment-activated:test",
                activationNonce: "activation-nonce-0123456789"
            )
            let commandPayload = try JSONEncoder().encode(command)
            try input.fileHandleForWriting.write(
                contentsOf: OperatorEnrollmentHelper.frame(commandPayload)
            )
            let receiptPayload = try OperatorEnrollmentHelper.readFrame(
                from: activation.fileHandleForReading
            )
            activationReceipt = try JSONDecoder().decode(
                OperatorEnrollmentActivationReceipt.self,
                from: receiptPayload
            )
            XCTAssertEqual(activationReceipt?.activationCommandDigest, sha256Digest(commandPayload))
            if !trailingInput.isEmpty {
                try input.fileHandleForWriting.write(contentsOf: trailingInput)
            }
        }
        try input.fileHandleForWriting.close()
        wait(for: [finished], timeout: 2)
        return HelperExchangeResult(
            response: response,
            responseDigest: responseDigest,
            activationReceipt: activationReceipt
        )
    }

    nonisolated private static func enrollmentHelperRequest(nowMs: Int64) -> OperatorEnrollmentHelperRequest {
        OperatorEnrollmentHelperRequest(
            protocolVersion: 2,
            operation: "enroll",
            requestId: "request-1",
            nonce: "nonce-1",
            daemonGeneration: "generation-7",
            bootstrapId: "bootstrap-1",
            expiresAtMs: nowMs + 60_000,
            challengeBytesBase64: challenge.base64EncodedString(),
            challengeDigest: challengeDigest
        )
    }

    nonisolated private static var challengeDigest: String {
        "sha256:" + SHA256.hash(data: challenge).map { String(format: "%02x", $0) }.joined()
    }

    nonisolated private static func pendingEnvelope(challengeDigest: String? = nil) -> Data {
        let item = try! JSONSerialization.jsonObject(with: recoveryItem(
            events: [["eventId": "event-created", "kind": "challenge-created"]],
            challengeDigest: challengeDigest
        ))
        return listEnvelope(items: [item])
    }

    nonisolated private static func mutatedPendingEnvelope(field: String) -> Data {
        var item = try! JSONSerialization.jsonObject(with: recoveryItem(
            events: [["eventId": "event-created", "kind": "challenge-created"]]
        )) as! [String: Any]
        var signing = item["signing"] as! [String: Any]
        for decision in ["approve", "deny"] {
            var prompt = signing[decision] as! [String: Any]
            let bytes = Data(base64Encoded: prompt["challengeBytesBase64"] as! String)!
            var envelope = try! JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            switch field {
            case "worktree": envelope["worktree"] = "/Users/operator/coding/another-worktree"
            case "actorId": envelope["actorId"] = "01M00000000000000000000000"
            case "actionHash": envelope["actionHash"] = "sha256:\(String(repeating: "9", count: 64))"
            case "decision": envelope["decision"] = "revoke"
            case "enrollmentActivationEventId": envelope["enrollmentActivationEventId"] = "operator-authority-event:activated-other"
            case "claim.filePath":
                var claims = envelope["claims"] as! [[String: Any]]
                claims[0]["filePath"] = "lib/other-authority.ts"
                envelope["claims"] = claims
            default: fatalError("unknown signing mutation")
            }
            let changed = try! JSONSerialization.data(
                withJSONObject: envelope,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
            prompt["challengeBytesBase64"] = changed.base64EncodedString()
            prompt["challengeDigest"] = sha256Digest(changed)
            signing[decision] = prompt
        }
        item["signing"] = signing
        return listEnvelope(items: [item])
    }

    nonisolated private static func listEnvelope(items: [Any]) -> Data {
        return try! JSONSerialization.data(withJSONObject: [
            "success": true,
            "count": items.count,
            "daemonGeneration": "generation-7",
            "recoveries": items,
        ])
    }

    nonisolated private static func recoveryItem(
        status: String = "pending",
        successorSessionId: String? = nil,
        events: [[String: String]],
        challengeDigest: String? = nil,
        addForbiddenFields: Bool = false
    ) -> Data {
        var scope: [String: Any] = [
            "actionHash": Self.actionHash,
            "harbor": "local",
            "project": "port-daddy",
            "worktree": "/Users/operator/coding/port-daddy-recovery",
            "branch": "codex/recovery",
            "predecessorSessionId": "session-old",
            "sessionIntent": "repair operator presence",
            "actorId": "01M1366E7N8VWB417S3C45HEZP",
            "intendedAgentId": "agent-repair-operator-presence",
            "daemonGeneration": "generation-7",
            "nonce": "recovery-nonce-7",
            "expiresAt": 1_900_000_000_000 as Int64,
            "bodyExpiresAt": 1_900_604_800_000 as Int64,
            "jtiDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "contextSlot": "codex-thread-7",
            "priorContextDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "deviceKeyId": "device-key-1",
            "enrollmentEventId": "operator-authority-event:enrolled-1",
            "enrollmentActivationEventId": "operator-authority-event:activated-1",
            "claims": [
                [
                    "id": 101,
                    "nodeId": "claim-node:one",
                    "disposition": "transfer",
                    "repoId": "port-daddy",
                    "worldKind": "worktree",
                    "worldId": "worktree-recovery",
                    "gitOid": NSNull(),
                    "selectorKind": "symbol",
                    "filePath": "lib/operator-recovery.ts",
                    "startLine": 120,
                    "endLine": 188,
                    "symbol": NSNull(),
                    "symbolPath": "OperatorRecovery.consume",
                    "sessionId": "session-old",
                    "purpose": "repair operator presence",
                    "agentId": "agent-repair-operator-presence",
                    "phase": "in_progress",
                    "mode": "X",
                    "intent": "resume exact authority",
                    "claimedAt": 1_899_999_900_000 as Int64,
                    "releasedAt": NSNull(),
                    "observedBy": "operator",
                    "confidence": 1.0,
                    "legacySessionFileId": NSNull(),
                ],
                [
                    "id": 102,
                    "nodeId": "claim-node:two",
                    "disposition": "release",
                    "repoId": "port-daddy",
                    "worldKind": "worktree",
                    "worldId": "worktree-recovery",
                    "gitOid": NSNull(),
                    "selectorKind": "range",
                    "filePath": "tests/unit/operator-recovery.test.ts",
                    "startLine": 40,
                    "endLine": 88,
                    "symbol": NSNull(),
                    "symbolPath": NSNull(),
                    "sessionId": "session-old",
                    "purpose": "repair operator presence",
                    "agentId": "agent-repair-operator-presence",
                    "phase": "in_progress",
                    "mode": "X",
                    "intent": "release exact test claim",
                    "claimedAt": 1_899_999_901_000 as Int64,
                    "releasedAt": NSNull(),
                    "observedBy": NSNull(),
                    "confidence": 0.875,
                    "legacySessionFileId": 42,
                ],
            ],
        ]
        if addForbiddenFields {
            scope["credential"] = "raw-credential-must-never-render"
            scope["signatureDerBase64"] = "raw-signature-must-never-render"
            scope["jti"] = "raw-jti-must-never-render"
            scope["grant"] = "raw-grant-must-never-render"
        }
        let signingPrompt: (String) -> [String: Any] = { decision in
            var envelope = scope
            envelope["schema"] = "pd.operator-recovery-decision.v0"
            envelope["decision"] = decision
            envelope["recoveryId"] = "recovery-1"
            let bytes = try! JSONSerialization.data(
                withJSONObject: envelope,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
            return [
                "challengeBytesBase64": bytes.base64EncodedString(),
                "challengeDigest": challengeDigest ?? sha256Digest(bytes),
            ]
        }
        let signing: Any
        switch status {
        case "pending":
            signing = [
                "approve": signingPrompt("approve"),
                "deny": signingPrompt("deny"),
                "revoke": NSNull(),
            ]
        case "approved":
            signing = [
                "approve": NSNull(),
                "deny": NSNull(),
                "revoke": signingPrompt("revoke"),
            ]
        default:
            signing = NSNull()
        }
        let canonicalEvents: [[String: String]]
        if events.first?["kind"] == "challenge-created" {
            canonicalEvents = events
        } else {
            canonicalEvents = [["eventId": "event-created", "kind": "challenge-created"]] + events
        }
        let publicEvents: [[String: Any]] = canonicalEvents.enumerated().map { index, event in
            var projected = event as [String: Any]
            projected["ledgerSeq"] = index + 41
            return projected
        }
        let eventIds = canonicalEvents.compactMap { $0["eventId"] }
        let terminalEvent: Any = eventIds.last.map { $0 as Any } ?? NSNull()
        let authorityEvent: Any = ["denied", "expired", "revoked", "consumed"].contains(status)
            ? terminalEvent
            : NSNull()
        return try! JSONSerialization.data(withJSONObject: [
            "recoveryId": "recovery-1",
            "status": status,
            "scope": scope,
            "signing": signing,
            "successorSessionId": successorSessionId ?? NSNull(),
            "receipt": [
                "ledgerSequences": publicEvents.compactMap { $0["ledgerSeq"] },
                "eventIds": eventIds,
                "terminalAuthorityEventId": authorityEvent,
                "terminalEventId": terminalEvent,
            ],
            "events": publicEvents,
        ])
    }

    nonisolated private static func recoveryChallenge(decision: String) -> Data {
        let item = try! JSONSerialization.jsonObject(with: recoveryItem(
            events: [["eventId": "event-created", "kind": "challenge-created"]]
        )) as! [String: Any]
        let signing = item["signing"] as! [String: Any]
        let prompt = signing[decision] as! [String: Any]
        return Data(base64Encoded: prompt["challengeBytesBase64"] as! String)!
    }

    nonisolated private static func decisionEnvelope(
        status: String,
        successorSessionId: String,
        events: [[String: String]],
        includeCustody: Bool
    ) -> Data {
        var item = try! JSONSerialization.jsonObject(with: recoveryItem(
            status: status,
            successorSessionId: successorSessionId,
            events: events
        )) as! [String: Any]
        item["success"] = true
        item["binding"] = [
            "predecessorSessionId": "session-old",
            "successorSessionId": successorSessionId,
            "actorId": "01M1366E7N8VWB417S3C45HEZP",
            "intendedAgentId": "agent-repair-operator-presence",
            "transferredClaimNodeIds": ["claim-node:one"],
            "releasedClaimNodeIds": ["claim-node:two"],
            "boundAt": 1_900_000_000_100 as Int64,
        ]
        item["bodyCredential"] = [
            "bodyId": "body-receipt-1",
            "actorId": "01M1366E7N8VWB417S3C45HEZP",
            "intendedAgentId": "agent-repair-operator-presence",
            "scopeProfile": "session-body-v1",
            "scope": [
                "harbor": "local",
                "sessionId": successorSessionId,
                "project": "port-daddy",
                "canonicalWorktree": "/Users/operator/coding/port-daddy-recovery",
                "branch": "codex/recovery",
            ],
            "issuedAt": 1_900_000_000_100 as Int64,
            "expiresAt": 1_900_604_800_000 as Int64,
        ]
        if includeCustody {
            item["custody"] = [
                "installed": true,
                "contextSlot": "codex-thread-7",
                "canonicalWorktree": "/Users/operator/coding/port-daddy-recovery",
                "mode": 384,
            ]
        }
        return try! JSONSerialization.data(withJSONObject: item)
    }
}

private extension URLRequest {
    var operatorRecoveryBodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
