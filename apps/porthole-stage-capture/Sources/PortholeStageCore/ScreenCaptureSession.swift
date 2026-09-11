import AVFoundation
import AppKit
import ApplicationServices
import CoreImage
import CoreMedia
import CryptoKit
import Foundation
import OSLog
import ScreenCaptureKit
import Security

private let stageLog = Logger(subsystem: "dev.portdaddy.porthole", category: "capture")

public enum StageCaptureError: LocalizedError {
    case proofOutputAlreadyExists(URL)
    case noProofFrames
    case assetWriter(String)
    case identityVerification(String)
    case unsupportedPickerSelection(String)
    case capabilityDenied(SourceCapabilityAction)

    public var errorDescription: String? {
        switch self {
        case let .proofOutputAlreadyExists(url):
            return "Proof output already exists at \(url.path). Move it aside before recording again."
        case .noProofFrames:
            return "The approved proof recorder received no complete frames."
        case let .assetWriter(message):
            return "Proof media writer failed: \(message)"
        case let .identityVerification(message):
            return "Source identity could not be verified: \(message)"
        case let .unsupportedPickerSelection(message):
            return "The macOS picker selection was rejected: \(message)"
        case let .capabilityDenied(action):
            return "This approval does not grant \(action.rawValue). Review its capabilities first."
        }
    }
}

public enum ProtectedFieldInspector {
    public static func assess(processID: Int32) -> PrivacyAssessment {
        let now = DispatchTime.now().uptimeNanoseconds
        guard AXIsProcessTrusted() else {
            return PrivacyAssessment(
                status: .unknown,
                reason: "Accessibility access is unavailable, so protected-field status cannot be verified.",
                assessedAtMonotonicNanos: now
            )
        }

        let application = AXUIElementCreateApplication(pid_t(processID))
        var focusedValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute as CFString, &focusedValue) == .success,
              let focusedValue
        else {
            return PrivacyAssessment(
                status: .unknown,
                reason: "The selected application did not expose a focused accessibility element.",
                assessedAtMonotonicNanos: now
            )
        }

        let focused = unsafeBitCast(focusedValue, to: AXUIElement.self)
        var subroleValue: CFTypeRef?
        let subroleResult = AXUIElementCopyAttributeValue(focused, kAXSubroleAttribute as CFString, &subroleValue)
        if subroleResult == .success,
           let subrole = subroleValue as? String,
           subrole == NSAccessibility.Subrole.secureTextField.rawValue
        {
            return PrivacyAssessment(
                status: .protected,
                reason: "The selected application reports a focused secure text field.",
                assessedAtMonotonicNanos: now
            )
        }

        var roleValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(focused, kAXRoleAttribute as CFString, &roleValue) == .success,
              roleValue is String
        else {
            return PrivacyAssessment(
                status: .unknown,
                reason: "The focused element's accessibility role could not be verified.",
                assessedAtMonotonicNanos: now
            )
        }

        return PrivacyAssessment(
            status: .clear,
            reason: "Accessibility reported a focused, non-secure element for the selected application.",
            assessedAtMonotonicNanos: now
        )
    }
}

final class ApprovedProofRecorder {
    let outputURL: URL

    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let lock = NSLock()
    private var started = false
    private var acceptingFrames = true
    private var finishing = false
    private var cancelQueued = false
    private(set) var frameCount = 0

    var recordedFrameCount: Int {
        lock.withLock { frameCount }
    }

    init(outputURL: URL, width: Int, height: Int) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            throw StageCaptureError.proofOutputAlreadyExists(outputURL)
        }
        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        self.outputURL = outputURL
        input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: max(width * height * 6, 1_500_000),
                ],
            ]
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw StageCaptureError.assetWriter("H.264 input is unsupported for \(width)x\(height).")
        }
        writer.add(input)
    }

    func append(_ sampleBuffer: CMSampleBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard acceptingFrames else { return }
        if writer.status == .unknown {
            writer.startWriting()
            writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
            started = true
        }
        guard writer.status == .writing, input.isReadyForMoreMediaData else { return }
        if input.append(sampleBuffer) {
            frameCount += 1
        }
    }

    func suspend() {
        lock.lock()
        acceptingFrames = false
        lock.unlock()
    }

    func cancel() {
        let shouldCancel = lock.withLock {
            acceptingFrames = false
            guard !cancelQueued else { return false }
            cancelQueued = true
            return true
        }
        guard shouldCancel else { return }
        // AVAssetWriter.cancelWriting is itself blocking. Retire the local
        // writer synchronously, but never put that framework wait on the UI or
        // the bounded shutdown task. The writer owns its incomplete file.
        DispatchQueue.global(qos: .utility).async { [writer] in writer.cancelWriting() }
    }

    func finish(deadline: CaptureShutdownDeadline) async throws {
        let didStart = lock.withLock {
            acceptingFrames = false
            guard !finishing else { return false }
            finishing = true
            return started
        }
        guard didStart else { throw StageCaptureError.noProofFrames }
        input.markAsFinished()
        do {
            try await deadline.wait(phase: "Proof finalization") { completion in
                writer.finishWriting { completion(nil) }
            }
        } catch {
            cancel()
            throw error
        }
        guard writer.status == .completed else {
            throw StageCaptureError.assetWriter(writer.error?.localizedDescription ?? "unknown writer status")
        }
    }
}

private final class FrameOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    private let source: ShareableWindowDescriptor
    private let captureLease: CaptureLeaseIdentity
    private let runtime: RuntimeMetadata
    private let ciContext = CIContext(options: [.cacheIntermediates: false])
    private let onFrame: (CapturedFrame) -> Void
    private let onError: (Error) -> Void
    private let proofRecorder: ApprovedProofRecorder?
    private var nextSequence: UInt64
    private var lastClock: UInt64
    private let deliveryLock = NSLock()
    private var acceptingFrames = true

    func invalidate() {
        deliveryLock.withLock { acceptingFrames = false }
        proofRecorder?.suspend()
    }

    init(
        source: ShareableWindowDescriptor,
        captureLease: CaptureLeaseIdentity,
        runtime: RuntimeMetadata,
        firstSequence: UInt64,
        lastMonotonicNanos: UInt64,
        proofRecorder: ApprovedProofRecorder?,
        onFrame: @escaping (CapturedFrame) -> Void,
        onError: @escaping (Error) -> Void
    ) {
        self.source = source
        self.captureLease = captureLease
        self.runtime = runtime
        nextSequence = firstSequence
        lastClock = lastMonotonicNanos
        self.proofRecorder = proofRecorder
        self.onFrame = onFrame
        self.onError = onError
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard deliveryLock.withLock({ acceptingFrames }),
              outputType == .screen,
              sampleBuffer.isValid,
              CMSampleBufferDataIsReady(sampleBuffer),
              Self.isComplete(sampleBuffer),
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let sourceImage = CIImage(cvPixelBuffer: pixelBuffer)
        guard let image = ciContext.createCGImage(sourceImage, from: sourceImage.extent) else { return }

        var now = DispatchTime.now().uptimeNanoseconds
        if now <= lastClock { now = lastClock &+ 1 }
        let sequence = nextSequence
        nextSequence &+= 1
        lastClock = now

        let metadata = FrameMetadata(
            sequence: sequence,
            monotonicNanos: now,
            captureLeaseID: captureLease.leaseID,
            sourceApprovalID: captureLease.approvalID,
            sourceDisplayTitle: captureLease.displayTitle,
            sourceKind: captureLease.sourceKind,
            sourceWindowID: source.windowID,
            sourceWidthPoints: source.width,
            sourceHeightPoints: source.height,
            pixelWidth: width,
            pixelHeight: height,
            contentScale: source.width > 0 ? Double(width) / source.width : 1,
            runtime: runtime
        )
        deliveryLock.withLock {
            guard acceptingFrames else { return }
            proofRecorder?.append(sampleBuffer)
            onFrame(CapturedFrame(image: image, metadata: metadata))
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onError(error)
    }

    private static func isComplete(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[SCStreamFrameInfo: Any]],
        let rawStatus = attachments.first?[.status] as? Int,
        let status = SCFrameStatus(rawValue: rawStatus)
        else { return false }
        return status == .complete
    }
}

