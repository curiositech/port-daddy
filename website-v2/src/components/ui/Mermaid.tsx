import React, { useEffect, useRef, useCallback, useId, useState } from 'react'
import type { Mermaid as MermaidApi } from 'mermaid'
import { cn } from '@/lib/utils'

interface MermaidProps {
  chart: string
  className?: string
}

export const Mermaid: React.FC<MermaidProps> = ({ chart, className }) => {
  const ref = useRef<HTMLDivElement>(null)
  const idPrefix = useId().replace(/:/g, '')
  const renderCount = useRef(0)
  // Dynamic import so the `mermaid` module never evaluates during
  // prerender — it touches `document` / `window` at module scope,
  // which throws under vite-react-ssg.
  const [mermaid, setMermaid] = useState<MermaidApi | null>(null)
  useEffect(() => {
    let active = true
    import('mermaid').then((mod) => {
      if (active) setMermaid(mod.default)
    })
    return () => { active = false }
  }, [])

  const renderChart = useCallback(() => {
    if (!mermaid) return
    // Render diagrams as a theme-INDEPENDENT light "paper" card so they stay
    // legible in dark mode (the old version inherited dark tokens -> dark text
    // on a dark inset gradient, and the SVG rendered at tiny natural size).
    const ink = '#1A1A2E' // indigo-black
    const paper = '#f7f3eb' // raised cream
    const paperBase = '#f2eee6'
    const cobalt = '#003fb8'
    const lifeline = '#9a948a'

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      themeVariables: {
        primaryColor: paper,
        primaryTextColor: ink,
        primaryBorderColor: ink,
        lineColor: cobalt,
        secondaryColor: paperBase,
        tertiaryColor: paperBase,
        mainBkg: paper,
        nodeBorder: ink,
        clusterBkg: paperBase,
        clusterBorder: ink,
        defaultLinkColor: cobalt,
        titleColor: ink,
        textColor: ink,
        edgeLabelBackground: paper,
        nodeTextColor: ink,
        // Sequence diagram specific
        signalColor: cobalt,
        signalTextColor: ink,
        actorBkg: paper,
        actorBorder: ink,
        actorTextColor: ink,
        actorLineColor: lifeline,
        activationBorderColor: cobalt,
        activationBkgColor: paperBase,
        sequenceNumberColor: '#fbf7ef',
        labelBoxBkgColor: paperBase,
        labelBoxBorderColor: ink,
        labelTextColor: ink,
        loopTextColor: ink,
        noteBkgColor: '#fff3d6',
        noteTextColor: ink,
        noteBorderColor: ink,
        fontFamily: '"Source Sans 3", "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: '15px',
      },
      flowchart: {
        curve: 'basis',
        htmlLabels: true,
        nodeSpacing: 72,
        rankSpacing: 82,
        padding: 22,
        useMaxWidth: true,
      },
      sequence: {
        useMaxWidth: true,
        diagramMarginX: 8,
        diagramMarginY: 8,
        actorMargin: 60,
        boxMargin: 10,
        messageFontSize: 15,
        actorFontSize: 15,
        noteFontSize: 14,
        mirrorActors: true,
      },
    })

    if (ref.current && chart) {
      // mermaid.render produces trusted SVG from our own chart definitions
      ref.current.textContent = ''
      const id = `mermaid-${idPrefix}-${renderCount.current}`
      renderCount.current += 1
      mermaid.render(id, chart).then((result) => {
        if (ref.current) {
          const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml')
          const svg = parsed.documentElement
          if (svg.tagName.toLowerCase() === 'svg') {
            // Fill the container width so the diagram is legible, not tiny.
            svg.setAttribute('width', '100%')
            svg.style.width = '100%'
            svg.style.height = 'auto'
            svg.style.maxWidth = '100%'
            svg.style.display = 'block'
            ref.current.textContent = ''
            ref.current.appendChild(document.importNode(svg, true))
          }
        }
      })
    }
  }, [chart, idPrefix, mermaid])

  useEffect(() => {
    if (!mermaid) return
    renderChart()

    // Re-render when theme changes
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          renderChart()
          break
        }
      }
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [renderChart, mermaid])

  // Light "paper" card, theme-independent — the diagram is always dark-on-cream
  // so it reads the same in light and dark mode (no dark-on-dark gradient).
  return (
    <div
      className={cn(
        'pd-docs-mermaid my-12 flex w-full justify-center overflow-x-auto border-2 border-[var(--border-strong)] bg-[#f7f3eb] p-[var(--space-6)]',
        className,
      )}
      ref={ref}
    />
  )
}
