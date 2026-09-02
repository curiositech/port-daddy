import Foundation

public struct PickerSelectedSourcePolicy: Equatable, Sendable {
    public static let productExcludedBundlePrefixes = [
        "dev.portdaddy.porthole-stage",
        "dev.portdaddy.console",
        "com.curiositech.portdaddy.console",
    ]

    public let currentProcessID: Int32
    public let excludedBundlePrefixes: [String]
    public let minimumWidth: Double
    public let minimumHeight: Double

    public init(
        currentProcessID: Int32,
        excludedBundlePrefixes: [String] = PickerSelectedSourcePolicy.productExcludedBundlePrefixes,
        minimumWidth: Double = 160,
        minimumHeight: Double = 120
    ) {
        self.currentProcessID = currentProcessID
        self.excludedBundlePrefixes = excludedBundlePrefixes
        self.minimumWidth = minimumWidth
        self.minimumHeight = minimumHeight
    }

    /// Validates the one source returned by Apple's picker. This type has no
    /// list input or catalog projection by design.
    public func accepts(_ pickerSelectedSource: ShareableWindowDescriptor) -> Bool {
        guard pickerSelectedSource.ownerPID != currentProcessID else { return false }
        guard pickerSelectedSource.isOnScreen, pickerSelectedSource.layer == 0 else { return false }
        guard pickerSelectedSource.width >= minimumWidth,
              pickerSelectedSource.height >= minimumHeight
        else { return false }
        if let bundle = pickerSelectedSource.bundleIdentifier {
            guard !excludedBundlePrefixes.contains(where: { bundle.hasPrefix($0) }) else { return false }
        }
        return true
    }
}

public struct ExactWindowStreamPolicy: Equatable, Sendable {
    public static let standard = ExactWindowStreamPolicy(
        includesPhysicalCursorPixels: true,
        includesMouseClickIndicators: false
    )

    public let includesPhysicalCursorPixels: Bool
    public let includesMouseClickIndicators: Bool

    public init(includesPhysicalCursorPixels: Bool, includesMouseClickIndicators: Bool) {
        self.includesPhysicalCursorPixels = includesPhysicalCursorPixels
        self.includesMouseClickIndicators = includesMouseClickIndicators
    }
}

public enum CursorLeasePolicy {
    public static func permits(_ event: CursorEvent, activeLeaseID: String?) -> Bool {
        guard let activeLeaseID, !activeLeaseID.isEmpty else { return false }
        return event.captureLeaseID == activeLeaseID
    }
}

public enum CapturePausePolicy {
    /// Persisted proof is one immutable media segment in this slice. A future
    /// segmented writer may permit pause only after its segment chain and
    /// receipt ordering are independently specified and tested.
    public static func permitsPause(proofPersistenceEnabled: Bool) -> Bool {
        !proofPersistenceEnabled
    }
}

public struct BackgroundCaptureAccumulator: Equatable, Sendable {
    private var firstSnapshot: CaptureActivitySnapshot?
    private var acceptedCompleteFrameCount = 0
    private var backgroundCompleteFrameCount = 0
    private var firstBackgroundFrameSequence: UInt64?
    private var lastBackgroundFrameSequence: UInt64?
    private var firstBackgroundFrameMonotonicNanos: UInt64?
    private var lastBackgroundFrameMonotonicNanos: UInt64?

    public init() {}

    public mutating func observe(frame: FrameMetadata, activity: CaptureActivitySnapshot) {
        firstSnapshot = firstSnapshot ?? activity
        acceptedCompleteFrameCount += 1

        let isBackgroundContinuityFrame = !activity.captureApplicationActive
            && !activity.sourceApplicationActive
            && activity.differentForegroundApplicationPresent
        guard isBackgroundContinuityFrame else { return }

        backgroundCompleteFrameCount += 1
        firstBackgroundFrameSequence = firstBackgroundFrameSequence ?? frame.sequence
        lastBackgroundFrameSequence = frame.sequence
        firstBackgroundFrameMonotonicNanos = firstBackgroundFrameMonotonicNanos ?? frame.monotonicNanos
        lastBackgroundFrameMonotonicNanos = frame.monotonicNanos
    }

