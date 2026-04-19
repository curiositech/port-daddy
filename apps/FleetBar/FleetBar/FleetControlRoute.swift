import Foundation

enum FleetControlSurface: String, CaseIterable, Identifiable {
    case flow
    case agents
    case activity
    case channels
    case inbox
    case sorties
    case memory
    case yaml

    var id: String { rawValue }

    var title: String {
        switch self {
        case .flow: return "Flow"
        case .agents: return "Agents"
        case .activity: return "Activity"
        case .channels: return "Channels"
        case .inbox: return "Inbox"
        case .sorties: return "Sorties"
        case .memory: return "Memory"
        case .yaml: return "YAML"
        }
    }

    var icon: String {
        switch self {
        case .flow: return "point.3.connected.trianglepath.dotted"
        case .agents: return "person.3"
        case .activity: return "waveform.path.ecg"
        case .channels: return "dot.radiowaves.left.and.right"
        case .inbox: return "tray.full"
        case .sorties: return "paperplane"
        case .memory: return "square.stack.3d.up"
        case .yaml: return "curlybraces"
        }
    }
}

enum FleetControlRoute {
    static let surfaceKey = "fleet.control.surface"
    static let projectKey = "fleet.control.project"
    static let agentKey = "fleet.control.agent"

    static func persist(surface: FleetControlSurface, project: String?, agent: String? = nil) {
        let defaults = UserDefaults.standard
        defaults.set(surface.rawValue, forKey: surfaceKey)
        if let project, !project.isEmpty {
            defaults.set(project, forKey: projectKey)
        } else {
            defaults.removeObject(forKey: projectKey)
        }
        if let agent, !agent.isEmpty {
            defaults.set(agent, forKey: agentKey)
        } else {
            defaults.removeObject(forKey: agentKey)
        }
    }
}