private final class MetadataEmitter {
    private let queue = DispatchQueue(label: "dev.portdaddy.porthole-stage.metadata", qos: .utility)

    init() {
        // Report a broken metadata pipe through the lease error path instead
        // of letting SIGPIPE terminate the process before cleanup.
        _ = fcntl(FileHandle.standardOutput.fileDescriptor, F_SETNOSIGPIPE, 1)
    }

    func emit(_ frame: FrameMetadata, onError: @escaping (Error) -> Void) {
        queue.async {
            do {
                try FrameMetadataLineWriter { try FileHandle.standardOutput.write(contentsOf: $0) }.write(frame)
            } catch { onError(error) }
        }
    }
}

private enum SafeFixtureAttestor {
    static let captureBundleIdentifier = "dev.portdaddy.porthole"
    static let fixtureBundleIdentifier = "dev.portdaddy.porthole.safe-fixture"

    static func attest(
        source: ShareableWindowDescriptor,
        configuration: ProofConfiguration
    ) -> SafeFixtureAttestation? {
        guard configuration.explicitSafeFixtureApproval,
              source.title == configuration.targetWindowTitle,
              source.title == "Porthole Safe Fixture",
              source.ownerName == "PortholeFixture",
              source.bundleIdentifier == fixtureBundleIdentifier,
              Bundle.main.bundleIdentifier == captureBundleIdentifier,
              hasValidResourceSeal(Bundle.main.bundleURL),
              let manifestURL = Bundle.main.url(forResource: "safe-fixture-identity", withExtension: "json"),
              let manifestData = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(SafeFixtureIdentityManifest.self, from: manifestData),
              let running = NSRunningApplication(processIdentifier: pid_t(source.ownerPID)),
              let observedExecutable = running.executableURL,
              running.bundleIdentifier == fixtureBundleIdentifier,
              let runtimeIdentity = try? CodeIdentityInspector.inspect(running)
        else { return nil }

        let observed = observedExecutable.resolvingSymlinksInPath().standardizedFileURL
        guard SafeFixtureIdentityPolicy.accepts(
            manifest, observed: runtimeIdentity.program, executableFilename: observed.lastPathComponent
        )
        else { return nil }

        let expectedDigest = manifest.executableSHA256
        let observedDigest = runtimeIdentity.program.executableSHA256
        let identity = [
            running.bundleIdentifier ?? "missing-bundle-id",
            running.localizedName ?? source.ownerName,
            observed.lastPathComponent,
        ].joined(separator: ":")
        guard expectedDigest == observedDigest,
              observed.lastPathComponent == "PortholeFixture",
              running.bundleIdentifier == fixtureBundleIdentifier,
              running.processIdentifier == source.ownerPID,
              runtimeIdentity.program.bundleIdentifier == fixtureBundleIdentifier,
              runtimeIdentity.program.executableSHA256 == observedDigest
        else { return nil }

        return SafeFixtureAttestation(
            processID: source.ownerPID,
            exactWindowTitle: source.title,
            applicationIdentity: identity,
            captureBundleIdentifier: captureBundleIdentifier,
            fixtureBundleIdentifier: fixtureBundleIdentifier,
            executableFilename: observed.lastPathComponent,
            designatedRequirement: runtimeIdentity.program.designatedRequirement,
            launchIdentity: runtimeIdentity.launchIdentity,
            expectedExecutableSHA256: expectedDigest,
            observedExecutableSHA256: observedDigest,
            verified: true
        )
    }

    private static func hasValidResourceSeal(_ bundle: URL) -> Bool {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(bundle as CFURL, [], &code) == errSecSuccess,
              let code else { return false }
        return SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess
    }
}

private enum CodeIdentityInspector {
    static func inspect(_ running: NSRunningApplication) throws -> RunningApplicationIdentity {
        guard let executableURL = running.executableURL?.resolvingSymlinksInPath().standardizedFileURL,
              let bundleIdentifier = running.bundleIdentifier,
              !bundleIdentifier.isEmpty
        else {
            throw StageCaptureError.identityVerification("the selected process has no stable executable or bundle identity")
        }
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(executableURL as CFURL, [], &staticCode) == errSecSuccess,
              let staticCode
        else {
            throw StageCaptureError.identityVerification("Security.framework could not load the selected executable signature")
        }
        guard SecStaticCodeCheckValidity(staticCode, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess else {
            throw StageCaptureError.identityVerification("the selected executable signature is invalid")
        }
        var requirement: SecRequirement?
        guard SecCodeCopyDesignatedRequirement(staticCode, [], &requirement) == errSecSuccess,
              let requirement
        else {
            throw StageCaptureError.identityVerification("the selected executable has no designated requirement")
        }
        var requirementString: CFString?
        guard SecRequirementCopyString(requirement, [], &requirementString) == errSecSuccess,
              let designatedRequirement = requirementString as String?
        else {
            throw StageCaptureError.identityVerification("the designated requirement could not be serialized")
        }
        let executableData = try Data(contentsOf: executableURL, options: .mappedIfSafe)
        let executableSHA256 = SHA256.hash(data: executableData).hexString
        let program = SignedProgramIdentity(
            bundleIdentifier: bundleIdentifier,
            designatedRequirement: designatedRequirement,
            executableSHA256: executableSHA256
        )
        let launchDate = running.launchDate?.timeIntervalSince1970 ?? 0
        let launchMaterial = [
            bundleIdentifier,
            String(running.processIdentifier),
            String(format: "%.6f", launchDate),
            executableURL.path,
            designatedRequirement,
            executableSHA256,
        ].joined(separator: "\u{1F}")
        let launchIdentity = SHA256.hash(data: Data(launchMaterial.utf8)).hexString
        return RunningApplicationIdentity(
            program: program,
            processID: running.processIdentifier,
            launchIdentity: launchIdentity
        )
    }

    static func satisfies(
        _ running: NSRunningApplication,
        approvedProgram: SignedProgramIdentity
    ) -> Bool {
        guard running.bundleIdentifier == approvedProgram.bundleIdentifier,
              let executableURL = running.executableURL?.resolvingSymlinksInPath().standardizedFileURL
        else { return false }
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(executableURL as CFURL, [], &staticCode) == errSecSuccess,
              let staticCode
        else { return false }
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(
            approvedProgram.designatedRequirement as CFString,
            [],
            &requirement
        ) == errSecSuccess,
        let requirement,
        SecStaticCodeCheckValidity(
            staticCode,
            SecCSFlags(rawValue: kSecCSStrictValidate),
            requirement
        ) == errSecSuccess,
        let observed = try? inspect(running)
        else { return false }
        return ProgramIdentityPolicy.sameApprovedAuthority(
            approved: approvedProgram,
            observed: observed.program
        )
    }
}

/// Durable signed-program policies live in the login Keychain. Window titles,
/// process IDs, window IDs, and runtime filters are never written here.
private struct KeychainSignedProgramApprovalStore {
    private let service = "dev.portdaddy.porthole.source-approvals.v1"

