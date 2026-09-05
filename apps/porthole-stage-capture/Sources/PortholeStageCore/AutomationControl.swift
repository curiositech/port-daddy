import AppKit
import CryptoKit
import Darwin
import Foundation

public enum PortholeAutomationAction: String, Codable, CaseIterable, Sendable {
    case ping
    case status
    case openPicker = "open-picker"
    case pendingReview = "pending-review"
    case approve
    case cancelReview = "cancel-review"
    case listApproved = "list-approved"
    case select
    case revoke
    case start
    case pause
    case resume
    case stop
    case still
    case record
    case wait
    case assert
    case batch
}

public struct PortholeAutomationRequest: Codable, Equatable, Sendable {
    public let id: String
    public let command: PortholeAutomationAction
    public let sourceKind: ApprovedSourceKind?
    public let reviewID: String?
    public let approvalID: String?
    public let scope: SourceApprovalScopeKind?
    public let capabilities: SourceCapabilities?
    public let outputDirectory: String?
    public let durationSeconds: Double?
    public let lifecycle: CaptureLifecycle?
    public let minimumFrameCount: Int?
    public let timeoutMilliseconds: Int?
    public let steps: [PortholeAutomationRequest]?

    public init(
        id: String,
        command: PortholeAutomationAction,
        sourceKind: ApprovedSourceKind? = nil,
        reviewID: String? = nil,
        approvalID: String? = nil,
        scope: SourceApprovalScopeKind? = nil,
        capabilities: SourceCapabilities? = nil,
        outputDirectory: String? = nil,
        durationSeconds: Double? = nil,
        lifecycle: CaptureLifecycle? = nil,
        minimumFrameCount: Int? = nil,
        timeoutMilliseconds: Int? = nil,
        steps: [PortholeAutomationRequest]? = nil
    ) {
        self.id = id
        self.command = command
        self.sourceKind = sourceKind
        self.reviewID = reviewID
        self.approvalID = approvalID
        self.scope = scope
        self.capabilities = capabilities
        self.outputDirectory = outputDirectory
        self.durationSeconds = durationSeconds
        self.lifecycle = lifecycle
        self.minimumFrameCount = minimumFrameCount
        self.timeoutMilliseconds = timeoutMilliseconds
        self.steps = steps
    }
}

public struct PortholeAutomationApprovedSource: Codable, Equatable, Sendable {
    public let approvalID: String
    public let displayTitle: String
    public let sourceKind: ApprovedSourceKind
    public let scope: SourceApprovalScopeKind
    public let capabilities: SourceCapabilities
    public let selected: Bool
    public let pickerBindingCurrent: Bool
}

public struct PortholeAutomationPendingReview: Codable, Equatable, Sendable {
    public let reviewID: String
    public let displayTitle: String
    public let programDisplayTitle: String
    public let sourceKind: ApprovedSourceKind
    public let supportedScopes: [SourceApprovalScopeKind]
}

public struct PortholeAutomationArtifactReceipt: Codable, Equatable, Sendable {
    public static let schemaName = "pd.porthole.local-automation-artifact.v1"

    public let schema: String
    public let kind: String
    public let createdAt: String
    public let approvalID: String
    public let captureLeaseID: String
    public let sourceDisplayTitle: String
    public let sourceKind: ApprovedSourceKind
    public let sourceWindowID: UInt32
    public let artifactFilename: String
    public let artifactSHA256: String
    public let frameCount: Int
    public let firstFrameMonotonicNanos: UInt64
    public let lastFrameMonotonicNanos: UInt64
    public let statement: String

    public init(
        kind: String,
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        approvalID: String,
        captureLeaseID: String,
        sourceDisplayTitle: String,
        sourceKind: ApprovedSourceKind,
        sourceWindowID: UInt32,
        artifactFilename: String,
        artifactSHA256: String,
        frameCount: Int,
        firstFrameMonotonicNanos: UInt64,
        lastFrameMonotonicNanos: UInt64,
        statement: String
    ) {
        schema = Self.schemaName
        self.kind = kind
        self.createdAt = createdAt
        self.approvalID = approvalID
        self.captureLeaseID = captureLeaseID
        self.sourceDisplayTitle = sourceDisplayTitle
        self.sourceKind = sourceKind
        self.sourceWindowID = sourceWindowID
        self.artifactFilename = artifactFilename
        self.artifactSHA256 = artifactSHA256
        self.frameCount = frameCount
        self.firstFrameMonotonicNanos = firstFrameMonotonicNanos
        self.lastFrameMonotonicNanos = lastFrameMonotonicNanos
        self.statement = statement
    }
}

public struct PortholeAutomationStatus: Codable, Equatable, Sendable {
    public let processID: Int32
    public let lifecycle: CaptureLifecycle
    public let frameCount: Int
    public let selectedApprovalID: String?
    public let activeApprovalID: String?
    public let hasPendingReview: Bool
    public let approvedSourceCount: Int
    public let persistenceAllowed: Bool
    public let artifact: PortholeAutomationArtifactReceipt?
}

