import Foundation
import XCTest
@testable import PortholeStageCore

enum BoundaryFixtures {
    static let program = SignedProgramIdentity(
        bundleIdentifier: "dev.portdaddy.porthole.safe-fixture",
        designatedRequirement: "identifier fixture", executableSHA256: String(repeating: "a", count: 64))

    static func approval(scope: SourceApprovalScopeKind = .exactWindow, bits: Int = 7) -> SourceApproval {
        let instance = RunningApplicationIdentity(program: program, processID: 41, launchIdentity: "launch-a")
        return SourceApproval(
            approvalID: "approval-a", scope: scope, sourceKind: scope == .exactWindow ? .window : .application,
            displayTitle: "Fixture", capabilities: SourceCapabilities(
                preview: bits & 1 != 0, liveShare: bits & 2 != 0, persistRecording: bits & 4 != 0),
            program: program, runningInstance: scope == .signedProgram ? nil : instance,
            exactWindow: scope == .exactWindow ? ExactWindowIdentity(application: instance, windowID: 77) : nil,
            createdAtMonotonicNanos: 10)
    }

    static func mutated(_ approval: SourceApproval, path: [String], value: Any) throws -> SourceApproval {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(approval)) as? [String: Any])
        func replace(_ object: inout [String: Any], _ path: ArraySlice<String>) {
            let key = path.first!
            if path.count == 1 { object[key] = value }
            else {
                var child = object[key] as! [String: Any]
                replace(&child, path.dropFirst())
                object[key] = child
            }
        }
        replace(&json, path[...])
        return try JSONDecoder().decode(SourceApproval.self, from: JSONSerialization.data(withJSONObject: json))
    }

    static func observation(pid: Int32 = 41, launch: String = "launch-a", windows: Set<UInt32> = [77]) -> SourceRuntimeObservation {
        SourceRuntimeObservation(program: program, processID: pid, launchIdentity: launch, openWindowIDs: windows)
    }

    static func cursor(name: String = "Agent 🧭", sequence: UInt64 = 1, lease: String = "lease-a") -> CursorEvent {
        CursorEvent(captureLeaseID: lease, participantID: "agent-a", kind: .agent, displayName: name,
                    colorHex: "#65D8FF", normalizedX: 0.5, normalizedY: 0.5,
                    sequence: sequence, monotonicNanos: sequence * 100)
    }

    static func frame() -> FrameMetadata {
        FrameMetadata(sequence: 1, monotonicNanos: 100, captureLeaseID: "lease-a", sourceApprovalID: "approval-a",
            sourceDisplayTitle: "Fixture", sourceKind: .window, sourceWindowID: 77,
            sourceWidthPoints: 640, sourceHeightPoints: 400, pixelWidth: 1280, pixelHeight: 800, contentScale: 2,
            runtime: RuntimeMetadata(processID: 41, operatingSystem: "test", appVersion: "test",
                audioCaptureEnabled: false, microphoneCaptureEnabled: false,
                physicalCursorIncludedInSourcePixels: true, mouseClickIndicatorsEnabled: false, frameRingCapacity: 3))
    }
}

final class PolicyBoundaryTests: XCTestCase {
    func testStartStopRevocationAndStaleCompletionInterleavings() throws {
        var gate = CaptureOperationGate()
        let first = try XCTUnwrap(gate.beginStart())
        XCTAssertNil(gate.beginStart(), "double start is rejected")
        XCTAssertTrue(gate.permitsCompletion(first))
        gate.beginStop()
        XCTAssertFalse(gate.permitsCompletion(first))
        XCTAssertNil(gate.beginStart(), "no new stream while a stop awaits")
        gate.beginStop()
        gate.finishStop()
        XCTAssertNil(gate.beginStart(), "nested stop still in flight")
        gate.finishStop()
        let second = try XCTUnwrap(gate.beginStart())
        XCTAssertNotEqual(first, second)
        gate.finishStart(first)
        XCTAssertTrue(gate.permitsCompletion(second), "old completion cannot clear the new start")
        XCTAssertFalse(gate.permitsCompletion(first))
        gate.beginStop(cancelPendingStart: false)
        XCTAssertFalse(gate.permitsCompletion(second))
        gate.finishStop()
        XCTAssertTrue(gate.permitsCompletion(second), "owned stream replacement preserves ticket")
        gate.finishStart(second)
        XCTAssertFalse(gate.permitsCompletion(second))
        XCTAssertNotNil(gate.beginStart())
    }

