import XCTest
import Foundation
@testable import PortDaddyKit

/// `PortDaddyFixtures`' error paths, which nothing exercised.
///
/// Every other suite in this target calls the loader on its happy path, so
/// `FixtureError` was a type no running code had ever constructed. The part
/// that makes it worth a test is narrow and specific: `decode` catches the
/// underlying `DecodingError` and rethrows it as
/// `.unreadable(name, String(describing: error))`. Replace that second argument
/// with a fixed phrase — the obvious "simplification" — and the only thing lost
/// is the sentence naming which key was wrong, which is the entire reason a
/// developer reads this error. A test asserting only "it throws" would not
/// notice, so these assert the CONTENT.
final class FixturesTests: XCTestCase {

    /// Decoding a real fixture as the wrong type reaches the `catch` in
    /// `Fixtures.swift:59-66` with genuine `DecodingError` content. Doing it
    /// this way rather than committing a malformed .json keeps the
    /// TypeScript -> Swift drift gate out of it: that gate regenerates the
    /// fixture files from their canonical sources and would delete a
    /// deliberately-broken one on the next run.
    func testDecodingAFixtureAsTheWrongTypeNamesTheFixtureAndCarriesTheReason() {
        // harbors.fixture.json is `{ note, entries }`; RoadmapProjection wants
        // `v` first, so this is a keyNotFound, not a near miss.
        XCTAssertThrowsError(
            try PortDaddyFixtures.decode(RoadmapProjection.self, from: .harbors)
        ) { error in
            guard case FixtureError.unreadable(let name, let reason) = error else {
                return XCTFail("expected FixtureError.unreadable, got \(error)")
            }
            XCTAssertEqual(name, PortDaddyFixture.harbors.rawValue)
            XCTAssertFalse(reason.isEmpty, "an unreadable fixture must say why")
            XCTAssertTrue(
                reason.contains("keyNotFound") || reason.contains("typeMismatch"),
                "the reason must carry the DecodingError, not a fixed phrase — got: \(reason)"
            )
        }
    }

    /// `object(_:)` has its own `.unreadable` throw with a hand-written reason
    /// rather than a DecodingError. Both fixtures below are JSON objects, so
    /// the only way to reach it is a fixture whose top level is not one — none
    /// exists, and inventing one would again fight the drift gate. What IS
    /// checkable without a fixture is that the sentence a developer reads names
    /// the fixture: an error that says "could not be decoded" and nothing else
    /// sends them looking through five files.
    func testBothErrorSentencesNameTheFixtureTheyAreAbout() {
        XCTAssertTrue(
            FixtureError.missing("harbors.fixture").description.contains("harbors.fixture"),
            "a missing-fixture error must name the fixture"
        )
        let unreadable = FixtureError.unreadable("harbors.fixture", "top level is not an object")
        XCTAssertTrue(unreadable.description.contains("harbors.fixture"))
        XCTAssertTrue(
            unreadable.description.contains("top level is not an object"),
            "the reason must survive into the description, not be swallowed by it"
        )
    }

    /// The happy path, asserted once so the tests above are known to be
    /// failing for the right reason: `decode` against the MATCHING type does
    /// not throw. Without this, a loader broken badly enough to throw on
    /// everything would make both tests above pass.
    func testTheLoaderStillSucceedsOnAMatchingType() throws {
        _ = try PortDaddyFixtures.decode(RoadmapProjection.self, from: .roadmapProjection)
    }
}
