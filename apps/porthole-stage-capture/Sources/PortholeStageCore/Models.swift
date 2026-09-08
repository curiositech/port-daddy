import AppKit
import CoreGraphics
import Foundation

public struct PortholePoint: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct PortholeSize: Codable, Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }
}

/// A privacy-safe geometry sample for diagnosing Apple's content-sharing picker.
///
/// AppKit hit testing is expressed in logical points. Backing scale is applied
/// only when deriving pixels for diagnostics; it must never be applied to a
/// point used for picker hit testing.
public struct PickerHitTestGeometry: Codable, Equatable, Sendable {
    public let windowOriginInScreenPoints: PortholePoint
    public let windowSizeInPoints: PortholeSize
    public let contentLayoutOriginInWindowPoints: PortholePoint
    public let contentLayoutSizeInPoints: PortholeSize
    public let mouseLocationInWindowPoints: PortholePoint
    public let backingScaleFactor: Double

    public init(
        windowOriginInScreenPoints: PortholePoint,
        windowSizeInPoints: PortholeSize,
        contentLayoutOriginInWindowPoints: PortholePoint,
        contentLayoutSizeInPoints: PortholeSize,
        mouseLocationInWindowPoints: PortholePoint,
        backingScaleFactor: Double
    ) {
        self.windowOriginInScreenPoints = windowOriginInScreenPoints
        self.windowSizeInPoints = windowSizeInPoints
        self.contentLayoutOriginInWindowPoints = contentLayoutOriginInWindowPoints
        self.contentLayoutSizeInPoints = contentLayoutSizeInPoints
        self.mouseLocationInWindowPoints = mouseLocationInWindowPoints
        self.backingScaleFactor = backingScaleFactor
    }

    public var mouseLocationInScreenPoints: PortholePoint {
        PortholePoint(
            x: windowOriginInScreenPoints.x + mouseLocationInWindowPoints.x,
            y: windowOriginInScreenPoints.y + mouseLocationInWindowPoints.y
        )
    }

    public var mouseLocationInBackingPixels: PortholePoint {
        PortholePoint(
            x: mouseLocationInScreenPoints.x * backingScaleFactor,
            y: mouseLocationInScreenPoints.y * backingScaleFactor
        )
    }

    public func windowPoint(fromScreenPoint point: PortholePoint) -> PortholePoint {
        PortholePoint(
            x: point.x - windowOriginInScreenPoints.x,
            y: point.y - windowOriginInScreenPoints.y
        )
    }
}

/// The proof fixture intentionally uses a plain AppKit window with no content
/// transform or full-size titlebar content. Both properties are part of the
/// picker hit-test contract and are asserted independently of live TCC proof.
public struct SafeFixtureWindowContract: Equatable, Sendable {
    public static let standard = SafeFixtureWindowContract(
        contentSizeInPoints: PortholeSize(width: 720, height: 460),
        usesFullSizeContentView: false,
        usesIdentityContentTransform: true,
        isResizable: false
    )

    public let contentSizeInPoints: PortholeSize
    public let usesFullSizeContentView: Bool
    public let usesIdentityContentTransform: Bool
    public let isResizable: Bool

    public init(
        contentSizeInPoints: PortholeSize,
        usesFullSizeContentView: Bool,
        usesIdentityContentTransform: Bool,
        isResizable: Bool
    ) {
        self.contentSizeInPoints = contentSizeInPoints
        self.usesFullSizeContentView = usesFullSizeContentView
        self.usesIdentityContentTransform = usesIdentityContentTransform
        self.isResizable = isResizable
    }
}

public enum ParticipantKind: String, Codable, CaseIterable, Sendable {
    case human
    case agent
}

/// Typed, local-only presence input for the first Stage slice.
///
/// Events are newline-delimited JSON on stdin. This is deliberately not a
/// network protocol and must not be described as remote collaboration.
public struct CursorEvent: Codable, Equatable, Sendable, Identifiable {
    public static let schemaName = "pd.porthole.local-cursor.v1"

