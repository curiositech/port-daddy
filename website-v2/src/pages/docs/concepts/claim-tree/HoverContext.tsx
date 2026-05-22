import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SessionId } from './data'

/**
 * Shared hover state across every visualization on the page. When the
 * reader hovers a session in one viz, every other viz dims everything
 * not belonging to that session. This is the unifying "story" element.
 */
interface HoverState {
  session: SessionId | null
  setSession: (s: SessionId | null) => void
  nodeId: string | null
  setNodeId: (n: string | null) => void
}

const HoverCtx = createContext<HoverState>({
  session: null,
  setSession: () => {},
  nodeId: null,
  setNodeId: () => {},
})

export function ClaimTreeHoverProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionId | null>(null)
  const [nodeId, setNodeId] = useState<string | null>(null)
  const value = useMemo(() => ({ session, setSession, nodeId, setNodeId }), [session, nodeId])
  return <HoverCtx.Provider value={value}>{children}</HoverCtx.Provider>
}

export function useHover() {
  return useContext(HoverCtx)
}

/**
 * Opacity helper: dim a mark when there's a hovered session that doesn't
 * match this mark. Pass `null` if the mark doesn't belong to any session
 * (e.g., unclaimed nodes get the dim treatment too).
 */
export function dimFor(markSession: SessionId | null | undefined, hovered: SessionId | null): number {
  if (!hovered) return 1
  return markSession === hovered ? 1 : 0.25
}