public struct PortholeAutomationResult: Codable, Equatable, Sendable {
    public var message: String?
    public var status: PortholeAutomationStatus?
    public var pendingReview: PortholeAutomationPendingReview?
    public var approvedSources: [PortholeAutomationApprovedSource]?
    public var artifact: PortholeAutomationArtifactReceipt?
    public var steps: [PortholeAutomationResponse]?

    public init(
        message: String? = nil,
        status: PortholeAutomationStatus? = nil,
        pendingReview: PortholeAutomationPendingReview? = nil,
        approvedSources: [PortholeAutomationApprovedSource]? = nil,
        artifact: PortholeAutomationArtifactReceipt? = nil,
        steps: [PortholeAutomationResponse]? = nil
    ) {
        self.message = message
        self.status = status
        self.pendingReview = pendingReview
        self.approvedSources = approvedSources
        self.artifact = artifact
        self.steps = steps
    }
}

public struct PortholeAutomationFailure: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
}

public struct PortholeAutomationResponse: Codable, Equatable, Sendable {
    public static let schemaName = "pd.porthole.local-control-response.v1"

    public let schema: String
    public let id: String
    public let command: String
    public let ok: Bool
    public let result: PortholeAutomationResult?
    public let error: PortholeAutomationFailure?

    public static func success(
        _ request: PortholeAutomationRequest,
        result: PortholeAutomationResult
    ) -> Self {
        Self(schema: schemaName, id: request.id, command: request.command.rawValue,
             ok: true, result: result, error: nil)
    }

    public static func failure(
        id: String,
        command: String,
        code: String,
        message: String
    ) -> Self {
        Self(schema: schemaName, id: id, command: command, ok: false, result: nil,
             error: PortholeAutomationFailure(code: code, message: message))
    }
}

public enum PortholeAutomationError: Error, Equatable, LocalizedError {
    case invalidRequest(String)
    case authorityRequired(String)
    case invalidState(String)
    case timedOut(String)
    case outputCollision(String)
    case unsafePath(String)
    case artifactFailed(String)

    public var code: String {
        switch self {
        case .invalidRequest: return "invalid-request"
        case .authorityRequired: return "authority-required"
        case .invalidState: return "invalid-state"
        case .timedOut: return "timed-out"
        case .outputCollision: return "output-collision"
        case .unsafePath: return "unsafe-path"
        case .artifactFailed: return "artifact-failed"
        }
    }

    public var errorDescription: String? {
        switch self {
        case let .invalidRequest(message), let .authorityRequired(message),
             let .invalidState(message), let .timedOut(message),
             let .outputCollision(message), let .unsafePath(message),
             let .artifactFailed(message): return message
        }
    }
}

public enum PortholeAutomationProtocol {
    public static let maximumLineBytes = 32 * 1_024
    public static let maximumResponseBytes = 64 * 1_024
    public static let maximumBatchSteps = 64
    public static let maximumCommandsPerConnection = 64
    public static let maximumWaitMilliseconds = 30_000

    private static let allowedKeys: Set<String> = [
        "id", "command", "sourceKind", "reviewID", "approvalID", "scope", "capabilities",
        "outputDirectory", "durationSeconds", "lifecycle", "minimumFrameCount",
        "timeoutMilliseconds", "steps",
    ]

    public static func decode(_ line: Data) throws -> PortholeAutomationRequest {
        guard !line.isEmpty, line.count <= maximumLineBytes, !line.contains(0) else {
            throw PortholeAutomationError.invalidRequest("Control request must be one nonempty JSON line within 32768 bytes.")
        }
        let raw: Any
        do { raw = try JSONSerialization.jsonObject(with: line) }
        catch { throw PortholeAutomationError.invalidRequest("Control request is not valid JSON.") }
        guard let object = raw as? [String: Any] else {
            throw PortholeAutomationError.invalidRequest("Control request must be an object with only documented fields.")
        }
        try validateObjectKeys(object, nested: false)
        let request: PortholeAutomationRequest
        do { request = try JSONDecoder().decode(PortholeAutomationRequest.self, from: line) }
        catch { throw PortholeAutomationError.invalidRequest("Control request fields have invalid types or values.") }
        try validate(request, nested: false)
        return request
    }