    public let schema: String
    public let captureLeaseID: String
    public let participantID: String
    public let kind: ParticipantKind
    public let displayName: String
    public let colorHex: String
    public let normalizedX: Double
    public let normalizedY: Double
    public let sequence: UInt64
    public let monotonicNanos: UInt64
    public let visible: Bool

    public var id: String { participantID }

    public init(
        schema: String = CursorEvent.schemaName,
        captureLeaseID: String,
        participantID: String,
        kind: ParticipantKind,
        displayName: String,
        colorHex: String,
        normalizedX: Double,
        normalizedY: Double,
        sequence: UInt64,
        monotonicNanos: UInt64,
        visible: Bool = true
    ) {
        self.schema = schema
        self.captureLeaseID = captureLeaseID
        self.participantID = participantID
        self.kind = kind
        self.displayName = displayName
        self.colorHex = colorHex
        self.normalizedX = normalizedX
        self.normalizedY = normalizedY
        self.sequence = sequence
        self.monotonicNanos = monotonicNanos
        self.visible = visible
    }
}

public struct ShareableWindowDescriptor: Codable, Equatable, Sendable, Identifiable {
    public let windowID: UInt32
    public let ownerPID: Int32
    public let ownerName: String
    public let bundleIdentifier: String?
    public let title: String
    public let width: Double
    public let height: Double
    public let layer: Int
    public let isOnScreen: Bool

    public var id: UInt32 { windowID }

    public init(
        windowID: UInt32,
        ownerPID: Int32,
        ownerName: String,
        bundleIdentifier: String?,
        title: String,
        width: Double,
        height: Double,
        layer: Int,
        isOnScreen: Bool
    ) {
        self.windowID = windowID
        self.ownerPID = ownerPID
        self.ownerName = ownerName
        self.bundleIdentifier = bundleIdentifier
        self.title = title
        self.width = width
        self.height = height
        self.layer = layer
        self.isOnScreen = isOnScreen
    }

    public var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled window" : trimmed
    }
}

public enum ApprovedSourceKind: String, Codable, Equatable, Sendable {
    case application
    case window
}

public enum SourceApprovalScopeKind: String, Codable, CaseIterable, Equatable, Sendable {
    /// A signed program identity. This is the only scope eligible for durable
    /// storage, and must be backed by a designated code requirement.
    case signedProgram = "signed-program"
    /// One launch of a signed program. PID alone is never sufficient.
    case runningInstance = "running-instance"
    /// One window owned by one verified running instance.
    case exactWindow = "exact-window"
}

public enum CaptureAuthorizationDomain: String, Codable, Equatable, Sendable {
    /// Grants only this operator/device permission to acquire pixels. It is not
    /// evidence read, share, indexing, project, team, or agent authority.
    case deviceOperatorCaptureOnly = "device-operator-capture-only"
}

public struct SourceCapabilities: Codable, Equatable, Sendable {
    public let preview: Bool
    public let liveShare: Bool
    public let persistRecording: Bool

    public init(preview: Bool, liveShare: Bool, persistRecording: Bool) {
        self.preview = preview
        self.liveShare = liveShare
        self.persistRecording = persistRecording
    }

    public static let previewOnly = SourceCapabilities(
        preview: true,
        liveShare: false,
        persistRecording: false
    )
}

public struct SignedProgramIdentity: Codable, Equatable, Sendable {
    public let bundleIdentifier: String
    public let designatedRequirement: String
    public let executableSHA256: String

    public init(bundleIdentifier: String, designatedRequirement: String, executableSHA256: String) {
        self.bundleIdentifier = bundleIdentifier
        self.designatedRequirement = designatedRequirement
        self.executableSHA256 = executableSHA256
    }

    /// Ad-hoc identities have no stable signing authority across builds, so a
    /// saved approval must remain exact-build. Anchored designated requirements
    /// are evaluated by Security.framework and may survive a legitimate update.
    public var requiresExactExecutableDigest: Bool {
        !designatedRequirement.localizedCaseInsensitiveContains("anchor apple")
    }
}

