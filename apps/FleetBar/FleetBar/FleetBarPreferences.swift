import Foundation

struct FleetBarPreferences: Codable {
    var launchFleetBarOnDaemonStart: Bool = true
}

enum FleetBarPreferenceStore {
    private static var prefsURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy", isDirectory: true)
            .appendingPathComponent("ui-preferences.json", isDirectory: false)
    }

    static func load() -> FleetBarPreferences {
        do {
            let data = try Data(contentsOf: prefsURL)
            return try JSONDecoder().decode(FleetBarPreferences.self, from: data)
        } catch {
            return FleetBarPreferences()
        }
    }

    @discardableResult
    static func save(_ preferences: FleetBarPreferences) -> Bool {
        do {
            let directory = prefsURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(preferences)
            try data.write(to: prefsURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}
