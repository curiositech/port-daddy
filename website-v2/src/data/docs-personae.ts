// Stub: the `/docs/personae` and `/docs/lifecycle/*` pages haven't shipped
// yet (see Copilot review on PR #20 — soft-404 sitemap entries removed).
// DocsSidebar still references these arrays, so we export empty lists to
// keep the build green; the persona + lifecycle sections render as empty
// shells until the data + pages actually land.
export interface DocsPersona {
  slug: string;
  shortName: string;
}

export interface DocsLifecycleStage {
  slug: string;
  title: string;
}

export const docsPersonae: DocsPersona[] = [];
export const docsLifecycleStages: DocsLifecycleStage[] = [];
