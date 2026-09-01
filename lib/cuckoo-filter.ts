/**
 * Cuckoo Filter — Fan, Andersen, Kaminsky, Mitzenmacher (2014)
 *
 *   "Cuckoo Filter: Practically Better Than Bloom"
 *   https://www.cs.cmu.edu/~dga/papers/cuckoo-conext2014.pdf
 *
 * Spec:    whitepaper/formal/proverif/bonded/recovery/cuckoo-pollution.md (theoretical bound A3)
 * Runtime: lib/cuckoo-filter.ts  (you are here)
 *
 * Parameters per the paper for the "standard" configuration:
 *
 *   B (entries per bucket) = 4
 *   f (fingerprint bits)   = 8        — 1 byte; value 0 reserved for "empty"
 *   MaxKicks               = 500
 *
 * Theoretical false-positive bound (paper §3):
 *
 *   fpRate ≤ 2·B / 2^f = 8 / 256 = 0.03125
 *
 * Capacity ceiling — we reject inserts beyond load-factor 0.95 (paper §6
 * shows insert failures dominate beyond ~95% on B=4 configurations).
 *
 * Use case in Bonded Commons / Anchor Protocol: rate-limit membership
 * tests in bond-escrow flows (e.g. "has this delegation_id already been
 * spent in the last N seconds?") without storing or revealing the full
 * set. The filter exposes false-positives at a bounded rate but never
 * false-negatives, which is exactly the safety property the rate-limit
 * gate needs.
 */

import { createHash } from 'node:crypto';

export const BUCKET_SIZE = 4;
export const FINGERPRINT_BITS = 8;
export const FINGERPRINT_MAX = 255; // 2^8 - 1; 0 reserved as "empty"
export const DEFAULT_MAX_KICKS = 500;
export const MAX_LOAD_FACTOR = 0.95;

export interface CuckooFilterOptions {
  /** Total number of buckets. Should be a power of two (rounded up if not). */
  numBuckets: number;
  /** Override the kick ceiling for insert path. */
  maxKicks?: number;
}

export interface CuckooStats {
  numBuckets: number;
  capacity: number;
  size: number;
  loadFactor: number;
  insertFailures: number;
}

function nextPow2(n: number): number {
  if (n <= 1) return 1;
  return 1 << Math.ceil(Math.log2(n));
}

