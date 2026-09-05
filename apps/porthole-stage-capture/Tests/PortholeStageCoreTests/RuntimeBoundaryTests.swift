import Darwin
import Foundation
import XCTest
@testable import PortholeStageCore

final class RuntimeBoundaryTests: XCTestCase {
    func testQueuedOldHandlerCannotConsumeBytesBelongingToRestartedReader() throws {
        let pipe = Pipe()
        let reader = LocalCursorReader(input: pipe.fileHandleForReading)
        defer { reader.stop(); try? pipe.fileHandleForReading.close() }
        reader.start { _ in XCTFail("retired callback must not run") }
        let retired = try XCTUnwrap(pipe.fileHandleForReading.readabilityHandler)
        reader.stop()
        var received: [CursorEvent] = []
        reader.start { received.append($0) }
        let current = try XCTUnwrap(pipe.fileHandleForReading.readabilityHandler)
        // Drive a previously queued callback in a deterministic order while
        // using the real pipe and the production handler bodies.
        pipe.fileHandleForReading.readabilityHandler = nil
        let fresh = BoundaryFixtures.cursor(sequence: 3)
        try pipe.fileHandleForWriting.write(contentsOf: JSONEncoder().encode(fresh) + Data([10]))
        try pipe.fileHandleForWriting.close()
        retired(pipe.fileHandleForReading)
        current(pipe.fileHandleForReading)
        XCTAssertEqual(received, [fresh], "a stale callback must not steal and discard new-generation bytes")
    }

    func testCursorDecoderEveryByteSplitIncludingMultibyteUnicode() throws {
        let event = BoundaryFixtures.cursor()
        let line = try JSONEncoder().encode(event) + Data([10])
        for split in 0...line.count {
            var decoder = CursorEventLineDecoder()
            let before = decoder.append(Data(line.prefix(split)))
            let after = decoder.append(Data(line.dropFirst(split)))
            XCTAssertEqual(before + after, [event], "split \(split)")
            XCTAssertEqual(decoder.bufferedByteCount, 0)
        }
    }

    func testCursorResetDropsPartialLineAndReleasesRetainedBytes() throws {
        let event = BoundaryFixtures.cursor()
        let json = try JSONEncoder().encode(event)
        var decoder = CursorEventLineDecoder()
        XCTAssertTrue(decoder.append(Data(json.prefix(50))).isEmpty)
        XCTAssertEqual(decoder.bufferedByteCount, 50)
        decoder.reset()
        XCTAssertEqual(decoder.bufferedByteCount, 0)
        XCTAssertEqual(decoder.append(json + Data([10])), [event])
        decoder.reset()
        XCTAssertTrue(decoder.append(Data([10])).isEmpty)
    }

    func testOversizedLineIsDiscardedUntilDelimiterThenReaderRecovers() throws {
        let event = BoundaryFixtures.cursor()
        let line = try JSONEncoder().encode(event)
        var decoder = CursorEventLineDecoder(maximumLineBytes: line.count)
        XCTAssertEqual(decoder.append(line + Data([10])), [event], "exact byte bound is valid")
        for _ in 0..<32 {
            XCTAssertTrue(decoder.append(Data(repeating: 65, count: 4096)).isEmpty)
            XCTAssertLessThanOrEqual(decoder.bufferedByteCount, line.count)
        }
        XCTAssertEqual(decoder.append(Data([10]) + line + Data([10])), [event])
        _ = decoder.append(Data(repeating: 65, count: line.count + 1))
        decoder.reset()
        XCTAssertEqual(decoder.append(line + Data([10])), [event], "reset clears oversize discard state")
    }

