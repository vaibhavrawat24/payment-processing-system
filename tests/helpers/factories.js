'use strict';

const { v4: uuidv4 } = require('uuid');

function createPaymentData(overrides = {}) {
  return {
    merchantId: `merchant_${uuidv4().slice(0, 8)}`,
    amount: 1000,
    currency: 'USD',
    metadata: { orderId: 'order_123' },
    ...overrides,
  };
}

function createWebhookPayload(overrides = {}) {
  return {
    eventId: `evt_${uuidv4()}`,
    eventType: 'payment.success',
    paymentId: uuidv4(),
    payload: { gatewayRef: `gw_${uuidv4()}` },
    ...overrides,
  };
}

function createIdempotencyKey() {
  return `idem_${uuidv4()}`;
}

module.exports = { createPaymentData, createWebhookPayload, createIdempotencyKey };