    func load() -> [SourceApproval] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return [] }
        let dataItems: [Data]
        if let items = result as? [Data] {
            dataItems = items
        } else if let item = result as? Data {
            dataItems = [item]
        } else {
            return []
        }
        let decoder = JSONDecoder()
        return dataItems.compactMap { data in
            guard let approval = try? decoder.decode(SourceApproval.self, from: data),
                  approval.scope == .signedProgram,
                  approval.runningInstance == nil,
                  approval.exactWindow == nil,
                  (try? SourceApprovalPolicy.validate(approval)) != nil
            else { return nil }
            return approval
        }
    }

    func save(_ approval: SourceApproval) throws {
        guard approval.scope == .signedProgram else {
            throw StageCaptureError.identityVerification("only signed-program approvals may enter durable storage")
        }
        try SourceApprovalPolicy.validate(approval)
        let data = try JSONEncoder().encode(approval)
        let account = approval.approvalID
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(base as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insert = base
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let insertStatus = SecItemAdd(insert as CFDictionary, nil)
            guard insertStatus == errSecSuccess else {
                throw StageCaptureError.identityVerification("Keychain write failed with status \(insertStatus)")
            }
        } else if status != errSecSuccess {
            throw StageCaptureError.identityVerification("Keychain update failed with status \(status)")
        }
    }

    func delete(approvalID: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: approvalID,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

private struct PickerSelectionBinding {
    let review: ApprovalReview
    let filter: SCContentFilter
    let source: ShareableWindowDescriptor
    let runtimeIdentity: RunningApplicationIdentity
}

private struct ApprovedFilterBinding {
    let filter: SCContentFilter
    let source: ShareableWindowDescriptor
    let runtimeIdentity: RunningApplicationIdentity
}

private struct AutomationRecordingRequest {
    let outputDirectory: URL
    let durationSeconds: Double
}

private struct AutomationRecordingSeed {
    let outputDirectory: URL
    let approval: SourceApproval
    let lease: CaptureLeaseIdentity
    let firstFrame: FrameMetadata
    let lastFrame: FrameMetadata
}

public enum ProofArtifactWriter {
    public static func write(
        manifest: PortholeProofManifest,
        outputDirectory: URL
    ) throws -> PortholeProofReceipt {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let manifestData = try encoder.encode(manifest)
        let manifestURL = outputDirectory.appendingPathComponent("manifest.json")
        try manifestData.write(to: manifestURL, options: .atomic)

        let sourceMediaURL = outputDirectory.appendingPathComponent(manifest.sourceMediaFilename)
        let sourceMediaData = try Data(contentsOf: sourceMediaURL, options: .mappedIfSafe)
        let receipt = PortholeProofReceipt(
            manifestSHA256: SHA256.hash(data: manifestData).hexString,
            sourceMediaSHA256: SHA256.hash(data: sourceMediaData).hexString,
            manifestFilename: manifestURL.lastPathComponent,
            sourceMediaFilename: sourceMediaURL.lastPathComponent,
            stageCompositeDisposition: manifest.stageCompositeDisposition,
            monotonicFrameRange: manifest.firstFrame.monotonicNanos ... manifest.lastFrame.monotonicNanos,
            statement: "Local safe-fixture source capture proof. Stage composite is deferred until an in-process renderer exists; this is not a signed universal-ledger completeness receipt."
        )
        let receiptData = try encoder.encode(receipt)
        try receiptData.write(
            to: outputDirectory.appendingPathComponent("receipt.json"),
            options: .atomic
        )
        return receipt
    }
}

private extension SHA256.Digest {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}

@MainActor
public final class StageCaptureController: NSObject, ObservableObject, SCContentSharingPickerObserver {
    public static let frameRingCapacity = 3

    @Published public private(set) var approvedSources: [SourceApproval] = []
    @Published public private(set) var selectedApprovalID: String?
    @Published public private(set) var pendingApprovalReview: ApprovalReview?
    @Published public private(set) var activeCaptureLease: CaptureLeaseIdentity?
    @Published public private(set) var lifecycle: CaptureLifecycle = .idle
    @Published public private(set) var latestImage: NSImage?
    @Published public private(set) var latestMetadata: FrameMetadata?
    @Published public private(set) var frameRingCount = 0
    @Published public private(set) var statusMessage = "Nothing is approved. Use the macOS picker to review one source."
    @Published public private(set) var privacyAssessment = PrivacyAssessment(
        status: .unknown,
        reason: "No approved source is active.",
        assessedAtMonotonicNanos: 0
    )
    @Published public private(set) var persistenceGate = PersistenceGate(
        allowed: false,
        label: "Not approved",
        reason: "Preview, live share, and persistence are separate operator grants."
    )
    @Published public private(set) var cursors: [CursorEvent] = []
    @Published public private(set) var proofReceipt: PortholeProofReceipt?
    @Published public private(set) var automationArtifactReceipt: PortholeAutomationArtifactReceipt?

    public let proofConfiguration: ProofConfiguration?

    private let pickerSourcePolicy: PickerSelectedSourcePolicy
    private let runtime: RuntimeMetadata
    private let metadataEmitter = MetadataEmitter()
    private let picker: SCContentSharingPicker?
    private let keychainStore = KeychainSignedProgramApprovalStore()
    private var ledger = SourceApprovalLedger()
    private var pickerSelection: PickerSelectionBinding?
    private var approvedFilters: [String: ApprovedFilterBinding] = [:]
    private var stream: SCStream?
    private var output: FrameOutput?
    private var proofRecorder: ApprovedProofRecorder?
    private var automationRecordingRequest: AutomationRecordingRequest?
    private var safeFixtureAttestation: SafeFixtureAttestation?
    private var ring: MonotonicFrameRing<CapturedFrame>
    private var cursorStore = CursorStore()
    private var leaseTimer: Timer?
    private var proofStopTask: Task<Void, Never>?
    private var firstProofFrame: FrameMetadata?
    private var lastProofFrame: FrameMetadata?
    private var backgroundCaptureAccumulator = BackgroundCaptureAccumulator()
    private var receivedProofFrames = 0
    private var activeSource: ShareableWindowDescriptor?
    private var activeApproval: SourceApproval?
    private var proofInvalidated = false
    private var operationGate = CaptureOperationGate()
    private var shutdownGeneration = UUID()
    private var finalizingApprovalID: String?
#if DEBUG
    private var injectedShutdownWork: CaptureShutdownWork?
#endif

    public convenience init(proofConfiguration: ProofConfiguration? = nil) {
        self.init(proofConfiguration: proofConfiguration, useSystemPicker: true)
    }

    private init(proofConfiguration: ProofConfiguration?, useSystemPicker: Bool) {
        self.proofConfiguration = proofConfiguration
        picker = useSystemPicker ? SCContentSharingPicker.shared : nil
        pickerSourcePolicy = PickerSelectedSourcePolicy(
            currentProcessID: ProcessInfo.processInfo.processIdentifier
        )
        runtime = RuntimeMetadata(
            processID: ProcessInfo.processInfo.processIdentifier,
            operatingSystem: ProcessInfo.processInfo.operatingSystemVersionString,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development",
            audioCaptureEnabled: false,
            microphoneCaptureEnabled: false,
            physicalCursorIncludedInSourcePixels: ExactWindowStreamPolicy.standard.includesPhysicalCursorPixels,
            mouseClickIndicatorsEnabled: ExactWindowStreamPolicy.standard.includesMouseClickIndicators,
            frameRingCapacity: Self.frameRingCapacity
        )
        ring = try! MonotonicFrameRing(capacity: Self.frameRingCapacity)
        super.init()
        if useSystemPicker { configureSystemPicker() }
    }

#if DEBUG
    /// Debug-only internal seam: a shutdown callback cannot authorize capture.
    /// No filters are installed; normal start still requires a real picker and
    /// signed runtime binding. Release builds do not contain this initializer.
    convenience init(shutdownWork: CaptureShutdownWork, approval: SourceApproval) throws {
        self.init(proofConfiguration: nil, useSystemPicker: false)
        try ledger.approve(approval)
        approvedSources = ledger.approvedSources
        selectedApprovalID = approval.approvalID
        activeCaptureLease = CaptureLeaseIdentity(leaseID: "test-shutdown-only", approvalID: approval.approvalID,
            displayTitle: approval.displayTitle, sourceKind: .window, sourceWindowID: 77)
        lifecycle = .live
        injectedShutdownWork = shutdownWork
    }
#endif

    deinit {
        leaseTimer?.invalidate()
        proofStopTask?.cancel()
        picker?.remove(self)
    }

    public var selectedApprovalCanEnterStage: Bool {
        guard let selectedApprovalID,
              let approval = approvedSources.first(where: { $0.approvalID == selectedApprovalID })
        else { return false }
        return isApprovalReady(selectedApprovalID)
            && SourceApprovalPolicy.permits(.preview, approval: approval)
            && lifecycle != .live
    }

    public var canPauseCapture: Bool {
        lifecycle == .live
            && CapturePausePolicy.permitsPause(proofPersistenceEnabled: proofConfiguration != nil)
    }

    public func isApprovalReady(_ approvalID: String) -> Bool {
        guard let binding = approvedFilters[approvalID],
              let approval = approvedSources.first(where: { $0.approvalID == approvalID })
        else { return false }
        return validateRuntimeBinding(binding, approval: approval)
    }

    public func bootstrap() async {
        if SourceApprovalHydrationPolicy.shouldLoadDurableApprovals(
            proofOnlyExactFixtureMode: proofConfiguration != nil
        ) {
            for approval in keychainStore.load() {
                try? ledger.approve(approval)
            }
        }
        publishLedger()
        lifecycle = .ready
        if proofConfiguration != nil {
            statusMessage = "Proof mode is isolated. Choose the exact fixture in the macOS picker; approval and Enter Stage remain separate."
        } else if approvedSources.isEmpty {
            statusMessage = "Nothing is approved. The source catalog stays inside the macOS picker."
        } else {
            statusMessage = "Approved signed apps are locked. Choose one again in the macOS picker to attach a current filter."
        }
    }

    public func presentSystemPicker(for sourceKind: ApprovedSourceKind) async {
        guard let picker else { return }
        if proofConfiguration != nil, sourceKind != .window {
            statusMessage = "Proof mode accepts one exact fixture window, never an application or display."
            return
        }
        if stream != nil || latestImage != nil {
            await stopStream(finalState: .ready, finalizeProof: true)
            clearLiveState()
            guard lifecycle != .failed else { return }
        }
        pickerSelection = nil
        pendingApprovalReview = nil
        statusMessage = "macOS is presenting the private source picker. No catalog enters Porthole."
        switch sourceKind {
        case .window:
            picker.present(using: .window)
        case .application:
            picker.present(using: .application)
        }
    }

    public func approvePending(
        scope: SourceApprovalScopeKind,
        capabilities: SourceCapabilities
    ) {
        guard let pickerSelection,
              pickerSelection.review.supportedScopes.contains(scope)
        else {
            statusMessage = "Approval review expired. Choose the source again in the macOS picker."
            pendingApprovalReview = nil
            return
        }
        let review = pickerSelection.review
        guard SourceApprovalPolicy.supports(scope: scope, capabilities: capabilities) else {
            statusMessage = "Persistence requires this exact window. Review the scope and capabilities again."
            return
        }
        var proofAttestation: SafeFixtureAttestation?
        if let proofConfiguration {
            guard ledger.approvedSources.isEmpty,
                  scope == .exactWindow,
                  capabilities.preview,
                  capabilities.persistRecording,
                  let attestation = SafeFixtureAttestor.attest(
                      source: pickerSelection.source,
                      configuration: proofConfiguration
                  )
            else {
                statusMessage = "Proof approval failed closed: choose the signed exact fixture and grant preview plus persistence."
                return
            }
            proofAttestation = attestation
        }
        do {
            let approval = try SourceApprovalPolicy.reviewedApproval(
                review: review, scope: scope, capabilities: capabilities,
                approvalID: UUID().uuidString.lowercased(),
                createdAtMonotonicNanos: DispatchTime.now().uptimeNanoseconds)
            if approval.scope == .signedProgram {
                try keychainStore.save(approval)
            }
            try ledger.approve(approval)
            approvedFilters[approval.approvalID] = ApprovedFilterBinding(
                filter: pickerSelection.filter,
                source: pickerSelection.source,
                runtimeIdentity: pickerSelection.runtimeIdentity
            )
            if let proofAttestation { safeFixtureAttestation = proofAttestation }
            selectedApprovalID = approval.approvalID
            self.pickerSelection = nil
            pendingApprovalReview = nil
            publishLedger()
            statusMessage = "Approved. Capture is still stopped; Enter Stage is a separate action."
        } catch {
            statusMessage = "Approval failed closed: \(error.localizedDescription)"
        }
    }

    public func cancelPendingApproval() {
        pickerSelection = nil
        pendingApprovalReview = nil
        statusMessage = approvedSources.isEmpty
            ? "Nothing is approved. No source metadata was retained."
            : "Approval canceled. Existing approved sources are unchanged."
    }

    public func selectApproval(_ approvalID: String) async {
        guard approvedSources.contains(where: { $0.approvalID == approvalID }) else { return }
        guard selectedApprovalID != approvalID else { return }
        operationGate.beginStop()
        defer { operationGate.finishStop() }
        if activeCaptureLease?.approvalID != approvalID, stream != nil || latestImage != nil {
            await stopStream(finalState: .ready, finalizeProof: true)
            clearLiveState()
            guard lifecycle != .failed else { return }
        }
        selectedApprovalID = approvalID
        if approvedFilters[approvalID] == nil {
            statusMessage = "This signed-app approval needs a current system-picker selection before Enter Stage."
        } else {
            statusMessage = "Approved source selected. Capture remains stopped until Enter Stage."
        }
    }

    public func revokeApproval(_ approvalID: String) async {
        let wasFinalizing = finalizingApprovalID == approvalID
        if wasFinalizing { proofInvalidated = true }
        operationGate.beginStop(cancelPendingStart:
            selectedApprovalID == approvalID || activeCaptureLease?.approvalID == approvalID)
        defer { operationGate.finishStop() }
        if activeCaptureLease?.approvalID == approvalID {
            proofInvalidated = true
            proofRecorder?.suspend()
            clearLiveState()
            await stopStream(finalState: .ready, finalizeProof: false)
        }
        if ledger.revoke(approvalID: approvalID)?.scope == .signedProgram {
            keychainStore.delete(approvalID: approvalID)
        }
        approvedFilters.removeValue(forKey: approvalID)
        if selectedApprovalID == approvalID { selectedApprovalID = nil }
        publishLedger()
        if lifecycle != .failed {
            statusMessage = wasFinalizing
                ? "Revoked. Local frame delivery is closed and the pending proof is invalidated."
                : "Revoked. Streams stopped, frames and cursors cleared, and future writes are blocked."
        }
    }

    public func startCapture() async {
        guard let startTicket = operationGate.beginStart() else { return }
        defer { operationGate.finishStart(startTicket) }
        guard let selectedApprovalID,
              let approval = approvedSources.first(where: { $0.approvalID == selectedApprovalID }),
              let binding = approvedFilters[selectedApprovalID]
        else {
            lifecycle = .ready
            statusMessage = "Nothing active is approved. Use the macOS picker first."
            return
        }
        guard SourceApprovalPolicy.permits(.preview, approval: approval) else {
            lifecycle = .ready
            statusMessage = StageCaptureError.capabilityDenied(.preview).localizedDescription
            return
        }
        if stream != nil {
            await stopStream(finalState: .ready, finalizeProof: true, cancelPendingStart: false)
            guard lifecycle != .failed else { return }
        }
        guard operationGate.permitsCompletion(startTicket) else { return }
        guard validateRuntimeBinding(binding, approval: approval),
              self.selectedApprovalID == selectedApprovalID,
              approvedSources.contains(approval)
        else {
            clearLiveState()
            lifecycle = .failed
            statusMessage = "The approved source changed before capture started. Approve it again."
            return
        }
        clearLiveState()
        proofInvalidated = false
        proofReceipt = nil
        automationArtifactReceipt = nil

        let lease = CaptureLeaseIdentity(
            leaseID: UUID().uuidString.lowercased(),
            approvalID: approval.approvalID,
            displayTitle: Self.displayTitle(for: binding.source),
            sourceKind: binding.source.windowID == 0 ? .application : .window,
            sourceWindowID: binding.source.windowID
        )
        activeCaptureLease = lease
        activeApproval = approval
        activeSource = binding.source

        let attestation = proofConfiguration.flatMap {
            SafeFixtureAttestor.attest(source: binding.source, configuration: $0)
        }
        safeFixtureAttestation = attestation
        privacyAssessment = attestation?.verified == true
            ? PrivacyAssessment(
                status: .clear,
                reason: "The proof-only fixture approval remains bound to one signed launch and one exact window.",
                assessedAtMonotonicNanos: DispatchTime.now().uptimeNanoseconds
            )
            : ProtectedFieldInspector.assess(processID: binding.source.ownerPID)
        persistenceGate = PortholeAutomationPersistencePolicy.evaluateActiveMode(
            automationRecording: automationRecordingRequest != nil, approval: approval,
            sourceIsCurrent: isApprovalReady(approval.approvalID), assessment: privacyAssessment,
            explicitFixtureApproval: proofConfiguration?.explicitSafeFixtureApproval == true,
            verifiedFixture: attestation?.verified == true)

        let filter = binding.filter
        let width = Self.evenDimension(filter.contentRect.width * CGFloat(filter.pointPixelScale))
        let height = Self.evenDimension(filter.contentRect.height * CGFloat(filter.pointPixelScale))
        let configuration = Self.streamConfiguration(width: width, height: height)

        do {
            var recorder: ApprovedProofRecorder?
            if let proofConfiguration,
               approval.capabilities.persistRecording,
               persistenceGate.allowed
            {
                recorder = try ApprovedProofRecorder(
                    outputURL: proofConfiguration.outputDirectory.appendingPathComponent("stage-source.mov"),
                    width: width,
                    height: height
                )
            } else if let automationRecordingRequest {
                guard persistenceGate.allowed else {
                    self.automationRecordingRequest = nil
                    clearLiveState()
                    lifecycle = .ready
                    statusMessage = persistenceGate.reason
                    return
                }
                try PortholeAutomationOutputDirectory.createNew(
                    automationRecordingRequest.outputDirectory
                )
                recorder = try ApprovedProofRecorder(
                    outputURL: automationRecordingRequest.outputDirectory
                        .appendingPathComponent("stage-source.mov"),
                    width: width,
                    height: height
                )
            }
            proofRecorder = recorder
            firstProofFrame = nil
            lastProofFrame = nil
            backgroundCaptureAccumulator = BackgroundCaptureAccumulator()
            receivedProofFrames = 0

            let output = FrameOutput(
                source: binding.source,
                captureLease: lease,
                runtime: runtime,
                firstSequence: 1,
                lastMonotonicNanos: 0,
                proofRecorder: recorder,
                onFrame: { [weak self] frame in
                    Task { @MainActor in
                        // A frame may already be queued when Stop detaches its
                        // stream. It cannot invalidate or revive a newer lease.
                        guard let self, self.activeCaptureLease == lease else { return }
                        self.consume(frame)
                    }
                },
                onError: { [weak self] error in
                    Task { @MainActor in
                        guard let self, self.activeCaptureLease == lease else { return }
                        await self.invalidateActiveLease(reason: "Capture stopped: \(error.localizedDescription)")
                    }
                }
            )
            let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
            try stream.addStreamOutput(
                output,
                type: .screen,
                sampleHandlerQueue: DispatchQueue(label: "dev.portdaddy.porthole-stage.frames", qos: .userInteractive)
            )
            self.output = output
            self.stream = stream
            try await stream.startCapture()
            guard operationGate.permitsCompletion(startTicket), activeCaptureLease == lease else {
                output.invalidate()
                recorder?.cancel()
                try? await Self.stop(stream, deadline: CaptureShutdownDeadline())
                return
            }
            lifecycle = .live
            statusMessage = persistenceGate.allowed
                ? "Recording · one approved exact window · mic and audio off"
                : "Live preview · approved source · memory-only"
            startLeaseMonitor(binding: binding, approval: approval, lease: lease)
            if recorder != nil,
               let duration = proofConfiguration?.durationSeconds ?? automationRecordingRequest?.durationSeconds {
                scheduleProofStop(after: duration)
            }
        } catch {
            guard activeCaptureLease == lease else { return }
            operationGate.beginStop(cancelPendingStart: false)
            defer { operationGate.finishStop() }
            stageLog.error("capture start failed closed: \(error.localizedDescription, privacy: .public)")
            await stopStream(finalState: .failed, finalizeProof: false, cancelPendingStart: false)
            lifecycle = .failed
            statusMessage = error.localizedDescription
        }
    }

    public func pauseCapture() async {
        guard lifecycle == .live else { return }
        guard CapturePausePolicy.permitsPause(proofPersistenceEnabled: proofConfiguration != nil) else {
            statusMessage = "Proof recording is one immutable segment. Stop & Clear finishes it; pause is unavailable."
            return
        }
        operationGate.beginStop()
        defer { operationGate.finishStop() }
        await stopStream(finalState: .paused, finalizeProof: false, preservePreview: true)
        if lifecycle == .paused {
            statusMessage = "Paused · cached frame remains memory-only; Stop clears it"
        }
    }

    public func stopCapture() async {
        operationGate.beginStop()
        defer { operationGate.finishStop() }
        await stopStream(finalState: .stopped, finalizeProof: true)
        let didWriteReceipt = proofReceipt != nil || automationArtifactReceipt != nil
        clearLiveState()
        if lifecycle != .failed {
            lifecycle = .stopped
            statusMessage = didWriteReceipt
                ? "Stopped · approved proof receipt written · preview cleared"
                : "Stopped · preview, ring, and cursors cleared · no proof receipt"
        }
    }

    public func ingestCursor(_ event: CursorEvent) {
        guard CursorLeasePolicy.permits(
            event,
            activeLeaseID: activeCaptureLease?.leaseID
        )
        else {
            statusMessage = "Ignored cursor event because it was not scoped to the active Stage lease."
            return
        }
        do {
            try cursorStore.ingest(event)
            cursors = cursorStore.visible
        } catch {
            statusMessage = "Ignored invalid local cursor event: \(error)"
        }
    }

    nonisolated public func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        Task { @MainActor [weak self] in
            await self?.acceptPickerSelection(filter, for: stream)
        }
    }

    nonisolated public func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didCancelFor stream: SCStream?
    ) {
        Task { @MainActor [weak self] in self?.cancelPendingApproval() }
    }

    nonisolated public func contentSharingPickerStartDidFailWithError(_ error: Error) {
        Task { @MainActor [weak self] in
            self?.lifecycle = .permissionDenied
            self?.statusMessage = "macOS could not present the private picker: \(error.localizedDescription)"
        }
    }

    private func configureSystemPicker() {
        guard let picker else { return }
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = [.singleWindow, .singleApplication]
        configuration.excludedBundleIDs = pickerSourcePolicy.excludedBundlePrefixes + [
            SafeFixtureAttestor.captureBundleIdentifier,
        ]
        configuration.excludedWindowIDs = []
        configuration.allowsChangingSelectedContent = false
        picker.defaultConfiguration = configuration
        picker.maximumStreamCount = 1
        picker.add(self)
        picker.isActive = true
    }

    private func acceptPickerSelection(_ filter: SCContentFilter, for stream: SCStream?) async {
        guard stream == nil else {
            await invalidateActiveLease(reason: "An out-of-band source replacement was rejected; choose a new approval instead.")
            return
        }
        do {
            let selection = try pickerBinding(for: filter)
            if let running = NSRunningApplication(
                processIdentifier: selection.runtimeIdentity.processID
            ),
            let durable = approvedSources.first(where: {
                $0.scope == .signedProgram
                    && ProgramIdentityPolicy.sameApprovedAuthority(
                        approved: $0.program,
                        observed: selection.review.program
                    )
                    && CodeIdentityInspector.satisfies(running, approvedProgram: $0.program)
            }) {
                approvedFilters[durable.approvalID] = ApprovedFilterBinding(
                    filter: selection.filter,
                    source: selection.source,
                    runtimeIdentity: selection.runtimeIdentity
                )
                selectedApprovalID = durable.approvalID
                pickerSelection = nil
                pendingApprovalReview = nil
                statusMessage = "Existing signed-app approval matched. Capture is still stopped until Enter Stage."
                return
            }
            pickerSelection = selection
            pendingApprovalReview = selection.review
            lifecycle = .ready
            statusMessage = "Review scope and capabilities. The picker selection has not started capture."
        } catch {
            pickerSelection = nil
            pendingApprovalReview = nil
            lifecycle = .failed
            statusMessage = error.localizedDescription
        }
    }

    private func pickerBinding(for filter: SCContentFilter) throws -> PickerSelectionBinding {
        guard #available(macOS 15.2, *) else {
            throw StageCaptureError.unsupportedPickerSelection(
                "this macOS release cannot expose enough filter identity to bind an exact approval"
            )
        }
        switch filter.style {
        case .window:
            guard filter.includedWindows.count == 1,
                  let window = filter.includedWindows.first,
                  let application = window.owningApplication,
                  let running = NSRunningApplication(processIdentifier: application.processID)
            else {
                throw StageCaptureError.unsupportedPickerSelection("expected exactly one signed window")
            }
            let source = Self.descriptor(window)
            guard pickerSourcePolicy.accepts(source) else {
                throw StageCaptureError.unsupportedPickerSelection("the selected window is excluded, hidden, or too small")
            }
            let runtimeIdentity = try CodeIdentityInspector.inspect(running)
            let exactWindow = ExactWindowIdentity(
                application: runtimeIdentity,
                windowID: source.windowID
            )
            let review = ApprovalReview(
                reviewID: UUID().uuidString.lowercased(),
                sourceKind: .window,
                displayTitle: Self.displayTitle(for: source),
                programDisplayTitle: application.applicationName,
                program: runtimeIdentity.program,
                runningInstance: runtimeIdentity,
                exactWindow: exactWindow
            )
            return PickerSelectionBinding(
                review: review,
                filter: filter,
                source: source,
                runtimeIdentity: runtimeIdentity
            )
        case .application:
            guard filter.includedApplications.count == 1,
                  let application = filter.includedApplications.first,
                  let running = NSRunningApplication(processIdentifier: application.processID),
                  !pickerSourcePolicy.excludedBundlePrefixes.contains(where: {
                      application.bundleIdentifier.hasPrefix($0)
                  })
            else {
                throw StageCaptureError.unsupportedPickerSelection("expected exactly one non-Porthole signed app")
            }
            let runtimeIdentity = try CodeIdentityInspector.inspect(running)
            let source = ShareableWindowDescriptor(
                windowID: 0,
                ownerPID: application.processID,
                ownerName: application.applicationName,
                bundleIdentifier: application.bundleIdentifier,
                title: application.applicationName,
                width: filter.contentRect.width,
                height: filter.contentRect.height,
                layer: 0,
                isOnScreen: true
            )
            let review = ApprovalReview(
                reviewID: UUID().uuidString.lowercased(),
                sourceKind: .application,
                displayTitle: application.applicationName,
                programDisplayTitle: application.applicationName,
                program: runtimeIdentity.program,
                runningInstance: runtimeIdentity,
                exactWindow: nil
            )
            return PickerSelectionBinding(
                review: review,
                filter: filter,
                source: source,
                runtimeIdentity: runtimeIdentity
            )
        default:
            throw StageCaptureError.unsupportedPickerSelection("only one window or one app may be approved")
        }
    }

    private func consume(_ frame: CapturedFrame) {
        guard lifecycle == .live,
              let lease = activeCaptureLease,
              lease.matches(frame.metadata)
        else {
            if lifecycle == .live {
                proofInvalidated = true
                proofRecorder?.suspend()
                clearLiveState()
                lifecycle = .failed
                statusMessage = "Rejected a stale or relabeled frame; the active lease was cleared."
                Task { await stopStream(finalState: .failed, finalizeProof: false) }
            }
            return
        }
        do {
            try ring.append(
                sequence: frame.metadata.sequence,
                monotonicNanos: frame.metadata.monotonicNanos,
                value: frame
            )
            latestImage = NSImage(cgImage: frame.image, size: .zero)
            latestMetadata = frame.metadata
            metadataEmitter.emit(frame.metadata) { [weak self] error in
                Task { @MainActor in
                    guard let self, self.activeCaptureLease == lease else { return }
                    await self.invalidateActiveLease(reason: "Metadata output failed: \(error.localizedDescription)")
                }
            }
            frameRingCount = ring.entries.count
            if frame.metadata.sequence == 1 || frame.metadata.sequence.isMultiple(of: 30) {
                let snapshot = currentActivitySnapshot()
                stageLog.info(
                    "complete-frame sequence=\(frame.metadata.sequence, privacy: .public) monotonicNanos=\(frame.metadata.monotonicNanos, privacy: .public) leaseMatches=true captureAppActive=\(snapshot.captureApplicationActive, privacy: .public) sourceAppActive=\(snapshot.sourceApplicationActive, privacy: .public) differentForegroundPresent=\(snapshot.differentForegroundApplicationPresent, privacy: .public)"
                )
            }
            if proofRecorder != nil {
                backgroundCaptureAccumulator.observe(
                    frame: frame.metadata,
                    activity: currentActivitySnapshot()
                )
                firstProofFrame = firstProofFrame ?? frame.metadata
                lastProofFrame = frame.metadata
                receivedProofFrames += 1
            }
        } catch {
            proofInvalidated = true
            proofRecorder?.suspend()
            clearLiveState()
            lifecycle = .failed
            statusMessage = "Rejected non-monotonic frame metadata: \(error)"
            Task { await stopStream(finalState: .failed, finalizeProof: false) }
        }
    }

    private func startLeaseMonitor(
        binding: ApprovedFilterBinding,
        approval: SourceApproval,
        lease: CaptureLeaseIdentity
    ) {
        leaseTimer?.invalidate()
        leaseTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self,
                      self.lifecycle == .live,
                      self.activeCaptureLease == lease
                else { return }
                let valid = self.validateRuntimeBinding(binding, approval: approval)
                guard self.lifecycle == .live, self.activeCaptureLease == lease else { return }
                guard valid else {
                    await self.invalidateActiveLease(
                        reason: "Approval expired because its signed launch or exact window changed."
                    )
                    return
                }
                let assessment = self.safeFixtureAttestation?.verified == true
                    ? PrivacyAssessment(
                        status: .clear,
                        reason: "The proof fixture signature, launch identity, and exact window remain bound.",
                        assessedAtMonotonicNanos: DispatchTime.now().uptimeNanoseconds
                    )
                    : ProtectedFieldInspector.assess(processID: binding.source.ownerPID)
                self.privacyAssessment = assessment
                self.persistenceGate = PortholeAutomationPersistencePolicy.evaluateActiveMode(
                    automationRecording: self.automationRecordingRequest != nil, approval: approval,
                    sourceIsCurrent: valid, assessment: assessment,
                    explicitFixtureApproval: self.proofConfiguration?.explicitSafeFixtureApproval == true,
                    verifiedFixture: self.safeFixtureAttestation?.verified == true)
                if !self.persistenceGate.allowed, self.proofRecorder != nil {
                    self.proofRecorder?.suspend()
                    self.statusMessage = "Live preview continues · persistence synchronously paused for privacy uncertainty"
                }
            }
        }
    }

    private func validateRuntimeBinding(
        _ binding: ApprovedFilterBinding,
        approval: SourceApproval
    ) -> Bool {
        guard let running = NSRunningApplication(processIdentifier: binding.runtimeIdentity.processID),
              CodeIdentityInspector.satisfies(running, approvedProgram: approval.program),
              let observedIdentity = try? CodeIdentityInspector.inspect(running),
              observedIdentity == binding.runtimeIdentity
        else { return false }
        // The active SCStream is the exact-window liveness witness. Closing or
        // replacing the window terminates that stream through its delegate;
        // periodic identity checks must not enumerate unrelated windows.
        let openWindowIDs: Set<UInt32> = approval.exactWindow.map { [$0.windowID] } ?? []
        let observation = SourceRuntimeObservation(
            program: observedIdentity.program,
            processID: observedIdentity.processID,
            launchIdentity: observedIdentity.launchIdentity,
            openWindowIDs: openWindowIDs
        )
        return SourceApprovalValidity.pickerBindingIsCurrent(
            approval, sourceWindowID: binding.source.windowID, sourceOwnerPID: binding.source.ownerPID,
            boundIdentity: binding.runtimeIdentity, observation: observation)
    }

    private func invalidateActiveLease(reason: String) async {
        guard let approvalID = activeCaptureLease?.approvalID else { return }
        operationGate.beginStop()
        defer { operationGate.finishStop() }
        proofInvalidated = true
        proofRecorder?.suspend()
        clearLiveState()
        await stopStream(finalState: .failed, finalizeProof: false)
        if ledger.revoke(approvalID: approvalID)?.scope == .signedProgram {
            keychainStore.delete(approvalID: approvalID)
        }
        approvedFilters.removeValue(forKey: approvalID)
        if selectedApprovalID == approvalID { selectedApprovalID = nil }
        publishLedger()
        lifecycle = .failed
        statusMessage = reason + " Frames and cursors were cleared; no further write is possible."
    }

    private func stopStream(
        finalState: CaptureLifecycle?,
        finalizeProof: Bool,
        cancelPendingStart: Bool = true,
        preservePreview: Bool = false
    ) async {
        operationGate.beginStop(cancelPendingStart: cancelPendingStart)
        defer { operationGate.finishStop() }
        let generation = UUID()
        shutdownGeneration = generation
        let deadline = CaptureShutdownDeadline()
        leaseTimer?.invalidate()
        leaseTimer = nil
        proofStopTask?.cancel()
        proofStopTask = nil
        // Close the local boundary synchronously, before waiting for either
        // framework. Detach resources so a reentrant Stop cannot finalize the
        // same recorder twice or accidentally clear a newer capture.
        output?.invalidate()
        proofRecorder?.suspend()
        let stoppingStream = stream
        let recorder = proofRecorder
        let manifest = finalizeProof && !proofInvalidated ? proofManifest(recorder: recorder) : nil
        let proofOutput = proofConfiguration?.outputDirectory
        let automationSeed: AutomationRecordingSeed? = if finalizeProof,
            !proofInvalidated,
            let request = automationRecordingRequest,
            let approval = activeApproval,
            let lease = activeCaptureLease,
            let firstFrame = firstProofFrame,
            let lastFrame = lastProofFrame,
            approval.scope == .exactWindow,
            lease.matches(firstFrame),
            lease.matches(lastFrame)
        {
            AutomationRecordingSeed(
                outputDirectory: request.outputDirectory,
                approval: approval,
                lease: lease,
                firstFrame: firstFrame,
                lastFrame: lastFrame
            )
        } else { nil }
        var work = CaptureShutdownWork(
            approval: manifest?.sourceApproval ?? automationSeed?.approval,
            closeDelivery: {}, // Real outputs were synchronously retired above.
            stop: { deadline in
                if let stoppingStream { try await Self.stop(stoppingStream, deadline: deadline) }
            },
            finalize: { deadline in
                if manifest != nil || automationSeed != nil, let recorder {
                    try await recorder.finish(deadline: deadline)
                }
                else { recorder?.cancel() }
            },
            publish: {
                guard let manifest, let proofOutput else { return nil }
                return try ProofArtifactWriter.write(manifest: manifest, outputDirectory: proofOutput)
            },
            cancel: { recorder?.cancel() }
        )
#if DEBUG
        if let injectedShutdownWork {
            work = injectedShutdownWork
            self.injectedShutdownWork = nil
        }
#endif
        work.closeDelivery()
        finalizingApprovalID = work.approval?.approvalID
        defer { if shutdownGeneration == generation { finalizingApprovalID = nil } }
        stream = nil
        output = nil
        proofRecorder = nil
        automationRecordingRequest = nil
        safeFixtureAttestation = nil
        activeSource = nil
        activeApproval = nil
        activeCaptureLease = nil
        proofReceipt = nil
        automationArtifactReceipt = nil
        if !preservePreview { clearLiveState() }
        do {
            try await work.stop(deadline)
            guard shutdownGeneration == generation else { work.cancel(); return }
            if finalizeProof, !proofInvalidated { try await work.finalize(deadline) }
            else { work.cancel() }
            // Success callbacks can race with task cancellation, revocation,
            // or a newer Stop. None can be undone by receipt publication.
            try Task.checkCancellation()
            guard shutdownGeneration == generation else { work.cancel(); return }
            if finalizeProof, !proofInvalidated,
               work.approval.map({ approvedSources.contains($0) }) ?? true {
                proofReceipt = try work.publish()
                if let automationSeed, let recorder {
                    automationArtifactReceipt = try PortholeAutomationArtifactWriter.writeRecordingReceipt(
                        outputDirectory: automationSeed.outputDirectory,
                        approval: automationSeed.approval,
                        lease: automationSeed.lease,
                        firstFrame: automationSeed.firstFrame,
                        lastFrame: automationSeed.lastFrame,
                        frameCount: min(receivedProofFrames, recorder.recordedFrameCount)
                    )
                }
            } else { work.cancel() }
            if let finalState, lifecycle != .failed { lifecycle = finalState }
        } catch {
            work.cancel()
            guard shutdownGeneration == generation else { return }
            proofInvalidated = true
            clearLiveState()
            lifecycle = .failed
            statusMessage = "Shutdown failed: \(error.localizedDescription) No proof receipt was published."
        }
    }

    private static func stop(_ stream: SCStream, deadline: CaptureShutdownDeadline) async throws {
        try await deadline.wait(phase: "Screen capture", alwaysRequestCleanup: true) { completion in
            stream.stopCapture(completionHandler: completion)
        }
    }

    private func proofManifest(recorder: ApprovedProofRecorder?) -> PortholeProofManifest? {
        guard let recorder,
              proofConfiguration != nil,
              let source = activeSource,
              let safeFixtureAttestation,
              let approval = activeApproval,
              let captureLease = activeCaptureLease,
              let backgroundCaptureEvidence = backgroundCaptureAccumulator.evidence(
                  sourceWindowOnScreenAtFirstFrame: source.isOnScreen,
                  displayOrScreenFallbackUsed: false
              ),
              let firstFrame = firstProofFrame,
              let lastFrame = lastProofFrame,
              approvedSources.count == 1,
              captureLease.matches(firstFrame),
              captureLease.matches(lastFrame)
        else { return nil }
        return PortholeProofManifest(
                createdAt: ISO8601DateFormatter().string(from: Date()),
                source: source,
                safeFixtureAttestation: safeFixtureAttestation,
                sourceApproval: approval,
                captureLease: captureLease,
                backgroundCaptureEvidence: backgroundCaptureEvidence,
                evidenceAccessScope: .standaloneNoAccess,
                privacyAssessment: privacyAssessment,
                persistenceGate: persistenceGate,
                firstFrame: firstFrame,
                lastFrame: lastFrame,
                capturedFrameCount: min(receivedProofFrames, recorder.recordedFrameCount),
                ringCapacity: Self.frameRingCapacity,
                cursorParticipants: cursors,
                excludedBundlePrefixes: pickerSourcePolicy.excludedBundlePrefixes,
                sourceMediaFilename: recorder.outputURL.lastPathComponent
            )
    }

    private func currentActivitySnapshot() -> CaptureActivitySnapshot {
        let capturePID = ProcessInfo.processInfo.processIdentifier
        let sourcePID = activeSource?.ownerPID
        let sourceActive = sourcePID.flatMap {
            NSRunningApplication(processIdentifier: $0)?.isActive
        } ?? false
        let foregroundPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let differentForegroundPresent = foregroundPID.map { processID in
            guard processID != capturePID else { return false }
            if let sourcePID, processID == sourcePID { return false }
            return true
        } ?? false
        return CaptureActivitySnapshot(
            captureApplicationActive: NSApp.isActive,
            sourceApplicationActive: sourceActive,
            differentForegroundApplicationPresent: differentForegroundPresent
        )
    }

    private func scheduleProofStop(after durationSeconds: Double) {
        proofStopTask?.cancel()
        proofStopTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(durationSeconds))
            guard !Task.isCancelled else { return }
            // Do not have stopStream cancel the timer task which is now
            // performing finalization; cancellation must mean an outside stop.
            self?.proofStopTask = nil
            await self?.stopCapture()
        }
    }

    private func publishLedger() {
        approvedSources = ledger.approvedSources
    }

    private func clearLiveState() {
        activeCaptureLease = nil
        latestImage = nil
        latestMetadata = nil
        ring.removeAll(keepingCapacity: false)
        frameRingCount = 0
        cursorStore.removeAll()
        cursors = []
    }

    private static func descriptor(_ window: SCWindow) -> ShareableWindowDescriptor {
        let app = window.owningApplication
        return ShareableWindowDescriptor(
            windowID: window.windowID,
            ownerPID: app?.processID ?? 0,
            ownerName: app?.applicationName ?? "Unknown application",
            bundleIdentifier: app?.bundleIdentifier,
            title: window.title ?? "",
            width: window.frame.width,
            height: window.frame.height,
            layer: window.windowLayer,
            isOnScreen: window.isOnScreen
        )
    }

    private static func displayTitle(for source: ShareableWindowDescriptor) -> String {
        source.windowID == 0
            ? source.ownerName
            : "\(source.ownerName) · \(source.displayTitle)"
    }

    private static func streamConfiguration(width: Int, height: Int) -> SCStreamConfiguration {
        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.queueDepth = frameRingCapacity
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = ExactWindowStreamPolicy.standard.includesPhysicalCursorPixels
        configuration.capturesAudio = false
        configuration.excludesCurrentProcessAudio = true
        if #available(macOS 15.0, *) {
            configuration.showMouseClicks = ExactWindowStreamPolicy.standard.includesMouseClickIndicators
            configuration.captureMicrophone = false
        }
        return configuration
    }

    private static func evenDimension(_ value: CGFloat) -> Int {
        let clamped = max(Int(value.rounded()), 2)
        return clamped.isMultiple(of: 2) ? clamped : clamped - 1
    }
}

