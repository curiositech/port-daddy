import SwiftUI

struct ContentView: View {
    @State private var trialData: SheafTrialData?
    @State private var currentTurnIndex: Int = 3 // Start on Turn 4 (the critical divergence turn!)
    @State private var isPlaying: Bool = false
    @State private var selectedElement: SelectedElement? = .simplex("tau_wcag")
    @State private var inspectorTab: InspectorTab = .hodge
    
    enum InspectorTab: String, CaseIterable, Identifiable {
        case stalk = "Stalk F(v)"
        case restriction = "Restriction ρ"
        case hodge = "Hodge & Triad"
        case transcript = "Transcripts"
        
        var id: String { self.rawValue }
    }
    
    let timer = Timer.publish(every: 3.0, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Dark Swiss Modern canvas background
            Color(red: 0.05, green: 0.07, blue: 0.10)
                .ignoresSafeArea()
            
            if let data = trialData, data.timeseries.indices.contains(currentTurnIndex) {
                let currentTurn = data.timeseries[currentTurnIndex]
                
                HStack(spacing: 0) {
                    // MAIN CANVAS AREA (Left)
                    VStack(spacing: 0) {
                        // Header Banner
                        VStack(spacing: 6) {
                            HStack {
                                Text("The Cohomology of Swarms")
                                    .font(.system(.title2, design: .rounded, weight: .black))
                                    .foregroundStyle(
                                        LinearGradient(
                                            colors: [.primary, .cyan],
                                            startPoint: .leading,
                                            endPoint: .trailing
                                        )
                                    )
                                
                                Text("Theorems CR-1 through CR-5 • Owens 2026")
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .foregroundColor(.secondary)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Color.white.opacity(0.08), in: Capsule())
                                
                                Spacer()
                                
                                // Global Cohomological Residual Badge
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(currentTurn.residuals.total > 0 ? Color.red : Color.teal)
                                        .frame(width: 8, height: 8)
                                    
                                    Text("Global Residual r: \(String(format: "%.1f", currentTurn.residuals.total))")
                                        .font(.system(size: 11, weight: .black, design: .monospaced))
                                        .foregroundColor(currentTurn.residuals.total > 0 ? .red : .teal)
                                    
                                    Text("•")
                                        .foregroundColor(.secondary)
                                    
                                    Text("Legibility L(g): \(String(format: "%.2f", currentTurn.hodge.legibilityRatio))")
                                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                                        .foregroundColor(.cyan)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.black.opacity(0.4), in: Capsule())
                                .overlay(
                                    Capsule().stroke(currentTurn.residuals.total > 0 ? Color.red.opacity(0.5) : Color.teal.opacity(0.5), lineWidth: 1)
                                )
                            }
                            .padding(.horizontal, 24)
                            .padding(.top, 16)
                            
                            // Stage Cue Pill Banner
                            HStack {
                                Text(currentTurn.stage_cue)
                                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                                    .foregroundColor(.white)
                                    .lineLimit(2)
                                Spacer()
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                currentTurn.residuals.total > 0 ?
                                LinearGradient(colors: [Color.orange.opacity(0.3), Color.red.opacity(0.2)], startPoint: .leading, endPoint: .trailing) :
                                LinearGradient(colors: [Color.blue.opacity(0.2), Color.teal.opacity(0.2)], startPoint: .leading, endPoint: .trailing),
                                in: RoundedRectangle(cornerRadius: 10)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(currentTurn.residuals.total > 0 ? Color.orange.opacity(0.6) : Color.cyan.opacity(0.3), lineWidth: 1)
                            )
                            .padding(.horizontal, 24)
                        }
                        
                        // Central Simplicial Complex Graph
                        GraphCanvasView(
                            turn: currentTurn,
                            metadata: data.metadata,
                            selectedElement: $selectedElement
                        )
                        
                        // Scrubber & Playback Bar
                        VStack(spacing: 12) {
                            HStack(spacing: 16) {
                                // Step Previous
                                Button(action: {
                                    if currentTurnIndex > 0 { currentTurnIndex -= 1 }
                                }) {
                                    Image(systemName: "backward.end.fill")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundColor(currentTurnIndex > 0 ? .primary : .secondary.opacity(0.4))
                                }
                                .buttonStyle(.plain)
                                .disabled(currentTurnIndex == 0)
                                
                                // Play / Pause
                                Button(action: { isPlaying.toggle() }) {
                                    Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                        .font(.system(size: 32, weight: .bold))
                                        .foregroundStyle(Color.cyan)
                                }
                                .buttonStyle(.plain)
                                
                                // Step Next
                                Button(action: {
                                    if currentTurnIndex < data.timeseries.count - 1 { currentTurnIndex += 1 }
                                }) {
                                    Image(systemName: "forward.end.fill")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundColor(currentTurnIndex < data.timeseries.count - 1 ? .primary : .secondary.opacity(0.4))
                                }
                                .buttonStyle(.plain)
                                .disabled(currentTurnIndex == data.timeseries.count - 1)
                                
                                // Slider
                                Slider(
                                    value: Binding(
                                        get: { Double(currentTurnIndex) },
                                        set: { currentTurnIndex = Int($0) }
                                    ),
                                    in: 0...Double(data.timeseries.count - 1),
                                    step: 1
                                )
                                .tint(.cyan)
                                
                                // Turn Number
                                Text("Turn \(currentTurn.turn) / \(data.timeseries.count)")
                                    .font(.system(.headline, design: .monospaced, weight: .black))
                                    .frame(width: 120, alignment: .trailing)
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(
                                .ultraThinMaterial,
                                in: RoundedRectangle(cornerRadius: 16)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(Color.white.opacity(0.15), lineWidth: 1)
                            )
                            .shadow(color: .black.opacity(0.3), radius: 15, x: 0, y: 8)
                            .padding(.horizontal, 24)
                            .padding(.bottom, 16)
                        }
                    }
                    
                    Divider().opacity(0.3)
                    
                    // INSPECTOR SIDEBAR (Right)
                    VStack(spacing: 0) {
                        // Tabs Header
                        Picker("Inspector", selection: $inspectorTab) {
                            ForEach(InspectorTab.allCases) { tab in
                                Text(tab.rawValue).tag(tab)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding(14)
                        
                        Divider().opacity(0.2)
                        
                        // Tab Contents
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                switch inspectorTab {
                                case .stalk:
                                    StalkInspectorView(
                                        turn: currentTurn,
                                        metadata: data.metadata,
                                        selectedElement: selectedElement
                                    )
                                case .restriction:
                                    RestrictionMapInspectorView(
                                        turn: currentTurn,
                                        metadata: data.metadata,
                                        selectedElement: selectedElement
                                    )
                                case .hodge:
                                    HodgeInspectorView(
                                        turn: currentTurn,
                                        metadata: data.metadata,
                                        selectedElement: selectedElement
                                    )
                                case .transcript:
                                    TranscriptLogView(
                                        turns: Array(data.timeseries.prefix(currentTurnIndex + 1))
                                    )
                                }
                            }
                            .padding(16)
                        }
                    }
                    .frame(width: 400)
                    .background(Color(red: 0.08, green: 0.10, blue: 0.14))
                }
            } else {
                VStack(spacing: 16) {
                    ProgressView().scaleEffect(1.5)
                    Text("Loading Grounded Sheaf Complex...").foregroundColor(.secondary)
                }
            }
        }
        .onAppear(perform: loadGroundedData)
        .onReceive(timer) { _ in
            if isPlaying, let data = trialData {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                    if currentTurnIndex < data.timeseries.count - 1 {
                        currentTurnIndex += 1
                    } else {
                        isPlaying = false
                    }
                }
            }
        }
    }
    
    private func loadGroundedData() {
        do {
            self.trialData = try DataLoader.loadGroundedSheafData()
        } catch {
            print("Failed to load grounded sheaf data: \(error)")
        }
    }
}

