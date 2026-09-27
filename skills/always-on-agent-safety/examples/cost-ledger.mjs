// Zero-effect illustration of a local reservation ledger. No provider calls occur.
const safeAmount = (n) => Number.isSafeInteger(n) && n >= 0;
const validPeriod = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const clone = (value) => structuredClone(value);

export class CostLedger {
  constructor({ policyRevision, currency, periodLimitsMicros, requestLimitMicros }) {
    if (typeof policyRevision !== 'string' || !policyRevision || !/^[A-Z]{3}$/.test(currency)
        || !periodLimitsMicros || typeof periodLimitsMicros !== 'object'
        || !safeAmount(requestLimitMicros)) throw new TypeError('invalid local budget policy');
    this.policyRevision = policyRevision;
    this.currency = currency;
    this.periodLimitsMicros = new Map(Object.entries(periodLimitsMicros));
    this.requestLimitMicros = requestLimitMicros;
    this.records = new Map();
  }

  #key(period, operationId) { return `${period}\u0000${operationId}`; }
  #usage(period) {
    let total = 0n;
    for (const record of this.records.values()) {
      if (record.period !== period) continue;
      const amount = record.state === 'SETTLED' ? record.actualMicros
        : ['RESERVED', 'SUBMITTED', 'UNKNOWN'].includes(record.state) ? record.reservedMicros : 0;
      total += BigInt(amount);
    }
    return total;
  }

  reserve({ period, operationId, amountMicros, rateRevision }) {
    if (!validPeriod(period) || typeof operationId !== 'string' || !operationId
        || !safeAmount(amountMicros) || amountMicros === 0
        || typeof rateRevision !== 'string' || !rateRevision) {
      return { kind: 'UNKNOWN', reason: 'INVALID_RESERVATION_INPUT' };
    }
    const key = this.#key(period, operationId);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.reservedMicros !== amountMicros || existing.rateRevision !== rateRevision
          || existing.policyRevision !== this.policyRevision || existing.currency !== this.currency) {
        return { kind: 'UNKNOWN', reason: 'IDEMPOTENCY_KEY_CONFLICT' };
      }
      return { kind: existing.state, replay: true, record: clone(existing) };
    }
    const cap = this.periodLimitsMicros.get(period);
    if (!safeAmount(cap)) return { kind: 'UNKNOWN', reason: 'PERIOD_POLICY_MISSING' };
    if (amountMicros > this.requestLimitMicros) return { kind: 'DENIED', reason: 'REQUEST_LIMIT' };
    const current = this.#usage(period);
    if (current + BigInt(amountMicros) > BigInt(cap)) return { kind: 'DENIED', reason: 'LOCAL_PERIOD_LIMIT', current: this.usage(period), requested: amountMicros, cap };
    const record = { period, operationId, reservedMicros: amountMicros, actualMicros: null,
      rateRevision, policyRevision: this.policyRevision, currency: this.currency, state: 'RESERVED' };
    this.records.set(key, record);
    return { kind: 'RESERVED', replay: false, record: clone(record) };
  }

  submit(period, operationId) {
    const record = this.records.get(this.#key(period, operationId));
    if (!record) return { kind: 'UNKNOWN', reason: 'RESERVATION_MISSING' };
    if (record.state === 'SUBMITTED') return { kind: 'SUBMITTED', replay: true, record: clone(record) };
    if (record.state !== 'RESERVED') return { kind: 'UNKNOWN', reason: 'INVALID_SUBMIT_STATE' };
    record.state = 'SUBMITTED';
    return { kind: 'SUBMITTED', replay: false, record: clone(record) };
  }

  markUnknown(period, operationId) {
    const record = this.records.get(this.#key(period, operationId));
    if (!record) return { kind: 'UNKNOWN', reason: 'RESERVATION_MISSING' };
    if (record.state === 'UNKNOWN') return { kind: 'UNKNOWN', replay: true, record: clone(record) };
    if (record.state !== 'SUBMITTED') return { kind: 'UNKNOWN', reason: 'INVALID_UNKNOWN_STATE' };
    record.state = 'UNKNOWN'; // Keep the full hold until definitive reconciliation.
    return { kind: 'UNKNOWN', replay: false, record: clone(record) };
  }

  settle(period, operationId, actualMicros, settlementRevision) {
    const record = this.records.get(this.#key(period, operationId));
    if (!record || !safeAmount(actualMicros) || typeof settlementRevision !== 'string' || !settlementRevision) {
      return { kind: 'UNKNOWN', reason: 'INVALID_SETTLEMENT' };
    }
    if (record.state === 'SETTLED') {
      if (record.actualMicros !== actualMicros || record.settlementRevision !== settlementRevision) {
        return { kind: 'UNKNOWN', reason: 'SETTLEMENT_REPLAY_CONFLICT' };
      }
      return { kind: record.actualMicros > record.reservedMicros ? 'OVERRUN' : 'SETTLED', replay: true, record: clone(record) };
    }
    if (record.state !== 'SUBMITTED' && record.state !== 'UNKNOWN') return { kind: 'UNKNOWN', reason: 'INVALID_SETTLEMENT_STATE' };
    record.actualMicros = actualMicros;
    record.settlementRevision = settlementRevision;
    record.state = 'SETTLED'; // Usage is definitive even when it exceeded our reserve.
    return { kind: actualMicros > record.reservedMicros ? 'OVERRUN' : 'SETTLED', replay: false, record: clone(record) };
  }

  cancelBeforeSubmit(period, operationId) {
    const record = this.records.get(this.#key(period, operationId));
    if (!record) return { kind: 'UNKNOWN', reason: 'RESERVATION_MISSING' };
    if (record.state === 'CANCELLED') return { kind: 'CANCELLED', replay: true };
    if (record.state !== 'RESERVED') return { kind: 'UNKNOWN', reason: 'SUBMISSION_MAY_HAVE_OCCURRED' };
    record.state = 'CANCELLED';
    return { kind: 'CANCELLED', replay: false };
  }

  usage(period) {
    const exact = this.#usage(period);
    return exact > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(exact);
  }
}
