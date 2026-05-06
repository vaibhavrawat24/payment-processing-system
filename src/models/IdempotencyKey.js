'use strict';

class IdempotencyKey {
  constructor(db) {
    this.db = db;
  }

  findByKey(key) {
    return this.db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(key) || null;
  }

  create({ key, paymentId, requestHash, responseStatus, responseBody, ttlMs }) {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO idempotency_keys (key, payment_id, request_hash, response_status, response_body, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(key, paymentId, requestHash, responseStatus, JSON.stringify(responseBody), now, now + ttlMs);
  }

  deleteExpired() {
    return this.db.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?').run(Date.now());
  }
}

module.exports = IdempotencyKey;