    public func evidence(
        sourceWindowOnScreenAtFirstFrame: Bool,
        displayOrScreenFallbackUsed: Bool
    ) -> BackgroundCaptureEvidence? {
        guard let firstSnapshot else { return nil }
        return BackgroundCaptureEvidence(
            captureApplicationActiveAtFirstFrame: firstSnapshot.captureApplicationActive,
            sourceApplicationActiveAtFirstFrame: firstSnapshot.sourceApplicationActive,
            differentForegroundApplicationPresentAtFirstFrame: firstSnapshot.differentForegroundApplicationPresent,
            sourceWindowOnScreenAtFirstFrame: sourceWindowOnScreenAtFirstFrame,
            acceptedCompleteFrameCount: acceptedCompleteFrameCount,
            backgroundCompleteFrameCount: backgroundCompleteFrameCount,
            firstBackgroundFrameSequence: firstBackgroundFrameSequence,
            lastBackgroundFrameSequence: lastBackgroundFrameSequence,
            firstBackgroundFrameMonotonicNanos: firstBackgroundFrameMonotonicNanos,
            lastBackgroundFrameMonotonicNanos: lastBackgroundFrameMonotonicNanos,
            displayOrScreenFallbackUsed: displayOrScreenFallbackUsed
        )
    }
}

public enum FrameRingError: Error, Equatable {
    case invalidCapacity
    case nonMonotonicSequence(previous: UInt64, incoming: UInt64)
    case nonMonotonicClock(previous: UInt64, incoming: UInt64)
}

public struct MonotonicFrameRing<Element> {
    public struct Entry {
        public let sequence: UInt64
        public let monotonicNanos: UInt64
        public let value: Element
    }

    public let capacity: Int
    public private(set) var entries: [Entry] = []

    public init(capacity: Int) throws {
        guard capacity > 0 else { throw FrameRingError.invalidCapacity }
        self.capacity = capacity
    }

    @discardableResult
    public mutating func append(sequence: UInt64, monotonicNanos: UInt64, value: Element) throws -> Entry? {
        if let previous = entries.last {
            guard sequence > previous.sequence else {
                throw FrameRingError.nonMonotonicSequence(previous: previous.sequence, incoming: sequence)
            }
            guard monotonicNanos > previous.monotonicNanos else {
                throw FrameRingError.nonMonotonicClock(previous: previous.monotonicNanos, incoming: monotonicNanos)
            }
        }
        entries.append(Entry(sequence: sequence, monotonicNanos: monotonicNanos, value: value))
        return entries.count > capacity ? entries.removeFirst() : nil
    }

    public mutating func removeAll(keepingCapacity: Bool = true) {
        entries.removeAll(keepingCapacity: keepingCapacity)
    }
}

public enum CursorIngestError: Error, Equatable {
    case unsupportedSchema
    case invalidLease
    case invalidParticipant
    case invalidDisplayName
    case invalidColor
    case coordinateOutOfRange
    case staleSequence
    case nonMonotonicClock
}

public struct CursorStore: Sendable {
    private var latestByParticipant: [String: CursorEvent] = [:]

    public init() {}

    public var visible: [CursorEvent] {
        latestByParticipant.values
            .filter(\.visible)
            .sorted {
                if $0.kind != $1.kind { return $0.kind == .human }
                return $0.participantID < $1.participantID
            }
    }

    public mutating func ingest(_ event: CursorEvent) throws {
        guard event.schema == CursorEvent.schemaName else { throw CursorIngestError.unsupportedSchema }
        guard !event.captureLeaseID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CursorIngestError.invalidLease
        }
        guard !event.participantID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CursorIngestError.invalidParticipant
        }
        guard !event.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CursorIngestError.invalidDisplayName
        }
        guard Self.isHexColor(event.colorHex) else { throw CursorIngestError.invalidColor }
        guard (0 ... 1).contains(event.normalizedX), (0 ... 1).contains(event.normalizedY) else {
            throw CursorIngestError.coordinateOutOfRange
        }
        if let prior = latestByParticipant[event.participantID] {
            guard event.sequence > prior.sequence else { throw CursorIngestError.staleSequence }
            guard event.monotonicNanos > prior.monotonicNanos else { throw CursorIngestError.nonMonotonicClock }
        }
        latestByParticipant[event.participantID] = event
    }

    public mutating func removeAll() {
        latestByParticipant.removeAll(keepingCapacity: false)
    }

    private static func isHexColor(_ value: String) -> Bool {
        guard value.count == 7, value.first == "#" else { return false }
        return value.dropFirst().allSatisfy { $0.isHexDigit }
    }
}

