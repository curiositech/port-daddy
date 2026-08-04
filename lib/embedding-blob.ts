/**
 * Embedding Blob Codec — shared Float32 vector <-> SQLite BLOB helpers.
 *
 * Motivation: both the whois phonebook (lib/whois.ts) and the intent index
 * (lib/intent-index.ts) persist MiniLM embeddings as Float32Array BLOBs in
 * sidecar tables. Whois grew its own module-private copies of these helpers;
 * rather than copy them a second time (or destabilize whois by refactoring it
 * mid-slice), this tiny module is the single shared codec going forward. New
 * sidecar embedding stores import from here; whois can migrate in a follow-up
 * (Lookout note filed in the introducing PR).
 */

/**
 * Encode an embedding vector as a Float32Array-backed Buffer for BLOB storage.
 *
 * Why Float32 BLOBs and not JSON arrays: the design goal is compactness and
 * zero-parse reads — 384 floats are 1.5KB as a BLOB versus ~4-8KB as JSON,
 * and the format matches what the local embedder returns, so decode is a view,
 * not a parse.
 *
 * @param vector - The embedding as a plain number array (resolver.embed output).
 * @returns A Buffer viewing the vector's Float32 bytes, ready to bind as a BLOB.
 */
export function vectorToBlob(vector: number[]): Buffer {
  const f32 = new Float32Array(vector);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Decode a persisted embedding BLOB back into a Float32Array.
 *
 * Design intent: copy-then-view. better-sqlite3 Buffers can be views into a
 * larger pooled allocation with a non-zero byteOffset that is not 4-byte
 * aligned; constructing the Float32Array over a fresh copy guarantees correct
 * alignment and prevents aliasing the driver's internal buffer pool.
 *
 * @param blob - The BLOB column value as read from SQLite.
 * @returns The embedding vector as a Float32Array.
 */
export function blobToVector(blob: Buffer): Float32Array {
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

/**
 * Min-length dot product between two vectors.
 *
 * Why dot equals cosine here: vectors produced by the shared local embedder
 * (`createLocalEmbedder` / `SemanticResolver.embed`, pooling mean +
 * normalize:true) are already unit-normalized, so cosine similarity reduces to
 * a plain dot product — the same doctrine as `cosineSimilarity` in
 * lib/semantic-resolver.ts. Using the min length keeps a model-dimension
 * mismatch from throwing; model-tagged sidecar rows should prevent that case
 * from ranking at all.
 *
 * @param a - First vector (query or corpus embedding).
 * @param b - Second vector.
 * @returns The dot product over the shared prefix of the two vectors.
 */
export function dotF32(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}