public struct RunningApplicationIdentity: Codable, Equatable, Sendable {
    public let program: SignedProgramIdentity
    public let processID: Int32
    public let launchIdentity: String

    public init(program: SignedProgramIdentity, processID: Int32, launchIdentity: String) {
        self.program = program
        self.processID = processID
        self.launchIdentity = launchIdentity
    }
}

public struct ExactWindowIdentity: Codable, Equatable, Sendable {
    public let application: RunningApplicationIdentity
    public let windowID: UInt32

    public init(application: RunningApplicationIdentity, windowID: UInt32) {
        self.application = application
        self.windowID = windowID
    }
}

/// The operator-reviewed policy object. Approving a source never starts a
/// stream. Exact-window and running-instance approvals are intentionally
/// ephemeral; only signed-program approvals may be stored durably.
public struct SourceApproval: Codable, Equatable, Sendable, Identifiable {
    public let approvalID: String
    public let scope: SourceApprovalScopeKind
    public let sourceKind: ApprovedSourceKind
    public let displayTitle: String
    public let capabilities: SourceCapabilities
    public let program: SignedProgramIdentity
    public let runningInstance: RunningApplicationIdentity?
    public let exactWindow: ExactWindowIdentity?
    public let createdAtMonotonicNanos: UInt64
    public let persistsUntilRevoked: Bool
    public let authorizationDomain: CaptureAuthorizationDomain

    public var id: String { approvalID }

    public init(
        approvalID: String,
        scope: SourceApprovalScopeKind,
        sourceKind: ApprovedSourceKind,
        displayTitle: String,
        capabilities: SourceCapabilities,
        program: SignedProgramIdentity,
        runningInstance: RunningApplicationIdentity?,
        exactWindow: ExactWindowIdentity?,
        createdAtMonotonicNanos: UInt64
    ) {
        self.approvalID = approvalID
        self.scope = scope
        self.sourceKind = sourceKind
        self.displayTitle = displayTitle
        self.capabilities = capabilities
        self.program = program
        self.runningInstance = runningInstance
        self.exactWindow = exactWindow
        self.createdAtMonotonicNanos = createdAtMonotonicNanos
        persistsUntilRevoked = scope == .signedProgram
        authorizationDomain = .deviceOperatorCaptureOnly
    }
}

public enum EvidenceTenancy: String, Codable, Equatable, Sendable {
    case standaloneLocal = "standalone-local"
    case projectScoped = "project-scoped"
}

public struct EvidenceAccessScope: Codable, Equatable, Sendable {
    public let tenancy: EvidenceTenancy
    public let accountID: String?
    public let teamID: String?
    public let harborID: String?
    public let repositoryID: String?
    public let sessionID: String?
    public let actorID: String?
    public let perspectiveID: String?
    public let allowRead: Bool
    public let allowShare: Bool
    public let allowSemanticIndex: Bool

    public init(
        tenancy: EvidenceTenancy,
        accountID: String?,
        teamID: String?,
        harborID: String?,
        repositoryID: String?,
        sessionID: String?,
        actorID: String?,
        perspectiveID: String?,
        allowRead: Bool,
        allowShare: Bool,
        allowSemanticIndex: Bool
    ) {
        self.tenancy = tenancy
        self.accountID = accountID
        self.teamID = teamID
        self.harborID = harborID
        self.repositoryID = repositoryID
        self.sessionID = sessionID
        self.actorID = actorID
        self.perspectiveID = perspectiveID
        self.allowRead = allowRead
        self.allowShare = allowShare
        self.allowSemanticIndex = allowSemanticIndex
    }

    public static let standaloneNoAccess = EvidenceAccessScope(
        tenancy: .standaloneLocal,
        accountID: nil,
        teamID: nil,
        harborID: nil,
        repositoryID: nil,
        sessionID: nil,
        actorID: nil,
        perspectiveID: nil,
        allowRead: false,
        allowShare: false,
        allowSemanticIndex: false
    )
}

