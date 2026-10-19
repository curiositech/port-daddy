import Foundation
import Darwin

/// Stop-only OS actions. Never invokes pd, brew, a login shell, a start verb or
/// a PID from an unverified file. The separate com.bosun.daemon is NOT ours.
enum LocalRuntimeShutdown {
    enum Action: String, Sendable { case disable, bootout }
    struct Step: Equatable, Sendable {
        let action: Action
        let target: String
        var arguments: [String] { [action.rawValue, target] }
    }
    struct Receipt: Sendable {
        let step: Step
        let status: Int32?
        var summary: String {
            let verb = step.action == .disable ? "Disable automatic restart" : "Stop supervised job"
            return "\(verb) · \(step.target): \(status == 0 ? "accepted" : "not confirmed")"
        }
    }

    static func plan(uid: uid_t) -> [Step] {
        let prefix = "gui/\(uid)/"
        let labels = ["com.portdaddy.appwatch", "com.portdaddy.freshness", "com.portdaddy.bosun", "homebrew.mxcl.port-daddy", "sh.brew.port-daddy", "com.portdaddy.daemon"]
        // Disable every known resurrector before stopping any process. Preserve
        // the current FleetBar window so the operator can read failure receipts.
        return (labels + ["com.portdaddy.fleetbar", "com.portdaddy.fleetbar.devlatest"]).map { Step(action: .disable, target: prefix + $0) }
            + labels.map { Step(action: .bootout, target: prefix + $0) }
    }

    static func stop(
        uid: uid_t = getuid(),
        run: (Step) -> Int32? = runLaunchctl
    ) -> [Receipt] {
        plan(uid: uid).map { Receipt(step: $0, status: run($0)) }
    }

    private static func runLaunchctl(_ step: Step) -> Int32? {
        let process = Process()
        let finished = DispatchSemaphore(value: 0)
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = step.arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { _ in finished.signal() }
        do { try process.run() } catch { return nil }
        guard finished.wait(timeout: .now() + 3) == .success else {
            process.terminate()
            if finished.wait(timeout: .now() + 1) != .success {
                // This is our own timed-out launchctl child, never a discovered
                // daemon PID or process-name match. No unbounded wait follows.
                kill(process.processIdentifier, SIGKILL)
            }
            return nil
        }
        return process.terminationStatus
    }
}
