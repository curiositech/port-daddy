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
    const nodes = [
      { id: 'core', name: 'Port Daddy', color: '#3AADB1', size: 12 }
    ]
    const links: any[] = []

    services.forEach((s: any) => {
      nodes.push({ id: `svc:${s.id}`, name: s.id, color: '#2DD4BF', size: 8 })
      links.push({ source: 'core', target: `svc:${s.id}`, color: '#3AADB1' })
    })

    agents.forEach((a: any) => {
      nodes.push({ id: `agt:${a.id}`, name: a.id, color: '#FBBF24', size: 6 })
      // Heuristic connection
      const service = services.find((s: any) => a.identity?.startsWith(s.id.split(':')[0]))
      links.push({ source: service ? `svc:${service.id}` : 'core', target: `agt:${a.id}`, color: '#FBBF24' })
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
        backgroundColor={theme === 'dark' ? '#0F172A' : '#F8FAFC'}
        showNavInfo={false}
        linkOpacity={0.3}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.005}
        nodeRelSize={6}
      />
    </motion.div>
  )
}