public enum EvidenceCapability: String, Codable, Equatable, Sendable {
    case read
    case share
    case semanticIndex = "semantic-index"
}

public struct EvidenceAccessRequest: Equatable, Sendable {
    public let accountID: String
    public let teamID: String?
    public let harborID: String
    public let repositoryID: String
    public let sessionID: String
    public let actorID: String
    public let perspectiveID: String
    public let capability: EvidenceCapability

    public init(
        accountID: String,
        teamID: String?,
        harborID: String,
        repositoryID: String,
        sessionID: String,
        actorID: String,
        perspectiveID: String,
        capability: EvidenceCapability
    ) {
        self.accountID = accountID
        self.teamID = teamID
        self.harborID = harborID
        self.repositoryID = repositoryID
        self.sessionID = sessionID
        self.actorID = actorID
        self.perspectiveID = perspectiveID
        self.capability = capability
    }
}

public struct ApprovalReview: Equatable, Sendable, Identifiable {
    public let reviewID: String
    public let sourceKind: ApprovedSourceKind
    public let displayTitle: String
    public let programDisplayTitle: String
    public let program: SignedProgramIdentity
    public let runningInstance: RunningApplicationIdentity
    public let exactWindow: ExactWindowIdentity?
    public let supportedScopes: [SourceApprovalScopeKind]

    public var id: String { reviewID }

    public init(
        reviewID: String,
        sourceKind: ApprovedSourceKind,
        displayTitle: String,
        programDisplayTitle: String,
        program: SignedProgramIdentity,
        runningInstance: RunningApplicationIdentity,
        exactWindow: ExactWindowIdentity?
    ) {
        self.reviewID = reviewID
        self.sourceKind = sourceKind
        self.displayTitle = displayTitle
        self.programDisplayTitle = programDisplayTitle
        self.program = program
        self.runningInstance = runningInstance
        self.exactWindow = exactWindow
        supportedScopes = exactWindow == nil
            ? [.runningInstance, .signedProgram]
            : [.exactWindow, .runningInstance, .signedProgram]
    }
}

/// Immutable identity carried by the content filter, UI label, and every
/// emitted frame. This prevents a newly selected label from relabeling a cached
/// frame from an older source.
public struct CaptureLeaseIdentity: Codable, Equatable, Sendable {
    public let leaseID: String
    public let approvalID: String
    public let displayTitle: String
    public let sourceKind: ApprovedSourceKind
    public let sourceWindowID: UInt32

    public init(
        leaseID: String,
        approvalID: String,
        displayTitle: String,
        sourceKind: ApprovedSourceKind,
        sourceWindowID: UInt32
    ) {
        self.leaseID = leaseID
        self.approvalID = approvalID
        self.displayTitle = displayTitle
        self.sourceKind = sourceKind
        self.sourceWindowID = sourceWindowID
    }

    public func matches(_ frame: FrameMetadata) -> Bool {
        frame.captureLeaseID == leaseID
            && frame.sourceApprovalID == approvalID
            && frame.sourceDisplayTitle == displayTitle
            && frame.sourceKind == sourceKind
            && frame.sourceWindowID == sourceWindowID
    }
}

public enum CaptureLifecycle: String, Codable, Equatable, Sendable {
    case idle
    case ready
    case live
    case paused
    case stopped
    case permissionDenied = "permission-denied"
    case failed
}

public enum PrivacyStatus: String, Codable, Equatable, Sendable {
    case clear
    case protected
    case unknown
}

public struct PrivacyAssessment: Codable, Equatable, Sendable {
    public let status: PrivacyStatus
    public let reason: String
    public let assessedAtMonotonicNanos: UInt64

    public init(status: PrivacyStatus, reason: String, assessedAtMonotonicNanos: UInt64) {
        self.status = status
        self.reason = reason
        self.assessedAtMonotonicNanos = assessedAtMonotonicNanos
    }
}

public struct PersistenceGate: Codable, Equatable, Sendable {
    public let allowed: Bool
    public let label: String
    public let reason: String

