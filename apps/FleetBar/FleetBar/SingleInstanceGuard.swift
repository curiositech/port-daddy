import Foundation
import AppKit

// MARK: - Single-Instance Guard

/// A peer FleetBar process discovered at launch.
struct RunningInstance: Equatable {
    let pid: pid_t
    let launchDate: Date?
}

/// What a launching instance should do once it sees its peers.
enum SingleInstanceDecision: Equatable {
    /// No other instance of this build is running.
    case soleInstance
    /// This instance is the newest; terminate these older peer pids.
    case reapOlder([pid_t])
    /// A *newer* peer already exists; this instance should quit.
    case yield
}

/// Enforces one running FleetBar **per build** (per bundle identifier).
///
/// macOS deduplicates double-clicks of one bundle through LaunchServices, but
/// exec'ing the Mach-O directly — which is how packaged dev builds get launched
/// from a script — bypasses that, so copies stack up (the "four dev FleetBars"
/// case). This guard closes that gap with **newest-wins** semantics, matching the
/// operator's "close the older one for the new one": a fresh launch reaps the
/// older peers, and if it discovers an even newer peer it yields instead, so two
/// near-simultaneous launches can never mutually terminate.
///
/// Production (`ai.portdaddy.FleetBar`) and a dev build carry *different* bundle
/// ids, so they are never peers — a dev FleetBar runs happily beside the installed
/// one. Only exact-same-build duplicates are reaped.
enum SingleInstanceGuard {
    /// Pure decision: given this process and the full peer set (which may include
    /// this process), decide what to do. Factored out so the newest-wins logic is
    /// unit-testable without `NSWorkspace`.
    ///
    /// Yield only when a peer is *provably* newer — both its and our launch dates
    /// are known and the peer's is later. An unknown self-launch time (which AppKit
    /// can report during `applicationDidFinishLaunching`) defaults to "newest", so
    /// the instance reaps rather than yields. Refusing to launch is a worse failure
    /// than the rare double-launch the yield path guards against, and a stale or
    /// still-terminating LaunchServices registration must never euthanise a fresh
    /// instance.
    static func decide(me: RunningInstance, peers: [RunningInstance]) -> SingleInstanceDecision {
        let others = peers.filter { $0.pid != me.pid }
        guard !others.isEmpty else { return .soleInstance }

        let myStart = me.launchDate ?? .distantFuture
        let aPeerIsProvablyNewer = others.contains { peer in
            guard let peerStart = peer.launchDate else { return false }
            return peerStart > myStart
        }
        if aPeerIsProvablyNewer { return .yield }
        return .reapOlder(others.map(\.pid))
    }

    /// Apply the guard against the live workspace. Reaps older peers and returns
    /// the decision; the caller terminates *self* on `.yield`.
    @MainActor
    @discardableResult
    static func enforce(
        workspace: NSWorkspace = .shared,
        current: NSRunningApplication = .current
    ) -> SingleInstanceDecision {
        guard let myID = current.bundleIdentifier, !myID.isEmpty else {
            // No bundle identity (rare; some raw test hosts) — cannot match peers.
            return .soleInstance
        }

        let me = RunningInstance(pid: current.processIdentifier, launchDate: current.launchDate)
        let peers = workspace.runningApplications
            .filter { $0.bundleIdentifier == myID && !$0.isTerminated }
            .map { RunningInstance(pid: $0.processIdentifier, launchDate: $0.launchDate) }

        let decision = decide(me: me, peers: peers)
        if case .reapOlder(let pids) = decision {
            let toReap = Set(pids)
            for app in workspace.runningApplications
            where app.bundleIdentifier == myID
                && app.processIdentifier != me.pid
                && toReap.contains(app.processIdentifier) {
                app.terminate()
            }
        }
        return decision
    }
}
