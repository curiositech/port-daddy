import React, { useEffect, useRef, useCallback, useId } from 'react'
import mermaid from 'mermaid'
import { Surface } from './Surface'

interface MermaidProps {
  chart: string
}

export const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null)
  const idPrefix = useId().replace(/:/g, '')
  const renderCount = useRef(0)

  const renderChart = useCallback(() => {
    const root = document.documentElement
    const style = getComputedStyle(root)
    const token = (name: string) => style.getPropertyValue(name).trim() || `var(${name})`

    const primary = token('--brand-secondary')
    const surface = token('--surface-base')
    const raised = token('--surface-raised')
    const border = token('--border-strong')
    const text = token('--text-primary')
    const inverse = token('--text-inverse')
    const signalText = token('--text-primary')
    const signalLine = token('--brand-secondary')
    const actorLine = token('--border-strong')

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      themeVariables: {
        primaryColor: primary,
        primaryTextColor: inverse,
        primaryBorderColor: primary,
        lineColor: signalLine,
        secondaryColor: primary,
        tertiaryColor: surface,
        mainBkg: raised,
        nodeBorder: primary,
        clusterBkg: surface,
        clusterBorder: border,
        defaultLinkColor: signalLine,
        titleColor: text,
        edgeLabelBackground: 'transparent',
        nodeTextColor: text,
        // Sequence diagram specific
        signalColor: signalLine,
        signalTextColor: signalText,
        actorTextColor: text,
        actorLineColor: actorLine,
        activationBorderColor: primary,
        sequenceNumberColor: inverse,
        labelTextColor: signalText,
        loopTextColor: signalText,
        noteBkgColor: raised,
        noteTextColor: text,
        noteBorderColor: border,
      }
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
            ref.current.textContent = ''
            ref.current.appendChild(document.importNode(svg, true))
          }
        }
      })
    }
  }, [chart, idPrefix])

  useEffect(() => {
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
  }, [renderChart])

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