// MARK: - Inspector 1: Stalk Inspector F(v)
struct StalkInspectorView: View {
    let turn: SheafTurn
    let metadata: SheafMetadata
    let selectedElement: SelectedElement?
    
    var agentId: String {
        if case .node(let id) = selectedElement { return id }
        return turn.active_agent
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Agent Stalk F(\(agentId))")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                    Text(metadata.agentRoles[agentId] ?? "Agent")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                }
                Spacer()
                Text("Vector Space ℝ\(metadata.agents[agentId]?.count ?? 0)")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .padding(5)
                    .background(Color.cyan.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
                    .foregroundColor(.cyan)
            }
            
            Divider().opacity(0.2)
            
            // Stalk Dimensions
            Text("OBSERVED DIMENSIONS")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.secondary)
            
            let dims = metadata.agents[agentId] ?? []
            let state = turn.states[agentId] ?? []
            
            VStack(spacing: 8) {
                ForEach(0..<dims.count, id: \.self) { i in
                    let dimIdx = dims[i]
                    let dimName = metadata.dimensions["\(dimIdx)"] ?? "Dim \(dimIdx)"
                    let val = i < state.count ? state[i] : 0.0
                    
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text("Dim \(dimIdx): \(dimName)")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                            Spacer()
                            Text("\(Int(val))%")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundColor(val >= 90 ? .teal : (val < 50 ? .orange : .primary))
                        }
                        
                        GeometryReader { barGeo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.08)).frame(height: 6)
                                Capsule()
                                    .fill(val >= 90 ? Color.teal : (val < 50 ? Color.orange : Color.blue))
                                    .frame(width: max(0, barGeo.size.width * CGFloat(val / 100.0)), height: 6)
                            }
                        }
                        .frame(height: 6)
                    }
                    .padding(8)
                    .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            
            Divider().opacity(0.2)
            
            // Concrete Tool Call Action
            Text("LAST EXECUTED TOOL CALL")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .font(.system(size: 11))
                        .foregroundColor(.cyan)
                    Text(turn.tool_call.toolName)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(.cyan)
                }
                
                Text("Arguments:")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(.secondary)
                
                Text(formatJSON(turn.tool_call.args))
                    .font(.system(size: 9.5, design: .monospaced))
                    .foregroundColor(.primary.opacity(0.9))
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
                
                Text("Result:")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(.secondary)
                
                Text(formatJSON(turn.tool_call.result))
                    .font(.system(size: 9.5, design: .monospaced))
                    .foregroundColor(.teal.opacity(0.95))
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
            }
            .padding(10)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }
    }
    
    private func formatJSON(_ dict: [String: AnyCodable]) -> String {
        dict.map { "  \($0.key): \($0.value.stringRepresentation)" }.joined(separator: "\n")
    }
}

