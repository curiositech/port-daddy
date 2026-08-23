export async function replaceRoadmapMirror(
  env: { DB: D1Database },
  userId: string,
  repoFullName: string,
  harbor: string,
  input: {
    items?: Array<{ slug: string; status: string; kind: string; priority: string; summaryMd?: string; descriptionMd?: string; assigneeId?: string; startedAt?: string; dueAt?: string; estimate?: string; lastTouchedAt?: string; createdAt?: string; deletedAt?: string; dependencies?: string; notes?: string }>;
    edges?: Array<{ scope: string; sourceId: string; edgeType: string; targetId: string }>;
    activity?: Array<{ at: string; slug: string; kind: string; byId: string; detail: string }>;
  },
)