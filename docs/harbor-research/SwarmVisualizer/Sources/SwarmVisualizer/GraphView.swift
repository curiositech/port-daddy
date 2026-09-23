import SwiftUI

enum SelectedElement: Equatable {
    case node(String)
    case edge(String)
    case simplex(String)
}

struct GraphCanvasView: View {
    let turn: SheafTurn
    let metadata: SheafMetadata
    @Binding var selectedElement: SelectedElement?
    
    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let pmPos = position(for: "PM", in: size)
            let designPos = position(for: "Design", in: size)
            let devPos = position(for: "Dev", in: size)
            let criticPos = position(for: "Critic", in: size)
            
            ZStack {
                // Background Coordinate Grid (Swiss Modern Systems drafting context)
                CoordinateGridView()
                    .opacity(0.18)
                
                // 1. 2-SIMPLICES (Triadic Review Contracts / Faces)
                // Simplex 1: tau_sitemap = [PM, Design, Dev]
                SimplexFaceView(
                    id: "tau_sitemap",
                    name: "Architecture Triad",
                    points: [pmPos, designPos, devPos],
                    curl: turn.simplices["tau_sitemap"]?.curl ?? 0,
                    isSelected: selectedElement == .simplex("tau_sitemap")
                )
                .onTapGesture {
                    selectedElement = .simplex("tau_sitemap")
                }
                
                // Simplex 2: tau_wcag = [PM, Design, Critic]
                SimplexFaceView(
                    id: "tau_wcag",
                    name: "Accessibility Triad",
                    points: [pmPos, designPos, criticPos],
                    curl: turn.simplices["tau_wcag"]?.curl ?? 0,
                    isSelected: selectedElement == .simplex("tau_wcag")
                )
                .onTapGesture {
                    selectedElement = .simplex("tau_wcag")
                }
                
                // Simplex 3: tau_ui = [Design, Dev, Critic]
                SimplexFaceView(
                    id: "tau_ui",
                    name: "Design-Code Triad",
                    points: [designPos, devPos, criticPos],
                    curl: turn.simplices["tau_ui"]?.curl ?? 0,
                    isSelected: selectedElement == .simplex("tau_ui")
                )
                .onTapGesture {
                    selectedElement = .simplex("tau_ui")
                }
                
                // 2. 1-SIMPLICES (Edges / Channels with Restriction Maps)
                ForEach(metadata.edges) { edge in
                    let edgeKey = "\(edge.u)-\(edge.v)"
                    let res = turn.residuals.edgeResiduals[edgeKey] ?? 0
                    let cochain = turn.cochains[edgeKey]
                    let uPos = position(for: edge.u, in: size)
                    let vPos = position(for: edge.v, in: size)
                    
                    SimplexEdgeView(
                        edge: edge,
                        start: uPos,
                        end: vPos,
                        residual: res,
                        cochain: cochain,
                        isSelected: selectedElement == .edge(edgeKey)
                    )
                    .onTapGesture {
                        selectedElement = .edge(edgeKey)
                    }
                }
                
                // 3. 0-SIMPLICES (Agent Nodes with Stalks)
                ForEach(["PM", "Design", "Dev", "Critic"], id: \.self) { agentId in
                    let pos = position(for: agentId, in: size)
                    let isActive = (turn.active_agent == agentId)
                    let state = turn.states[agentId] ?? []
                    let dims = metadata.agents[agentId] ?? []
                    let role = metadata.agentRoles[agentId] ?? "Agent"
                    
                    AgentNodeCard(
                        agentId: agentId,
                        role: role,
                        position: pos,
                        state: state,
                        dimensionIndices: dims,
                        dimensionNames: metadata.dimensions,
                        isActive: isActive,
                        isSelected: selectedElement == .node(agentId)
                    )
                    .onTapGesture {
                        selectedElement = .node(agentId)
                    }
                    
                    // Floating Personified Thought Bubble
                    if isActive {
                        FloatingThoughtBubble(
                            agentId: agentId,
                            anchor: pos,
                            thought: turn.thought_bubble
                        )
                    }
                }
            }
        }
    }
    
    private func position(for agent: String, in size: CGSize) -> CGPoint {
        switch agent {
        case "PM":     return CGPoint(x: size.width * 0.50, y: size.height * 0.16)
        case "Design": return CGPoint(x: size.width * 0.20, y: size.height * 0.52)
        case "Dev":    return CGPoint(x: size.width * 0.80, y: size.height * 0.52)
        case "Critic": return CGPoint(x: size.width * 0.50, y: size.height * 0.87)
        default:       return CGPoint(x: size.width * 0.50, y: size.height * 0.50)
        }
    }
}

