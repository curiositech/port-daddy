export const OPEN_DOCS_SEARCH_EVENT = 'pd-docs-search:open'

export function openDocsSearch() {
  window.dispatchEvent(new Event(OPEN_DOCS_SEARCH_EVENT))
}