extension StageCaptureController: PortholeAutomationControlling {
    public func automationStatus() -> PortholeAutomationStatus {
        PortholeAutomationStatus(
            processID: runtime.processID,
            lifecycle: lifecycle,
            frameCount: latestMetadata.map { Int(clamping: $0.sequence) } ?? 0,
            selectedApprovalID: selectedApprovalID,
            activeApprovalID: activeCaptureLease?.approvalID,
            hasPendingReview: pendingApprovalReview != nil,
            approvedSourceCount: approvedSources.count,
            persistenceAllowed: persistenceGate.allowed,
            artifact: automationArtifactReceipt
        )
    }

    public func automationPendingReview() -> PortholeAutomationPendingReview? {
        pendingApprovalReview.map {
            PortholeAutomationPendingReview(
                reviewID: $0.reviewID,
                displayTitle: $0.displayTitle,
                programDisplayTitle: $0.programDisplayTitle,
                sourceKind: $0.sourceKind,
                supportedScopes: $0.supportedScopes
            )
        }
    }

    public func automationApprovedSources() -> [PortholeAutomationApprovedSource] {
        approvedSources.map {
            PortholeAutomationApprovedSource(
                approvalID: $0.approvalID,
                displayTitle: $0.displayTitle,
                sourceKind: $0.sourceKind,
                scope: $0.scope,
                capabilities: $0.capabilities,
                selected: selectedApprovalID == $0.approvalID,
                pickerBindingCurrent: isApprovalReady($0.approvalID)
            )
        }
    }

