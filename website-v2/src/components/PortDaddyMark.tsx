import * as React from 'react'

interface Props {
  size?: number
  className?: string
  style?: React.CSSProperties
}

export function PortDaddyMark({ size = 120, className, style }: Props) {
  const clipId = React.useId()
  const gradientId = React.useId()

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      className={className}
      style={style}
      role="img"
      aria-label="Port Daddy FleetBar logo"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="64" y="64" width="896" height="896" rx="206" />
        </clipPath>
        <linearGradient id={gradientId} x1="236" y1="220" x2="808" y2="784" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5BB9B7" />
          <stop offset="1" stopColor="#377D80" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="64" y="64" width="896" height="896" fill="#0D0C0B" />
        <rect x="112" y="112" width="800" height="800" rx="152" fill="#161412" />
        <g stroke="#3A3530" strokeWidth="10">
          <path d="M276 140v744" />
          <path d="M456 140v744" />
          <path d="M636 140v744" />
          <path d="M816 140v744" />
          <path d="M140 276h744" />
          <path d="M140 456h744" />
          <path d="M140 636h744" />
          <path d="M140 816h744" />
        </g>
        <path d="M186 196h116v632H186z" fill="#D8C9AE" />
        <path d="M302 196h394v116H302z" fill="#D8C9AE" />
        <path d="M302 454h292v116H302z" fill="#D8C9AE" />
        <path d="M296 626h176c148 0 248-78 248-196 0-114-96-186-242-186H302" stroke="#0D0C0B" strokeWidth="178" strokeLinecap="square" strokeLinejoin="miter" />
        <path d="M334 626h142c126 0 210-76 210-190 0-112-82-182-208-182H334" stroke={`url(#${gradientId})`} strokeWidth="62" strokeLinecap="square" strokeLinejoin="miter" />
        <g fill="#D8C9AE" stroke="#0D0C0B" strokeWidth="26">
          <circle cx="334" cy="626" r="52" />
          <circle cx="478" cy="254" r="52" />
          <circle cx="686" cy="436" r="52" />
        </g>
        <circle cx="742" cy="720" r="70" fill="#CC3D2E" stroke="#0D0C0B" strokeWidth="28" />
        <circle cx="742" cy="720" r="23" fill="#D8C9AE" />
        <path d="M868 112v800" stroke="#D8C9AE" strokeWidth="18" />
        <path d="M112 868h800" stroke="#D8C9AE" strokeWidth="18" />
      </g>
      <rect x="74" y="74" width="876" height="876" rx="196" stroke="#D8C9AE" strokeWidth="20" />
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