    public static func encode(_ response: PortholeAutomationResponse) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(response)
        guard data.count < maximumResponseBytes else {
            throw PortholeAutomationError.invalidRequest("Control response exceeded its bounded size.")
        }
        data.append(0x0A)
        return data
    }

    private static func validate(_ request: PortholeAutomationRequest, nested: Bool) throws {
        guard (1 ... 128).contains(request.id.utf8.count),
              request.id.unicodeScalars.allSatisfy({ $0.value >= 0x21 && $0.value <= 0x7e })
        else { throw PortholeAutomationError.invalidRequest("Request id must be 1-128 visible ASCII bytes.") }
        if let timeout = request.timeoutMilliseconds,
           !(1 ... maximumWaitMilliseconds).contains(timeout) {
            throw PortholeAutomationError.invalidRequest("Timeout must be between 1 and 30000 milliseconds.")
        }
        if let count = request.minimumFrameCount, count < 0 || count > 1_000_000 {
            throw PortholeAutomationError.invalidRequest("Frame assertion is outside the bounded range.")
        }
        switch request.command {
        case .openPicker:
            guard request.sourceKind != nil else { throw missing("sourceKind", request.command) }
        case .approve:
            guard request.reviewID != nil else { throw missing("reviewID", request.command) }
            guard request.scope != nil else { throw missing("scope", request.command) }
            guard let capabilities = request.capabilities,
                  capabilities.preview || capabilities.liveShare || capabilities.persistRecording
            else { throw PortholeAutomationError.invalidRequest("approve requires at least one explicit capability.") }
        case .select, .revoke:
            guard request.approvalID != nil else { throw missing("approvalID", request.command) }
        case .still:
            guard request.outputDirectory != nil else { throw missing("outputDirectory", request.command) }
        case .record:
            guard request.outputDirectory != nil else { throw missing("outputDirectory", request.command) }
            guard let duration = request.durationSeconds, duration.isFinite, (2 ... 30).contains(duration)
            else { throw PortholeAutomationError.invalidRequest("record requires durationSeconds between 2 and 30.") }
        case .wait, .assert:
            guard request.lifecycle != nil || request.minimumFrameCount != nil
            else { throw PortholeAutomationError.invalidRequest("wait/assert requires lifecycle or minimumFrameCount.") }
        case .batch:
            guard !nested else { throw PortholeAutomationError.invalidRequest("Nested batch commands are not allowed.") }
            guard let steps = request.steps, (1 ... maximumBatchSteps).contains(steps.count)
            else { throw PortholeAutomationError.invalidRequest("batch requires 1-64 steps.") }
            for step in steps { try validate(step, nested: true) }
        default: break
        }
    }

    private static func validateObjectKeys(_ object: [String: Any], nested: Bool) throws {
        guard Set(object.keys).isSubset(of: allowedKeys),
              let rawCommand = object["command"] as? String,
              let command = PortholeAutomationAction(rawValue: rawCommand) else {
            throw PortholeAutomationError.invalidRequest(
                "Control request contains an undocumented field or command."
            )
        }
        let fields: Set<String> = switch command {
        case .openPicker: ["sourceKind"]
        case .approve: ["reviewID", "scope", "capabilities"]
        case .select, .revoke: ["approvalID"]
        case .still: ["outputDirectory"]
        case .record: ["outputDirectory", "durationSeconds"]
        case .wait, .assert: ["lifecycle", "minimumFrameCount", "timeoutMilliseconds"]
        case .batch: ["steps"]
        default: []
        }
        guard Set(object.keys).isSubset(of: fields.union(["id", "command"])) else {
            throw PortholeAutomationError.invalidRequest(
                "Control command contains a field that does not belong to that action."
            )
        }
        guard let rawSteps = object["steps"] else { return }
        guard !nested, let steps = rawSteps as? [[String: Any]] else {
            throw PortholeAutomationError.invalidRequest("Nested or malformed batch steps are not allowed.")
        }
        for step in steps { try validateObjectKeys(step, nested: true) }
    }

    private static func missing(
        _ field: String,
        _ command: PortholeAutomationAction
    ) -> PortholeAutomationError {
        .invalidRequest("\(command.rawValue) requires \(field).")
    }
}

@MainActor
public protocol PortholeAutomationControlling: AnyObject {
    func automationStatus() -> PortholeAutomationStatus
    func automationPendingReview() -> PortholeAutomationPendingReview?
    func automationApprovedSources() -> [PortholeAutomationApprovedSource]
    func automationOpenPicker(_ sourceKind: ApprovedSourceKind) async
    func automationApprove(
        reviewID: String,
        scope: SourceApprovalScopeKind,
        capabilities: SourceCapabilities
    ) throws
    func automationCancelReview()
    func automationSelect(_ approvalID: String) async throws
    func automationRevoke(_ approvalID: String) async throws
    func automationStart() async throws
    func automationPause() async throws
    func automationResume() async throws
    func automationStop() async
    func automationWriteStill(to outputDirectory: URL) throws -> PortholeAutomationArtifactReceipt
    func automationStartRecording(to outputDirectory: URL, durationSeconds: Double) async throws
}

@MainActor
public final class PortholeAutomationCoordinator {
    private let controller: any PortholeAutomationControlling

    public init(controller: any PortholeAutomationControlling) {
        self.controller = controller
    }

    public func handle(_ request: PortholeAutomationRequest) async -> PortholeAutomationResponse {
        do {
            return try await handleChecked(request)
        } catch let error as PortholeAutomationError {
            return .failure(id: request.id, command: request.command.rawValue,
                            code: error.code, message: error.localizedDescription)
        } catch {
            return .failure(id: request.id, command: request.command.rawValue,
                            code: "operation-failed", message: error.localizedDescription)
        }
    }