    public init(allowed: Bool, label: String, reason: String) {
        self.allowed = allowed
        self.label = label
        self.reason = reason
    }
}

public struct RuntimeMetadata: Codable, Equatable, Sendable {
    public let processID: Int32
    public let operatingSystem: String
    public let appVersion: String
    public let audioCaptureEnabled: Bool
    public let microphoneCaptureEnabled: Bool
    public let physicalCursorIncludedInSourcePixels: Bool
    public let mouseClickIndicatorsEnabled: Bool
    public let frameRingCapacity: Int

    public init(
        processID: Int32,
        operatingSystem: String,
        appVersion: String,
        audioCaptureEnabled: Bool,
        microphoneCaptureEnabled: Bool,
        physicalCursorIncludedInSourcePixels: Bool,
        mouseClickIndicatorsEnabled: Bool,
        frameRingCapacity: Int
    ) {
        self.processID = processID
        self.operatingSystem = operatingSystem
        self.appVersion = appVersion
        self.audioCaptureEnabled = audioCaptureEnabled
        self.microphoneCaptureEnabled = microphoneCaptureEnabled
        self.physicalCursorIncludedInSourcePixels = physicalCursorIncludedInSourcePixels
        self.mouseClickIndicatorsEnabled = mouseClickIndicatorsEnabled
        self.frameRingCapacity = frameRingCapacity
    }
}

public struct FrameMetadata: Codable, Equatable, Sendable {
    public let sequence: UInt64
    public let monotonicNanos: UInt64
    public let captureLeaseID: String
    public let sourceApprovalID: String
    public let sourceDisplayTitle: String
    public let sourceKind: ApprovedSourceKind
    public let sourceWindowID: UInt32
    public let sourceWidthPoints: Double
    public let sourceHeightPoints: Double
    public let pixelWidth: Int
    public let pixelHeight: Int
    public let contentScale: Double
    public let runtime: RuntimeMetadata

    public init(
        sequence: UInt64,
        monotonicNanos: UInt64,
        captureLeaseID: String,
        sourceApprovalID: String,
        sourceDisplayTitle: String,
        sourceKind: ApprovedSourceKind,
        sourceWindowID: UInt32,
        sourceWidthPoints: Double,
        sourceHeightPoints: Double,
        pixelWidth: Int,
        pixelHeight: Int,
        contentScale: Double,
        runtime: RuntimeMetadata
    ) {
        self.sequence = sequence
        self.monotonicNanos = monotonicNanos
        self.captureLeaseID = captureLeaseID
        self.sourceApprovalID = sourceApprovalID
        self.sourceDisplayTitle = sourceDisplayTitle
        self.sourceKind = sourceKind
        self.sourceWindowID = sourceWindowID
        self.sourceWidthPoints = sourceWidthPoints
        self.sourceHeightPoints = sourceHeightPoints
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.contentScale = contentScale
        self.runtime = runtime
    }
}

public struct CapturedFrame: @unchecked Sendable {
    public let image: CGImage
    public let metadata: FrameMetadata

    public init(image: CGImage, metadata: FrameMetadata) {
        self.image = image
        self.metadata = metadata
    }
}

public struct ProofConfiguration: Equatable, Sendable {
    public let targetWindowTitle: String
    public let outputDirectory: URL
    public let explicitSafeFixtureApproval: Bool
    public let durationSeconds: Double

    public init(
        targetWindowTitle: String,
        outputDirectory: URL,
        explicitSafeFixtureApproval: Bool,
        durationSeconds: Double
    ) {
        self.targetWindowTitle = targetWindowTitle
        self.outputDirectory = outputDirectory
        self.explicitSafeFixtureApproval = explicitSafeFixtureApproval
        self.durationSeconds = durationSeconds
    }
}

public struct SafeFixtureAttestation: Codable, Equatable, Sendable {
    public static let schemaName = "pd.porthole.safe-fixture-attestation.v1"

