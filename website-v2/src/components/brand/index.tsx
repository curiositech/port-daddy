/**
 * Port Daddy brand mark roster — the single typed home for every official logo.
 *
 * The SVG source of truth lives in `public/logos/`. These components pick the
 * right theme variant and apply consistent sizing so call sites never hard-code
 * an asset path or guess a pixel size. See `public/logos/README.md` for the
 * full roster index and usage guidance.
 *
 * Palette (do NOT use the retired Harbor-Heritage warm colors):
 *   cobalt #2076FE · seafoam #12B88F (light) / #20DEB0 (dark) · amber #F5A623 (light) / #FFB505 (dark)
 */
import * as React from 'react'

import { useTheme } from '@/lib/theme-context'

type DivProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>

interface MarkProps extends DivProps {
  /** Square edge length in px. Defaults to 40 (navbar size). */
  size?: number
  /** Force a theme variant instead of reading the live theme. */
  variant?: 'light' | 'dark'
  /** Animated (spinning radar) vs static. Default: animated. */
  animated?: boolean
  /** Accessible label. Pass `''` for decorative use alongside a wordmark. */
  alt?: string
}

const ASSET = {
  markAnimated: {
    light: '/logos/portdaddy-animated-lightmode.svg',
    dark: '/logos/portdaddy-animated-darkmode.svg',
  },
  markStatic: {
    light: '/logos/portdaddy-static-lightmode.svg',
    dark: '/logos/portdaddy-static-darkmode.svg',
  },
  markSmall: {
    light: '/logos/portdaddy-mark-small-light.svg',
    dark: '/logos/portdaddy-mark-small-dark.svg',
  },
  wordmark: {
    light: '/logos/portdaddy-wordmark-light.svg',
    dark: '/logos/portdaddy-wordmark-dark.svg',
  },
} as const

function useVariant(forced?: 'light' | 'dark'): 'light' | 'dark' {
  const { theme } = useTheme()
  return forced ?? theme
}

/**
 * The flagship radar mark. Animated by default (the spinning radar); pass
 * `animated={false}` for the glossy static version. This is the canonical
 * brand mark — use it in the hero and anywhere the full logo belongs.
 */
export function PortDaddyMark({
  size = 40,
  variant,
  animated = true,
  alt = 'Port Daddy',
  className,
  style,
  ...rest
}: MarkProps) {
  const v = useVariant(variant)
  const src = (animated ? ASSET.markAnimated : ASSET.markStatic)[v]
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, ...style }}
      {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)}
    />
  )
}

/**
 * Favicon-grade small mark (monogram only, no radar). Stays legible down to
 * 16px. Use in dense chrome — tab strips, breadcrumb crumbs, compact toolbars.
 */
export function PortDaddyMarkSmall({
  size = 24,
  variant,
  alt = 'Port Daddy',
  className,
  style,
  ...rest
}: Omit<MarkProps, 'animated'>) {
  const v = useVariant(variant)
  return (
    <img
      src={ASSET.markSmall[v]}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, ...style }}
      {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)}
    />
  )
}

interface MonoProps extends React.SVGProps<SVGSVGElement> {
  size?: number
  title?: string
}

/**
 * Monochrome inline mark. Inherits `currentColor`, so it tints to the
 * surrounding text/icon color — the right choice inside buttons, nav links,
 * footers, and anywhere a single-color glyph is wanted. Rendered inline (not an
 * <img>) so `currentColor` resolves.
 */
export function PortDaddyMarkMono({ size = 20, title = 'Port Daddy', ...rest }: MonoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label={title}
      {...rest}
    >
      <g stroke="currentColor" strokeWidth={10} strokeLinecap="butt" fill="none">
        <line x1="32" y1="15" x2="32" y2="85" />
        <circle cx="48" cy="40" r="16" />
        <line x1="68" y1="85" x2="68" y2="15" />
        <circle cx="52" cy="60" r="16" />
      </g>
    </svg>
  )
}

interface WordmarkProps extends DivProps {
  /** Rendered width in px. Height follows the 720×220 lockup aspect (≈0.306×). */
  width?: number
  variant?: 'light' | 'dark'
  alt?: string
}

/**
 * Horizontal "Port Daddy" lockup — mark + type + tagline rule. Use in
 * marketing headers, footers, share cards, and slides where the name should
 * read alongside the mark. Theme-aware.
 */
export function PortDaddyWordmark({
  width = 280,
  variant,
  alt = 'Port Daddy',
  className,
  style,
  ...rest
}: WordmarkProps) {
  const v = useVariant(variant)
  const height = Math.round((width * 220) / 720)
  return (
    <img
      src={ASSET.wordmark[v]}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={{ width, height, ...style }}
      {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)}
    />
  )
}

export const BRAND_LOGO_ASSETS = ASSET