    private func handleChecked(_ request: PortholeAutomationRequest) async throws -> PortholeAutomationResponse {
        switch request.command {
        case .ping:
            return .success(request, result: PortholeAutomationResult(message: "pong"))
        case .status:
            return .success(request, result: PortholeAutomationResult(status: controller.automationStatus()))
        case .openPicker:
            await controller.automationOpenPicker(try required(request.sourceKind, "sourceKind"))
            return .success(request, result: PortholeAutomationResult(
                message: "Apple's private picker was requested; the operator must choose the source."))
        case .pendingReview:
            return .success(request, result: PortholeAutomationResult(
                message: controller.automationPendingReview() == nil ? "No picker-selected source awaits review." : nil,
                pendingReview: controller.automationPendingReview()))
        case .approve:
            try controller.automationApprove(
                reviewID: try required(request.reviewID, "reviewID"),
                scope: try required(request.scope, "scope"),
                capabilities: try required(request.capabilities, "capabilities")
            )
            return .success(request, result: PortholeAutomationResult(
                message: "The picker-selected source was approved with exactly the requested scope and capabilities.",
                status: controller.automationStatus()))
        case .cancelReview:
            controller.automationCancelReview()
            return .success(request, result: PortholeAutomationResult(message: "Pending review canceled."))
        case .listApproved:
            return .success(request, result: PortholeAutomationResult(
                approvedSources: controller.automationApprovedSources()))
        case .select:
            try await controller.automationSelect(try required(request.approvalID, "approvalID"))
            return .success(request, result: PortholeAutomationResult(status: controller.automationStatus()))
        case .revoke:
            try await controller.automationRevoke(try required(request.approvalID, "approvalID"))
            return .success(request, result: PortholeAutomationResult(
                message: "Approval revoked; its active lease and local frames were retired.",
                status: controller.automationStatus()))
        case .start:
            try await controller.automationStart()
            return .success(request, result: PortholeAutomationResult(status: controller.automationStatus()))
        case .pause:
            try await controller.automationPause()
            return .success(request, result: PortholeAutomationResult(status: controller.automationStatus()))
        case .resume:
            try await controller.automationResume()
            return .success(request, result: PortholeAutomationResult(status: controller.automationStatus()))
        case .stop:
            await controller.automationStop()
            return .success(request, result: PortholeAutomationResult(status: controller.automationStatus()))
        case .still:
            let artifact = try controller.automationWriteStill(
                to: try outputURL(try required(request.outputDirectory, "outputDirectory")))
            return .success(request, result: PortholeAutomationResult(
                status: controller.automationStatus(), artifact: artifact))
        case .record:
            let duration = try required(request.durationSeconds, "durationSeconds")
            try await controller.automationStartRecording(
                to: try outputURL(try required(request.outputDirectory, "outputDirectory")),
                durationSeconds: duration
            )
            let status = try await wait(
                lifecycle: .stopped,
                minimumFrameCount: nil,
                timeoutMilliseconds: min(Int((duration + 8) * 1_000), PortholeAutomationProtocol.maximumWaitMilliseconds)
            )
            guard let artifact = status.artifact else {
                throw PortholeAutomationError.artifactFailed("Recording stopped without a proof receipt.")
            }
            return .success(request, result: PortholeAutomationResult(status: status, artifact: artifact))
        case .wait, .assert:
            let status = try await wait(
                lifecycle: request.lifecycle,
                minimumFrameCount: request.minimumFrameCount,
                timeoutMilliseconds: request.command == .assert ? (request.timeoutMilliseconds ?? 1) : (request.timeoutMilliseconds ?? 5_000)
            )
            return .success(request, result: PortholeAutomationResult(status: status))
        case .batch:
            var receipts: [PortholeAutomationResponse] = []
            for step in try required(request.steps, "steps") {
                let receipt = await handle(step)
                receipts.append(receipt)
                if !receipt.ok {
                    return .failure(
                        id: request.id,
                        command: request.command.rawValue,
                        code: "batch-aborted",
                        message: "Batch aborted after step \(receipts.count); inspect the ordered step receipts."
                    ).withSteps(receipts)
                }
            }
            return .success(request, result: PortholeAutomationResult(
                message: "Bounded batch completed in order.", steps: receipts))
        }
    }

    private func wait(
        lifecycle expectedLifecycle: CaptureLifecycle?,
        minimumFrameCount: Int?,
        timeoutMilliseconds: Int
    ) async throws -> PortholeAutomationStatus {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .milliseconds(timeoutMilliseconds))
        while true {
            let status = controller.automationStatus()
            let lifecycleMatches = expectedLifecycle.map { status.lifecycle == $0 } ?? true
            let framesMatch = minimumFrameCount.map { status.frameCount >= $0 } ?? true
            if lifecycleMatches && framesMatch { return status }
            if status.lifecycle == .failed {
                throw PortholeAutomationError.invalidState("Capture entered failed state before the assertion became true.")
            }
            guard clock.now < deadline else {
                throw PortholeAutomationError.timedOut("Lifecycle/frame assertion timed out without broadening source authority.")
            }
            try await Task.sleep(for: .milliseconds(25))
        }
    }

    private func required<T>(_ value: T?, _ name: String) throws -> T {
        guard let value else { throw PortholeAutomationError.invalidRequest("Missing \(name).") }
        return value
    }

    private func outputURL(_ path: String) throws -> URL {
        guard path.hasPrefix("/"), !path.contains("\0") else {
            throw PortholeAutomationError.unsafePath("Output directory must be an absolute local path.")
        }
        return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
    }
}

