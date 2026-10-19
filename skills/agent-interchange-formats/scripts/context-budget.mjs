/** Pure local planning helper; it does not estimate provider tokens or send a handoff. */
function safeNonnegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function compareCodePoints(left, right) {
  const a = Array.from(left), b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const delta = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (delta) return delta;
  }
  return a.length - b.length;
}
function publicParts(selected) {
  return selected.slice().sort((a, b) => a.index - b.index).map(({ index, ...part }) => part);
}

/**
 * Select a deterministic subset of locally described context parts. `measureEnvelope`
 * receives every candidate in original source order and must measure the complete
 * encoded envelope, including local headers and separators. `overheadTokens` covers
 * only context outside that envelope. Required parts never drop.
 */
export function selectContextParts({ capacityTokens, reservedTokens, overheadTokens, parts, measureEnvelope }) {
  if (![capacityTokens, reservedTokens, overheadTokens].every(safeNonnegativeInteger) ||
      !Array.isArray(parts) || typeof measureEnvelope !== "function") {
    return { status: "UNRESOLVED_CONTEXT_BUDGET", reason: "INVALID_LOCAL_BUDGET_INPUT", parts: [] };
  }
  const availableTokens = capacityTokens - reservedTokens - overheadTokens;
  if (availableTokens < 0) return { status: "UNRESOLVED_CONTEXT_BUDGET", reason: "RESERVES_EXCEED_CAPACITY", availableTokens, parts: [] };
  const normalized = parts.map((part, index) => ({ ...part, index }));
  if (normalized.some((part) => !part || typeof part !== "object" || typeof part.id !== "string" || !part.id ||
      !safeNonnegativeInteger(part.tokenEstimate) || typeof part.required !== "boolean" || !safeNonnegativeInteger(part.priority)) ||
      new Set(normalized.map((part) => part.id)).size !== normalized.length) {
    return { status: "UNRESOLVED_CONTEXT_BUDGET", reason: "INVALID_PARTS", availableTokens, parts: [] };
  }
  let selected = normalized.slice(); // Always source order for every exact-envelope measurement.
  const removable = normalized.filter((part) => !part.required).sort((a, b) =>
    a.priority - b.priority || compareCodePoints(a.id, b.id)); // lower priority drops first
  const measure = () => {
    try {
      const measuredTokens = measureEnvelope(publicParts(selected));
      if (!safeNonnegativeInteger(measuredTokens)) return { ok: false, reason: "INVALID_ENVELOPE_MEASUREMENT", measuredTokens };
      return { ok: true, measuredTokens };
    } catch (error) {
      return { ok: false, reason: "ENVELOPE_MEASUREMENT_THROWN", errorName: error?.name || "Error" };
    }
  };
  let result = measure();
  if (!result.ok) return { status: "UNRESOLVED_CONTEXT_BUDGET", ...result, availableTokens, parts: publicParts(selected) };
  while (result.measuredTokens > availableTokens && removable.length) {
    const removed = removable.shift();
    selected = selected.filter((part) => part.id !== removed.id);
    result = measure();
    if (!result.ok) return { status: "UNRESOLVED_CONTEXT_BUDGET", ...result, availableTokens, parts: publicParts(selected) };
  }
  if (result.measuredTokens > availableTokens) {
    return { status: "UNRESOLVED_CONTEXT_BUDGET", reason: "REQUIRED_ENVELOPE_EXCEEDS_BUDGET", availableTokens, measuredTokens: result.measuredTokens, parts: publicParts(selected) };
  }
  return { status: "READY", availableTokens, measuredTokens: result.measuredTokens, parts: publicParts(selected) };
}
