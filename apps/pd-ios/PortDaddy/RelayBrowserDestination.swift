import Foundation

/// The beta hands off to two existing account pages. No user or server input
/// can choose the origin, route, query, or fragment, and the app sends no token.
enum RelayBrowserDestination: CaseIterable {
    case interruptions
    case harbors

    static let origin = URL(string: "https://relay.portdaddy.dev")!

    var url: URL {
        let path = switch self {
        case .interruptions: RelayRoute.accountInterruptions
        case .harbors: RelayRoute.accountHarbors
        }
        return Self.origin.appending(path: path)
    }
}