// MARK: - Simplex Face View (2-Simplex / Triad)
struct SimplexFaceView: View {
    let id: String
    let name: String
    let points: [CGPoint]
    let curl: Double
    let isSelected: Bool
    
    var body: some View {
        let centroid = CGPoint(
            x: (points[0].x + points[1].x + points[2].x) / 3.0,
            y: (points[0].y + points[1].y + points[2].y) / 3.0
        )
        let hasConflict = curl > 0.05
        
        ZStack {
            // Triangle Fill
            Path { path in
                path.move(to: points[0])
                path.addLine(to: points[1])
                path.addLine(to: points[2])
                path.closeSubpath()
            }
            .fill(
                hasConflict ?
                Color.orange.opacity(isSelected ? 0.35 : 0.20) :
                Color.teal.opacity(isSelected ? 0.25 : 0.10)
            )
            .overlay(
                Path { path in
                    path.move(to: points[0])
                    path.addLine(to: points[1])
                    path.addLine(to: points[2])
                    path.closeSubpath()
                }
                .stroke(
                    hasConflict ? Color.orange.opacity(0.8) : Color.teal.opacity(0.4),
                    style: StrokeStyle(lineWidth: isSelected ? 2.5 : 1.0, dash: hasConflict ? [6, 4] : [])
                )
            )
            
            // Centroid Triadic Curl Badge
            VStack(spacing: 3) {
                HStack(spacing: 4) {
                    Image(systemName: hasConflict ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(hasConflict ? .orange : .teal)
                    
                    Text("τ: \(name)")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundColor(.primary.opacity(0.9))
                }
                
                Text("Curl (δ₁g): \(String(format: "%.1f", curl))")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(hasConflict ? .orange : .secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                .ultraThinMaterial,
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(
                        hasConflict ? Color.orange.opacity(0.7) : Color.white.opacity(0.2),
                        lineWidth: 1
                    )
            )
            .shadow(color: hasConflict ? .orange.opacity(0.4) : .clear, radius: 8)
            .position(centroid)
        }
    }
}

// MARK: - Simplex Edge View (1-Simplex / Channel with Restriction Map)
struct SimplexEdgeView: View {
    let edge: SheafEdgeDef
    let start: CGPoint
    let end: CGPoint
    let residual: Double
    let cochain: SheafCochain?
    let isSelected: Bool
    
    @State private var dashPhase: CGFloat = 0
    
    var body: some View {
        let mid = CGPoint(x: (start.x + end.x) / 2.0, y: (start.y + end.y) / 2.0)
        let hasConflict = residual > 0.05
        
        ZStack {
            // Channel Line
            Path { path in
                path.move(to: start)
                path.addLine(to: end)
            }
            .stroke(
                hasConflict ?
                LinearGradient(colors: [.orange, .red], startPoint: .leading, endPoint: .trailing) :
                LinearGradient(colors: [.blue.opacity(0.5), .cyan.opacity(0.5)], startPoint: .leading, endPoint: .trailing),
                style: StrokeStyle(
                    lineWidth: hasConflict ? (isSelected ? 4.5 : 3.0) : (isSelected ? 3.0 : 1.5),
                    lineCap: .round,
                    dash: hasConflict ? [10, 5] : [],
                    dashPhase: dashPhase
                )
            )
            .shadow(color: hasConflict ? .red.opacity(0.6) : .cyan.opacity(0.2), radius: hasConflict ? 10 : 2)
            
            // Midway Restriction Badge
            HStack(spacing: 4) {
                Text("ρₑ Dims [\(edge.sharedDims.map { String($0) }.joined(separator: ","))]")
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundColor(.secondary)
                
                Text("‖gₑ‖²: \(String(format: "%.1f", residual))")
                    .font(.system(size: 8, weight: .black, design: .monospaced))
                    .foregroundColor(hasConflict ? .red : .teal)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
                .ultraThinMaterial,
                in: Capsule()
            )
            .overlay(
                Capsule()
                    .stroke(
                        isSelected ? Color.accentColor : (hasConflict ? Color.red.opacity(0.7) : Color.white.opacity(0.2)),
                        lineWidth: isSelected ? 1.5 : 0.8
                    )
            )
            .position(mid)
        }
        .onAppear {
            if hasConflict {
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                    dashPhase -= 20
                }
            }
        }
    }
}

// MARK: - Agent Node Card (0-Simplex / Stalk)
struct AgentNodeCard: View {
    let agentId: String
    let role: String
    let position: CGPoint
    let state: [Double]
    let dimensionIndices: [Int]
    let dimensionNames: [String: String]
    let isActive: Bool
    let isSelected: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack {
                Circle()
                    .fill(avatarColor(for: agentId))
                    .frame(width: 12, height: 12)
                    .overlay(
                        Circle().stroke(Color.white, lineWidth: 1)
                    )
                
                Text(agentId)
                    .font(.system(.headline, design: .rounded, weight: .heavy))
                    .foregroundColor(.primary)
                
                Spacer()
                
                if isActive {
                    Text("SPEAKING")
                        .font(.system(size: 8, weight: .black, design: .rounded))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.cyan, in: Capsule())
                        .foregroundColor(.black)
                }
            }
            
