'use strict';

class WebhookEvent {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(id) || null;
  }

  create({ id, paymentId, eventType, payload }) {
    const now = Date.now();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_events (id, payment_id, event_type, payload, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, paymentId, eventType, JSON.stringify(payload), now);

    // Returns null if INSERT was ignored (duplicate), otherwise the new row
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  updateStatus(id, status) {
    this.db.prepare(
      'UPDATE webhook_events SET status = ?, processed_at = ? WHERE id = ?'
    ).run(status, Date.now(), id);
  }

  listByPayment(paymentId) {
    return this.db.prepare('SELECT * FROM webhook_events WHERE payment_id = ? ORDER BY created_at').all(paymentId);
  }
}

module.exports = WebhookEvent;