public enum SourceApprovalError: Error, Equatable {
    case emptyApprovalID
    case emptyDisplayTitle
    case invalidProgramIdentity
    case noCapabilities
    case invalidScopeBinding
}

public enum SourceCapabilityAction: String, Equatable, Sendable {
    case preview
    case liveShare = "live-share"
    case persistRecording = "persist-recording"
}

public enum SourceApprovalPolicy {
    public static func validate(_ approval: SourceApproval) throws {
        guard !approval.approvalID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SourceApprovalError.emptyApprovalID
        }
        guard !approval.displayTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SourceApprovalError.emptyDisplayTitle
        }
        let program = approval.program
        guard !program.bundleIdentifier.isEmpty,
              !program.designatedRequirement.isEmpty,
              program.executableSHA256.count == 64,
              program.executableSHA256.allSatisfy(\.isHexDigit)
        else { throw SourceApprovalError.invalidProgramIdentity }
        guard approval.capabilities.preview
                || approval.capabilities.liveShare
                || approval.capabilities.persistRecording
        else { throw SourceApprovalError.noCapabilities }

        switch approval.scope {
        case .signedProgram:
            guard approval.runningInstance == nil,
                  approval.exactWindow == nil,
                  approval.persistsUntilRevoked
            else { throw SourceApprovalError.invalidScopeBinding }
        case .runningInstance:
            guard let instance = approval.runningInstance,
                  instance.program == program,
                  !instance.launchIdentity.isEmpty,
                  approval.exactWindow == nil,
                  !approval.persistsUntilRevoked
            else { throw SourceApprovalError.invalidScopeBinding }
        case .exactWindow:
            guard approval.sourceKind == .window,
                  let instance = approval.runningInstance,
                  let window = approval.exactWindow,
                  instance.program == program,
                  window.application == instance,
                  window.windowID > 0,
                  !approval.persistsUntilRevoked
            else { throw SourceApprovalError.invalidScopeBinding }
        }
    }

    public static func permits(_ action: SourceCapabilityAction, approval: SourceApproval) -> Bool {
        switch action {
        case .preview: return approval.capabilities.preview
        case .liveShare: return approval.capabilities.liveShare
        case .persistRecording: return approval.capabilities.persistRecording
        }
    }
}

public enum ProgramIdentityPolicy {
    /// Durable authority is the bundle ID plus designated requirement. The
    /// executable digest is retained as observed-build evidence and becomes an
    /// authority constraint only when the code has no anchored signer.
    public static func sameApprovedAuthority(
        approved: SignedProgramIdentity,
        observed: SignedProgramIdentity
    ) -> Bool {
        guard approved.bundleIdentifier == observed.bundleIdentifier,
              approved.designatedRequirement == observed.designatedRequirement
        else { return false }
        return !approved.requiresExactExecutableDigest
            || approved.executableSHA256 == observed.executableSHA256
    }
}

public enum SourceApprovalHydrationPolicy {
    /// Proof mode is isolated from the durable signed-program ledger so its
    /// fixture-only approval cannot accidentally inherit unrelated authority.
    public static func shouldLoadDurableApprovals(proofOnlyExactFixtureMode: Bool) -> Bool {
        !proofOnlyExactFixtureMode
    }
}

public enum EvidenceAccessPolicy {
    /// Source approval is deliberately absent from this API. Capture authority
    /// cannot satisfy an evidence request, even for the same macOS user.
    public static func permits(
        scope: EvidenceAccessScope,
        request: EvidenceAccessRequest
    ) -> Bool {
        guard scope.tenancy == .projectScoped,
              scope.accountID == request.accountID,
              scope.teamID == request.teamID,
              scope.harborID == request.harborID,
              scope.repositoryID == request.repositoryID,
              scope.sessionID == request.sessionID,
              scope.actorID == request.actorID,
              scope.perspectiveID == request.perspectiveID
        else { return false }
        switch request.capability {
        case .read: return scope.allowRead
        case .share: return scope.allowShare
        case .semanticIndex: return scope.allowSemanticIndex
        }
    }
}

/// Runtime evidence used to catch process exit, PID reuse, code identity drift,
/// and exact-window closure before another frame is accepted or persisted.
public struct SourceRuntimeObservation: Equatable, Sendable {
    public let program: SignedProgramIdentity
    public let processID: Int32
    public let launchIdentity: String
    public let openWindowIDs: Set<UInt32>