    public let schema: String
    public let proofOnlyCapability: Bool
    public let explicitApprovalFlag: Bool
    public let processID: Int32
    public let exactWindowTitle: String
    public let applicationIdentity: String
    public let captureBundleIdentifier: String
    public let fixtureBundleIdentifier: String
    public let executableFilename: String
    public let designatedRequirement: String
    public let launchIdentity: String
    public let expectedExecutableSHA256: String
    public let observedExecutableSHA256: String
    public let verified: Bool

    public init(
        processID: Int32,
        exactWindowTitle: String,
        applicationIdentity: String,
        captureBundleIdentifier: String,
        fixtureBundleIdentifier: String,
        executableFilename: String,
        designatedRequirement: String,
        launchIdentity: String,
        expectedExecutableSHA256: String,
        observedExecutableSHA256: String,
        verified: Bool
    ) {
        schema = Self.schemaName
        proofOnlyCapability = true
        explicitApprovalFlag = true
        self.processID = processID
        self.exactWindowTitle = exactWindowTitle
        self.applicationIdentity = applicationIdentity
        self.captureBundleIdentifier = captureBundleIdentifier
        self.fixtureBundleIdentifier = fixtureBundleIdentifier
        self.executableFilename = executableFilename
        self.designatedRequirement = designatedRequirement
        self.launchIdentity = launchIdentity
        self.expectedExecutableSHA256 = expectedExecutableSHA256
        self.observedExecutableSHA256 = observedExecutableSHA256
        self.verified = verified
    }
}

/// Runtime-only activity facts. No foreground application identity or
/// unrelated window metadata is stored.
public struct CaptureActivitySnapshot: Equatable, Sendable {
    public let captureApplicationActive: Bool
    public let sourceApplicationActive: Bool
    public let differentForegroundApplicationPresent: Bool

    public init(
        captureApplicationActive: Bool,
        sourceApplicationActive: Bool,
        differentForegroundApplicationPresent: Bool
    ) {
        self.captureApplicationActive = captureApplicationActive
        self.sourceApplicationActive = sourceApplicationActive
        self.differentForegroundApplicationPresent = differentForegroundApplicationPresent
    }
}

public struct BackgroundCaptureEvidence: Codable, Equatable, Sendable {
    public let captureApplicationActiveAtFirstFrame: Bool
    public let sourceApplicationActiveAtFirstFrame: Bool
    public let differentForegroundApplicationPresentAtFirstFrame: Bool
    public let sourceWindowOnScreenAtFirstFrame: Bool
    public let acceptedCompleteFrameCount: Int
    public let backgroundCompleteFrameCount: Int
    public let firstBackgroundFrameSequence: UInt64?
    public let lastBackgroundFrameSequence: UInt64?
    public let firstBackgroundFrameMonotonicNanos: UInt64?
    public let lastBackgroundFrameMonotonicNanos: UInt64?
    public let displayOrScreenFallbackUsed: Bool

    public var provesBackgroundContinuity: Bool {
        guard !displayOrScreenFallbackUsed,
              backgroundCompleteFrameCount >= 2,
              let firstSequence = firstBackgroundFrameSequence,
              let lastSequence = lastBackgroundFrameSequence,
              let firstClock = firstBackgroundFrameMonotonicNanos,
              let lastClock = lastBackgroundFrameMonotonicNanos
        else { return false }
        return lastSequence > firstSequence && lastClock > firstClock
    }

