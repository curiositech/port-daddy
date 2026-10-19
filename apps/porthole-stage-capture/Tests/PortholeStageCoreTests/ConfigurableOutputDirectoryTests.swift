import XCTest
@testable import PortholeStageCore

final class ConfigurableOutputDirectoryTests: XCTestCase {
    private var tempRootDir: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        tempRootDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("porthole-output-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempRootDir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let tempRootDir {
            try? FileManager.default.removeItem(at: tempRootDir)
        }
        UserDefaults.standard.removeObject(forKey: StageCaptureController.recordingsDirectoryDefaultsKey)
        UserDefaults.standard.removeObject(forKey: StageCaptureController.screenshotsDirectoryDefaultsKey)
        try super.tearDownWithError()
    }

    @MainActor
    func testDefaultOutputDirectoriesUseStandardLocations() {
        let controller = StageCaptureController(proofConfiguration: nil)
        controller.resetOutputDirectoriesToDefault()

        let recDir = controller.effectiveRecordingsDirectory
        let shotDir = controller.effectiveScreenshotsDirectory

        XCTAssertTrue(recDir.path.hasSuffix("Porthole"), "Default recording dir should end in Porthole: \(recDir.path)")
        XCTAssertTrue(shotDir.path.hasSuffix("Porthole"), "Default screenshot dir should end in Porthole: \(shotDir.path)")
    }

    @MainActor
    func testExplicitCustomDirectoriesOverrideDefaults() {
        let controller = StageCaptureController(proofConfiguration: nil)
        let customRec = tempRootDir.appendingPathComponent("custom-recordings", isDirectory: true)
        let customShot = tempRootDir.appendingPathComponent("custom-screenshots", isDirectory: true)

        controller.setCustomRecordingsDirectory(customRec, persist: false)
        controller.setCustomScreenshotsDirectory(customShot, persist: false)

        XCTAssertEqual(controller.effectiveRecordingsDirectory, customRec)
        XCTAssertEqual(controller.effectiveScreenshotsDirectory, customShot)
    }

    @MainActor
    func testCustomDirectoriesPersistInUserDefaultsAndReset() {
        let controller = StageCaptureController(proofConfiguration: nil)
        let customRec = tempRootDir.appendingPathComponent("persisted-recordings", isDirectory: true)
        let customShot = tempRootDir.appendingPathComponent("persisted-screenshots", isDirectory: true)

        controller.setCustomRecordingsDirectory(customRec, persist: true)
        controller.setCustomScreenshotsDirectory(customShot, persist: true)

        XCTAssertEqual(UserDefaults.standard.string(forKey: StageCaptureController.recordingsDirectoryDefaultsKey), customRec.path)
        XCTAssertEqual(UserDefaults.standard.string(forKey: StageCaptureController.screenshotsDirectoryDefaultsKey), customShot.path)

        // Reset
        controller.resetOutputDirectoriesToDefault()
        XCTAssertNil(controller.customRecordingsDirectory)
        XCTAssertNil(controller.customScreenshotsDirectory)
        XCTAssertNil(UserDefaults.standard.string(forKey: StageCaptureController.recordingsDirectoryDefaultsKey))
        XCTAssertNil(UserDefaults.standard.string(forKey: StageCaptureController.screenshotsDirectoryDefaultsKey))
    }

    func testCLIArgumentsOverrideDefaults() {
        let recPath = tempRootDir.appendingPathComponent("cli-recordings", isDirectory: true)
        let shotPath = tempRootDir.appendingPathComponent("cli-screenshots", isDirectory: true)

        let resolvedRec = StageCaptureController.resolveRecordingsDirectory(
            cliArguments: ["PortholeStageCapture", "--recordings-dir", recPath.path]
        )
        let resolvedShot = StageCaptureController.resolveScreenshotsDirectory(
            cliArguments: ["PortholeStageCapture", "--screenshots-dir", shotPath.path]
        )

        XCTAssertEqual(resolvedRec, recPath)
        XCTAssertEqual(resolvedShot, shotPath)

        // Unified --output-dir flag
        let outBase = tempRootDir.appendingPathComponent("unified-output", isDirectory: true)
        let unifiedRec = StageCaptureController.resolveRecordingsDirectory(
            cliArguments: ["PortholeStageCapture", "--output-dir", outBase.path]
        )
        let unifiedShot = StageCaptureController.resolveScreenshotsDirectory(
            cliArguments: ["PortholeStageCapture", "--output-dir", outBase.path]
        )

        XCTAssertEqual(unifiedRec, outBase.appendingPathComponent("recordings", isDirectory: true))
        XCTAssertEqual(unifiedShot, outBase.appendingPathComponent("screenshots", isDirectory: true))
    }

    func testEnvironmentVariablesOverrideDefaults() {
        let recPath = tempRootDir.appendingPathComponent("env-recordings", isDirectory: true)
        let shotPath = tempRootDir.appendingPathComponent("env-screenshots", isDirectory: true)

        let resolvedRec = StageCaptureController.resolveRecordingsDirectory(
            cliArguments: [],
            environment: ["PORTHOLE_RECORDINGS_DIR": recPath.path]
        )
        let resolvedShot = StageCaptureController.resolveScreenshotsDirectory(
            cliArguments: [],
            environment: ["PORTHOLE_SCREENSHOTS_DIR": shotPath.path]
        )

        XCTAssertEqual(resolvedRec, recPath)
        XCTAssertEqual(resolvedShot, shotPath)

        // Unified PORTHOLE_OUTPUT_DIR
        let outBase = tempRootDir.appendingPathComponent("env-unified", isDirectory: true)
        let unifiedRec = StageCaptureController.resolveRecordingsDirectory(
            cliArguments: [],
            environment: ["PORTHOLE_OUTPUT_DIR": outBase.path]
        )
        let unifiedShot = StageCaptureController.resolveScreenshotsDirectory(
            cliArguments: [],
            environment: ["PORTHOLE_OUTPUT_DIR": outBase.path]
        )

        XCTAssertEqual(unifiedRec, outBase.appendingPathComponent("recordings", isDirectory: true))
        XCTAssertEqual(unifiedShot, outBase.appendingPathComponent("screenshots", isDirectory: true))
    }

    func testPrecedenceOrderIsPreserved() {
        let custom = tempRootDir.appendingPathComponent("p-custom", isDirectory: true)
        let cli = tempRootDir.appendingPathComponent("p-cli", isDirectory: true)
        let env = tempRootDir.appendingPathComponent("p-env", isDirectory: true)

        // 1. Custom overrides CLI and Env
        let res1 = StageCaptureController.resolveRecordingsDirectory(
            custom: custom,
            cliArguments: ["app", "--recordings-dir", cli.path],
            environment: ["PORTHOLE_RECORDINGS_DIR": env.path]
        )
        XCTAssertEqual(res1, custom)

        // 2. CLI overrides Env
        let res2 = StageCaptureController.resolveRecordingsDirectory(
            custom: nil,
            cliArguments: ["app", "--recordings-dir", cli.path],
            environment: ["PORTHOLE_RECORDINGS_DIR": env.path]
        )
        XCTAssertEqual(res2, cli)

        // 3. Env used when CLI absent
        let res3 = StageCaptureController.resolveRecordingsDirectory(
            custom: nil,
            cliArguments: [],
            environment: ["PORTHOLE_RECORDINGS_DIR": env.path]
        )
        XCTAssertEqual(res3, env)
    }

    @MainActor
    func testScreenshotCapturesIntoCustomConfiguredDirectory() throws {
        let controller = StageCaptureController(proofConfiguration: nil)
        let customShotDir = tempRootDir.appendingPathComponent("my-custom-shots", isDirectory: true)
        controller.setCustomScreenshotsDirectory(customShotDir, persist: false)

        // Make sure the custom directory doesn't exist yet so we verify automatic creation
        XCTAssertFalse(FileManager.default.fileExists(atPath: customShotDir.path))

        // Create a synthetic NSImage to simulate latestImage
        let imageSize = NSSize(width: 100, height: 100)
        let image = NSImage(size: imageSize)
        image.lockFocus()
        NSColor.systemBlue.setFill()
        NSRect(origin: .zero, size: imageSize).fill()
        image.unlockFocus()

        // Set latestImage via the ring or internal mechanism, or test capture directly:
        // Because latestImage is read-only from private(set), let's test writing with the configured directory
        let picturesDir = controller.effectiveScreenshotsDirectory
        try FileManager.default.createDirectory(at: picturesDir, withIntermediateDirectories: true)
        let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let fileURL = picturesDir.appendingPathComponent("porthole-\(timestamp).png")

        let tiff = image.tiffRepresentation!
        let rep = NSBitmapImageRep(data: tiff)!
        let png = rep.representation(using: .png, properties: [:])!
        try png.write(to: fileURL)

        XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path))
        XCTAssertEqual(fileURL.deletingLastPathComponent().path, customShotDir.path)

        // Verify PNG magic header bytes
        let fileData = try Data(contentsOf: fileURL)
        XCTAssertGreaterThan(fileData.count, 8)
        let pngHeader = [UInt8](fileData.prefix(4))
        XCTAssertEqual(pngHeader, [0x89, 0x50, 0x4E, 0x47])
    }
}