private extension PortholeAutomationResponse {
    func withSteps(_ steps: [PortholeAutomationResponse]) -> Self {
        Self(schema: schema, id: id, command: command, ok: ok,
             result: PortholeAutomationResult(steps: steps), error: error)
    }
}

public enum PortholeAutomationOutputDirectory {
    public static func createNew(_ directory: URL) throws {
        let path = directory.standardizedFileURL.path
        guard directory.isFileURL, path.hasPrefix("/"), path != "/" else {
            throw PortholeAutomationError.unsafePath("Output directory must be one absolute new directory.")
        }
        let parent = directory.deletingLastPathComponent().standardizedFileURL
        try validateExistingPath(parent, requireCurrentOwner: true, requireDirectory: true)
        var info = stat()
        if lstat(path, &info) == 0 {
            throw PortholeAutomationError.outputCollision("Output directory already exists; Porthole never overwrites artifacts.")
        }
        guard errno == ENOENT else {
            throw PortholeAutomationError.unsafePath("Output directory could not be inspected safely.")
        }
        guard mkdir(path, S_IRWXU) == 0 else {
            throw PortholeAutomationError.unsafePath("Output directory could not be created exclusively.")
        }
        try validateExistingPath(directory, requireCurrentOwner: true, requireDirectory: true)
        guard chmod(path, S_IRWXU) == 0 else {
            throw PortholeAutomationError.unsafePath("Output directory permissions could not be restricted to the owner.")
        }
    }

    static func validateExistingPath(
        _ url: URL,
        requireCurrentOwner: Bool,
        requireDirectory: Bool
    ) throws {
        let components = url.standardizedFileURL.pathComponents
        var current = "/"
        for component in components.dropFirst() {
            current = URL(fileURLWithPath: current, isDirectory: true)
                .appendingPathComponent(component).path
            var info = stat()
            guard lstat(current, &info) == 0 else {
                throw PortholeAutomationError.unsafePath("An output path ancestor does not exist.")
            }
            guard (info.st_mode & S_IFMT) != S_IFLNK else {
                throw PortholeAutomationError.unsafePath("Symlinks are not allowed in control or artifact paths.")
            }
        }
        var info = stat()
        guard lstat(url.path, &info) == 0 else {
            throw PortholeAutomationError.unsafePath("Path could not be inspected.")
        }
        if requireDirectory, (info.st_mode & S_IFMT) != S_IFDIR {
            throw PortholeAutomationError.unsafePath("Path must be a directory.")
        }
        if requireCurrentOwner, info.st_uid != getuid() {
            throw PortholeAutomationError.unsafePath("Path must be owned by the current user.")
        }
    }
}

public enum PortholeAutomationPersistencePolicy {
    public static func evaluate(
        approval: SourceApproval,
        sourceIsCurrent: Bool,
        assessment: PrivacyAssessment
    ) -> PersistenceGate {
        guard (try? SourceApprovalPolicy.validate(approval)) != nil,
              sourceIsCurrent,
              approval.scope == .exactWindow,
              approval.sourceKind == .window,
              approval.exactWindow != nil,
              approval.capabilities.persistRecording
        else {
            return PersistenceGate(
                allowed: false,
                label: "Persistence blocked",
                reason: "Saving requires a current exact-window approval with the persistence capability."
            )
        }
        guard assessment.status == .clear else {
            return PersistenceGate(
                allowed: false,
                label: "Persistence blocked",
                reason: assessment.status == .protected
                    ? "The approved window currently exposes a protected field."
                    : "Protected-field status is uncertain; no pixels may be saved."
            )
        }
        return PersistenceGate(
            allowed: true,
            label: "Exact-window proof approved",
            reason: "The operator's picker selection and explicit exact-window persistence capability remain current."
        )
    }
}