    public func automationOpenPicker(_ sourceKind: ApprovedSourceKind) async {
        await presentSystemPicker(for: sourceKind)
    }

    public func automationApprove(
        reviewID: String,
        scope: SourceApprovalScopeKind,
        capabilities: SourceCapabilities
    ) throws {
        guard let review = pendingApprovalReview, review.reviewID == reviewID else {
            throw PortholeAutomationError.authorityRequired(
                "That review is not the current operator-selected picker source."
            )
        }
        guard review.supportedScopes.contains(scope) else {
            throw PortholeAutomationError.authorityRequired(
                "Requested scope is not supported by the current picker selection."
            )
        }
        if !SourceApprovalPolicy.supports(scope: scope, capabilities: capabilities) {
            throw PortholeAutomationError.authorityRequired(
                "Persistence requires the exact picker-selected window and at least one capability."
            )
        }
        let before = approvedSources.count
        approvePending(scope: scope, capabilities: capabilities)
        guard pendingApprovalReview == nil, approvedSources.count == before + 1,
              let granted = approvedSources.first(where: { $0.approvalID == selectedApprovalID }),
              granted.scope == scope, granted.capabilities == capabilities else {
            throw PortholeAutomationError.authorityRequired(statusMessage)
        }
    }

    public func automationCancelReview() {
        cancelPendingApproval()
    }

