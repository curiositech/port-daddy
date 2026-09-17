import XCTest
@testable import PortholeStageCore

final class RecordingStorageBudgetTests: XCTestCase {
    typealias Budget = RecordingStorageBudget

    func testOversizeOutputBlocksAdmissionDespiteQuotaHeadroom() async throws {
        let budget = try Budget(limits: .init(totalBytes: 100, freeDiskReserveBytes: 10),
                                availableDiskBytes: 30)
        let token = try await budget.reserve(bytes: 10, purpose: .media)
        await expect(.exceedsReservation) { try await budget.commit(token, actualBytes: 11) }
        await expect(.admissionHeld) { _ = try await budget.reserve(bytes: 10, purpose: .media) }
        await expect(.admissionHeld) { try await budget.commit(token, actualBytes: 0) }
        let held = await budget.snapshot()
        XCTAssertEqual(held.heldReservationCount, 1)
        XCTAssertEqual(held.reservationCount, 1)
        let refusals = await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<100 {
                group.addTask {
                    do { _ = try await budget.reserve(bytes: 1, purpose: .ocr); return false }
                    catch { return error as? Budget.Failure == .admissionHeld }
                }
            }
            var count = 0
            for await refused in group { if refused { count += 1 } }
            return count
        }
        XCTAssertEqual(refusals, 100)
        // Explicit stopped-writer cleanup removes all 11 bytes before this call.
        try await budget.release(token)
        let replacement = try await budget.reserve(bytes: 20, purpose: .media)
        try await budget.commit(replacement, actualBytes: 20)
        let restored = await budget.snapshot()
        XCTAssertEqual(restored.heldReservationCount, 0)
        XCTAssertEqual(restored.estimatedFreeDiskBytes, 10)
    }

    func testEveryOffendingTokenRequiresCleanupWhileOtherWritersCanCommit() async throws {
        let budget = try Budget(limits: .init(totalBytes: 100, freeDiskReserveBytes: 10),
                                availableDiskBytes: 60)
        let first = try await budget.reserve(bytes: 10, purpose: .media)
        let second = try await budget.reserve(bytes: 10, purpose: .temporaryExport)
        let valid = try await budget.reserve(bytes: 10, purpose: .ocr)
        let cancelled = try await budget.reserve(bytes: 10, purpose: .thumbnail)
        await expect(.exceedsReservation) { try await budget.commit(first, actualBytes: 11) }
        await expect(.exceedsReservation) { try await budget.commit(second, actualBytes: Int64.max) }
        try await budget.commit(valid, actualBytes: 8, pinned: true)
        try await budget.release(cancelled)
        await expect(.admissionHeld) { _ = try await budget.reserve(bytes: 1, purpose: .media) }
        let both = await budget.snapshot()
        XCTAssertEqual(both.heldReservationCount, 2)
        XCTAssertEqual(both.committedBytes, 8)
        XCTAssertEqual(both.pinnedBytes, 8)
        XCTAssertEqual(both.reservedBytes, 20)
        try await budget.release(first)
        await expect(.admissionHeld) { try await budget.commit(second, actualBytes: 10) }
        await expect(.admissionHeld) { _ = try await budget.reserve(bytes: 1, purpose: .media) }
        let partial = await budget.snapshot()
        XCTAssertEqual(partial.heldReservationCount, 1)
        try await budget.release(second)
        let restored = try await budget.reserve(bytes: 42, purpose: .media)
        try await budget.commit(restored, actualBytes: 42)
        let final = await budget.snapshot()
        XCTAssertEqual(final.estimatedFreeDiskBytes, 10)
        XCTAssertEqual(final.heldReservationCount, 0)
    }

    func testDefaultsAndInvalidInitialization() throws {
        XCTAssertEqual(Budget.Limits().totalBytes, 20 * 1_024 * 1_024 * 1_024)
        XCTAssertEqual(Budget.Limits().freeDiskReserveBytes, 10 * 1_024 * 1_024 * 1_024)
        for limits in [Budget.Limits(totalBytes: 0), Budget.Limits(totalBytes: -1),
                       Budget.Limits(freeDiskReserveBytes: -1),
                       Budget.Limits(maximumReservations: 0)] {
            XCTAssertThrowsError(try Budget(limits: limits, availableDiskBytes: 100))
        }
        XCTAssertThrowsError(try Budget(existingBytes: -1, availableDiskBytes: 100))
        XCTAssertThrowsError(try Budget(existingPinnedBytes: 1, availableDiskBytes: 100))
        XCTAssertThrowsError(try Budget(existingBytes: Int64.max, availableDiskBytes: 100))
        XCTAssertThrowsError(try Budget(availableDiskBytes: -1))
    }

    func testAllPurposesShareQuotaAndPinsDoNotEscapeIt() async throws {
        let budget = try Budget(limits: .init(totalBytes: 100, freeDiskReserveBytes: 10),
                                existingBytes: 20, existingPinnedBytes: 20, availableDiskBytes: 200)
        for purpose in Budget.Purpose.allCases {
            let token = try await budget.reserve(bytes: 10, purpose: purpose)
            try await budget.commit(token, actualBytes: 10, pinned: true)
        }
        let last = try await budget.reserve(bytes: 10, purpose: .media)
        await expect(.quotaExceeded) { _ = try await budget.reserve(bytes: 1, purpose: .ocr) }
        try await budget.commit(last, actualBytes: 10)
        let state = await budget.snapshot()
        XCTAssertEqual(state.committedBytes, 100)
        XCTAssertEqual(state.pinnedBytes, 90)
        XCTAssertEqual(state.reservedBytes, 0)
    }

    func testDiskReserveExactBoundaryAndCommittedBytesStillConsumeDisk() async throws {
        let budget = try Budget(limits: .init(totalBytes: 1_000, freeDiskReserveBytes: 100),
                                availableDiskBytes: 130)
        let a = try await budget.reserve(bytes: 20, purpose: .media)
        let b = try await budget.reserve(bytes: 10, purpose: .temporaryExport)
        await expect(.diskReserveExceeded) { _ = try await budget.reserve(bytes: 1, purpose: .ocr) }
        try await budget.commit(a, actualBytes: 15)
        let c = try await budget.reserve(bytes: 5, purpose: .thumbnail)
        await expect(.diskReserveExceeded) { _ = try await budget.reserve(bytes: 1, purpose: .media) }
        try await budget.release(b)
        try await budget.release(c)
        let state = await budget.snapshot()
        XCTAssertEqual(state.estimatedFreeDiskBytes, 115)
        XCTAssertEqual(state.committedBytes, 15)
        let d = try await budget.reserve(bytes: 15, purpose: .media)
        try await budget.commit(d, actualBytes: 15)
        await expect(.diskReserveExceeded) { _ = try await budget.reserve(bytes: 1, purpose: .media) }
    }

    func testFailedCommitLeavesCapacityReservedAndTokenIsSingleUse() async throws {
        let budget = try Budget(limits: .init(totalBytes: 10, freeDiskReserveBytes: 0),
                                availableDiskBytes: 10)
        let token = try await budget.reserve(bytes: 10, purpose: .media)
        let before = await budget.snapshot()
        await expect(.invalidValue) { try await budget.commit(token, actualBytes: -1) }
        let after = await budget.snapshot()
        XCTAssertEqual(before, after)
        // Invalid negative reports do not assert the presence of oversize bytes.
        await expect(.quotaExceeded) { _ = try await budget.reserve(bytes: 1, purpose: .ocr) }
        try await budget.commit(token, actualBytes: 0)
        await expect(.unknownReservation) { try await budget.commit(token, actualBytes: 0) }
        await expect(.unknownReservation) { try await budget.release(token) }
        let replacement = try await budget.reserve(bytes: 10, purpose: .media)
        try await budget.release(replacement)
        await expect(.unknownReservation) { try await budget.release(replacement) }
    }

    func testWrongBudgetCannotReleaseOrCommitReservation() async throws {
        let limits = Budget.Limits(totalBytes: 100, freeDiskReserveBytes: 0)
        let a = try Budget(limits: limits, availableDiskBytes: 100)
        let b = try Budget(limits: limits, availableDiskBytes: 100)
        let token = try await a.reserve(bytes: 100, purpose: .media)
        await expect(.unknownReservation) { try await b.release(token) }
        await expect(.unknownReservation) { try await b.commit(token, actualBytes: 100) }
        let state = await a.snapshot()
        XCTAssertEqual(state.reservedBytes, 100)
    }

    func testExtremeIntegersAndBelowReserveFailWithoutOverflow() async throws {
        let budget = try Budget(limits: .init(totalBytes: Int64.max, freeDiskReserveBytes: 0),
                                availableDiskBytes: Int64.max)
        for bytes in [Int64.min, -1, 0] {
            await expect(.invalidValue) { _ = try await budget.reserve(bytes: bytes, purpose: .media) }
        }
        let token = try await budget.reserve(bytes: Int64.max, purpose: .media)
        await expect(.quotaExceeded) { _ = try await budget.reserve(bytes: 1, purpose: .media) }
        try await budget.commit(token, actualBytes: Int64.max, pinned: true)
        let state = await budget.snapshot()
        XCTAssertEqual(state.committedBytes, Int64.max)
        XCTAssertEqual(state.pinnedBytes, Int64.max)
        XCTAssertEqual(state.estimatedFreeDiskBytes, 0)
        let full = try Budget(limits: .init(totalBytes: 100, freeDiskReserveBytes: 10),
                              availableDiskBytes: 9)
        await expect(.diskReserveExceeded) { _ = try await full.reserve(bytes: 1, purpose: .media) }
    }

    func testReservationMetadataIsBounded() async throws {
        let budget = try Budget(limits: .init(totalBytes: 100, freeDiskReserveBytes: 0,
                                              maximumReservations: 1), availableDiskBytes: 100)
        let token = try await budget.reserve(bytes: 1, purpose: .media)
        await expect(.tooManyReservations) { _ = try await budget.reserve(bytes: 1, purpose: .media) }
        try await budget.release(token)
        _ = try await budget.reserve(bytes: 1, purpose: .ocr)
    }

    func testConcurrentWritersCannotOvercommitAndReleaseRestoresCapacity() async throws {
        let budget = try Budget(limits: .init(totalBytes: 100, freeDiskReserveBytes: 50),
                                availableDiskBytes: 150)
        let tokens = await withTaskGroup(of: Budget.Reservation?.self) { group in
            for _ in 0..<200 {
                group.addTask { try? await budget.reserve(bytes: 10, purpose: .media) }
            }
            var successes: [Budget.Reservation] = []
            for await token in group { if let token { successes.append(token) } }
            return successes
        }
        XCTAssertEqual(tokens.count, 10)
        let full = await budget.snapshot()
        XCTAssertEqual(full.reservedBytes, 100)
        for (index, token) in tokens.enumerated() {
            if index.isMultiple(of: 2) { try await budget.commit(token, actualBytes: 8, pinned: true) }
            else { try await budget.release(token) }
        }
        let remainder = try await budget.reserve(bytes: 60, purpose: .temporaryExport)
        try await budget.commit(remainder, actualBytes: 60)
        let final = await budget.snapshot()
        XCTAssertEqual(final.committedBytes, 100)
        XCTAssertEqual(final.pinnedBytes, 40)
        XCTAssertEqual(final.estimatedFreeDiskBytes, 50)
        XCTAssertEqual(final.reservationCount, 0)
    }

    private func expect(_ expected: Budget.Failure,
                        operation: () async throws -> Void) async {
        do { try await operation(); XCTFail("Expected \(expected)") }
        catch { XCTAssertEqual(error as? Budget.Failure, expected) }
    }
}
