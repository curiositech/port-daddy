import React, { useEffect, useRef } from 'react'
import mermaid from 'mermaid'
import { Surface } from './Surface'

interface MermaidProps {
  chart: string
}

export const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Read CSS custom properties at render time so theme changes are picked up
    const root = document.documentElement
    const style = getComputedStyle(root)
    const primary = style.getPropertyValue('--brand-secondary').trim() || '#4A9D9E'
    const surface = style.getPropertyValue('--surface-base').trim() || '#f8fafc'
    const raised = style.getPropertyValue('--surface-raised').trim() || '#ffffff'
    const border = style.getPropertyValue('--border-strong').trim() || '#e2e8f0'
    const text = style.getPropertyValue('--text-primary').trim() || '#1E1B18'

    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      themeVariables: {
        primaryColor: primary,
        primaryTextColor: '#ffffff',
        primaryBorderColor: primary,
        lineColor: primary,
        secondaryColor: primary,
        tertiaryColor: surface,
        mainBkg: raised,
        nodeBorder: primary,
        clusterBkg: surface,
        clusterBorder: border,
        defaultLinkColor: primary,
        titleColor: primary,
        edgeLabelBackground: raised,
        nodeTextColor: text,
      }
    })

    if (ref.current && chart) {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`
      mermaid.render(id, chart).then((result) => {
        if (ref.current) {
          ref.current.innerHTML = result.svg
        }
      })
    }
  }, [chart])

  return (
    <Surface
      depth="inset"
      radius="3xl"
      padding="xl"
      className="my-12 flex justify-center"
      ref={ref}
    />
  )
}
