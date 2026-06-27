// recorder.swift — ScreenCaptureKit window/display video recorder for pd-console PR proof.
//
// Captures a SINGLE window (by CGWindowID) or a whole display to an .mov, cropped to
// the target, using ScreenCaptureKit's independent-window compositing. Because it
// targets the window's own backing store, it records only pd-console — never the
// operator's other windows — and works even when the window lives on an off-screen
// virtual display. No Accessibility permission is needed; Screen Recording permission
// IS (granted to the process that runs this, e.g. Terminal).
//
// Build:  swiftc -O scripts/proof/recorder.swift -o target/proof/recorder
// Usage:  recorder --window-id <id> --out <file.mov> [--duration 10] [--fps 30]
//         recorder --display-id <CGDirectDisplayID> --out <file.mov> [--duration 10]
//
// Exit codes: 0 ok · 2 bad args · 3 target not found · 4 capture/permission error.

import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

// ── CLI parsing ────────────────────────────────────────────────────────────────
func argValue(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}
func fail(_ msg: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(("recorder: " + msg + "\n").data(using: .utf8)!)
    exit(code)
}

let rawWindowId = argValue("--window-id")
let rawDisplayId = argValue("--display-id")
let windowIdArg = rawWindowId.flatMap { UInt32($0) }
let displayIdArg = rawDisplayId.flatMap { UInt32($0) }
guard let outPath = argValue("--out") else { fail("missing --out <file.mov>", 2) }
let duration = Double(argValue("--duration") ?? "10") ?? 10
let fps = Int(argValue("--fps") ?? "30") ?? 30
if rawWindowId != nil && windowIdArg == nil {
    fail("--window-id must be numeric", 2)
}
if rawDisplayId != nil && displayIdArg == nil {
    fail("--display-id must be numeric", 2)
}
if windowIdArg == nil && displayIdArg == nil {
    fail("need --window-id <id> or --display-id <id>", 2)
}
if windowIdArg != nil && displayIdArg != nil {
    fail("choose exactly one of --window-id or --display-id", 2)
}

let outURL = URL(fileURLWithPath: outPath)
do {
    if FileManager.default.fileExists(atPath: outURL.path) {
        try FileManager.default.removeItem(at: outURL)
    }
    try FileManager.default.createDirectory(
        at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
} catch {
    fail("preparing output path: \(error.localizedDescription)", 4)
}

// ── Recorder: SCStream → AVAssetWriter ───────────────────────────────────────────
@available(macOS 12.3, *)
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let queue = DispatchQueue(label: "dev.portdaddy.recorder")
    private var started = false
    private var frames = 0
    let finished = DispatchSemaphore(value: 0)

    init(outURL: URL, width: Int, height: Int) throws {
        writer = try AVAssetWriter(outputURL: outURL, fileType: .mov)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: width * height * 8,
            ],
        ]
        input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        writer.add(input)
        super.init()
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen, sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer)
        else { return }
        // Only append frames the compositor marked complete (skip idle/blank frames).
        guard
            let attach = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
            let rawStatus = attach.first?[.status] as? Int,
            let status = SCFrameStatus(rawValue: rawStatus), status == .complete
        else { return }

        if writer.status == .unknown {
            writer.startWriting()
            writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
            started = true
        }
        guard writer.status == .writing, input.isReadyForMoreMediaData else { return }
        input.append(sampleBuffer)
        frames += 1
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(
            "recorder: stream stopped: \(error.localizedDescription)\n".data(using: .utf8)!)
    }

    func finish() {
        guard started else {
            FileHandle.standardError.write(
                "recorder: no frames captured (window not rendering / permission denied?)\n"
                    .data(using: .utf8)!)
            finished.signal()
            return
        }
        input.markAsFinished()
        writer.finishWriting {
            FileHandle.standardError.write(
                "recorder: wrote \(self.frames) frames → \(outURL.path)\n".data(using: .utf8)!)
            self.finished.signal()
        }
    }
}

guard #available(macOS 12.3, *) else { fail("requires macOS 12.3+", 4) }

// ── Resolve target via SCShareableContent ────────────────────────────────────────
let ready = DispatchSemaphore(value: 0)
var filter: SCContentFilter?
var pxWidth = 0
var pxHeight = 0

SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) {
    content, err in
    defer { ready.signal() }
    guard let content = content else {
        fail("getShareableContent failed: \(err?.localizedDescription ?? "unknown")", 4)
    }

    if let wid = windowIdArg {
        guard let win = content.windows.first(where: { $0.windowID == wid }) else {
            fail("window id \(wid) not found among \(content.windows.count) windows", 3)
        }
        // Pixel scale = backing scale of the display the window sits on (retina = 2).
        guard let display = content.displays.first(where: { $0.frame.intersects(win.frame) }) else {
            fail("window id \(wid) does not intersect any captured display", 3)
        }
        let scale = Double(display.width) / Double(display.frame.width)
        pxWidth = Int((win.frame.width * scale).rounded())
        pxHeight = Int((win.frame.height * scale).rounded())
        filter = SCContentFilter(desktopIndependentWindow: win)
    } else if let did = displayIdArg {
        guard let disp = content.displays.first(where: { $0.displayID == did }) else {
            fail("display id \(did) not found among \(content.displays.count) displays", 3)
        }
        pxWidth = disp.width
        pxHeight = disp.height
        filter = SCContentFilter(display: disp, excludingWindows: [])
    }
}
if ready.wait(timeout: .now() + 30) == .timedOut {
    fail("timed out while enumerating ScreenCaptureKit content", 4)
}

guard let filter = filter, pxWidth > 0, pxHeight > 0 else { fail("could not build filter", 3) }

let config = SCStreamConfiguration()
config.width = pxWidth
config.height = pxHeight
config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
config.queueDepth = 6
config.showsCursor = false
config.pixelFormat = kCVPixelFormatType_32BGRA

do {
    let rec = try Recorder(outURL: outURL, width: pxWidth, height: pxHeight)
    let stream = SCStream(filter: filter, configuration: config, delegate: rec)
    try stream.addStreamOutput(
        rec, type: .screen, sampleHandlerQueue: DispatchQueue(label: "dev.portdaddy.sck"))

    let startErr = DispatchSemaphore(value: 0)
    var startFailure: Error?
    stream.startCapture { err in
        startFailure = err
        startErr.signal()
    }
    if startErr.wait(timeout: .now() + 10) == .timedOut {
        fail("startCapture timed out", 4)
    }
    if let e = startFailure { fail("startCapture: \(e.localizedDescription)", 4) }

    FileHandle.standardError.write(
        "recorder: capturing \(pxWidth)x\(pxHeight) @ \(fps)fps for \(duration)s…\n"
            .data(using: .utf8)!)
    Thread.sleep(forTimeInterval: duration)

    let stopErr = DispatchSemaphore(value: 0)
    stream.stopCapture { _ in stopErr.signal() }
    if stopErr.wait(timeout: .now() + 10) == .timedOut {
        fail("stopCapture timed out", 4)
    }
    rec.finish()
    if rec.finished.wait(timeout: .now() + 10) == .timedOut {
        fail("finishWriting timed out", 4)
    }
    exit(0)
} catch {
    fail("recording error: \(error.localizedDescription)", 4)
}