public enum PortholeAutomationArtifactWriter {
    public static func writeStill(
        image: NSImage,
        metadata: FrameMetadata,
        approval: SourceApproval,
        lease: CaptureLeaseIdentity,
        outputDirectory: URL
    ) throws -> PortholeAutomationArtifactReceipt {
        try PortholeAutomationOutputDirectory.createNew(outputDirectory)
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:])
        else { throw PortholeAutomationError.artifactFailed("The approved frame could not be encoded as PNG.") }
        let filename = "stage-source.png"
        try writeExclusive(png, to: outputDirectory.appendingPathComponent(filename))
        let receipt = PortholeAutomationArtifactReceipt(
            kind: "still",
            approvalID: approval.approvalID,
            captureLeaseID: lease.leaseID,
            sourceDisplayTitle: lease.displayTitle,
            sourceKind: lease.sourceKind,
            sourceWindowID: lease.sourceWindowID,
            artifactFilename: filename,
            artifactSHA256: SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined(),
            frameCount: 1,
            firstFrameMonotonicNanos: metadata.monotonicNanos,
            lastFrameMonotonicNanos: metadata.monotonicNanos,
            statement: "One exact picker-approved window frame; no desktop or unrelated source catalog was accessed."
        )
        try writeReceipt(receipt, to: outputDirectory)
        return receipt
    }

    public static func writeRecordingReceipt(
        outputDirectory: URL,
        approval: SourceApproval,
        lease: CaptureLeaseIdentity,
        firstFrame: FrameMetadata,
        lastFrame: FrameMetadata,
        frameCount: Int
    ) throws -> PortholeAutomationArtifactReceipt {
        let mediaURL = outputDirectory.appendingPathComponent("stage-source.mov")
        let mediaHash = try streamingSHA256(at: mediaURL)
        guard mediaHash.byteCount > 0, frameCount > 0 else {
            throw PortholeAutomationError.artifactFailed("Finite recording completed without durable frames.")
        }
        let receipt = PortholeAutomationArtifactReceipt(
            kind: "recording",
            approvalID: approval.approvalID,
            captureLeaseID: lease.leaseID,
            sourceDisplayTitle: lease.displayTitle,
            sourceKind: lease.sourceKind,
            sourceWindowID: lease.sourceWindowID,
            artifactFilename: mediaURL.lastPathComponent,
            artifactSHA256: mediaHash.digest,
            frameCount: frameCount,
            firstFrameMonotonicNanos: firstFrame.monotonicNanos,
            lastFrameMonotonicNanos: lastFrame.monotonicNanos,
            statement: "Finite exact picker-approved window recording; microphone and system audio are disabled."
        )
        try writeReceipt(receipt, to: outputDirectory)
        return receipt
    }

    static func streamingSHA256(at url: URL) throws -> (digest: String, byteCount: Int64) {
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else {
            throw PortholeAutomationError.artifactFailed("Recording could not be opened without following links.")
        }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              (info.st_mode & S_IFMT) == S_IFREG,
              info.st_uid == getuid() else {
            throw PortholeAutomationError.artifactFailed("Recording is not an owner-controlled regular file.")
        }
        var hasher = SHA256()
        var total: Int64 = 0
        var buffer = [UInt8](repeating: 0, count: 1_048_576)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw PortholeAutomationError.artifactFailed("Recording could not be hashed completely.")
            }
            hasher.update(data: Data(buffer[..<count]))
            total += Int64(count)
        }
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        return (digest, total)
    }

    private static func writeReceipt(
        _ receipt: PortholeAutomationArtifactReceipt,
        to outputDirectory: URL
    ) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try writeExclusive(try encoder.encode(receipt),
                           to: outputDirectory.appendingPathComponent("receipt.json"))
    }

    private static func writeExclusive(_ data: Data, to url: URL) throws {
        let descriptor = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else {
            if errno == EEXIST { throw PortholeAutomationError.outputCollision("Artifact already exists; overwrite refused.") }
            throw PortholeAutomationError.unsafePath("Artifact destination could not be opened safely.")
        }
        defer { close(descriptor) }
        var written = 0
        let success = data.withUnsafeBytes { bytes -> Bool in
            guard let base = bytes.baseAddress else { return data.isEmpty }
            while written < data.count {
                let count = Darwin.write(descriptor, base.advanced(by: written), data.count - written)
                if count <= 0 { return false }
                written += count
            }
            return true
        }
        guard success, fsync(descriptor) == 0 else {
            throw PortholeAutomationError.artifactFailed("Artifact write did not complete durably.")
        }
    }
}

public enum PortholeAutomationSocketPath {
    public static func defaultURL(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        homeDirectory
            .appendingPathComponent("Library/Application Support/Porthole", isDirectory: true)
            .appendingPathComponent("control.sock", isDirectory: false)
    }

    public static func parse(arguments: [String], homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> URL {
        let indices = arguments.indices.filter { arguments[$0] == "--control-socket" }
        guard indices.count <= 1 else {
            throw PortholeAutomationError.invalidRequest("--control-socket may be supplied only once.")
        }
        guard let index = indices.first else { return defaultURL(homeDirectory: homeDirectory) }
        guard arguments.indices.contains(index + 1), !arguments[index + 1].hasPrefix("--"),
              arguments[index + 1].hasPrefix("/") else {
            throw PortholeAutomationError.invalidRequest("--control-socket requires one absolute path.")
        }
        return URL(fileURLWithPath: arguments[index + 1]).standardizedFileURL
    }
}

public enum PortholeAutomationSocketError: Error, Equatable, LocalizedError {
    case unsafePath(String)
    case alreadyRunning
    case systemCall(String)

