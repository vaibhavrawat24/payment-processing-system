'use strict';

const Payment = require('../models/Payment');
const WebhookEvent = require('../models/WebhookEvent');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

const TERMINAL_STATUSES = new Set(['success', 'failed']);

// Maps gateway event types to payment statuses
const EVENT_TO_STATUS = {
  'payment.success': 'success',
  'payment.failed': 'failed',
};

class WebhookHandler {
  constructor(db) {
    this.paymentModel = new Payment(db);
    this.webhookModel = new WebhookEvent(db);
  }

  handleEvent({ eventId, eventType, paymentId, payload }) {
    if (!eventId || !eventType || !paymentId) {
      throw new ValidationError('eventId, eventType, and paymentId are required');
    }

    const targetStatus = EVENT_TO_STATUS[eventType];
    if (!targetStatus) {
      logger.info({ event: 'webhook.unknown_type', eventId, eventType }, 'Unknown webhook event type — ignoring');
      return { action: 'ignored', reason: 'unknown_event_type' };
    }

    // Attempt to record the event (INSERT OR IGNORE)
    const recorded = this.webhookModel.create({ id: eventId, paymentId, eventType, payload });

    // INSERT was ignored → true duplicate; return early (idempotent)
    if (!recorded || recorded.status === 'processed') {
      logger.info({ event: 'webhook.duplicate', eventId }, 'Duplicate webhook — ignoring');
      return { action: 'ignored', reason: 'duplicate' };
    }

    const payment = this.paymentModel.findById(paymentId);
    if (!payment) {
      this.webhookModel.updateStatus(eventId, 'ignored');
      logger.warn({ event: 'webhook.payment_not_found', eventId, paymentId }, 'Payment not found for webhook');
      return { action: 'ignored', reason: 'payment_not_found' };
    }

    // Terminal state wins — do not allow a webhook to override a terminal payment
    if (TERMINAL_STATUSES.has(payment.status)) {
      const isConflict = payment.status !== targetStatus;
      const action = isConflict ? 'conflict' : 'ignored';
      this.webhookModel.updateStatus(eventId, action);

      if (isConflict) {
        logger.warn(
          {
            event: 'webhook.conflict',
            eventId,
            paymentId,
            currentStatus: payment.status,
            webhookStatus: targetStatus,
          },
          'Conflicting webhook state — terminal state preserved'
        );
      } else {
        logger.info({ event: 'webhook.redundant', eventId }, 'Webhook matches existing terminal state');
      }
      return { action, paymentId, currentStatus: payment.status };
    }

    // Apply the state transition
    const changed = this.paymentModel.transitionStatus(
      paymentId,
      payment.status,
      targetStatus,
      targetStatus === 'success'
        ? { gateway_ref: payload.gatewayRef || null, completed_at: Date.now() }
        : { failure_reason: payload.reason || 'gateway_callback', completed_at: Date.now() },
      payment.version
    );

    if (changed === 0) {
      // Version conflict — another operation updated the payment concurrently
      this.webhookModel.updateStatus(eventId, 'conflict');
      logger.warn(
        { event: 'webhook.version_conflict', eventId, paymentId },
        'Webhook lost optimistic lock race'
      );
      return { action: 'conflict', reason: 'version_conflict' };
    }

    this.webhookModel.updateStatus(eventId, 'processed');
    logger.info(
      { event: 'webhook.applied', eventId, paymentId, newStatus: targetStatus },
      'Webhook applied successfully'
    );
    return { action: 'processed', paymentId, newStatus: targetStatus };
  }
}

module.exports = WebhookHandler;
