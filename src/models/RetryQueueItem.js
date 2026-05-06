'use strict';

class RetryQueueItem {
  constructor(db) {
    this.db = db;
  }

  enqueue(id, paymentId, attempt, runAt) {
    const now = Date.now();
    // REPLACE handles the UNIQUE constraint on payment_id — reschedules existing entry
    this.db.prepare(`
      INSERT OR REPLACE INTO retry_queue (id, payment_id, attempt, run_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'scheduled', ?, ?)
    `).run(id, paymentId, attempt, runAt, now, now);
  }

  // Claim up to `limit` due jobs atomically — returns claimed rows
  claimDue(limit = 10) {
    const now = Date.now();
    const due = this.db.prepare(`
      SELECT * FROM retry_queue
      WHERE status = 'scheduled' AND run_at <= ?
      ORDER BY run_at ASC
      LIMIT ?
    `).all(now, limit);

    const claimed = [];
    for (const row of due) {
      const result = this.db.prepare(`
        UPDATE retry_queue SET status = 'running', updated_at = ?
        WHERE id = ? AND status = 'scheduled'
      `).run(Date.now(), row.id);
      if (result.changes === 1) claimed.push(row);
    }
    return claimed;
  }

  markDone(id) {
    this.db.prepare(
      "UPDATE retry_queue SET status = 'done', updated_at = ? WHERE id = ?"
    ).run(Date.now(), id);
  }

  markExhausted(id) {
    this.db.prepare(
      "UPDATE retry_queue SET status = 'exhausted', updated_at = ? WHERE id = ?"
    ).run(Date.now(), id);
  }

  findByPaymentId(paymentId) {
    return this.db.prepare('SELECT * FROM retry_queue WHERE payment_id = ?').get(paymentId) || null;
  }
}

module.exports = RetryQueueItem;
