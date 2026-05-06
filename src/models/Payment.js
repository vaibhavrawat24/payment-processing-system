'use strict';

class Payment {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    const row = this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    return row ? this._deserialize(row) : null;
  }

  create(data) {
    const now = Date.now();
    const row = {
      id: data.id,
      merchant_id: data.merchantId,
      amount: data.amount,
      currency: data.currency || 'USD',
      status: 'pending',
      retry_count: 0,
      max_retries: data.maxRetries ?? 3,
      version: 1,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO payments
        (id, merchant_id, amount, currency, status, retry_count, max_retries, version, metadata, created_at, updated_at)
      VALUES
        (@id, @merchant_id, @amount, @currency, @status, @retry_count, @max_retries, @version, @metadata, @created_at, @updated_at)
    `).run(row);

    return this.findById(data.id);
  }

  // Atomic compare-and-swap state transition with optimistic locking.
  // Returns number of rows changed (0 = lock conflict, lost race).
  transitionStatus(id, fromStatus, toStatus, extraFields = {}, expectedVersion) {
    const now = Date.now();
    const sets = ['status = @toStatus', 'version = @newVersion', 'updated_at = @now'];
    const params = { id, fromStatus, toStatus, newVersion: expectedVersion + 1, now };

    for (const [key, val] of Object.entries(extraFields)) {
      sets.push(`${key} = @${key}`);
      params[key] = val;
    }

    const result = this.db.prepare(`
      UPDATE payments
      SET ${sets.join(', ')}
      WHERE id = @id AND status = @fromStatus AND version = @expectedVersion
    `).run({ ...params, expectedVersion });

    return result.changes;
  }

  incrementRetryCount(id) {
    return this.db.prepare(
      'UPDATE payments SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?'
    ).run(Date.now(), id);
  }

  resetForManualRetry(id) {
    return this.db.prepare(`
      UPDATE payments
      SET status = 'pending', retry_count = 0, failure_reason = NULL,
          version = version + 1, updated_at = ?, completed_at = NULL
      WHERE id = ? AND status = 'failed'
    `).run(Date.now(), id);
  }

  list({ status, merchantId, limit = 20, offset = 0 } = {}) {
    const conditions = [];
    const params = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (merchantId) { conditions.push('merchant_id = ?'); params.push(merchantId); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM payments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    return rows.map(this._deserialize);
  }

  _deserialize(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      gatewayRef: row.gateway_ref,
      failureReason: row.failure_reason,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      version: row.version,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      processingAt: row.processing_at,
      completedAt: row.completed_at,
    };
  }
}

module.exports = Payment;
