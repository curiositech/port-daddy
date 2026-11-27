import Foundation
import XCTest
@testable import PortDaddyKit

final class RelayBrowserDestinationTests: XCTestCase {
    func testHandoffsUseOnlyTheHostedSessionGatedPages() throws {
        XCTAssertEqual(RelayBrowserDestination.allCases.map(\.url.absoluteString), [
            "https://relay.portdaddy.dev/account/interruptions",
            "https://relay.portdaddy.dev/account/harbors",
        ])
        for destination in RelayBrowserDestination.allCases {
            let components = try XCTUnwrap(URLComponents(url: destination.url, resolvingAgainstBaseURL: false))
            XCTAssertNil(components.query)
            XCTAssertNil(components.fragment, "no fixture or private record IDs go to the browser")
            XCTAssertNil(components.user)
            XCTAssertNil(components.password)
        }
    }
}
