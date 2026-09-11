import Foundation
import XCTest
@testable import FleetBar

extension XCTestCase {
    /// An explicit clean control root accompanies intercepted transport. Never
    /// clear the real HALT, change HOME, or infer authorization from a mock URL.
    func fixtureRuntimeControl() -> LocalRuntimeControl {
        let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../.scratch/store-control-\(UUID().uuidString)").standardizedFileURL
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            addTeardownBlock { try FileManager.default.removeItem(at: directory) }
        } catch { XCTFail("Could not create isolated control fixture: \(error)") }
        return LocalRuntimeControl(canonicalRoot: directory)
    }
}
