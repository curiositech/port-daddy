import XCTest
@testable import PortDaddyKit

// Ideas surface (Snipe proposals + explore chat). The fixture is the contract
// for a feed that is not built yet; these keep it decodable and keep the chat
// speaker asymmetry (them vs you) intact.
final class IdeasTests: XCTestCase {

    func testFeedFixtureDecodes() throws {
        let feed = try PortDaddyFixtures.ideas()
        XCTAssertEqual(feed.ideas.count, 1)
        XCTAssertEqual(feed.ideas.first?.source, "Snipe")
        XCTAssertEqual(feed.exploringTopic, "cache the index")
    }

    func testChatThreadRolesAlternateAsAuthored() throws {
        let feed = try PortDaddyFixtures.ideas()
        XCTAssertEqual(feed.chat.count, 3)
        XCTAssertEqual(feed.chat.map(\.role), [.them, .you, .them])
        XCTAssertEqual(feed.chat.first?.author, "Snipe")
    }

    func testIdeaCarriesTitleAndWhy() throws {
        let idea = try XCTUnwrap(try PortDaddyFixtures.ideas().ideas.first)
        XCTAssertFalse(idea.title.isEmpty)
        XCTAssertFalse(idea.why.isEmpty)
    }
}
