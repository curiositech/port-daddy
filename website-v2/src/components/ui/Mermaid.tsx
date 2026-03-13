import React, { useEffect, useRef } from 'react'
import mermaid from 'mermaid'

// Port Daddy brand hex codes
const BRAND_PRIMARY = '#3aadad';
const BRAND_SECONDARY = '#56cccc';
const BORDER_STRONG = '#e2e8f0';

interface MermaidProps {
  chart: string
}

export const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      themeVariables: {
        primaryColor: BRAND_PRIMARY,
        primaryTextColor: '#ffffff',
        primaryBorderColor: BRAND_PRIMARY,
        lineColor: BRAND_PRIMARY,
        secondaryColor: BRAND_SECONDARY,
        tertiaryColor: '#f8fafc',
        mainBkg: '#ffffff',
        nodeBorder: BRAND_PRIMARY,
        clusterBkg: '#f8fafc',
        clusterBorder: BORDER_STRONG,
        defaultLinkColor: BRAND_PRIMARY,
        titleColor: BRAND_PRIMARY,
        edgeLabelBackground: '#ffffff',
        nodeTextColor: '#000000' // Force high contrast black text for nodes
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
    <div 
      className="mermaid-container my-12 flex justify-center p-10 rounded-[32px] border bg-white shadow-inner" 
      ref={ref} 
    />
  )
}
