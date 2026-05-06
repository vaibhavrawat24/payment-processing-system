'use strict';

const { v4: uuidv4 } = require('uuid');
const RetryQueueItem = require('../models/RetryQueueItem');
const logger = require('../utils/logger');

class RetryQueue {
  constructor(db, config = {}) {
    this.model = new RetryQueueItem(db);
    this.baseDelayMs = config.baseDelayMs ?? 1000;
    this.maxDelayMs = config.maxDelayMs ?? 30000;
    this.tickIntervalMs = config.tickIntervalMs ?? 1000;
    this._paymentService = null;
    this._timer = null;
  }

  // Inject PaymentService after construction to avoid circular dependency
  setPaymentService(paymentService) {
    this._paymentService = paymentService;
  }

  enqueue(paymentId, runAt = Date.now(), attempt = 1) {
    this.model.enqueue(uuidv4(), paymentId, attempt, runAt);
    logger.info({ event: 'retry_queue.enqueued', paymentId, runAt, attempt }, 'Payment enqueued');
  }

  scheduleRetry(paymentId, attempt) {
    // Exponential backoff with ±20% jitter
    const base = Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), this.maxDelayMs);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.round(base + jitter);
    const runAt = Date.now() + delay;

    logger.warn(
      { event: 'retry_queue.scheduled', paymentId, attempt, delayMs: delay, runAt },
      'Retry scheduled'
    );
    this.enqueue(paymentId, runAt, attempt);
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this.tickIntervalMs);
    // Prevent the timer from keeping the process alive in tests
    if (this._timer.unref) this._timer.unref();
    logger.info({ event: 'retry_queue.started' }, 'Retry queue worker started');
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      logger.info({ event: 'retry_queue.stopped' }, 'Retry queue worker stopped');
    }
  }

  async _tick() {
    if (!this._paymentService) return;

    const items = this.model.claimDue(10);
    await Promise.allSettled(items.map((item) => this._processItem(item)));
  }

  async _processItem(item) {
    logger.info(
      { event: 'retry_queue.processing', paymentId: item.payment_id, attempt: item.attempt },
      'Processing queued payment'
    );
    try {
      const done = await this._paymentService.processPayment(item.payment_id, item.attempt);
      if (done) {
        this.model.markDone(item.id);
      } else {
        this.model.markExhausted(item.id);
      }
    } catch (err) {
      // processPayment handles its own retries; unexpected errors here just log
      logger.error(
        { event: 'retry_queue.error', paymentId: item.payment_id, err: err.message },
        'Unexpected error in retry queue worker'
      );
      this.model.markDone(item.id);
    }
  }

  calcDelay(attempt) {
    const base = Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), this.maxDelayMs);
    return base;
  }
}

module.exports = RetryQueue;