    public init(
        program: SignedProgramIdentity,
        processID: Int32,
        launchIdentity: String,
        openWindowIDs: Set<UInt32>
    ) {
        self.program = program
        self.processID = processID
        self.launchIdentity = launchIdentity
        self.openWindowIDs = openWindowIDs
    }
}

public enum SourceApprovalValidity {
    public static func remainsValid(
        _ approval: SourceApproval,
        observation: SourceRuntimeObservation?
    ) -> Bool {
        guard let observation,
              ProgramIdentityPolicy.sameApprovedAuthority(
                  approved: approval.program,
                  observed: observation.program
              )
        else { return false }
        switch approval.scope {
        case .signedProgram:
            return true
        case .runningInstance:
            guard let instance = approval.runningInstance else { return false }
            return observation.processID == instance.processID
                && observation.launchIdentity == instance.launchIdentity
        case .exactWindow:
            guard let instance = approval.runningInstance,
                  let window = approval.exactWindow
            else { return false }
            return observation.processID == instance.processID
                && observation.launchIdentity == instance.launchIdentity
                && observation.openWindowIDs.contains(window.windowID)
        }
    }
}

/// Approval-only projection. There is intentionally no API that accepts or
/// returns an unapproved shareable-window catalog.
public struct SourceApprovalLedger: Sendable {
    public private(set) var approvedSources: [SourceApproval] = []

    public init() {}

    public mutating func approve(_ approval: SourceApproval) throws {
        try SourceApprovalPolicy.validate(approval)
        approvedSources.removeAll { $0.approvalID == approval.approvalID }
        approvedSources.append(approval)
        approvedSources.sort { $0.createdAtMonotonicNanos < $1.createdAtMonotonicNanos }
    }

    @discardableResult
    public mutating func revoke(approvalID: String) -> SourceApproval? {
        guard let index = approvedSources.firstIndex(where: { $0.approvalID == approvalID }) else {
            return nil
        }
        return approvedSources.remove(at: index)
    }

    public var durableSignedProgramApprovals: [SourceApproval] {
        approvedSources.filter { $0.scope == .signedProgram && $0.persistsUntilRevoked }
    }
}

public enum PrivacyPersistencePolicy {
    /// Persistence is intentionally narrower than live preview in this slice.
    /// Only an explicitly approved synthetic fixture can write proof media.
    public static func evaluate(
        assessment: PrivacyAssessment,
        explicitOperatorApproval: Bool,
        isSyntheticSafeFixture: Bool
    ) -> PersistenceGate {
        guard assessment.status == .clear else {
            return PersistenceGate(
                allowed: false,
                label: "Persistence paused",
                reason: assessment.status == .protected
                    ? "A protected field is focused in the selected app."
                    : "Protected-field status is uncertain; Accessibility evidence is required."
            )
        }
        guard explicitOperatorApproval else {
            return PersistenceGate(
                allowed: false,
                label: "Live only · not saved",
                reason: "Saving requires an explicit privacy approval."
            )
        }
        guard isSyntheticSafeFixture else {
            return PersistenceGate(
                allowed: false,
                label: "Persistence paused",
                reason: "This first slice only persists its synthetic proof fixture."
            )
        }
        return PersistenceGate(
            allowed: true,
            label: "Approved proof recording",
            reason: "Explicit approval covers this synthetic fixture only."
        )
    }
}

public enum CaptureTransitionError: Error, Equatable {
    case invalidTransition(from: CaptureLifecycle, to: CaptureLifecycle)
}

public struct CaptureStateMachine: Sendable {
    public private(set) var state: CaptureLifecycle

    public init(state: CaptureLifecycle = .idle) {
        self.state = state
    }

    public mutating func transition(to next: CaptureLifecycle) throws {
        let allowed: Set<CaptureLifecycle>
        switch state {
        case .idle:
            allowed = [.ready, .permissionDenied, .failed]
        case .ready:
            allowed = [.live, .stopped, .permissionDenied, .failed]
        case .live:
            allowed = [.paused, .stopped, .failed]
        case .paused:
            allowed = [.live, .stopped, .failed]
        case .stopped:
            allowed = [.ready, .live, .failed]
        case .permissionDenied:
            allowed = [.ready, .failed]
        case .failed:
            allowed = [.ready]
        }
        guard allowed.contains(next) else {
            throw CaptureTransitionError.invalidTransition(from: state, to: next)
        }
        state = next
    }
}