    func testMalformedLinesDoNotPoisonFollowingCursorAndLeaseRemainsSeparate() throws {
        let event = BoundaryFixtures.cursor(lease: "old")
        let line = try JSONEncoder().encode(event)
        var decoder = CursorEventLineDecoder()
        let events = decoder.append(Data("\nnot-json\n{\"schema\":\"bad\"}\n".utf8) + line + Data([13, 10]))
        XCTAssertEqual(events, [event])
        XCTAssertFalse(CursorLeasePolicy.permits(events[0], activeLeaseID: "new"))
    }

    func testActualPipeStopAndRestartDoNotRetainPartialLineOrEmitOldBatch() throws {
        let pipe = Pipe()
        let reader = LocalCursorReader(input: pipe.fileHandleForReading)
        defer { reader.stop(); try? pipe.fileHandleForReading.close(); try? pipe.fileHandleForWriting.close() }
        let stopped = expectation(description: "first batch stopped reentrantly")
        let first = BoundaryFixtures.cursor(sequence: 1)
        let second = BoundaryFixtures.cursor(sequence: 2)
        reader.start { event in
            XCTAssertEqual(event, first)
            reader.stop() // Recursive callback is safe; remainder of this batch must be discarded.
            stopped.fulfill()
        }
        let encoder = JSONEncoder()
        try pipe.fileHandleForWriting.write(contentsOf:
            encoder.encode(first) + Data([10]) + encoder.encode(second) + Data([10]) + Data("{partial".utf8))
        wait(for: [stopped], timeout: 3)
        let restarted = expectation(description: "only new stream event")
        let fresh = BoundaryFixtures.cursor(sequence: 3)
        reader.start { event in
            XCTAssertEqual(event, fresh)
            reader.stop()
            restarted.fulfill()
        }
        try pipe.fileHandleForWriting.write(contentsOf: encoder.encode(fresh) + Data([10]))
        wait(for: [restarted], timeout: 3)
    }

