import Foundation

// MARK: - Root Data Structure
struct SheafTrialData: Codable {
    let metadata: SheafMetadata
    let timeseries: [SheafTurn]
}

// MARK: - Metadata
struct SheafMetadata: Codable {
    let project: String
    let theory: String
    let dimensions: [String: String]
    let agents: [String: [Int]]
    let agentRoles: [String: String]
    let edges: [SheafEdgeDef]
    let simplices: [SheafSimplexDef]
}

struct SheafEdgeDef: Codable, Identifiable {
    let u: String
    let v: String
    let sharedDims: [Int]
    
    var id: String { "\(u)-\(v)" }
}

struct SheafSimplexDef: Codable, Identifiable {
    let id: String
    let name: String
    let agents: [String]
    let sharedDims: [Int]
}

// MARK: - Turn Data
struct SheafTurn: Codable, Identifiable {
    let turn: Int
    let active_agent: String
    let stage_cue: String
    let thought_bubble: String
    let message_to_team: String
    let tool_call: SheafToolCall
    let states: [String: [Double]]
    let residuals: SheafResiduals
    let cochains: [String: SheafCochain]
    let simplices: [String: SheafSimplexResidual]
    let hodge: SheafHodge
    
    var id: Int { turn }
}

struct SheafToolCall: Codable {
    let toolName: String
    let args: [String: AnyCodable]
    let result: [String: AnyCodable]
}

struct SheafResiduals: Codable {
    let total: Double
    let edgeResiduals: [String: Double]
}

struct SheafCochain: Codable {
    let u_proj: [Double]
    let v_proj: [Double]
    let diff: [Double]
    let normSq: Double
    let restriction_u: String
    let restriction_v: String
}

struct SheafSimplexResidual: Codable {
    let curl: Double
    let boundaryEdges: [String]
    let description: String
}

struct SheafHodge: Codable {
    let gradientEnergy: Double
    let harmonicEnergy: Double
    let triadicCurlEnergy: Double
    let legibilityRatio: Double
    let classification: String
}

// MARK: - Generic AnyCodable for Tool Call JSON
struct AnyCodable: Codable {
    let value: Any
    
    init(_ value: Any) {
        self.value = value
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else {
            value = ""
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let bool = value as? Bool {
            try container.encode(bool)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        } else if let array = value as? [Any] {
            try container.encode(array.map { AnyCodable($0) })
        } else if let dict = value as? [String: Any] {
            try container.encode(dict.mapValues { AnyCodable($0) })
        }
    }
    
    var stringRepresentation: String {
        if let str = value as? String { return str }
        if let num = value as? NSNumber { return "\(num)" }
        if let arr = value as? [Any] { return "\(arr)" }
        if let dict = value as? [String: Any] { return "\(dict)" }
        return "\(value)"
    }
}

// MARK: - Data Loader
class DataLoader {
    static func loadGroundedSheafData() throws -> SheafTrialData {
        var data: Data?
        if let bundleUrl = Bundle.module.url(forResource: "sheaf_swarm_grounded", withExtension: "json"),
           let bundleData = try? Data(contentsOf: bundleUrl) {
            data = bundleData
        } else if let envPath = ProcessInfo.processInfo.environment["SHEAF_DATA_PATH"],
                  let envData = try? Data(contentsOf: URL(fileURLWithPath: envPath)) {
            data = envData
        } else {
            let candidates = [
                "docs/harbor-research/transcripts/sheaf_swarm_grounded.json",
                "../transcripts/sheaf_swarm_grounded.json",
                "../../transcripts/sheaf_swarm_grounded.json",
                "Sources/SwarmVisualizer/Resources/sheaf_swarm_grounded.json",
                "Resources/sheaf_swarm_grounded.json"
            ]
            let fileManager = FileManager.default
            let cwd = fileManager.currentDirectoryPath
            for candidate in candidates {
                let candidateUrl = URL(fileURLWithPath: cwd).appendingPathComponent(candidate)
                if fileManager.fileExists(atPath: candidateUrl.path),
                   let fileData = try? Data(contentsOf: candidateUrl) {
                    data = fileData
                    break
                }
            }
        }

        guard let finalData = data else {
            throw NSError(domain: "DataLoader", code: 404, userInfo: [NSLocalizedDescriptionKey: "sheaf_swarm_grounded.json not found in Bundle.module, SHEAF_DATA_PATH, or repository relative paths"])
        }

        let decoder = JSONDecoder()
        return try decoder.decode(SheafTrialData.self, from: finalData)
    }
}