    public func automationSelect(_ approvalID: String) async throws {
        guard approvedSources.contains(where: { $0.approvalID == approvalID }) else {
            throw PortholeAutomationError.authorityRequired("Approval is unknown or revoked.")
        }
        await selectApproval(approvalID)
        guard selectedApprovalID == approvalID else {
            throw PortholeAutomationError.invalidState(statusMessage)
        }
    }

    public func automationRevoke(_ approvalID: String) async throws {
        guard approvedSources.contains(where: { $0.approvalID == approvalID }) else {
            throw PortholeAutomationError.authorityRequired("Approval is unknown or already revoked.")
        }
        await revokeApproval(approvalID)
        guard !approvedSources.contains(where: { $0.approvalID == approvalID }) else {
            throw PortholeAutomationError.invalidState("Approval revocation did not complete.")
        }
    }

    public func automationStart() async throws {
        guard [.ready, .stopped].contains(lifecycle) else {
            throw PortholeAutomationError.invalidState("Start requires ready or stopped lifecycle state.")
        }
        automationRecordingRequest = nil
        await startCapture()
        guard lifecycle == .live else { throw PortholeAutomationError.invalidState(statusMessage) }
    }

    public func automationPause() async throws {
        guard canPauseCapture else {
            throw PortholeAutomationError.invalidState("Pause requires a live memory-only preview.")
        }
        await pauseCapture()
        guard lifecycle == .paused else { throw PortholeAutomationError.invalidState(statusMessage) }
    }

