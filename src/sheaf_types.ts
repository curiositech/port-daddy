export type StalkVector = number[];

export interface RestrictionMap { source: string; edge: string; matrix: number[][]; }

export interface SheafGraph { vertices: string[]; edges: { id: string; u: string; v: string; }[]; }

export interface CoboundaryResult { residual: number; edgeResiduals: Record<string, number>; isConsensus: boolean; }