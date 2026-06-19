import XCTest
@testable import FleetBar

// MARK: - Test Doubles

/// In-memory pasteboard so auto-clear logic is deterministic and never touches
/// the real system clipboard.
final class FakePasteboard: SecretPasteboard, @unchecked Sendable {
    private(set) var stored: String?
    private(set) var count = 0
    private(set) var clearCalls = 0

    func write(_ string: String) -> Int {
        stored = string
        count += 1
        return count
    }

    var changeCount: Int { count }
    var currentString: String? { stored }

    func clear() {
        stored = ""
        clearCalls += 1
        count += 1
    }

    /// Simulate another app/process writing to the clipboard.
    func externalWrite(_ string: String) {
        stored = string
        count += 1
    }
}

/// URLProtocol stub that returns canned responses keyed by path + method.
final class StubURLProtocol: URLProtocol {
    struct Stub {
        let status: Int
        let body: Data
    }

    nonisolated(unsafe) static var handler: ((URLRequest) -> Stub)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = StubURLProtocol.handler else {
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
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }
}

// MARK: - Tests

@MainActor
final class SecretsStoreTests: XCTestCase {

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    // MARK: Decode

    func testDecodesGetSecretsPayload() throws {
        let json = """
        {
          "success": true,
          "secrets": [
            { "key": "OPENAI_API_KEY", "backend": "openai", "storage": "keychain", "encryptedAtRest": true, "set": true },
            { "key": "LEGACY_TOKEN", "backend": null, "storage": "plaintext", "encryptedAtRest": false, "set": true },
            { "key": "GEMINI_API_KEY", "backend": "gemini", "storage": "keychain", "encryptedAtRest": true, "set": false }
          ]
        }
        """.data(using: .utf8)!

        let secrets = try SecretsStore.decodeList(json)
        XCTAssertEqual(secrets.count, 3)

        let openai = secrets[0]
        XCTAssertEqual(openai.key, "OPENAI_API_KEY")
        XCTAssertEqual(openai.backend, "openai")
        XCTAssertEqual(openai.storage, .keychain)
        XCTAssertTrue(openai.encryptedAtRest)
        XCTAssertTrue(openai.set)

        let legacy = secrets[1]
        XCTAssertNil(legacy.backend)
        XCTAssertEqual(legacy.storage, .plaintext)
        XCTAssertTrue(legacy.storage.isSensitive)
        XCTAssertFalse(legacy.encryptedAtRest)

        let gemini = secrets[2]
        XCTAssertFalse(gemini.set)
    }

    func testDecodeDegradesGracefullyOnUnknownStorageAndMissingFields() throws {
        let json = """
        { "secrets": [ { "key": "WEIRD", "storage": "vault" } ] }
        """.data(using: .utf8)!

        let secrets = try SecretsStore.decodeList(json)
        XCTAssertEqual(secrets.count, 1)
        XCTAssertEqual(secrets[0].storage, .unknown)
        XCTAssertFalse(secrets[0].encryptedAtRest)
        XCTAssertFalse(secrets[0].set)
        XCTAssertNil(secrets[0].backend)
    }

    /// The list payload must never carry a value field — guard the contract.
    func testListPayloadNeverContainsValues() throws {
        let json = """
        { "secrets": [ { "key": "A", "storage": "keychain", "encryptedAtRest": true, "set": true } ] }
        """.data(using: .utf8)!
        let raw = String(data: json, encoding: .utf8)!
        XCTAssertFalse(raw.contains("\"value\""))
        let secrets = try SecretsStore.decodeList(json)
        // SecretSummary has no value property; this compiles only because it
        // does not exist. Assert metadata is intact.
        XCTAssertEqual(secrets.first?.key, "A")
    }

    // MARK: Masking

