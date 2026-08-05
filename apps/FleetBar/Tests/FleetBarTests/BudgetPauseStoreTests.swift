import XCTest
@testable import FleetBar

// 2026-07-08 (issue #676 investigation): BudgetPauseStore.start() used to
// assign fresh subscribe() Tasks straight into pendingTask/resolvedTask with
// no guard. FleetPopover calls start() on every onAppear, and a re-shown
// popover's content view can re-fire onAppear without a preceding
// onDisappear (an observed AppKit/SwiftUI quirk) — each such double-start
// silently overwrote the previous Task references. An unstructured
// `Task { }` is NOT cancelled just because its handle is dropped, so each
// missed teardown leaked two permanent SSE connections to the daemon,
// compounding every time the operator opened the menu-bar dropdown. Fixed by
// making start() call stop() first (mirrors FleetStore.connectSSE(), which
// already did `sseTask?.cancel()` before reassigning) and adding a `deinit`
// safety net for the case stop() is never called at all.
@MainActor
final class BudgetPauseStoreTests: XCTestCase {

    /// Calling start() repeatedly without an intervening stop() must not
    /// crash — this is the exact FleetPopover onAppear-without-onDisappear
    /// scenario. Uses an unroutable base URL so the SSE subscribe requests
    /// fail fast and deterministically instead of hitting a real daemon.
    func testRepeatedStartWithoutStopDoesNotCrash() {
        let store = BudgetPauseStore(baseURL: "http://127.0.0.1.invalid:1")
        store.start()
        store.start()
        store.start()
        store.stop()
        XCTAssertFalse(store.isConnected)
    }

    /// stop() must be safe to call before any start() (used as a defensive
    /// teardown in onDisappear even if onAppear never ran) and safe to call
    /// twice in a row.
    func testStopIsIdempotentAndSafeWithoutPriorStart() {
        let store = BudgetPauseStore(baseURL: "http://127.0.0.1.invalid:1")
        store.stop()
        store.stop()
        XCTAssertFalse(store.isConnected)
    }

    // MARK: - Regression guards on the actual fix shape

    /// Source-level guard: start() must cancel any existing subscription
    /// before creating new ones. This is the one-line fix for the leak —
    /// pin it so a future edit cannot silently drop the `stop()` call and
    /// reintroduce the leak while still passing the behavioral tests above
    /// (which can't observe an internal Task leak without deeper
    /// instrumentation than this store currently exposes).
    func testStartCallsStopFirstInSource() throws {
        let source = try budgetPauseStoreSource()
        guard let startRange = source.range(of: "func start() {") else {
            return XCTFail("could not locate start() in BudgetPauseStore.swift")
        }
        let afterStart = source[startRange.upperBound...]
        guard let closingBrace = afterStart.range(of: "\n    }") else {
            return XCTFail("could not locate end of start() in BudgetPauseStore.swift")
        }
        let body = afterStart[..<closingBrace.lowerBound]
        XCTAssertTrue(body.contains("stop()"), "start() must call stop() first to guard against a double-start leak")
    }

    /// Source-level guard: a `deinit` safety net must cancel both
    /// subscription tasks in case `stop()` is never called before this
    /// object deallocates.
    func testDeinitCancelsBothTasksInSource() throws {
        let source = try budgetPauseStoreSource()
        guard let deinitRange = source.range(of: "deinit {") else {
            return XCTFail("BudgetPauseStore must have a deinit safety net (see FleetStore's equivalent pattern)")
        }
        let afterDeinit = source[deinitRange.upperBound...]
        guard let closingBrace = afterDeinit.range(of: "\n    }") else {
            return XCTFail("could not locate end of deinit in BudgetPauseStore.swift")
        }
        let body = afterDeinit[..<closingBrace.lowerBound]
        XCTAssertTrue(body.contains("pendingTask?.cancel()"), "deinit must cancel pendingTask")
        XCTAssertTrue(body.contains("resolvedTask?.cancel()"), "deinit must cancel resolvedTask")
    }

    /// Source-level guard (Copilot review, PR #879): stop() cancels the
    /// subscribe Tasks but cancellation can unwind a Task without ever
    /// reaching subscribe()'s `catch` block that sets `isConnected = false`
    /// — so stop() itself must set it explicitly, or the UI can get stuck
    /// showing "connected" after a stop().
    func testStopSetsIsConnectedFalseInSource() throws {
        let source = try budgetPauseStoreSource()
        guard let stopRange = source.range(of: "func stop() {") else {
            return XCTFail("could not locate stop() in BudgetPauseStore.swift")
        }
        let afterStop = source[stopRange.upperBound...]
        guard let closingBrace = afterStop.range(of: "\n    }") else {
            return XCTFail("could not locate end of stop() in BudgetPauseStore.swift")
        }
        let body = afterStop[..<closingBrace.lowerBound]
        XCTAssertTrue(body.contains("isConnected = false"), "stop() must explicitly set isConnected = false, not rely on Task cancellation reaching the catch block")
    }

    /// The operator action and daemon contract use one cancellation verb.
    /// Keep the native client from silently posting a stale resolution action.
    func testCancelNowPostsCanonicalCancellationAction() throws {
        let source = try budgetPauseStoreSource()
        guard let methodRange = source.range(of: "func cancelNow(agentId: String) async {") else {
            return XCTFail("could not locate cancelNow(agentId:) in BudgetPauseStore.swift")
        }
        let afterMethod = source[methodRange.upperBound...]
        guard let closingBrace = afterMethod.range(of: "\n    }") else {
            return XCTFail("could not locate end of cancelNow(agentId:) in BudgetPauseStore.swift")
        }
        let body = afterMethod[..<closingBrace.lowerBound]
        XCTAssertTrue(body.contains("body: [\"action\": \"cancel\"]"))
    }

    private func budgetPauseStoreSource() throws -> String {
        let thisFile = URL(fileURLWithPath: #filePath)
        let sourcePath = thisFile
            .deletingLastPathComponent() // BudgetPauseStoreTests.swift -> FleetBarTests/
            .deletingLastPathComponent() // FleetBarTests/ -> Tests/
            .deletingLastPathComponent() // Tests/ -> package root
            .appendingPathComponent("FleetBar")
            .appendingPathComponent("BudgetPauseStore.swift")
        return try String(contentsOf: sourcePath, encoding: .utf8)
    }
}