    func testActualPipeEOFClearsHandlerWithoutEmittingPartialJSON() throws {
        let pipe = Pipe()
        let reader = LocalCursorReader(input: pipe.fileHandleForReading)
        defer { reader.stop(); try? pipe.fileHandleForReading.close() }
        reader.start { _ in XCTFail("EOF must not authorize an incomplete event") }
        try pipe.fileHandleForWriting.write(contentsOf: Data("{partial".utf8))
        try pipe.fileHandleForWriting.close()
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            pipe.fileHandleForReading.readabilityHandler == nil
        }, object: nil)
        wait(for: [cleared], timeout: 3)
    }

    func testProofDurationRejectsMalformedNonfiniteAndOutOfRangeValues() throws {
        XCTAssertEqual(try ProofDurationPolicy.parse(nil), 8)
        for value in ["2", "30", " 8.5 ", "2e0"] {
            XCTAssertEqual(try ProofDurationPolicy.parse(value), Double(value.trimmingCharacters(in: .whitespaces))!)
        }
        for value in ["", " ", "nope", "NaN", "nan", "inf", "-inf", "Infinity", "1e999"] {
            XCTAssertThrowsError(try ProofDurationPolicy.parse(value), value) {
                XCTAssertEqual($0 as? ProofConfigurationError, .invalidDuration)
            }
        }
        for value in ["-1", "0", "1.999", "30.001", "99999"] {
            XCTAssertThrowsError(try ProofDurationPolicy.parse(value), value) {
                XCTAssertEqual($0 as? ProofConfigurationError, .durationOutOfRange)
            }
        }
    }

    func testPartialDuplicateAndMissingProofArgumentsFailClosed() throws {
        let cwd = URL(fileURLWithPath: "/Users/example/proof")
        XCTAssertNil(try ProofConfigurationParser.parse(arguments: ["Porthole"], currentDirectory: cwd))
        let valid = ["--proof-window-title", "Porthole Safe Fixture", "--proof-output", "recording"]
        let parsed = try XCTUnwrap(ProofConfigurationParser.parse(arguments: valid, currentDirectory: cwd))
        XCTAssertEqual(parsed.outputDirectory.path, "/Users/example/proof/recording")
        XCTAssertEqual(parsed.durationSeconds, 8)
        XCTAssertFalse(parsed.explicitSafeFixtureApproval)
        for args in [
            ["--approve-safe-fixture-persistence"], ["--proof-duration", "3"], ["--proof-window-title"],
            valid + ["--proof-output", "other"], valid + ["--proof-duration"],
            valid + ["--proof-duration", "--approve-safe-fixture-persistence"],
            valid + ["--proof-duration", "3", "--proof-duration", "4"],
            ["--proof-window-title", " ", "--proof-output", "recording"],
        ] { XCTAssertThrowsError(try ProofConfigurationParser.parse(arguments: args, currentDirectory: cwd)) }
        XCTAssertTrue(try XCTUnwrap(ProofConfigurationParser.parse(
            arguments: valid + ["--approve-safe-fixture-persistence"], currentDirectory: cwd)).explicitSafeFixtureApproval)
    }

    func testMetadataOutputIsExactlyOneDecodeableNewlineDelimitedFrame() throws {
        var writes: [Data] = []
        let frame = BoundaryFixtures.frame()
        try FrameMetadataLineWriter { writes.append($0) }.write(frame)
        XCTAssertEqual(writes.count, 1)
        XCTAssertEqual(writes[0].last, 10)
        XCTAssertEqual(writes[0].filter { $0 == 10 }.count, 1)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: writes[0]) as? [String: Any])
        XCTAssertEqual(object["schema"] as? String, "pd.porthole.native-frame-metadata.v1")
        let decoded = try JSONDecoder().decode(FrameMetadata.self,
            from: JSONSerialization.data(withJSONObject: try XCTUnwrap(object["frame"])))
        XCTAssertEqual(decoded, frame)
    }

    func testMetadataSinkFailureAndRealClosedAndBrokenPipesPropagate() throws {
        enum SinkError: Error { case refused }
        XCTAssertThrowsError(try FrameMetadataLineWriter { _ in throw SinkError.refused }.write(BoundaryFixtures.frame()))
        let closed = Pipe()
        try closed.fileHandleForWriting.close()
        defer { try? closed.fileHandleForReading.close() }
        XCTAssertThrowsError(try FrameMetadataLineWriter { try closed.fileHandleForWriting.write(contentsOf: $0) }
            .write(BoundaryFixtures.frame()))
        let broken = Pipe()
        XCTAssertEqual(fcntl(broken.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1), 0)
        try broken.fileHandleForReading.close()
        defer { try? broken.fileHandleForWriting.close() }
        XCTAssertThrowsError(try FrameMetadataLineWriter { try broken.fileHandleForWriting.write(contentsOf: $0) }
            .write(BoundaryFixtures.frame()))
    }

    func testFixtureIdentityIsBoundToManifestAndSignedDigestNotInstallationPath() {
        let program = BoundaryFixtures.program
        func accepts(schema: String = SafeFixtureIdentityManifest.schemaName,
                     bundle: String = "dev.portdaddy.porthole.safe-fixture",
                     name: String = "PortholeFixture", digest: String = program.executableSHA256) -> Bool {
            SafeFixtureIdentityPolicy.accepts(SafeFixtureIdentityManifest(schema: schema,
                bundleIdentifier: bundle, executableFilename: name, executableSHA256: digest),
                observed: program, executableFilename: "PortholeFixture")
        }
        XCTAssertTrue(accepts())
        XCTAssertFalse(accepts(schema: "unknown"))
        XCTAssertFalse(accepts(bundle: "dev.portdaddy.porthole"))
        XCTAssertFalse(accepts(name: "OtherFixture"))
        for digest in [String(repeating: "b", count: 64), String(repeating: "a", count: 63),
                       String(repeating: "A", count: 64), String(repeating: "z", count: 64), ""] {
            XCTAssertFalse(accepts(digest: digest))
        }
    }
}
