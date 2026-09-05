import AppKit
import AVFoundation
import CryptoKit
import PortholeStageCore
import SwiftUI

/// An explicitly synthetic, non-interactive presentation. These values never
/// enter StageCaptureController or its approval ledger, filters, or Keychain.
@MainActor
private final class SyntheticStageModel: StagePresentationModel {
    let approvedSources: [SourceApproval]
    let selectedApprovalID: String? = "synthetic-approval"
    let pendingApprovalReview: ApprovalReview? = nil
    let lifecycle: CaptureLifecycle = .live
    let persistenceGate = PersistenceGate(allowed: false, label: "Synthetic presentation",
        reason: "Generated UI only. No source was selected, shared, or recorded.")
    let activeCaptureLease: CaptureLeaseIdentity? = CaptureLeaseIdentity(leaseID: "synthetic-lease",
        approvalID: "synthetic-approval", displayTitle: "Motion Lab · synthetic source", sourceKind: .window, sourceWindowID: 77)
    let latestImage: NSImage?
    let latestMetadata: FrameMetadata?
    let frameRingCount = 3
    let cursors: [CursorEvent]
    let proofReceipt: PortholeProofReceipt? = nil
    let proofConfiguration: ProofConfiguration? = nil
    let statusMessage = "Synthetic UI proof · no capture or transport exercised"
    let selectedApprovalCanEnterStage = false
    let canPauseCapture = false

    init(frame: Int, image: CGImage) {
        let program = SignedProgramIdentity(bundleIdentifier: "invalid.synthetic.motion-lab",
            designatedRequirement: "synthetic presentation only", executableSHA256: String(repeating: "0", count: 64))
        let instance = RunningApplicationIdentity(program: program, processID: 0, launchIdentity: "synthetic-only")
        approvedSources = [SourceApproval(approvalID: "synthetic-approval", scope: .exactWindow,
            sourceKind: .window, displayTitle: "Motion Lab · synthetic source", capabilities: .previewOnly,
            program: program, runningInstance: instance, exactWindow: ExactWindowIdentity(application: instance, windowID: 77),
            createdAtMonotonicNanos: 1)]
        latestImage = NSImage(cgImage: image, size: NSSize(width: 720, height: 460))
        latestMetadata = FrameMetadata(sequence: UInt64(frame + 1), monotonicNanos: UInt64(frame + 1) * 41_666_667,
            captureLeaseID: "synthetic-lease", sourceApprovalID: "synthetic-approval",
            sourceDisplayTitle: "Motion Lab · synthetic source", sourceKind: .window, sourceWindowID: 77,
            sourceWidthPoints: 720, sourceHeightPoints: 460, pixelWidth: 720, pixelHeight: 460, contentScale: 1,
            runtime: RuntimeMetadata(processID: 0, operatingSystem: "synthetic-renderer", appVersion: "synthetic",
                audioCaptureEnabled: false, microphoneCaptureEnabled: false, physicalCursorIncludedInSourcePixels: false,
                mouseClickIndicatorsEnabled: false, frameRingCapacity: 3))
        let phase = Double(frame) / 24
        cursors = [
            CursorEvent(captureLeaseID: "synthetic-lease", participantID: "synthetic-person", kind: .human,
                displayName: "Person · synthetic", colorHex: "#F5CA5C", normalizedX: 0.22 + 0.11 * sin(phase * 2),
                normalizedY: 0.48 + 0.12 * cos(phase), sequence: UInt64(frame + 1), monotonicNanos: UInt64(frame + 1)),
            CursorEvent(captureLeaseID: "synthetic-lease", participantID: "synthetic-agent", kind: .agent,
                displayName: "Agent · synthetic", colorHex: "#65D8FF", normalizedX: 0.65 + 0.10 * cos(phase * 2),
                normalizedY: 0.64 + 0.08 * sin(phase), sequence: UInt64(frame + 1), monotonicNanos: UInt64(frame + 1)),
        ]
    }
    func isApprovalReady(_ approvalID: String) -> Bool { false }
    func cancelPendingApproval() {}
    func approvePending(scope: SourceApprovalScopeKind, capabilities: SourceCapabilities) {}
    func selectApproval(_ approvalID: String) async {}
    func revokeApproval(_ approvalID: String) async {}
    func presentSystemPicker(for sourceKind: ApprovedSourceKind) async {}
    func startCapture() async {}
    func pauseCapture() async {}
    func stopCapture() async {}
}