    func testAll49LifecycleEdgesIncludingStatePreservationAfterEveryDenial() throws {
        let states: [CaptureLifecycle] = [.idle, .ready, .live, .paused, .stopped, .permissionDenied, .failed]
        // Independent specification, not derived from implementation output.
        let edges: Set<String> = [
            "idle>ready", "idle>permission-denied", "idle>failed",
            "ready>live", "ready>stopped", "ready>permission-denied", "ready>failed",
            "live>paused", "live>stopped", "live>failed", "paused>live", "paused>stopped", "paused>failed",
            "stopped>ready", "stopped>live", "stopped>failed", "permission-denied>ready", "permission-denied>failed", "failed>ready",
        ]
        for from in states { for to in states {
            var machine = CaptureStateMachine(state: from)
            let edge = "\(from.rawValue)>\(to.rawValue)"
            if edges.contains(edge) {
                try machine.transition(to: to)
                XCTAssertEqual(machine.state, to, edge)
            } else {
                XCTAssertThrowsError(try machine.transition(to: to), edge) {
                    XCTAssertEqual($0 as? CaptureTransitionError, .invalidTransition(from: from, to: to), edge)
                }
                XCTAssertEqual(machine.state, from, "denied edge mutated state: \(edge)")
            }
        } }
    }

    func testFailureRecoveryAndStopRestartSequences() throws {
        var machine = CaptureStateMachine()
        for state: CaptureLifecycle in [.permissionDenied, .ready, .live, .paused, .live, .failed, .ready, .live, .stopped, .live] {
            try machine.transition(to: state)
            XCTAssertEqual(machine.state, state)
        }
    }

    func testAllScopeAndCapabilityCombinationsRemainOrthogonal() throws {
        for scope: SourceApprovalScopeKind in [.signedProgram, .runningInstance, .exactWindow] {
            for bits in 0..<8 {
                let approval = BoundaryFixtures.approval(scope: scope, bits: bits)
                if bits == 0 {
                    XCTAssertThrowsError(try SourceApprovalPolicy.validate(approval)) {
                        XCTAssertEqual($0 as? SourceApprovalError, .noCapabilities)
                    }
                } else { XCTAssertNoThrow(try SourceApprovalPolicy.validate(approval)) }
                for (action, bit): (SourceCapabilityAction, Int) in [(.preview, 1), (.liveShare, 2), (.persistRecording, 4)] {
                    XCTAssertEqual(SourceApprovalPolicy.permits(action, approval: approval), bits & bit != 0)
                }
            }
        }
    }

    func testHostileDecodedApprovalsCannotGrantAnyCapabilityOrEnterLedger() throws {
        let base = BoundaryFixtures.approval()
        let cases: [([String], Any, SourceApprovalError)] = [
            (["approvalID"], " \n", .emptyApprovalID), (["displayTitle"], "\t", .emptyDisplayTitle),
            (["program", "bundleIdentifier"], " ", .invalidProgramIdentity),
            (["program", "designatedRequirement"], "\n", .invalidProgramIdentity),
            (["program", "executableSHA256"], String(repeating: "a", count: 63), .invalidProgramIdentity),
            (["program", "executableSHA256"], String(repeating: "g", count: 64), .invalidProgramIdentity),
            (["program", "executableSHA256"], String(repeating: "Ａ", count: 64), .invalidProgramIdentity),
            (["runningInstance"], NSNull(), .invalidScopeBinding), (["exactWindow"], NSNull(), .invalidScopeBinding),
            (["runningInstance", "processID"], 0, .invalidScopeBinding),
            (["runningInstance", "processID"], -1, .invalidScopeBinding),
            (["runningInstance", "launchIdentity"], " \n", .invalidScopeBinding),
            (["runningInstance", "program", "bundleIdentifier"], "other", .invalidScopeBinding),
            (["exactWindow", "application", "launchIdentity"], "other-launch", .invalidScopeBinding),
            (["exactWindow", "windowID"], 0, .invalidScopeBinding),
            (["persistsUntilRevoked"], true, .invalidScopeBinding),
            (["sourceKind"], "application", .invalidScopeBinding),
        ]
        for (path, value, error) in cases {
            let hostile = try BoundaryFixtures.mutated(base, path: path, value: value)
            XCTAssertThrowsError(try SourceApprovalPolicy.validate(hostile), path.joined(separator: ".")) {
                XCTAssertEqual($0 as? SourceApprovalError, error)
            }
            for action: SourceCapabilityAction in [.preview, .liveShare, .persistRecording] {
                XCTAssertFalse(SourceApprovalPolicy.permits(action, approval: hostile))
            }
            XCTAssertFalse(SourceApprovalValidity.remainsValid(hostile, observation: BoundaryFixtures.observation()))
            var ledger = SourceApprovalLedger()
            try ledger.approve(base)
            XCTAssertThrowsError(try ledger.approve(hostile))
            XCTAssertEqual(ledger.approvedSources, [base], "invalid replacement must not revoke valid authority")
        }
    }

