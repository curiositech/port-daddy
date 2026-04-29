import * as React from 'react'

interface Props {
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Port Daddy PD Circuit monogram.
 * A compact app/header mark: PD letterform plus the shared-state channel that
 * lets agents talk through notes, claims, inboxes, readiness, and handoffs.
 */
export function PortDaddyMark({ size = 120, className, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      className={className}
      style={style}
      role="img"
      aria-label="Port Daddy PD Circuit monogram"
    >
      <rect
        x="10"
        y="10"
        width="108"
        height="108"
        fill="var(--surface-raised, #f7f3eb)"
        stroke="currentColor"
        strokeWidth="8"
      />
      <path
        d="M34 94V34h32c18.5 0 30 12 30 30S84.5 94 66 94H34Z"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinejoin="miter"
      />
      <path
        d="M62 34v60"
        stroke="var(--brand-primary, #003fb8)"
        strokeWidth="9"
        strokeLinecap="square"
      />
      <path d="M62 64h42" stroke="currentColor" strokeWidth="9" strokeLinecap="square" />
      <rect
        x="94"
        y="54"
        width="20"
        height="20"
        fill="var(--brand-primary, #003fb8)"
        stroke="currentColor"
        strokeWidth="6"
      />
    </svg>
  )
}

/**
 * One-color template variant for small monochrome contexts.
 */
export function PortDaddyAnchor({ size = 20, className, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      stroke="currentColor"
      className={className}
      style={style}
      role="img"
      aria-label="Port Daddy template monogram"
    >
      <rect x="10" y="10" width="108" height="108" strokeWidth="8" />
      <path
        d="M34 94V34h32c18.5 0 30 12 30 30S84.5 94 66 94H34Z"
        strokeWidth="9"
        strokeLinejoin="miter"
      />
      <path d="M62 34v60" strokeWidth="9" strokeLinecap="square" />
      <path d="M62 64h42" strokeWidth="9" strokeLinecap="square" />
      <rect x="94" y="54" width="20" height="20" strokeWidth="6" />
    </svg>
  )
}
