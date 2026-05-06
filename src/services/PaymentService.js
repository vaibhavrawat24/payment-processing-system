'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const IdempotencyKey = require('../models/IdempotencyKey');
const { ValidationError, NotFoundError, PaymentStateError, IdempotencyConflictError } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config');

const VALID_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'JPY']);

class PaymentService {
  constructor(db, gateway, circuitBreaker, retryQueue) {
    this.db = db;
    this.paymentModel = new Payment(db);
    this.idempotencyModel = new IdempotencyKey(db);
    this.gateway = gateway;
    this.circuitBreaker = circuitBreaker;
    this.retryQueue = retryQueue;
  }

  async createPayment(data, idempotencyKey, requestHash) {
    this._validateCreateInput(data);

    // Idempotency check
    const existing = this.idempotencyModel.findByKey(idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      logger.info(
        { event: 'payment.idempotent_hit', idempotencyKey },
        'Returning cached idempotent response'
      );
      return {
        statusCode: existing.response_status,
        body: JSON.parse(existing.response_body),
        fromCache: true,
      };
    }

    const paymentId = uuidv4();
    const payment = this.db.transaction(() => {
      const p = this.paymentModel.create({
        id: paymentId,
        merchantId: data.merchantId,
        amount: data.amount,
        currency: data.currency || 'USD',
        maxRetries: data.maxRetries ?? config.retry.maxAttempts,
        metadata: data.metadata,
      });

      const responseBody = this._formatPayment(p);
      this.idempotencyModel.create({
        key: idempotencyKey,
        paymentId,
        requestHash,
        responseStatus: 202,
        responseBody,
        ttlMs: config.idempotency.ttlMs,
      });

      return p;
    })();

    logger.info(
      { event: 'payment.created', paymentId, merchantId: data.merchantId, amount: data.amount },
      'Payment created'
    );

    // Enqueue for immediate async processing
    this.retryQueue.enqueue(paymentId, Date.now(), 1);

    return { statusCode: 202, body: this._formatPayment(payment), fromCache: false };
  }

  // Returns true if payment reached a terminal state, false if re-queued, null if skipped
  async processPayment(paymentId, attempt = 1) {
    const payment = this.paymentModel.findById(paymentId);
    if (!payment) {
      logger.error({ event: 'payment.not_found', paymentId }, 'Payment not found in queue');
      return true;
    }

    // Already in terminal state — nothing to do
    if (payment.status === 'success' || payment.status === 'failed') {
      logger.info({ event: 'payment.already_terminal', paymentId, status: payment.status }, 'Skipping terminal payment');
      return true;
    }

    // Optimistic lock: transition pending → processing
    const claimed = this.paymentModel.transitionStatus(
      paymentId, 'pending', 'processing',
      { processing_at: Date.now() },
      payment.version
    );

    if (claimed === 0) {
      // Another worker claimed it — skip silently
      logger.info({ event: 'payment.concurrency_skip', paymentId }, 'Lost race to claim payment');
      return null;
    }

    const currentPayment = this.paymentModel.findById(paymentId);
    logger.info({ event: 'payment.processing', paymentId, attempt }, 'Processing payment');

    try {
      const result = await this.circuitBreaker.execute(() =>
        this.gateway.charge({
          paymentId,
          amount: currentPayment.amount,
          currency: currentPayment.currency,
        })
      );

      if (result.success) {
        this.paymentModel.transitionStatus(
          paymentId, 'processing', 'success',
          { gateway_ref: result.ref, completed_at: Date.now() },
          currentPayment.version
        );
        logger.info(
          { event: 'payment.success', paymentId, gatewayRef: result.ref },
          'Payment succeeded'
        );
        return true;
      }

      // Non-retryable decline (card declined, etc.)
      return this._handleFailure(paymentId, currentPayment, result.code, false, attempt);

    } catch (err) {
      // Retryable errors: timeouts, network errors, circuit open
      const isRetryable = ['GATEWAY_TIMEOUT', 'CIRCUIT_OPEN'].includes(err.code);
      return this._handleFailure(paymentId, currentPayment, err.code || err.message, isRetryable, attempt);
    }
  }

  _handleFailure(paymentId, payment, reason, isRetryable, attempt) {
    const nextAttempt = attempt + 1;
    const canRetry = isRetryable && payment.retryCount < payment.maxRetries;

    if (canRetry) {
      // Transition back to pending for retry
      this.paymentModel.transitionStatus(
        paymentId, 'processing', 'pending',
        { failure_reason: reason },
        payment.version
      );
      this.paymentModel.incrementRetryCount(paymentId);
      this.retryQueue.scheduleRetry(paymentId, nextAttempt);

      logger.warn(
        { event: 'payment.retry_scheduled', paymentId, attempt: nextAttempt, reason },
        'Payment retry scheduled'
      );
      return false;
    }

    // Permanently failed
    this.paymentModel.transitionStatus(
      paymentId, 'processing', 'failed',
      { failure_reason: reason, completed_at: Date.now() },
      payment.version
    );
    logger.error(
      { event: 'payment.failed', paymentId, reason, retryCount: payment.retryCount },
      'Payment permanently failed'
    );
    return true;
  }

  getPayment(id) {
    const payment = this.paymentModel.findById(id);
    if (!payment) throw new NotFoundError('Payment');
    return this._formatPayment(payment);
  }

  listPayments({ status, merchantId, limit, offset } = {}) {
    const payments = this.paymentModel.list({ status, merchantId, limit, offset });
    return payments.map(this._formatPayment);
  }

  retryPayment(id) {
    const payment = this.paymentModel.findById(id);
    if (!payment) throw new NotFoundError('Payment');
    if (payment.status !== 'failed') {
      throw new PaymentStateError(`Cannot retry a payment in '${payment.status}' state`);
    }

    const changed = this.paymentModel.resetForManualRetry(id);
    if (changed.changes === 0) {
      throw new PaymentStateError('Payment state changed concurrently — please retry');
    }

    this.retryQueue.enqueue(id, Date.now(), 1);
    const updated = this.paymentModel.findById(id);
    logger.info({ event: 'payment.manual_retry', paymentId: id }, 'Manual retry initiated');
    return this._formatPayment(updated);
  }

  _validateCreateInput(data) {
    if (!data.merchantId || typeof data.merchantId !== 'string') {
      throw new ValidationError('merchantId is required');
    }
    if (!Number.isInteger(data.amount) || data.amount <= 0) {
      throw new ValidationError('amount must be a positive integer (in smallest currency unit)');
    }
    if (data.currency && !VALID_CURRENCIES.has(data.currency)) {
      throw new ValidationError(`currency must be one of: ${[...VALID_CURRENCIES].join(', ')}`);
    }
  }

  _formatPayment(p) {
    return {
      id: p.id,
      merchantId: p.merchantId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      gatewayRef: p.gatewayRef,
      failureReason: p.failureReason,
      retryCount: p.retryCount,
      maxRetries: p.maxRetries,
      metadata: p.metadata,
      createdAt: new Date(p.createdAt).toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
      processingAt: p.processingAt ? new Date(p.processingAt).toISOString() : null,
      completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null,
    };
  }

  static hashRequest(body) {
    return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }
}

module.exports = PaymentService;
