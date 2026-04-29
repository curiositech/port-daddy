import * as React from 'react'

interface GlyphProps {
  size?: number
  className?: string
  style?: React.CSSProperties
  title?: string
}

interface BaseGlyphProps extends GlyphProps {
  viewBox: string
  children: React.ReactNode
}

function BaseGlyph({ size = 20, className, style, title, viewBox, children }: BaseGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      style={style}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : 'true'}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function HarborGlyph({ size = 20, className, style, title = 'Harbor' }: GlyphProps) {
  return (
    <BaseGlyph size={size} className={className} style={style} title={title} viewBox="0 0 32 32">
      <path d="M6 7V25H12" strokeWidth="2.25" />
      <path d="M26 7V25H20" strokeWidth="2.25" />
      <line x1="12" y1="25" x2="20" y2="25" strokeWidth="2.25" />
      <line x1="16" y1="9" x2="16" y2="21" strokeWidth="2.25" />
      <line x1="11.5" y1="13" x2="20.5" y2="13" strokeWidth="2.25" />
      <path d="M16 21C14.1 21.5 12.7 22.9 11.8 25" strokeWidth="2" />
      <path d="M16 21C17.9 21.5 19.3 22.9 20.2 25" strokeWidth="2" />
    </BaseGlyph>
  )
}

export function FleetGlyph({ size = 20, className, style, title = 'Fleet' }: GlyphProps) {
  return (
    <BaseGlyph size={size} className={className} style={style} title={title} viewBox="0 0 32 32">
      <rect x="3.5" y="20.5" width="8" height="8" strokeWidth="2.25" />
      <rect x="20.5" y="20.5" width="8" height="8" strokeWidth="2.25" />
      <rect x="12" y="4" width="8" height="8" strokeWidth="2.25" />
      <line x1="16" y1="12" x2="16" y2="18" strokeWidth="2.25" />
      <line x1="7.5" y1="20.5" x2="16" y2="18" strokeWidth="2.25" />
      <line x1="24.5" y1="20.5" x2="16" y2="18" strokeWidth="2.25" />
    </BaseGlyph>
  )
}

export function SortieGlyph({ size = 20, className, style, title = 'Sortie' }: GlyphProps) {
  return (
    <BaseGlyph size={size} className={className} style={style} title={title} viewBox="0 0 32 32">
      <path d="M6 7V25H16" strokeWidth="2.25" />
      <path d="M12 20L25 7" strokeWidth="2.25" />
      <path d="M18 7H25V14" strokeWidth="2.25" />
    </BaseGlyph>
  )
}

export function SpiderGlyph({ size = 20, className, style, title = 'Spider' }: GlyphProps) {
  return (
    <BaseGlyph size={size} className={className} style={style} title={title} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="3.5" strokeWidth="2.25" />
      <circle cx="16" cy="5" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="25.5" cy="10" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="26" cy="22.5" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="16" cy="27" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="6" cy="22.5" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="10" r="1.75" fill="currentColor" stroke="none" />
      <line x1="16" y1="12.5" x2="16" y2="6.75" strokeWidth="2.25" />
      <line x1="19" y1="13.5" x2="24" y2="10.75" strokeWidth="2.25" />
      <line x1="19" y1="18.5" x2="24.25" y2="21.25" strokeWidth="2.25" />
      <line x1="16" y1="19.5" x2="16" y2="25.25" strokeWidth="2.25" />
      <line x1="13" y1="18.5" x2="7.75" y2="21.25" strokeWidth="2.25" />
      <line x1="13" y1="13.5" x2="8" y2="10.75" strokeWidth="2.25" />
    </BaseGlyph>
  )
}

export function CartographerGlyph({ size = 20, className, style, title = 'Cartographer' }: GlyphProps) {
  return (
    <BaseGlyph size={size} className={className} style={style} title={title} viewBox="0 0 32 32">
      <path d="M5 7L12 4L20 7L27 4V25L20 28L12 25L5 28V7Z" strokeWidth="2.25" />
      <line x1="12" y1="4.5" x2="12" y2="25" strokeWidth="2.25" />
      <line x1="20" y1="7" x2="20" y2="27.5" strokeWidth="2.25" />
      <path d="M9 22C11 18 13.6 16.2 16.1 15.6C18.4 15 20.5 12.5 23 9.5" strokeWidth="2" />
      <circle cx="9" cy="22" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="15.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="23" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
    </BaseGlyph>
  )
}

export function ControlPlaneGlyph({ size = 20, className, style, title = 'Control plane' }: GlyphProps) {
  return (
    <BaseGlyph size={size} className={className} style={style} title={title} viewBox="0 0 32 32">
      <rect x="4.5" y="5.5" width="23" height="21" strokeWidth="2.25" />
      <line x1="10.5" y1="5.5" x2="10.5" y2="26.5" strokeWidth="2.25" />
      <line x1="10.5" y1="12.5" x2="27.5" y2="12.5" strokeWidth="2.25" />
      <line x1="14" y1="18" x2="24" y2="18" strokeWidth="2.25" />
      <line x1="14" y1="22" x2="21" y2="22" strokeWidth="2.25" />
      <rect x="6.25" y="8" width="2.5" height="2.5" fill="currentColor" stroke="none" />
    </BaseGlyph>
  )
}

export function DaemonGlyph({ size = 20, className, style, title = 'Daemon' }: GlyphProps) {
  return (
    <BaseGlyph size={size} className={className} style={style} title={title} viewBox="0 0 32 32">
      <rect x="5.5" y="5.5" width="21" height="21" strokeWidth="2.25" />
      <rect x="21" y="4" width="5" height="5" fill="currentColor" stroke="none" />
      <rect x="12" y="9.5" width="8" height="4.5" strokeWidth="2" />
      <line x1="16" y1="14" x2="16" y2="21" strokeWidth="2" />
      <line x1="10.5" y1="17" x2="21.5" y2="17" strokeWidth="2" />
      <path d="M16 21C13.9 21.4 12.4 22.8 11.6 25" strokeWidth="2" />
      <path d="M16 21C18.1 21.4 19.6 22.8 20.4 25" strokeWidth="2" />
    </BaseGlyph>
  )
}
