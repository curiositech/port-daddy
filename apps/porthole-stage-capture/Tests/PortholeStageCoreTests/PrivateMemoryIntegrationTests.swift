import Foundation
import XCTest
@testable import PortholeStageCore

/// Offline integration of the actual policy primitives with invented media.
/// This is not a codec, persistence, filesystem or network integration test.
final class PrivateMemoryIntegrationTests: XCTestCase {
    func testBoundedBufferToReservedExcerptThenRevocation() async throws {
        var buffer = try SupportRecordingBuffer(byteLimit: 12, durationLimitNanos: 20)
        let producer = buffer.generation
        for n: UInt64 in 0 ..< 4 {
            try buffer.append(.init(sequence: n, startNanos: n * 5, endNanos: n * 5 + 5,
                                    bytes: Data(repeating: UInt8(n), count: 6)), generation: producer)
        }
        XCTAssertEqual(buffer.segments.map(\.sequence), [2, 3])
        let budget = try RecordingStorageBudget(
            limits: .init(totalBytes: 16, freeDiskReserveBytes: 10), availableDiskBytes: 26)
        let media = try await budget.reserve(bytes: 12, purpose: .media)
        let excerpt = buffer.segments.reduce(into: Data()) { $0.append($1.bytes) }
        try await budget.commit(media, actualBytes: Int64(excerpt.count), pinned: true)
        let derivative = try await budget.reserve(bytes: 4, purpose: .ocr)
        try await budget.commit(derivative, actualBytes: 4)
        do {
            _ = try await budget.reserve(bytes: 1, purpose: .temporaryExport)
            XCTFail("Pinned media and OCR must deny an export before allocation")
        } catch { XCTAssertEqual(error as? RecordingStorageBudget.Failure, .quotaExceeded) }

        let source = PortholeRecallSource(id: "fixture", revision: "r1", lineage: "session",
                                          scope: "project", policyRevision: "policy-1")
        let interval = PortholeMomentInterval(start: 10, end: 20)
        let moment = PortholeMomentReference(id: "moment", revision: "m1", source: source,
            interval: interval, transformations: ["fixture-annotation"], evidenceClass: .derived)
        let grant = PortholeRecallGrant(source: source, operation: .disclosure, principal: "agent",
            purpose: "debug", interval: interval, issuedAt: 1, expiresAt: 20)
        let approval = PortholeExcerptApproval(moment: moment, excerpt: excerpt, destination: "account/endpoint",
            principal: "agent", purpose: "debug", issuedAt: 1, expiresAt: 20)
        func permitted(revoked: Bool, data: Data) -> Bool {
            PortholeRecallPolicy.permitsCloudExcerpt(data, destination: "account/endpoint", moment: moment,
                principal: "agent", purpose: "debug", grant: grant, approval: approval,
                state: .init(source: source, retainedInterval: interval, retainedUntil: 30,
                             revoked: revoked, checkedAt: 10), now: 10)
        }
        XCTAssertTrue(permitted(revoked: false, data: excerpt))
        XCTAssertFalse(permitted(revoked: false, data: excerpt + Data([0])))
        buffer.reset()
        XCTAssertFalse(permitted(revoked: true, data: excerpt), "An existing copy has no continuing authority")
        XCTAssertThrowsError(try buffer.append(.init(sequence: 4, startNanos: 20, endNanos: 25,
                                                     bytes: Data([4])), generation: producer))
        let usage = await budget.snapshot()
        XCTAssertEqual(usage.committedBytes, 16, "Reset is not a disk-deletion receipt")
        XCTAssertEqual(usage.pinnedBytes, 12)
    }

    func testOversizeOutputDoesNotFreeCapacityForAnotherPipeline() async throws {
        let budget = try RecordingStorageBudget(
            limits: .init(totalBytes: 10, freeDiskReserveBytes: 10), availableDiskBytes: 20)
        let output = try await budget.reserve(bytes: 10, purpose: .quarantine)
        do { try await budget.commit(output, actualBytes: 11); XCTFail("Oversize output must fail") }
        catch { XCTAssertEqual(error as? RecordingStorageBudget.Failure, .exceedsReservation) }
        do { _ = try await budget.reserve(bytes: 1, purpose: .media); XCTFail("Unresolved bytes still count") }
        catch { XCTAssertEqual(error as? RecordingStorageBudget.Failure, .quotaExceeded) }
        // This represents a stopped synthetic writer with its partial output removed.
        try await budget.release(output)
        let replacement = try await budget.reserve(bytes: 10, purpose: .media)
        try await budget.commit(replacement, actualBytes: 10)
        let state = await budget.snapshot()
        XCTAssertEqual(state.reservationCount, 0)
        XCTAssertEqual(state.estimatedFreeDiskBytes, 10)
    }
}
