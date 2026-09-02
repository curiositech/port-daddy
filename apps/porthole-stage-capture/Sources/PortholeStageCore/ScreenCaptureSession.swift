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

private final class ApprovedProofRecorder {
    let outputURL: URL

    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let lock = NSLock()
    private var started = false
    private var acceptingFrames = true
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

    func finish() async throws {
        let didStart = lock.withLock {
            acceptingFrames = false
            return started
        }
        guard didStart else { throw StageCaptureError.noProofFrames }
        input.markAsFinished()
        await writer.finishWriting()
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
        guard outputType == .screen,
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
        proofRecorder?.append(sampleBuffer)
        onFrame(CapturedFrame(image: image, metadata: metadata))
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

private struct NativeFrameEvent: Encodable {
    let schema = "pd.porthole.native-frame-metadata.v1"
    let frame: FrameMetadata
}

private final class MetadataEmitter {
    private let queue = DispatchQueue(label: "dev.portdaddy.porthole-stage.metadata", qos: .utility)

    func emit(_ frame: FrameMetadata) {
        queue.async {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            guard var data = try? encoder.encode(NativeFrameEvent(frame: frame)) else { return }
            data.append(0x0A)
            FileHandle.standardOutput.write(data)
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
              let stageExecutable = Bundle.main.executableURL,
              let running = NSRunningApplication(processIdentifier: pid_t(source.ownerPID)),
              let observedExecutable = running.executableURL,
              running.bundleIdentifier == fixtureBundleIdentifier,
              let runtimeIdentity = try? CodeIdentityInspector.inspect(running)
        else { return nil }

        let expectedExecutable = stageExecutable
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("PortholeFixture.app/Contents/MacOS/PortholeFixture")
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let observed = observedExecutable.resolvingSymlinksInPath().standardizedFileURL
        guard observed == expectedExecutable,
              let expectedData = try? Data(contentsOf: expectedExecutable, options: .mappedIfSafe),
              let observedData = try? Data(contentsOf: observed, options: .mappedIfSafe)
        else { return nil }

        let expectedDigest = SHA256.hash(data: expectedData).hexString
        let observedDigest = SHA256.hash(data: observedData).hexString
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

    public let proofConfiguration: ProofConfiguration?

    private let pickerSourcePolicy: PickerSelectedSourcePolicy
    private let runtime: RuntimeMetadata
    private let metadataEmitter = MetadataEmitter()
    private let picker = SCContentSharingPicker.shared
    private let keychainStore = KeychainSignedProgramApprovalStore()
    private var ledger = SourceApprovalLedger()
    private var pickerSelection: PickerSelectionBinding?
    private var approvedFilters: [String: ApprovedFilterBinding] = [:]
    private var stream: SCStream?
    private var output: FrameOutput?
    private var proofRecorder: ApprovedProofRecorder?
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

    public init(proofConfiguration: ProofConfiguration? = nil) {
        self.proofConfiguration = proofConfiguration
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
        configureSystemPicker()
    }

    deinit {
        leaseTimer?.invalidate()
        proofStopTask?.cancel()
        picker.remove(self)
    }

    public var selectedApprovalCanEnterStage: Bool {
        guard let selectedApprovalID,
              let approval = approvedSources.first(where: { $0.approvalID == selectedApprovalID })
        else { return false }
        return approvedFilters[selectedApprovalID] != nil
            && SourceApprovalPolicy.permits(.preview, approval: approval)
            && lifecycle != .live
    }

    public var canPauseCapture: Bool {
        lifecycle == .live
            && CapturePausePolicy.permitsPause(proofPersistenceEnabled: proofConfiguration != nil)
    }

    public func isApprovalReady(_ approvalID: String) -> Bool {
        approvedFilters[approvalID] != nil
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
        if proofConfiguration != nil, sourceKind != .window {
            statusMessage = "Proof mode accepts one exact fixture window, never an application or display."
            return
        }
        if stream != nil || latestImage != nil {
            await stopStream(finalState: .ready, finalizeProof: true)
            clearLiveState()
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
        let approval = SourceApproval(
            approvalID: UUID().uuidString.lowercased(),
            scope: scope,
            sourceKind: scope == .exactWindow ? .window : review.sourceKind,
            displayTitle: scope == .exactWindow ? review.displayTitle : review.programDisplayTitle,
            capabilities: capabilities,
            program: review.program,
            runningInstance: scope == .signedProgram ? nil : review.runningInstance,
            exactWindow: scope == .exactWindow ? review.exactWindow : nil,
            createdAtMonotonicNanos: DispatchTime.now().uptimeNanoseconds
        )
        do {
            try SourceApprovalPolicy.validate(approval)
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
        if activeCaptureLease?.approvalID != approvalID, stream != nil || latestImage != nil {
            await stopStream(finalState: .ready, finalizeProof: true)
            clearLiveState()
        }
        selectedApprovalID = approvalID
        if approvedFilters[approvalID] == nil {
            statusMessage = "This signed-app approval needs a current system-picker selection before Enter Stage."
        } else {
            statusMessage = "Approved source selected. Capture remains stopped until Enter Stage."
        }
    }

    public func revokeApproval(_ approvalID: String) async {
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
        statusMessage = "Revoked. Streams stopped, frames and cursors cleared, and future writes are blocked."
    }

    public func startCapture() async {
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
            await stopStream(finalState: .ready, finalizeProof: true)
        }
        clearLiveState()
        proofInvalidated = false

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
        persistenceGate = PrivacyPersistencePolicy.evaluate(
            assessment: privacyAssessment,
            explicitOperatorApproval: approval.capabilities.persistRecording
                && proofConfiguration?.explicitSafeFixtureApproval == true,
            isSyntheticSafeFixture: attestation?.verified == true
        )

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
                    Task { @MainActor in self?.consume(frame) }
                },
                onError: { [weak self] error in
                    Task { @MainActor in await self?.invalidateActiveLease(
                        reason: "Capture stopped: \(error.localizedDescription)"
                    ) }
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
            lifecycle = .live
            statusMessage = persistenceGate.allowed
                ? "Recording · one approved fixture window · mic and audio off"
                : "Live preview · approved source · memory-only"
            startLeaseMonitor(binding: binding, approval: approval, lease: lease)
            if recorder != nil, let proofConfiguration {
                scheduleProofStop(after: proofConfiguration.durationSeconds)
            }
        } catch {
            stageLog.error("capture start failed closed: \(error.localizedDescription, privacy: .public)")
            if let stream { try? await stream.stopCapture() }
            proofRecorder?.suspend()
            proofRecorder = nil
            stream = nil
            output = nil
            clearLiveState()
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
        leaseTimer?.invalidate()
        leaseTimer = nil
        proofStopTask?.cancel()
        proofStopTask = nil
        if let stream { try? await stream.stopCapture() }
        stream = nil
        output = nil
        proofRecorder?.suspend()
        lifecycle = .paused
        statusMessage = "Paused · cached frame remains memory-only; Stop clears it"
    }

    public func stopCapture() async {
        await stopStream(finalState: .stopped, finalizeProof: true)
        let didWriteReceipt = proofReceipt != nil
        clearLiveState()
        if lifecycle != .failed {
            lifecycle = .stopped
            statusMessage = didWriteReceipt
                ? "Stopped · approved proof receipt written · preview cleared"
                : "Stopped · preview, ring, and cursors cleared · nothing saved"
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
            metadataEmitter.emit(frame.metadata)
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
                let valid = await self.validateRuntimeBinding(binding, approval: approval)
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
                self.persistenceGate = PrivacyPersistencePolicy.evaluate(
                    assessment: assessment,
                    explicitOperatorApproval: approval.capabilities.persistRecording
                        && self.proofConfiguration?.explicitSafeFixtureApproval == true,
                    isSyntheticSafeFixture: self.safeFixtureAttestation?.verified == true
                )
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
    ) async -> Bool {
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
        return SourceApprovalValidity.remainsValid(approval, observation: observation)
    }

    private func invalidateActiveLease(reason: String) async {
        guard let approvalID = activeCaptureLease?.approvalID else { return }
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
        finalizeProof: Bool
    ) async {
        leaseTimer?.invalidate()
        leaseTimer = nil
        proofStopTask?.cancel()
        proofStopTask = nil
        if let stream { try? await stream.stopCapture() }
        stream = nil
        output = nil
        if finalizeProof, !proofInvalidated {
            await finishProofIfNeeded()
        }
        proofRecorder = nil
        safeFixtureAttestation = nil
        activeSource = nil
        activeApproval = nil
        activeCaptureLease = nil
        if let finalState, lifecycle != .failed { lifecycle = finalState }
    }

    private func finishProofIfNeeded() async {
        guard let recorder = proofRecorder,
              let proofConfiguration,
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
        else { return }
        do {
            try await recorder.finish()
            let manifest = PortholeProofManifest(
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
            proofReceipt = try ProofArtifactWriter.write(
                manifest: manifest,
                outputDirectory: proofConfiguration.outputDirectory
            )
        } catch {
            lifecycle = .failed
            statusMessage = "Proof finalization failed: \(error.localizedDescription)"
        }
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