    func testScopeBindingRejectsPersistedEphemeralAndWindowLeakage() throws {
        for scope: SourceApprovalScopeKind in [.signedProgram, .runningInstance] {
            let base = BoundaryFixtures.approval(scope: scope)
            let flipped = try BoundaryFixtures.mutated(base, path: ["persistsUntilRevoked"], value: scope != .signedProgram)
            XCTAssertThrowsError(try SourceApprovalPolicy.validate(flipped))
        }
        for path in [["runningInstance", "processID"], ["runningInstance", "launchIdentity"]] {
            let hostile = try BoundaryFixtures.mutated(BoundaryFixtures.approval(scope: .runningInstance),
                path: path, value: path.last == "processID" ? 0 : " ")
            XCTAssertThrowsError(try SourceApprovalPolicy.validate(hostile))
        }
        let exact = BoundaryFixtures.approval()
        for scope in ["signed-program", "running-instance"] {
            let hostile = try BoundaryFixtures.mutated(exact, path: ["scope"], value: scope)
            XCTAssertThrowsError(try SourceApprovalPolicy.validate(hostile))
        }
    }

    func testPersistenceFull384CaseAuthorityPrivacyMatrixWithExplicitDenials() throws {
        for invalid in [false, true] { for current in [false, true] { for bits in 0..<8 {
            let base = BoundaryFixtures.approval(bits: bits)
            let approval = invalid ? try BoundaryFixtures.mutated(base, path: ["approvalID"], value: "") : base
            for privacy: PrivacyStatus in [.clear, .protected, .unknown] {
                for operatorApproved in [false, true] { for fixture in [false, true] {
                    let expected: PersistenceDenialReason? = invalid || bits == 0 ? .invalidApproval
                        : !current ? .staleSource : bits & 4 == 0 ? .capabilityDenied
                        : privacy == .protected ? .protectedContent : privacy == .unknown ? .uncertainPrivacy
                        : !operatorApproved ? .operatorApprovalRequired : !fixture ? .syntheticFixtureRequired : nil
                    let result = SourcePersistencePolicy.evaluate(approval: approval, sourceIsCurrent: current,
                        assessment: PrivacyAssessment(status: privacy, reason: "test", assessedAtMonotonicNanos: 1),
                        explicitOperatorApproval: operatorApproved, isSyntheticSafeFixture: fixture)
                    XCTAssertEqual(result.denialReason, expected)
                    XCTAssertEqual(result.gate.allowed, expected == nil)
                    XCTAssertFalse(result.gate.reason.isEmpty)
                } }
            }
        } } }
    }

    func testSourceValidityAndCursorLeaseNeverSubstituteForEachOther() {
        for pid: Int32 in [0, 41, 42] { for launch in ["launch-a", "launch-b", " "] {
            for windows: Set<UInt32> in [[], [77], [78]] {
                let valid = pid == 41 && launch == "launch-a" && windows.contains(77)
                for lease: String? in [nil, "", " \n", "lease-a", "other"] {
                    XCTAssertEqual(SourceApprovalValidity.remainsValid(BoundaryFixtures.approval(),
                        observation: BoundaryFixtures.observation(pid: pid, launch: launch, windows: windows)), valid)
                    XCTAssertEqual(CursorLeasePolicy.permits(BoundaryFixtures.cursor(), activeLeaseID: lease), lease == "lease-a")
                }
            }
        } }
        XCTAssertFalse(SourceApprovalValidity.remainsValid(BoundaryFixtures.approval(), observation: nil))
    }

    func testPickerRejectsNonfiniteGeometryAndInvalidProcess() {
        let policy = PickerSelectedSourcePolicy(currentProcessID: 42)
        for dimension in [Double.nan, .infinity, -.infinity, 0, 119] {
            for pid: Int32 in [0, -1, 42, 91] {
                let source = ShareableWindowDescriptor(windowID: 1, ownerPID: pid, ownerName: "Fixture",
                    bundleIdentifier: nil, title: "test", width: dimension, height: dimension, layer: 0, isOnScreen: true)
                XCTAssertFalse(policy.accepts(source))
            }
        }
    }
}