function sha256Bytes(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

function asBuf(key: string | Buffer): Buffer {
  return Buffer.isBuffer(key) ? key : Buffer.from(key, 'utf8');
}

/** 32-bit unsigned index hash. */
function indexHash(key: Buffer): number {
  const h = sha256Bytes(key);
  return h.readUInt32BE(0) >>> 0;
}

/** 8-bit fingerprint, value in [1, 255]. 0 is reserved. */
function fingerprint(key: Buffer): number {
  const h = sha256Bytes(key);
  // Take a separate byte from the digest so fp and indexHash are independent.
  const fp = h.readUInt8(4);
  return fp === 0 ? 1 : fp;
}

/** Hash of the fingerprint used to compute the alternative bucket index. */
function fingerprintHash(fp: number): number {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(fp, 0);
  return indexHash(buf);
}

export class CuckooFilter {
  readonly numBuckets: number;
  readonly maxKicks: number;
  /**
   * Hard size ceiling: the largest size whose resulting load-factor still
   * sits at or below MAX_LOAD_FACTOR. We floor (not ceil/round) so the
   * post-insert load-factor can never CROSS the ceiling — the previous
   * `loadFactor >= MAX_LOAD_FACTOR` guard was an off-by-one because it
   * tested the load factor BEFORE the insert, letting the size that
   * triggered the next rejection land just above the ceiling (e.g.
   * 244/256 = 0.953 on a B=4, 64-bucket filter).
   */
  readonly maxSize: number;
  private buckets: Uint8Array;
  private _size = 0;
  private _insertFailures = 0;

  constructor(opts: CuckooFilterOptions) {
    if (!opts || !Number.isFinite(opts.numBuckets) || opts.numBuckets < 1) {
      throw new Error('CuckooFilter requires positive numBuckets');
    }
    this.numBuckets = nextPow2(opts.numBuckets);
    this.maxKicks = opts.maxKicks ?? DEFAULT_MAX_KICKS;
    this.buckets = new Uint8Array(this.numBuckets * BUCKET_SIZE);
    this.maxSize = Math.floor(this.numBuckets * BUCKET_SIZE * MAX_LOAD_FACTOR);
  }

  get capacity(): number {
    return this.numBuckets * BUCKET_SIZE;
  }

  get size(): number {
    return this._size;
  }

  get loadFactor(): number {
    return this._size / this.capacity;
  }

  stats(): CuckooStats {
    return {
      numBuckets: this.numBuckets,
      capacity: this.capacity,
      size: this._size,
      loadFactor: this.loadFactor,
      insertFailures: this._insertFailures,
    };
  }

  private bucketIndex(h: number): number {
    return h & (this.numBuckets - 1);
  }

  private slot(bucket: number, entry: number): number {
    return bucket * BUCKET_SIZE + entry;
  }

  private bucketHasFp(bucket: number, fp: number): boolean {
    const base = bucket * BUCKET_SIZE;
    for (let i = 0; i < BUCKET_SIZE; i++) {
      if (this.buckets[base + i] === fp) return true;
    }
    return false;
  }

  private bucketInsert(bucket: number, fp: number): boolean {
    const base = bucket * BUCKET_SIZE;
    for (let i = 0; i < BUCKET_SIZE; i++) {
      if (this.buckets[base + i] === 0) {
        this.buckets[base + i] = fp;
        return true;
      }
    }
    return false;
  }

  private bucketDelete(bucket: number, fp: number): boolean {
    const base = bucket * BUCKET_SIZE;
    for (let i = 0; i < BUCKET_SIZE; i++) {
      if (this.buckets[base + i] === fp) {
        this.buckets[base + i] = 0;
        return true;
      }
    }
    return false;
  }

  /**
   * Insert key. Returns true on success, false if the filter rejects
   * (full or kick budget exhausted).
   *
   * Rejecting beyond MAX_LOAD_FACTOR is the runtime analogue of the
   * paper's §6 observation that insert-success collapses near load=1.
   * Hard-rejecting at 0.95 keeps false-positive rate inside the bound.
   */
  insert(key: string | Buffer): boolean {
    // Reject BEFORE the insert if accepting would push size past the ceiling.
    // Gating on `_size >= maxSize` (rather than `loadFactor >= MAX_LOAD_FACTOR`)
    // guarantees the post-insert load-factor is always <= MAX_LOAD_FACTOR.
    if (this._size >= this.maxSize) {
      this._insertFailures++;
      return false;
    }
    const buf = asBuf(key);
    const fp = fingerprint(buf);
    const i1 = this.bucketIndex(indexHash(buf));
    const i2 = this.bucketIndex(i1 ^ fingerprintHash(fp));

    if (this.bucketInsert(i1, fp) || this.bucketInsert(i2, fp)) {
      this._size++;
      return true;
    }

    // Both candidate buckets full. Kick.
    let bucket = Math.random() < 0.5 ? i1 : i2;
    let kickFp = fp;
    for (let n = 0; n < this.maxKicks; n++) {
      const entryIdx = Math.floor(Math.random() * BUCKET_SIZE);
      const slot = this.slot(bucket, entryIdx);
      const evicted = this.buckets[slot];
      this.buckets[slot] = kickFp;
      kickFp = evicted;
      bucket = this.bucketIndex(bucket ^ fingerprintHash(kickFp));
      if (this.bucketInsert(bucket, kickFp)) {
        this._size++;
        return true;
      }
    }
    this._insertFailures++;
    return false;
  }

  /** Membership test. May false-positive, never false-negative. */
  contains(key: string | Buffer): boolean {
    const buf = asBuf(key);
    const fp = fingerprint(buf);
    const i1 = this.bucketIndex(indexHash(buf));
    const i2 = this.bucketIndex(i1 ^ fingerprintHash(fp));
    return this.bucketHasFp(i1, fp) || this.bucketHasFp(i2, fp);
  }

  /**
   * Delete key. Returns true if one fingerprint matching key was removed.
   *
   * Note: a deletion of a key that was never inserted but happens to share
   * a fingerprint+bucket with another inserted key will succeed and remove
   * that other key. The paper documents this — cuckoo filters require the
   * caller to only delete keys it knows were inserted.
   */
  delete(key: string | Buffer): boolean {
    const buf = asBuf(key);
    const fp = fingerprint(buf);
    const i1 = this.bucketIndex(indexHash(buf));
    const i2 = this.bucketIndex(i1 ^ fingerprintHash(fp));
    if (this.bucketDelete(i1, fp) || this.bucketDelete(i2, fp)) {
      this._size--;
      return true;
    }
    return false;
  }

  /** Test-only: reset state. */
  reset(): void {
    this.buckets.fill(0);
    this._size = 0;
    this._insertFailures = 0;
  }
}

/**
 * Theoretical false-positive bound for default config (B=4, f=8 bits):
 *   2·B / 2^f = 8 / 256 = 0.03125
 *
 * Exported so the property test can assert against it directly rather
 * than re-deriving the constant.
 */
export const FP_RATE_UPPER_BOUND = (2 * BUCKET_SIZE) / Math.pow(2, FINGERPRINT_BITS);
