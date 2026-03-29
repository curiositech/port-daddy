import * as React from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { motion } from 'framer-motion'
import { useTheme } from '@/lib/theme'

interface GraphData {
  nodes: any[]
  links: any[]
}

export function Graph3D({ services = [], agents = [] }: { services: any[], agents: any[] }) {
  const { theme } = useTheme()
  const fgRef = React.useRef<any>(null)

  const data = React.useMemo<GraphData>(() => {
    // Harbor Heritage palette (resolved hex — 3D library can't use CSS vars)
    const TEAL_400 = '#5BB0B1'   // --p-teal-400
    const TEAL_300 = '#7CC4C5'   // --p-teal-300
    const GOLD_300 = '#D4AD7C'   // --p-gold-300

    const nodes = [
      { id: 'core', name: 'Port Daddy', color: TEAL_400, size: 12 }
    ]
    const links: any[] = []

    services.forEach((s: any) => {
      nodes.push({ id: `svc:${s.id}`, name: s.id, color: TEAL_300, size: 8 })
      links.push({ source: 'core', target: `svc:${s.id}`, color: TEAL_400 })
    })

    agents.forEach((a: any) => {
      nodes.push({ id: `agt:${a.id}`, name: a.id, color: GOLD_300, size: 6 })
      // Heuristic connection
      const service = services.find((s: any) => a.identity?.startsWith(s.id.split(':')[0]))
      links.push({ source: service ? `svc:${service.id}` : 'core', target: `agt:${a.id}`, color: GOLD_300 })
    })

    return { nodes, links }
  }, [services, agents])

  return (
    <motion.div className="w-full h-full rounded-3xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface-overlay)] font-sans">
      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        nodeLabel="name"
        nodeColor={(node: any) => node.color}
        nodeVal={(node: any) => node.size}
        linkColor={(link: any) => link.color}
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