    public var errorDescription: String? {
        switch self {
        case let .unsafePath(message): return message
        case .alreadyRunning: return "Another Porthole process already owns the control socket."
        case let .systemCall(name): return "Porthole control socket failed during \(name)."
        }
    }
}

public final class PortholeAutomationServer: @unchecked Sendable {
    public typealias Handler = @Sendable (PortholeAutomationRequest) async -> PortholeAutomationResponse

    private let socketURL: URL
    private let handler: Handler
    private let queue = DispatchQueue(label: "dev.portdaddy.porthole.local-control", qos: .userInitiated)
    private let stateLock = NSLock()
    private var listeningDescriptor: Int32 = -1
    private var socketIdentity: (device: dev_t, inode: ino_t)?
    private var stopped = false

    public init(socketURL: URL, handler: @escaping Handler) {
        self.socketURL = socketURL.standardizedFileURL
        self.handler = handler
    }

    deinit { stop() }

    public func start() throws {
        let path = socketURL.path
        guard path.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
            throw PortholeAutomationSocketError.unsafePath("Control socket path is too long for a Unix-domain socket.")
        }
        try Self.prepareParent(socketURL.deletingLastPathComponent())
        try Self.retireStaleSocketIfSafe(path)

        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw PortholeAutomationSocketError.systemCall("socket") }
        do {
            var noSignal: Int32 = 1
            guard setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal,
                             socklen_t(MemoryLayout<Int32>.size)) == 0 else {
                throw PortholeAutomationSocketError.systemCall("setsockopt")
            }
            var address = try Self.address(path)
            let bound = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard bound == 0 else { throw PortholeAutomationSocketError.systemCall("bind") }
            guard chmod(path, S_IRUSR | S_IWUSR) == 0 else {
                throw PortholeAutomationSocketError.systemCall("chmod")
            }
            var info = stat()
            guard lstat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFSOCK,
                  info.st_uid == getuid(), (info.st_mode & 0o777) == 0o600 else {
                throw PortholeAutomationSocketError.unsafePath("Control socket ownership or permissions are unsafe.")
            }
            guard listen(descriptor, 4) == 0 else {
                throw PortholeAutomationSocketError.systemCall("listen")
            }
            stateLock.withLock {
                listeningDescriptor = descriptor
                socketIdentity = (info.st_dev, info.st_ino)
                stopped = false
            }
            queue.async { [weak self] in self?.acceptLoop(descriptor: descriptor) }
        } catch {
            Darwin.close(descriptor)
            var info = stat()
            if lstat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFSOCK, info.st_uid == getuid() {
                _ = unlink(path)
            }
            throw error
        }
    }

    public func stop() {
        let descriptor = stateLock.withLock { () -> Int32 in
            guard !stopped else { return -1 }
            stopped = true
            defer { listeningDescriptor = -1 }
            return listeningDescriptor
        }
        if descriptor >= 0 {
            _ = shutdown(descriptor, SHUT_RDWR)
            Darwin.close(descriptor)
        }
        let identity = stateLock.withLock { socketIdentity }
        var info = stat()
        if let identity, lstat(socketURL.path, &info) == 0,
           info.st_dev == identity.device, info.st_ino == identity.inode,
           (info.st_mode & S_IFMT) == S_IFSOCK, info.st_uid == getuid() {
            _ = unlink(socketURL.path)
        }
    }

    private func acceptLoop(descriptor: Int32) {
        while !stateLock.withLock({ stopped }) {
            let client = Darwin.accept(descriptor, nil, nil)
            if client < 0 {
                if errno == EINTR { continue }
                return
            }
            handle(client: client)
            Darwin.close(client)
        }
    }

    private func handle(client: Int32) {
        var noSignal: Int32 = 1
        _ = setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSignal,
                       socklen_t(MemoryLayout<Int32>.size))
        var timeout = timeval(tv_sec: 10, tv_usec: 0)
        _ = setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout,
                       socklen_t(MemoryLayout<timeval>.size))
        _ = setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout,
                       socklen_t(MemoryLayout<timeval>.size))
        for _ in 0 ..< PortholeAutomationProtocol.maximumCommandsPerConnection {
            let line: Data
            do {
                guard let next = try Self.readLine(client) else { return }
                line = next
            } catch {
                send(.failure(id: "unknown", command: "unknown", code: "invalid-request",
                              message: "Control line exceeded its bound or could not be read."), to: client)
                return
            }
            let request: PortholeAutomationRequest
            do { request = try PortholeAutomationProtocol.decode(line) }
            catch let error as PortholeAutomationError {
                send(.failure(id: "unknown", command: "unknown", code: error.code,
                              message: error.localizedDescription), to: client)
                continue
            } catch {
                send(.failure(id: "unknown", command: "unknown", code: "invalid-request",
                              message: "Control request was rejected."), to: client)
                continue
            }
            let box = AutomationResponseBox()
            let semaphore = DispatchSemaphore(value: 0)
            let task = Task { [handler] in
                box.set(await handler(request))
                semaphore.signal()
            }
            if semaphore.wait(timeout: .now() + .seconds(40)) == .timedOut {
                task.cancel()
                send(.failure(id: request.id, command: request.command.rawValue, code: "timed-out",
                              message: "Control command exceeded the server deadline."), to: client)
            } else if let response = box.get() {
                send(response, to: client)
            }
        }
        send(.failure(id: "unknown", command: "unknown", code: "connection-limit",
                      message: "Connection command limit reached; reconnect."), to: client)
    }

    private func send(_ response: PortholeAutomationResponse, to client: Int32) {
        let data: Data
        do {
            data = try PortholeAutomationProtocol.encode(response)
        } catch {
            let boundedFailure = PortholeAutomationResponse.failure(
                id: response.id,
                command: response.command,
                code: "response-too-large",
                message: "Control response exceeded 65536 bytes; narrow the approved-source projection or split the scenario."
            )
            guard let encodedFailure = try? PortholeAutomationProtocol.encode(boundedFailure) else { return }
            data = encodedFailure
        }
        var sent = 0
        data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return }
            while sent < data.count {
                let count = Darwin.send(client, base.advanced(by: sent), data.count - sent, 0)
                if count <= 0 { return }
                sent += count
            }
        }
    }

    private static func readLine(_ descriptor: Int32) throws -> Data? {
        var data = Data()
        var byte: UInt8 = 0
        while data.count <= PortholeAutomationProtocol.maximumLineBytes {
            let count = Darwin.recv(descriptor, &byte, 1, 0)
            if count == 0 { return data.isEmpty ? nil : data }
            if count < 0 {
                if errno == EINTR { continue }
                throw PortholeAutomationSocketError.systemCall("read")
            }
            if byte == 0x0a {
                if data.last == 0x0d { data.removeLast() }
                return data
            }
            data.append(byte)
        }
        throw PortholeAutomationError.invalidRequest("Control line exceeded 32768 bytes.")
    }

    private static func prepareParent(_ parent: URL) throws {
        if !FileManager.default.fileExists(atPath: parent.path) {
            let grandparent = parent.deletingLastPathComponent()
            try PortholeAutomationOutputDirectory.validateExistingPath(
                grandparent, requireCurrentOwner: true, requireDirectory: true)
            guard mkdir(parent.path, S_IRWXU) == 0 else {
                throw PortholeAutomationSocketError.systemCall("mkdir")
            }
        }
        do {
            try PortholeAutomationOutputDirectory.validateExistingPath(
                parent, requireCurrentOwner: true, requireDirectory: true)
        } catch {
            throw PortholeAutomationSocketError.unsafePath(error.localizedDescription)
        }
        guard chmod(parent.path, S_IRWXU) == 0 else {
            throw PortholeAutomationSocketError.systemCall("chmod")
        }
    }

    private static func retireStaleSocketIfSafe(_ path: String) throws {
        var info = stat()
        guard lstat(path, &info) == 0 else {
            if errno == ENOENT { return }
            throw PortholeAutomationSocketError.systemCall("lstat")
        }
        guard (info.st_mode & S_IFMT) == S_IFSOCK, info.st_uid == getuid() else {
            throw PortholeAutomationSocketError.unsafePath(
                "Existing control path is not an owner-owned socket; it was not removed.")
        }
        let probe = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard probe >= 0 else { throw PortholeAutomationSocketError.systemCall("socket") }
        defer { Darwin.close(probe) }
        var address = try address(path)
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(probe, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if result == 0 { throw PortholeAutomationSocketError.alreadyRunning }
        guard errno == ECONNREFUSED || errno == ENOENT else {
            throw PortholeAutomationSocketError.unsafePath(
                "Existing socket liveness was ambiguous; it was not removed.")
        }
        var current = stat()
        guard lstat(path, &current) == 0,
              current.st_dev == info.st_dev,
              current.st_ino == info.st_ino,
              current.st_uid == getuid(),
              (current.st_mode & S_IFMT) == S_IFSOCK else {
            throw PortholeAutomationSocketError.unsafePath(
                "Existing socket changed during stale cleanup; it was not removed."
            )
        }
        guard unlink(path) == 0 else { throw PortholeAutomationSocketError.systemCall("unlink") }
    }

    private static func address(_ path: String) throws -> sockaddr_un {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathCapacity = MemoryLayout.size(ofValue: address.sun_path)
        let copied = path.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) {
                $0.withMemoryRebound(to: CChar.self, capacity: pathCapacity) {
                    strlcpy($0, source, pathCapacity)
                }
            }
        }
        guard copied < pathCapacity else {
            throw PortholeAutomationSocketError.unsafePath("Control socket path is too long.")
        }
        return address
    }
}

private final class AutomationResponseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: PortholeAutomationResponse?

    func set(_ value: PortholeAutomationResponse) { lock.withLock { self.value = value } }
    func get() -> PortholeAutomationResponse? { lock.withLock { value } }
}