// MARK: - Inspector 2: Restriction Map Inspector ρ
struct RestrictionMapInspectorView: View {
    let turn: SheafTurn
    let metadata: SheafMetadata
    let selectedElement: SelectedElement?
    
    var edgeKey: String {
        if case .edge(let key) = selectedElement { return key }
        // Default to edge with highest residual
        let sorted = turn.residuals.edgeResiduals.sorted { $0.value > $1.value }
        return sorted.first?.key ?? "PM-Design"
    }
    
    var body: some View {
        let cochain = turn.cochains[edgeKey]
        let residual = turn.residuals.edgeResiduals[edgeKey] ?? 0.0
        let parts = edgeKey.split(separator: "-")
        let u = parts.count > 0 ? String(parts[0]) : "PM"
        let v = parts.count > 1 ? String(parts[1]) : "Design"
        let edgeDef = metadata.edges.first { $0.u == u && $0.v == v }
        let shared = edgeDef?.sharedDims ?? []
        
        VStack(alignment: .leading, spacing: 14) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Restriction Map: \(u) ⟷ \(v)")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                    Text("Edge Stalk F(e) on Shared Dims [\(shared.map { String($0) }.joined(separator: ", "))]")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                }
                Spacer()
                Text("‖gₑ‖² = \(String(format: "%.1f", residual))")
                    .font(.system(size: 11, weight: .black, design: .monospaced))
                    .padding(5)
                    .background(residual > 0 ? Color.red.opacity(0.2) : Color.teal.opacity(0.2), in: RoundedRectangle(cornerRadius: 6))
                    .foregroundColor(residual > 0 ? .red : .teal)
            }
            