    public func automationResume() async throws {
        guard lifecycle == .paused else {
            throw PortholeAutomationError.invalidState("Resume requires paused lifecycle state.")
        }
        await startCapture()
        guard lifecycle == .live else { throw PortholeAutomationError.invalidState(statusMessage) }
    }

    public func automationStop() async {
        await stopCapture()
    }

    public func automationWriteStill(
        to outputDirectory: URL
    ) throws -> PortholeAutomationArtifactReceipt {
        guard lifecycle == .live,
              let approval = activeApproval,
              approvedSources.contains(approval),
              let lease = activeCaptureLease,
              lease.approvalID == approval.approvalID,
              lease.sourceWindowID == approval.exactWindow?.windowID,
              lease.sourceKind == .window,
              let image = latestImage,
              let metadata = latestMetadata,
              lease.matches(metadata)
        else {
            throw PortholeAutomationError.invalidState(
                "A live complete frame from one current exact-window approval is required."
            )
        }
        let gate = PortholeAutomationPersistencePolicy.evaluate(
            approval: approval,
            sourceIsCurrent: isApprovalReady(approval.approvalID),
            assessment: privacyAssessment
        )
        guard gate.allowed else { throw PortholeAutomationError.authorityRequired(gate.reason) }
        let receipt = try PortholeAutomationArtifactWriter.writeStill(
            image: image,
            metadata: metadata,
            approval: approval,
            lease: lease,
            outputDirectory: outputDirectory
        )
        automationArtifactReceipt = receipt
        return receipt
    }

