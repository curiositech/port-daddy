import * as React from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { motion } from 'framer-motion'
import { useTheme } from '@/lib/theme-context'

interface GraphService {
  id: string
}

interface GraphAgent {
  id: string
  identity?: string | null
}

interface GraphNode {
  id: string
  name: string
  color: string
  size: number
}

interface GraphLink {
  source: string
  target: string
  color: string
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export function Graph3D({ services = [], agents = [] }: { services?: GraphService[], agents?: GraphAgent[] }) {
  const { theme } = useTheme()

  const data = React.useMemo<GraphData>(() => {
    // Harbor Heritage palette (resolved hex — 3D library can't use CSS vars)
    const TEAL_400 = '#5BB0B1'   // --p-teal-400
    const TEAL_300 = '#7CC4C5'   // --p-teal-300
    const GOLD_300 = '#D4AD7C'   // --p-gold-300

    const nodes = [
      { id: 'core', name: 'Port Daddy', color: TEAL_400, size: 12 }
    ]
    const links: GraphLink[] = []

    services.forEach((s) => {
      nodes.push({ id: `svc:${s.id}`, name: s.id, color: TEAL_300, size: 8 })
      links.push({ source: 'core', target: `svc:${s.id}`, color: TEAL_400 })
    })

    agents.forEach((a) => {
      nodes.push({ id: `agt:${a.id}`, name: a.id, color: GOLD_300, size: 6 })
      // Heuristic connection
      const service = services.find((s) => a.identity?.startsWith(s.id.split(':')[0]))
      links.push({ source: service ? `svc:${service.id}` : 'core', target: `agt:${a.id}`, color: GOLD_300 })
    })

    return { nodes, links }
  }, [services, agents])

  return (
    <motion.div className="w-full h-full rounded-3xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface-overlay)] font-sans">
      <ForceGraph3D
        graphData={data}
        nodeLabel="name"
        nodeColor="color"
        nodeVal="size"
        linkColor="color"
        backgroundColor={theme === 'dark' ? '#1E1B18' : '#F5F1E9'} /* p-ebony-700 / p-stone-50 */
        showNavInfo={false}
        linkOpacity={0.3}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.005}
        nodeRelSize={6}
      />
    </motion.div>
  )
}
