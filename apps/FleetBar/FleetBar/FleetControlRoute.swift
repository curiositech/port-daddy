import Foundation

enum FleetControlSurface: String, CaseIterable, Identifiable {
    /// The operator home: needs-you list + trust-gate spawn approvals
    /// (ADR-0093). First in the strip — held spawns are the one thing the
    /// Control Center must never bury.
    case `operator`
    case flow
    case cloudfleet
    case backend
    case roadmap
    case proposals
    case nightshift
    case agents
    case visual
    case resources
    case activity
    case channels
    case inbox
    case sorties
    case memory
    case shipwright
    case yaml
    case galaxy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .operator: return "Operator"
        case .flow: return "Flow"
        case .cloudfleet: return "Cloud Fleet"
        case .backend: return "Backend"
        case .roadmap: return "Roadmap"
        case .proposals: return "Proposals"
        case .nightshift: return "Nightshift"
        case .agents: return "Agents"
        case .visual: return "Visual Task"
        case .resources: return "Resources"
        case .activity: return "Activity"
        case .channels: return "Channels"
        case .inbox: return "Inbox"
        case .sorties: return "Sorties"
        case .memory: return "Memory"
        case .shipwright: return "Shipwright"
        case .yaml: return "YAML"
        case .galaxy: return "Galaxy"
        }
    }

    var icon: String {
        switch self {
        case .operator: return "checklist"
        case .flow: return "point.3.connected.trianglepath.dotted"
        case .cloudfleet: return "cloud"
        case .backend: return "rectangle.stack.badge.person.crop"
        case .roadmap: return "map"
        case .proposals: return "person.crop.circle.badge.questionmark"
        case .nightshift: return "moon.stars.fill"
        case .agents: return "person.3"
        case .visual: return "viewfinder"
        case .resources: return "gauge"
        case .activity: return "waveform.path.ecg"
        case .channels: return "dot.radiowaves.left.and.right"
        case .inbox: return "tray.full"
        case .sorties: return "paperplane"
        case .memory: return "square.stack.3d.up"
        case .shipwright: return "hammer"
        case .yaml: return "curlybraces"
        case .galaxy: return "circle.hexagongrid"
        }
    }

    /// Whether this surface is rendered by a native SwiftUI view instead of
    /// embedded into the `/fleet-ui/` webview. Native surfaces opt in here:
    /// Nightshift, Backend, Proposals, and Galaxy have app-owned state/actions, so
    /// routing them through the browser would mean an extra trip + duplicate state.
    var isNative: Bool {
        switch self {
        case .cloudfleet, .nightshift, .backend, .proposals, .galaxy: return true
        default: return false
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
