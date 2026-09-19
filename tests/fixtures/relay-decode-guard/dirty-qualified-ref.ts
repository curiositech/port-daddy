function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

declare const namespaceLike: { decodeURIComponent: (value: string) => string };
declare const maybeNamespace: typeof namespaceLike | undefined;

const namespaceCall = namespaceLike.decodeURIComponent('%ZZ');
const globalCall = globalThis.decodeURIComponent('%ZZ');
const optionalReference = maybeNamespace?.decodeURIComponent;
const computedGlobal = globalThis['decodeURIComponent']('%ZZ');

export { namespaceCall, globalCall, optionalReference, computedGlobal };