    public init(
        captureApplicationActiveAtFirstFrame: Bool,
        sourceApplicationActiveAtFirstFrame: Bool,
        differentForegroundApplicationPresentAtFirstFrame: Bool,
        sourceWindowOnScreenAtFirstFrame: Bool,
        acceptedCompleteFrameCount: Int,
        backgroundCompleteFrameCount: Int,
        firstBackgroundFrameSequence: UInt64?,
        lastBackgroundFrameSequence: UInt64?,
        firstBackgroundFrameMonotonicNanos: UInt64?,
        lastBackgroundFrameMonotonicNanos: UInt64?,
        displayOrScreenFallbackUsed: Bool
    ) {
        self.captureApplicationActiveAtFirstFrame = captureApplicationActiveAtFirstFrame
        self.sourceApplicationActiveAtFirstFrame = sourceApplicationActiveAtFirstFrame
        self.differentForegroundApplicationPresentAtFirstFrame = differentForegroundApplicationPresentAtFirstFrame
        self.sourceWindowOnScreenAtFirstFrame = sourceWindowOnScreenAtFirstFrame
        self.acceptedCompleteFrameCount = acceptedCompleteFrameCount
        self.backgroundCompleteFrameCount = backgroundCompleteFrameCount
        self.firstBackgroundFrameSequence = firstBackgroundFrameSequence
        self.lastBackgroundFrameSequence = lastBackgroundFrameSequence
        self.firstBackgroundFrameMonotonicNanos = firstBackgroundFrameMonotonicNanos
        self.lastBackgroundFrameMonotonicNanos = lastBackgroundFrameMonotonicNanos
        self.displayOrScreenFallbackUsed = displayOrScreenFallbackUsed
    }
}

public enum StageCompositeDisposition: String, Codable, Equatable, Sendable {
    /// This slice deliberately does not enumerate the desktop to capture its
    /// own UI. A future composite must be rendered from Porthole's own view
    /// hierarchy in-process, after the source recording is complete.
    case deferredUntilInProcessRenderer = "deferred-until-in-process-renderer"
}

public struct PortholeProofManifest: Codable, Equatable, Sendable {
    public static let schemaName = "pd.porthole.native-window-proof.v4"

    public let schema: String
    public let createdAt: String
    public let source: ShareableWindowDescriptor
    public let exactDesktopIndependentWindow: Bool
    public let audioCaptureEnabled: Bool
    public let microphoneCaptureEnabled: Bool
    public let physicalCursorIncludedInSourcePixels: Bool
    public let mouseClickIndicatorsEnabled: Bool
    public let namedCursorOverlayRequiresActiveLease: Bool
    public let rawFrameWrittenBeforeApproval: Bool
    public let explicitSafeFixtureApproval: Bool
    public let safeFixtureAttestation: SafeFixtureAttestation
    public let sourceApproval: SourceApproval
    public let captureLease: CaptureLeaseIdentity
    public let backgroundCaptureEvidence: BackgroundCaptureEvidence
    public let approvedSourceCount: Int
    public let unapprovedSourceMetadataRendered: Bool
    public let approvalStartedCapture: Bool
    public let evidenceAccessScope: EvidenceAccessScope
    public let privacyAssessment: PrivacyAssessment
    public let persistenceGate: PersistenceGate
    public let firstFrame: FrameMetadata
    public let lastFrame: FrameMetadata
    public let capturedFrameCount: Int
    public let ringCapacity: Int
    public let cursorParticipants: [CursorEvent]
    public let excludedBundlePrefixes: [String]
    public let sourceMediaFilename: String
    public let stageCompositeDisposition: StageCompositeDisposition
    public let shareableContentEnumerationUsed: Bool