            Text(role)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundColor(.secondary)
                .lineLimit(1)
            
            Divider().opacity(0.3)
            
            // Stalk Dimensions (Named and Quantified)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(0..<dimensionIndices.count, id: \.self) { i in
                    let dimIdx = dimensionIndices[i]
                    let dimName = dimensionNames["\(dimIdx)"] ?? "Dim \(dimIdx)"
                    let val = i < state.count ? state[i] : 0.0
                    
                    HStack(spacing: 6) {
                        Text(dimName)
                            .font(.system(size: 9, weight: .medium, design: .rounded))
                            .foregroundColor(.secondary)
                            .frame(width: 110, alignment: .leading)
                            .lineLimit(1)
                        
                        GeometryReader { barGeo in
                            ZStack(alignment: .leading) {
                                Capsule()
                                    .fill(Color.white.opacity(0.1))
                                    .frame(height: 5)
                                
                                Capsule()
                                    .fill(barColor(for: val))
                                    .frame(width: max(0, barGeo.size.width * CGFloat(val / 100.0)), height: 5)
                            }
                        }
                        .frame(height: 5)
                        
                        Text("\(Int(val))%")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundColor(val == 100 ? .teal : .primary)
                            .frame(width: 32, alignment: .trailing)
                    }
                }
            }
        }
        .padding(14)
        .frame(width: 220)
        .background(
            .ultraThinMaterial,
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(
                    isSelected ? Color.accentColor : (isActive ? Color.cyan.opacity(0.9) : Color.white.opacity(0.15)),
                    lineWidth: isSelected ? 2.0 : (isActive ? 1.5 : 1.0)
                )
        )
        .shadow(color: isActive ? Color.cyan.opacity(0.35) : Color.black.opacity(0.2), radius: isActive ? 16 : 8)
        .position(position)
    }
    
    private func avatarColor(for agent: String) -> Color {
        switch agent {
        case "PM":     return .purple
        case "Design": return .pink
        case "Dev":    return .blue
        case "Critic": return .orange
        default:       return .gray
        }
    }
    
    private func barColor(for val: Double) -> Color {
        if val >= 95 { return .teal }
        if val >= 70 { return .blue }
        if val >= 40 { return .yellow }
        return .orange
    }
}

// MARK: - Personified Floating Thought Bubble
struct FloatingThoughtBubble: View {
    let agentId: String
    let anchor: CGPoint
    let thought: String
    
    var body: some View {
        let bubbleOffset = offset(for: agentId)
        
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text("💭")
                    .font(.system(size: 11))
                Text("\(agentId)'s Inner Monologue")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundColor(.secondary)
            }
            
            Text(thought)
                .font(.system(size: 10.5, weight: .regular, design: .rounded))
                .italic()
                .foregroundColor(.primary.opacity(0.95))
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(width: 240)
        .background(
            .ultraThinMaterial,
            in: RoundedRectangle(cornerRadius: 14)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.cyan.opacity(0.5), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.3), radius: 10, x: 0, y: 5)
        .position(x: anchor.x + bubbleOffset.x, y: anchor.y + bubbleOffset.y)
    }
    
    private func offset(for agent: String) -> CGPoint {
        switch agent {
        case "PM":     return CGPoint(x: 230, y: 10)
        case "Design": return CGPoint(x: 0, y: -130)
        case "Dev":    return CGPoint(x: 0, y: -130)
        case "Critic": return CGPoint(x: 230, y: -10)
        default:       return CGPoint(x: 0, y: -120)
        }
    }
}

// MARK: - Coordinate Grid View (Swiss Modern drafting context)
struct CoordinateGridView: View {
    var body: some View {
        GeometryReader { geo in
            Path { path in
                let step: CGFloat = 40
                for x in stride(from: 0, to: geo.size.width, by: step) {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: geo.size.height))
                }
                for y in stride(from: 0, to: geo.size.height, by: step) {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: geo.size.width, y: y))
                }
            }
            .stroke(Color.white.opacity(0.12), lineWidth: 0.5)
        }
    }
}