            Divider().opacity(0.2)
            
            // Algebraic Formulas
            Text("CELLULAR RESTRICTION OPERATORS")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading, spacing: 8) {
                Text("P_\(u): F(\(u)) ⟶ F(e)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.cyan)
                Text(cochain?.restriction_u ?? "")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.secondary)
                
                Text("P_\(v): F(\(v)) ⟶ F(e)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.cyan)
                Text(cochain?.restriction_v ?? "")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.secondary)
            }
            .padding(10)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            
            // Cochain Projection Comparison
            Text("LOCAL SECTION PROJECTIONS")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.secondary)
            
            if let c = cochain {
                VStack(spacing: 8) {
                    ForEach(0..<shared.count, id: \.self) { i in
                        let dimIdx = shared[i]
                        let dimName = metadata.dimensions["\(dimIdx)"] ?? "Dim \(dimIdx)"
                        let uVal = i < c.u_proj.count ? c.u_proj[i] : 0.0
                        let vVal = i < c.v_proj.count ? c.v_proj[i] : 0.0
                        let diff = i < c.diff.count ? c.diff[i] : 0.0
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Dim \(dimIdx): \(dimName)")
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                            
                            HStack {
                                Text("\(u): \(Int(uVal))%")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.purple)
                                Spacer()
                                Text("Δ = \(Int(diff))")
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundColor(diff == 0 ? .teal : .red)
                                Spacer()
                                Text("\(v): \(Int(vVal))%")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding(8)
                        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            
            // Theorem CR-1 Status
            HStack(spacing: 6) {
                Image(systemName: residual > 0 ? "exclamationmark.octagon.fill" : "checkmark.seal.fill")
                    .foregroundColor(residual > 0 ? .red : .teal)
                
                Text(residual > 0 ? "Theorem CR-1: Contradiction Detected across edge. No global section explains this gossip." : "Theorem CR-1: Zero residual. Complete harmonic consensus.")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundColor(residual > 0 ? .red : .teal)
            }
            .padding(10)
            .background(residual > 0 ? Color.red.opacity(0.1) : Color.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Inspector 3: Hodge Decomposition & Triad Inspector
struct HodgeInspectorView: View {
    let turn: SheafTurn
    let metadata: SheafMetadata
    let selectedElement: SelectedElement?
    
    var simplexId: String {
        if case .simplex(let id) = selectedElement { return id }
        return "tau_wcag"
    }
    
    var body: some View {
        let simpDef = metadata.simplices.first { $0.id == simplexId }
        let simpRes = turn.simplices[simplexId]
        let curl = simpRes?.curl ?? 0.0
        
        VStack(alignment: .leading, spacing: 14) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("2-Simplex: \(simpDef?.name ?? "Triad")")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                    Text("Triadic Review Contract τ = [\(simpDef?.agents.joined(separator: ", ") ?? "")]")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                }
                Spacer()
                Text("Curl δ₁g: \(String(format: "%.1f", curl))")
                    .font(.system(size: 11, weight: .black, design: .monospaced))
                    .padding(5)
                    .background(curl > 0 ? Color.orange.opacity(0.2) : Color.teal.opacity(0.2), in: RoundedRectangle(cornerRadius: 6))
                    .foregroundColor(curl > 0 ? .orange : .teal)
            }
            
            Divider().opacity(0.2)
            
            // Oriented Boundary Equation
            Text("TRIADIC BOUNDARY OPERATOR")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading, spacing: 4) {
                Text("∂₂τ = e₀₁ + e₁₂ - e₀₂")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.primary)
                Text("(δ₁g)_τ = g₀₁ + g₁₂ - g₀₂ ∈ ℝᵈ")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.cyan)
                Text("Measures non-zero circulation (Escher staircase curl) around review loop.")
                    .font(.system(size: 9.5))
                    .foregroundColor(.secondary)
            }
            .padding(10)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            
            Divider().opacity(0.2)
            
            // Simplicial Hodge Decomposition (Theorem CR-5)
            Text("SIMPLICIAL HODGE 1-LAPLACIAN (THEOREM CR-5)")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.secondary)
            
            VStack(spacing: 8) {
                HodgeSubspaceRow(
                    name: "Gauge Gradient im(δ₀)",
                    subtitle: "Benign turn latency • Curl-free",
                    energy: turn.hodge.gradientEnergy,
                    color: .blue
                )
                
                HodgeSubspaceRow(
                    name: "Harmonic Cavity ℋ¹(X)",
                    subtitle: "Macro network partition • Zero divergence & curl",
                    energy: turn.hodge.harmonicEnergy,
                    color: .gray
                )
                
                HodgeSubspaceRow(
                    name: "Triadic Curl im(δ₁*)",
                    subtitle: "Local review bug • Divergence-free",
                    energy: turn.hodge.triadicCurlEnergy,
                    color: .orange
                )
            }
            
            // Legibility Ratio Box
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("SWARM LEGIBILITY RATIO L(g)")
                        .font(.system(size: 10, weight: .black, design: .monospaced))
                        .foregroundColor(.yellow)
                    Spacer()
                    Text(String(format: "%.2f", turn.hodge.legibilityRatio))
                        .font(.system(size: 14, weight: .heavy, design: .monospaced))
                        .foregroundColor(.yellow)
                }
                
                Text("Formula: ‖h‖² / (‖h‖² + ‖δ₁*ψ‖²)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.secondary)
                
                Text("Triage Verdict: \(turn.hodge.classification)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundColor(turn.hodge.legibilityRatio > 0.6 ? .red : (turn.hodge.triadicCurlEnergy > 0 ? .orange : .teal))
            }
            .padding(10)
            .background(Color.yellow.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.yellow.opacity(0.3), lineWidth: 1))
        }
    }
}

struct HodgeSubspaceRow: View {
    let name: String
    let subtitle: String
    let energy: Double
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(name)
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                    .foregroundColor(color)
                Spacer()
                Text("‖·‖² = \(String(format: "%.1f", energy))")
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
            }
            Text(subtitle)
                .font(.system(size: 9))
                .foregroundColor(.secondary)
        }
        .padding(8)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Inspector 4: Transcript Log View
struct TranscriptLogView: View {
    let turns: [SheafTurn]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("SWARM CONVERSATION & TOOL LOG")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.secondary)
            
            ForEach(turns.reversed()) { turn in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Turn \(turn.turn) • \(turn.active_agent)")
                            .font(.system(size: 11, weight: .heavy, design: .rounded))
                            .foregroundColor(.cyan)
                        Spacer()
                        Text(turn.tool_call.toolName)
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundColor(.secondary)
                    }
                    
                    Text(turn.stage_cue)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.primary.opacity(0.9))
                    
                    Text("💭 " + turn.thought_bubble)
                        .font(.system(size: 9.5))
                        .italic()
                        .foregroundColor(.secondary)
                    
                    Text("💬 " + turn.message_to_team)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.white)
                }
                .padding(10)
                .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}