    public init(
        createdAt: String,
        source: ShareableWindowDescriptor,
        safeFixtureAttestation: SafeFixtureAttestation,
        sourceApproval: SourceApproval,
        captureLease: CaptureLeaseIdentity,
        backgroundCaptureEvidence: BackgroundCaptureEvidence,
        evidenceAccessScope: EvidenceAccessScope,
        privacyAssessment: PrivacyAssessment,
        persistenceGate: PersistenceGate,
        firstFrame: FrameMetadata,
        lastFrame: FrameMetadata,
        capturedFrameCount: Int,
        ringCapacity: Int,
        cursorParticipants: [CursorEvent],
        excludedBundlePrefixes: [String],
        sourceMediaFilename: String
    ) {
        schema = Self.schemaName
        self.createdAt = createdAt
        self.source = source
        exactDesktopIndependentWindow = true
        audioCaptureEnabled = false
        microphoneCaptureEnabled = false
        physicalCursorIncludedInSourcePixels = true
        mouseClickIndicatorsEnabled = false
        namedCursorOverlayRequiresActiveLease = true
        rawFrameWrittenBeforeApproval = false
        explicitSafeFixtureApproval = true
        self.safeFixtureAttestation = safeFixtureAttestation
        self.sourceApproval = sourceApproval
        self.captureLease = captureLease
        self.backgroundCaptureEvidence = backgroundCaptureEvidence
        approvedSourceCount = 1
        unapprovedSourceMetadataRendered = false
        approvalStartedCapture = false
        self.evidenceAccessScope = evidenceAccessScope
        self.privacyAssessment = privacyAssessment
        self.persistenceGate = persistenceGate
        self.firstFrame = firstFrame
        self.lastFrame = lastFrame
        self.capturedFrameCount = capturedFrameCount
        self.ringCapacity = ringCapacity
        self.cursorParticipants = cursorParticipants
        self.excludedBundlePrefixes = excludedBundlePrefixes
        self.sourceMediaFilename = sourceMediaFilename
        stageCompositeDisposition = .deferredUntilInProcessRenderer
        shareableContentEnumerationUsed = false
    }
}

public struct PortholeProofReceipt: Codable, Equatable, Sendable {
    public static let schemaName = "pd.porthole.native-window-proof-receipt.v2"

    public let schema: String
    public let manifestSHA256: String
    public let sourceMediaSHA256: String
    public let manifestFilename: String
    public let sourceMediaFilename: String
    public let stageCompositeDisposition: StageCompositeDisposition
    public let monotonicFrameRange: ClosedRange<UInt64>
    public let statement: String

    public init(
        manifestSHA256: String,
        sourceMediaSHA256: String,
        manifestFilename: String,
        sourceMediaFilename: String,
        stageCompositeDisposition: StageCompositeDisposition,
        monotonicFrameRange: ClosedRange<UInt64>,
        statement: String
    ) {
        schema = Self.schemaName
        self.manifestSHA256 = manifestSHA256
        self.sourceMediaSHA256 = sourceMediaSHA256
        self.manifestFilename = manifestFilename
        self.sourceMediaFilename = sourceMediaFilename
        self.stageCompositeDisposition = stageCompositeDisposition
        self.monotonicFrameRange = monotonicFrameRange
        self.statement = statement
    }

    private enum CodingKeys: String, CodingKey {
        case schema, manifestSHA256, sourceMediaSHA256, manifestFilename
        case sourceMediaFilename, stageCompositeDisposition
        case monotonicStartNanos, monotonicEndNanos, statement
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schema = try container.decode(String.self, forKey: .schema)
        manifestSHA256 = try container.decode(String.self, forKey: .manifestSHA256)
        sourceMediaSHA256 = try container.decode(String.self, forKey: .sourceMediaSHA256)
        manifestFilename = try container.decode(String.self, forKey: .manifestFilename)
        sourceMediaFilename = try container.decode(String.self, forKey: .sourceMediaFilename)
        stageCompositeDisposition = try container.decode(
            StageCompositeDisposition.self,
            forKey: .stageCompositeDisposition
        )
        let start = try container.decode(UInt64.self, forKey: .monotonicStartNanos)
        let end = try container.decode(UInt64.self, forKey: .monotonicEndNanos)
        monotonicFrameRange = start ... end
        statement = try container.decode(String.self, forKey: .statement)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schema, forKey: .schema)
        try container.encode(manifestSHA256, forKey: .manifestSHA256)
        try container.encode(sourceMediaSHA256, forKey: .sourceMediaSHA256)
        try container.encode(manifestFilename, forKey: .manifestFilename)
        try container.encode(sourceMediaFilename, forKey: .sourceMediaFilename)
        try container.encode(stageCompositeDisposition, forKey: .stageCompositeDisposition)
        try container.encode(monotonicFrameRange.lowerBound, forKey: .monotonicStartNanos)
        try container.encode(monotonicFrameRange.upperBound, forKey: .monotonicEndNanos)
        try container.encode(statement, forKey: .statement)
    }
}
