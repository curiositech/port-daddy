import Foundation
import Combine

enum ViewState: Equatable {
    case loading
    case loaded
    case error(String)

    static func == (lhs: ViewState, rhs: ViewState) -> Bool {
        switch (lhs, rhs) {
        case (.loading, .loading): return true
        case (.loaded, .loaded): return true
        case (.error(let a), .error(let b)): return a == b
        default: return false
        }
    }
}

@MainActor
final class FleetLiveViewModel: ObservableObject {
    @Published var state: ViewState = .loading
    @Published private(set) var reloadToken = UUID()

    private let daemonURL = URL(string: "http://localhost:9876/fleet-live.html")!
    private let healthURL = URL(string: "http://localhost:9876/ping")!

    init() {
        checkDaemon()
    }

    func reload() {
        state = .loading
        reloadToken = UUID()
        checkDaemon()
    }

    func handleNavigationError(_ error: Error) {
        state = .error("Could not connect to Port Daddy daemon.\nIs it running on localhost:9876?\n\nRun: pd start")
    }

    func handleNavigationSuccess() {
        state = .loaded
    }

    private func checkDaemon() {
        Task {
            do {
                let (_, response) = try await URLSession.shared.data(from: healthURL)
                if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                    state = .loaded
                } else {
                    state = .error("Daemon returned unexpected status.\nRun: pd start")
                }
            } catch {
                state = .error("Could not connect to Port Daddy daemon.\nIs it running on localhost:9876?\n\nRun: pd start")
            }
        }
    }
}
