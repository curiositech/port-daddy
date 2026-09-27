import SwiftUI

struct ObservationGraphView: View {
    let graph: ObservationGraph
    private let points: [CGPoint] = [
        CGPoint(x: 0.16, y: 0.16), CGPoint(x: 0.84, y: 0.16),
        CGPoint(x: 0.84, y: 0.84), CGPoint(x: 0.16, y: 0.84)
    ]

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                ForEach(Array(graph.edges.enumerated()), id: \.offset) { index, edge in
                    Path { path in
                        path.move(to: point(edge[0], in: geometry.size))
                        path.addLine(to: point(edge[1], in: geometry.size))
                    }
                    .stroke(index == 5 ? Color.accentColor : Color.primary.opacity(0.65),
                            style: StrokeStyle(lineWidth: index == 5 ? 3 : 2, lineCap: .round))
                }
                ForEach(0..<4, id: \.self) { vertex in
                    Text("\(vertex)")
                        .font(.headline.monospacedDigit())
                        .frame(width: 44, height: 44)
                        .background(.regularMaterial, in: Circle())
                        .overlay(Circle().stroke(Color.primary.opacity(0.55)))
                        .position(point(vertex, in: geometry.size))
                }
            }
        }
        .frame(height: 200)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Four vertices. Edges: \(graph.edges.map { "\($0[0]) to \($0[1])" }.joined(separator: ", ")).")
    }

    private func point(_ vertex: Int, in size: CGSize) -> CGPoint {
        CGPoint(x: points[vertex].x * size.width, y: points[vertex].y * size.height)
    }
}