private struct SyntheticMotionBoard: View {
    let frame: Int
    var body: some View {
        let phase = Double(frame) / 24
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Image(systemName: "safari").font(.system(size: 30, weight: .light)).foregroundStyle(.mint)
                VStack(alignment: .leading, spacing: 5) {
                    Text("MOTION LAB").font(.system(size: 12, weight: .bold, design: .monospaced)).tracking(2)
                    Text("A shared point of view").font(.system(size: 28, weight: .semibold, design: .rounded))
                }
                Spacer()
                Text(String(format: "%04.1fs", phase)).font(.system(size: 18, weight: .medium, design: .monospaced))
            }
            Text("Generated shapes, comments, and pointers. No desktop pixels.")
                .font(.system(size: 15)).foregroundStyle(.secondary)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 20).fill(.white.opacity(0.04))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.14)))
                RoundedRectangle(cornerRadius: 12).stroke(.cyan.opacity(0.7), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                    .frame(width: 180, height: 108).offset(x: 356)
                Circle().fill(LinearGradient(colors: [.yellow, .orange, .pink], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 88, height: 88).offset(x: 42 + 210 * (sin(phase * 2) * 0.5 + 0.5))
            }.frame(height: 166)
            Label(frame < 36 ? "What happens if we move this?" : "Yes — that motion is easy to follow.", systemImage: "text.bubble")
                .font(.system(size: 16, weight: .medium)).padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 10))
            HStack(spacing: 18) {
                Label("Synthetic only", systemImage: "sparkle")
                Label("Audio off", systemImage: "speaker.slash")
                Label("No capture", systemImage: "rectangle.slash")
            }.font(.system(size: 12)).foregroundStyle(.secondary)
        }
        .padding(32).frame(width: 720, height: 460)
        .foregroundStyle(.white)
        .background(LinearGradient(colors: [Color(red: 0.05, green: 0.11, blue: 0.16),
            Color(red: 0.12, green: 0.07, blue: 0.19)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .environment(\.colorScheme, .dark)
    }
}

enum SyntheticStageProofError: Error { case invalidArguments, outputExists, renderFailed, writerFailed }

/// Exclusive retirement: only constructed after all append calls have ended.
/// AVAssetWriter cancellation may block and must not hold the main actor.
private final class RetiredSyntheticWriter: @unchecked Sendable {
    let writer: AVAssetWriter
    init(_ writer: AVAssetWriter) { self.writer = writer }
    func cancel() { writer.cancelWriting() }
}

@MainActor
enum SyntheticStageProof {
    static func output(arguments: [String]) throws -> URL? {
        guard arguments.contains("--render-synthetic-proof") else { return nil }
        guard arguments.count == 3, arguments[1] == "--render-synthetic-proof", !arguments[2].hasPrefix("--")
        else { throw SyntheticStageProofError.invalidArguments }
        return URL(fileURLWithPath: arguments[2], isDirectory: true)
    }

    static func render(to directory: URL) async throws {
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw SyntheticStageProofError.outputExists }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var files: [[String: Any]] = []
        for (name, scheme): (String, ColorScheme) in [("dark", .dark), ("light", .light)] {
            NSApp.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            let movie = directory.appendingPathComponent("stage-\(name)-synthetic.mov")
            let writer = try AVAssetWriter(outputURL: movie, fileType: .mov)
            defer {
                if writer.status != .completed {
                    let retired = RetiredSyntheticWriter(writer)
                    DispatchQueue.global(qos: .utility).async { retired.cancel() }
                }
            }
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: 1320, AVVideoHeightKey: 830])
            let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                kCVPixelBufferWidthKey as String: 1320, kCVPixelBufferHeightKey as String: 830])
            guard writer.canAdd(input) else { throw SyntheticStageProofError.writerFailed }
            writer.add(input)
            guard writer.startWriting() else { throw SyntheticStageProofError.writerFailed }
            writer.startSession(atSourceTime: .zero)
            for frame in 0..<72 {
                let board = try image(SyntheticMotionBoard(frame: frame), width: 720, height: 460)
                let model = SyntheticStageModel(frame: frame, image: board)
                let root = VStack(spacing: 0) {
                    Text("SYNTHETIC UI PROOF  ·  no source selected or captured  ·  \(name.uppercased())")
                        .font(.system(size: 12, weight: .bold, design: .monospaced)).tracking(0.4)
                        .foregroundStyle(scheme == .dark ? Color.yellow : Color.black)
                        .frame(maxWidth: .infinity).frame(height: 38).background(.yellow.opacity(0.16))
                    StageView(controller: model)
                }.frame(width: 1320, height: 830).environment(\.colorScheme, scheme)
                    .background(scheme == .dark ? Color(red: 0.035, green: 0.043, blue: 0.055) : Color.white)
                    .allowsHitTesting(false)
                let rendered = try image(root, width: 1320, height: 830)
                if frame == 12 || frame == 60 {
                    let url = directory.appendingPathComponent("stage-\(name)-\(frame).png")
                    let rep = NSBitmapImageRep(cgImage: rendered)
                    guard let png = rep.representation(using: .png, properties: [:]) else { throw SyntheticStageProofError.renderFailed }
                    try png.write(to: url, options: .withoutOverwriting)
                    var pngRecord = try record(url)
                    pngRecord["pixelWidth"] = rendered.width
                    pngRecord["pixelHeight"] = rendered.height
                    pngRecord["pixelsPerPoint"] = 1
                    files.append(pngRecord)
                }
                let waitUntil = ContinuousClock.now.advanced(by: .seconds(5))
                while !input.isReadyForMoreMediaData {
                    guard ContinuousClock.now < waitUntil, writer.status == .writing else { throw SyntheticStageProofError.writerFailed }
                    try await Task.sleep(for: .milliseconds(5))
                }
                var buffer: CVPixelBuffer?
                guard let pool = adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
                      let buffer else { throw SyntheticStageProofError.writerFailed }
                CVPixelBufferLockBaseAddress(buffer, [])
                guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: 1320, height: 830,
                    bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { throw SyntheticStageProofError.renderFailed }
                context.draw(rendered, in: CGRect(x: 0, y: 0, width: 1320, height: 830))
                CVPixelBufferUnlockBaseAddress(buffer, [])
                guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 24))
                else { throw SyntheticStageProofError.writerFailed }
            }
            input.markAsFinished()
            writer.finishWriting {}
            let finishUntil = ContinuousClock.now.advanced(by: .seconds(5))
            while writer.status == .writing {
                guard ContinuousClock.now < finishUntil else { throw SyntheticStageProofError.writerFailed }
                try await Task.sleep(for: .milliseconds(10))
            }
            guard writer.status == .completed else { throw SyntheticStageProofError.writerFailed }
            var movieRecord = try record(movie)
            movieRecord["decodedVideoFrames"] = try await verifyMovie(movie)
            movieRecord["pixelWidth"] = 1320
            movieRecord["pixelHeight"] = 830
            movieRecord["pixelsPerPoint"] = 1
            files.append(movieRecord)
        }
        let manifest: [String: Any] = ["schema": "pd.porthole.synthetic-ui-proof.v1", "source": "StageView + synthetic presentation model",
            "capturePerformed": false, "operatorDataRead": false, "permissionProof": false, "backgroundCaptureProof": false,
            "cursorTransportProof": false, "productionDistribution": false,
            "logicalSizePoints": ["width": 1320, "height": 830],
            "framesPerAppearance": 72, "framesPerSecond": 24, "appearances": ["dark", "light"], "files": files]
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("synthetic-ui-manifest.json"), options: .withoutOverwriting)
    }

    private static func image<V: View>(_ view: V, width: Int, height: Int) throws -> CGImage {
        let host = NSHostingView(rootView: view.frame(width: CGFloat(width), height: CGFloat(height)))
        host.frame = NSRect(x: 0, y: 0, width: width, height: height)
        host.layoutSubtreeIfNeeded()
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32) else {
            throw SyntheticStageProofError.renderFailed
        }
        bitmap.size = host.bounds.size
        host.cacheDisplay(in: host.bounds, to: bitmap)
        guard let image = bitmap.cgImage else { throw SyntheticStageProofError.renderFailed }
        return image
    }

    private static func record(_ url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        return ["filename": url.lastPathComponent, "bytes": data.count,
            "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()]
    }

    private static func verifyMovie(_ url: URL) async throws -> Int {
        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        guard tracks.count == 1, audio.isEmpty else { throw SyntheticStageProofError.writerFailed }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: tracks[0], outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        reader.add(output)
        guard reader.startReading() else { throw SyntheticStageProofError.writerFailed }
        var frames = 0
        while let sample = output.copyNextSampleBuffer() {
            guard let image = CMSampleBufferGetImageBuffer(sample),
                  CVPixelBufferGetWidth(image) == 1320, CVPixelBufferGetHeight(image) == 830
            else { throw SyntheticStageProofError.writerFailed }
            frames += 1
        }
        guard reader.status == .completed, frames == 72 else { throw SyntheticStageProofError.writerFailed }
        return frames
    }
}
