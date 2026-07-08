/**
 * Embed a JSON value inside an HTML comment safely.
 *
 * The renderers append a hidden `<!-- pd-*-json … -->` machine block so a future
 * bulk-triage handler can re-materialize findings/proposals without re-parsing
 * the prose. The values are MODEL-PROVIDED (untrusted): a body containing `-->`
 * (or `<!--`) would terminate the HTML comment early, leaking the tail into the
 * visible comment and breaking downstream machine parsing.
 *
 * Escaping `<` and `>` to their `\uXXXX` JSON string escapes makes the comment
 * terminator un-formable in the raw text while keeping the payload valid JSON —
 * `JSON.parse` decodes `<` / `>` back to `<` / `>`. Structural JSON
 * never contains `<`/`>`, so escaping every occurrence is safe for the whole
 * serialized output. (This is the same defense used to embed JSON in a `<script>`
 * tag against `</script>` breakout.)
 */
export function htmlCommentSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