    public func automationStartRecording(
        to outputDirectory: URL,
        durationSeconds: Double
    ) async throws {
        guard proofConfiguration == nil else {
            throw PortholeAutomationError.invalidState(
                "Interactive automation recording cannot be combined with safe-fixture proof mode."
            )
        }
        guard [.ready, .stopped].contains(lifecycle) else {
            throw PortholeAutomationError.invalidState("Recording requires ready or stopped lifecycle state.")
        }
        guard let selectedApprovalID,
              let approval = approvedSources.first(where: { $0.approvalID == selectedApprovalID }),
              approval.scope == .exactWindow,
              approval.capabilities.persistRecording,
              isApprovalReady(selectedApprovalID)
        else {
            throw PortholeAutomationError.authorityRequired(
                "Recording requires a current exact-window picker approval with persistence capability."
            )
        }
        guard durationSeconds.isFinite, (2 ... 30).contains(durationSeconds) else {
            throw PortholeAutomationError.invalidRequest("Recording duration must be between 2 and 30 seconds.")
        }
        automationArtifactReceipt = nil
        automationRecordingRequest = AutomationRecordingRequest(
            outputDirectory: outputDirectory.standardizedFileURL,
            durationSeconds: durationSeconds
        )
        await startCapture()
        guard lifecycle == .live, proofRecorder != nil else {
            automationRecordingRequest = nil
            throw PortholeAutomationError.authorityRequired(statusMessage)
        }
    }
}