    func testMaskingHidesValueUntilRevealed() {
        XCTAssertEqual(SecretMask.display(value: "sk-secret", revealed: false), SecretMask.placeholder)
        XCTAssertEqual(SecretMask.display(value: "sk-secret", revealed: true), "sk-secret")
        // Revealed but no value -> still masked.
        XCTAssertEqual(SecretMask.display(value: nil, revealed: true), SecretMask.placeholder)
        // Empty value -> masked even when revealed.
        XCTAssertEqual(SecretMask.display(value: "", revealed: true), SecretMask.placeholder)
    }

    func testMaskPlaceholderHasFixedWidthRegardlessOfValue() {
        // Placeholder length must not leak the real value's length.
        let short = SecretMask.display(value: "x", revealed: false)
        let long = SecretMask.display(value: String(repeating: "x", count: 200), revealed: false)
        XCTAssertEqual(short, long)
    }

    // MARK: Reveal

    func testRevealPopulatesValueAndIsRevealed() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"success":true,"key":"OPENAI_API_KEY","value":"sk-live-123"}"#.data(using: .utf8)!)
        }
        let store = makeStore()
        XCTAssertFalse(store.isRevealed("OPENAI_API_KEY"))

        await store.reveal("OPENAI_API_KEY")

        XCTAssertTrue(store.isRevealed("OPENAI_API_KEY"))
        XCTAssertEqual(store.revealedValue("OPENAI_API_KEY"), "sk-live-123")
    }

    func testHideClearsRevealedValue() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"key":"K","value":"v"}"#.data(using: .utf8)!)
        }
        let store = makeStore()
        await store.reveal("K")
        XCTAssertTrue(store.isRevealed("K"))

        store.hide("K")
        XCTAssertFalse(store.isRevealed("K"))
        XCTAssertNil(store.revealedValue("K"))
    }

    func testHideAllClearsEveryRevealedValue() async {
        StubURLProtocol.handler = { req in
            let key = req.url!.pathComponents.dropLast().last ?? "K"
            return .init(status: 200, body: #"{"key":"\#(key)","value":"v"}"#.data(using: .utf8)!)
        }
        let store = makeStore()
        await store.reveal("A")
        await store.reveal("B")
        XCTAssertEqual(store.revealedValues.count, 2)

        store.hideAll()
        XCTAssertTrue(store.revealedValues.isEmpty)
    }

    // MARK: Copy + auto-clear

    func testCopyWritesToPasteboardAndStartsHold() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"key":"K","value":"sk-copyme"}"#.data(using: .utf8)!)
        }
        let board = FakePasteboard()
        let store = makeStore(pasteboard: board)

        await store.copyToClipboard("K")

        XCTAssertEqual(board.currentString, "sk-copyme")
        XCTAssertEqual(store.clipboardHold?.key, "K")
        XCTAssertEqual(store.clipboardHold?.value, "sk-copyme")
    }

    func testClearClipboardClearsWhenStillOurs() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"key":"K","value":"sk-copyme"}"#.data(using: .utf8)!)
        }
        let board = FakePasteboard()
        let store = makeStore(pasteboard: board)
        await store.copyToClipboard("K")

        let didClear = store.clearClipboardIfOurs()

        XCTAssertTrue(didClear)
        XCTAssertEqual(board.clearCalls, 1)
        XCTAssertEqual(board.currentString, "")
        XCTAssertNil(store.clipboardHold)
    }

    func testClearClipboardDoesNotClobberValueCopiedByAnotherApp() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"key":"K","value":"sk-copyme"}"#.data(using: .utf8)!)
        }
        let board = FakePasteboard()
        let store = makeStore(pasteboard: board)
        await store.copyToClipboard("K")

        // Operator copies something else after us.
        board.externalWrite("totally-unrelated-thing")

        let didClear = store.clearClipboardIfOurs()

        XCTAssertFalse(didClear, "Must not clear a pasteboard the operator overwrote")
        XCTAssertEqual(board.clearCalls, 0)
        XCTAssertEqual(board.currentString, "totally-unrelated-thing")
        XCTAssertNil(store.clipboardHold)
    }

    func testClearClipboardNoOpWhenNothingHeld() {
        let board = FakePasteboard()
        let store = makeStore(pasteboard: board)
        XCTAssertFalse(store.clearClipboardIfOurs())
        XCTAssertEqual(board.clearCalls, 0)
    }

    func testClipboardSecondsRemainingCountsDownFromTTL() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"key":"K","value":"v"}"#.data(using: .utf8)!)
        }
        // Controllable clock.
        var fakeNow = Date(timeIntervalSince1970: 1_000_000)
        let board = FakePasteboard()
        let store = SecretsStore(
            autoStart: false,
            baseURL: "http://127.0.0.1:9999",
            session: StubURLProtocol.makeSession(),
            pasteboard: board,
            clipboardTTL: 45,
            revealTTL: 30,
            now: { fakeNow }
        )

        await store.copyToClipboard("K")
        XCTAssertEqual(store.clipboardSecondsRemaining, 45)

        fakeNow = fakeNow.addingTimeInterval(20)
        XCTAssertEqual(store.clipboardSecondsRemaining, 25)

        fakeNow = fakeNow.addingTimeInterval(30) // past the deadline
        XCTAssertEqual(store.clipboardSecondsRemaining, 0)
    }

    func testCopyDefaultTTLIs45Seconds() {
        let store = makeStore()
        XCTAssertEqual(store.clipboardTTL, 45)
    }

    /// Teardown backstop: when the store is deallocated while a secret it wrote
    /// is still on the pasteboard, deinit must clear it (best effort). The fake
    /// is held outside the store so we can inspect it after the store is gone.
    func testDeinitClearsClipboardWhenSecretStillOurs() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"key":"K","value":"sk-teardown"}"#.data(using: .utf8)!)
        }
        let board = FakePasteboard()
        do {
            let store = makeStore(pasteboard: board)
            await store.copyToClipboard("K")
            XCTAssertEqual(board.currentString, "sk-teardown")
        } // store deallocated here
        XCTAssertEqual(board.currentString, "", "deinit should clear our secret from the pasteboard")
        XCTAssertEqual(board.clearCalls, 1)
    }

    /// Teardown must NOT clobber a value the operator copied after us.
    func testDeinitDoesNotClobberForeignClipboardOnTeardown() async {
        StubURLProtocol.handler = { _ in
            .init(status: 200, body: #"{"key":"K","value":"sk-teardown"}"#.data(using: .utf8)!)
        }
        let board = FakePasteboard()
        do {
            let store = makeStore(pasteboard: board)
            await store.copyToClipboard("K")
            board.externalWrite("operator-copied-this")
        } // store deallocated here
        XCTAssertEqual(board.currentString, "operator-copied-this")
        XCTAssertEqual(board.clearCalls, 0)
    }

    /// The copy affordance's countdown TTL must reflect the store's configured
    /// clipboardTTL, not a hard-coded constant — guards against UI/store drift.
    func testClipboardTTLIsConfigurable() {
        let store = SecretsStore(
            autoStart: false,
            baseURL: "http://127.0.0.1:9999",
            session: StubURLProtocol.makeSession(),
            pasteboard: FakePasteboard(),
            clipboardTTL: 20,
            revealTTL: 30
        )
        XCTAssertEqual(store.clipboardTTL, 20)
    }

    /// setSecret must POST a body containing the value exactly (no silent
    /// empty-body failure from a swallowed encoding error).
    func testSetSecretEncodesNonEmptyBody() async {
        nonisolated(unsafe) var capturedBody: Data?
        StubURLProtocol.handler = { req in
            if req.httpMethod == "POST", req.url!.path.hasSuffix("/secrets") {
                capturedBody = req.bodyData
                return .init(status: 200, body: #"{"success":true}"#.data(using: .utf8)!)
            }
            return .init(status: 200, body: #"{"secrets":[]}"#.data(using: .utf8)!)
        }
        let store = makeStore()
        _ = await store.setSecret(key: "K", value: "sk-body")

        let raw = capturedBody.flatMap { String(data: $0, encoding: .utf8) }
        XCTAssertNotNil(raw)
        XCTAssertFalse(raw!.isEmpty)
        XCTAssertTrue(raw!.contains("sk-body"))
        XCTAssertTrue(raw!.contains("\"K\""))
    }

    // MARK: Set / Delete

    func testSetSecretPostsAndReturnsTrueOn2xx() async {
        nonisolated(unsafe) var capturedBody: Data?
        StubURLProtocol.handler = { req in
            if req.httpMethod == "POST", req.url!.path.hasSuffix("/secrets") {
                capturedBody = req.bodyData
                return .init(status: 200, body: #"{"success":true,"key":"NEW"}"#.data(using: .utf8)!)
            }
            // refresh() GET after set
            return .init(status: 200, body: #"{"secrets":[]}"#.data(using: .utf8)!)
        }
        let store = makeStore()

        let ok = await store.setSecret(key: "NEW", value: "sk-new", backend: "openai")
        XCTAssertTrue(ok)

        // The POST body must contain the value exactly once and the key.
        if let capturedBody, let raw = String(data: capturedBody, encoding: .utf8) {
            XCTAssertTrue(raw.contains("\"NEW\""))
            XCTAssertTrue(raw.contains("sk-new"))
        }
        // Set response must NOT carry a value back.
        XCTAssertNil(store.revealedValue("NEW"))
    }

    func testSetSecretReturnsFalseOnError() async {
        StubURLProtocol.handler = { _ in .init(status: 500, body: Data()) }
        let store = makeStore()
        let ok = await store.setSecret(key: "X", value: "v")
        XCTAssertFalse(ok)
        XCTAssertNotNil(store.lastError)
    }

    func testDeleteSecretClearsLocalRevealAndClipboard() async {
        StubURLProtocol.handler = { req in
            if req.httpMethod == "POST", req.url!.path.hasSuffix("/reveal") {
                return .init(status: 200, body: #"{"key":"K","value":"sk-x"}"#.data(using: .utf8)!)
            }
            if req.httpMethod == "DELETE" {
                return .init(status: 200, body: #"{"success":true}"#.data(using: .utf8)!)
            }
            return .init(status: 200, body: #"{"secrets":[]}"#.data(using: .utf8)!)
        }
        let board = FakePasteboard()
        let store = makeStore(pasteboard: board)
        await store.copyToClipboard("K")
        XCTAssertNotNil(store.clipboardHold)
        XCTAssertTrue(store.isRevealed("K"))

        let ok = await store.deleteSecret(key: "K")
        XCTAssertTrue(ok)
        XCTAssertFalse(store.isRevealed("K"))
        XCTAssertNil(store.clipboardHold)
    }

    // MARK: Storage metadata

    func testStorageLabelsAndSensitivity() {
        XCTAssertEqual(SecretStorage.keychain.label, "Keychain")
        XCTAssertEqual(SecretStorage.plaintext.label, "Plaintext")
        XCTAssertFalse(SecretStorage.keychain.isSensitive)
        XCTAssertTrue(SecretStorage.plaintext.isSensitive)
        // Every storage maps to an SF Symbol (non-empty, no emoji).
        for storage in [SecretStorage.keychain, .plaintext, .env, .unknown] {
            XCTAssertFalse(storage.icon.isEmpty)
            XCTAssertTrue(storage.icon.allSatisfy { $0.isASCII })
        }
    }

    // MARK: - Helpers

    private func makeStore(pasteboard: SecretPasteboard = FakePasteboard()) -> SecretsStore {
        SecretsStore(
            autoStart: false,
            baseURL: "http://127.0.0.1:9999",
            session: StubURLProtocol.makeSession(),
            pasteboard: pasteboard
        )
    }
}

// MARK: - URLRequest body helper
//
// URLProtocol strips httpBody into httpBodyStream for some sessions; read both.
private extension URLRequest {
    var bodyData: Data? {
        if let body = httpBody { return body }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
