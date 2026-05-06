'use strict';

const WebhookHandler = require('../../src/services/WebhookHandler');
const Payment = require('../../src/models/Payment');
const { createTestDb } = require('../helpers/testDb');
const { v4: uuidv4 } = require('uuid');

function seedPayment(db, overrides = {}) {
  const model = new Payment(db);
  return model.create({
    id: uuidv4(),
    merchantId: 'merch_1',
    amount: 1000,
    currency: 'USD',
    maxRetries: 3,
    ...overrides,
  });
}

describe('WebhookHandler', () => {
  let db;
  let handler;

  beforeEach(() => {
    db = createTestDb();
    handler = new WebhookHandler(db);
  });

  afterEach(() => db.close());

  test('applies payment.success to a processing payment', () => {
    const payment = seedPayment(db);
    // Move to processing manually
    const model = new Payment(db);
    model.transitionStatus(payment.id, 'pending', 'processing', {}, 1);

    const result = handler.handleEvent({
      eventId: `evt_${uuidv4()}`,
      eventType: 'payment.success',
      paymentId: payment.id,
      payload: { gatewayRef: 'gw_abc123' },
    });

    expect(result.action).toBe('processed');
    expect(result.newStatus).toBe('success');

    const updated = model.findById(payment.id);
    expect(updated.status).toBe('success');
    expect(updated.gatewayRef).toBe('gw_abc123');
  });

  test('returns ignored for duplicate webhook with same eventId', () => {
    const payment = seedPayment(db);
    const model = new Payment(db);
    model.transitionStatus(payment.id, 'pending', 'processing', {}, 1);

    const eventId = `evt_${uuidv4()}`;
    handler.handleEvent({ eventId, eventType: 'payment.success', paymentId: payment.id, payload: {} });
    const result = handler.handleEvent({ eventId, eventType: 'payment.success', paymentId: payment.id, payload: {} });

    expect(result.action).toBe('ignored');
    expect(result.reason).toBe('duplicate');
  });

  test('detects conflict when webhook says success but payment is already failed', () => {
    const payment = seedPayment(db);
    const model = new Payment(db);
    // Manually set to failed
    model.transitionStatus(payment.id, 'pending', 'processing', {}, 1);
    model.transitionStatus(payment.id, 'processing', 'failed', { failure_reason: 'declined' }, 2);

    const result = handler.handleEvent({
      eventId: `evt_${uuidv4()}`,
      eventType: 'payment.success',
      paymentId: payment.id,
      payload: {},
    });

    expect(result.action).toBe('conflict');

    // Payment must remain failed
    const updated = model.findById(payment.id);
    expect(updated.status).toBe('failed');
  });

  test('ignores redundant webhook that matches terminal state', () => {
    const payment = seedPayment(db);
    const model = new Payment(db);
    model.transitionStatus(payment.id, 'pending', 'processing', {}, 1);
    model.transitionStatus(payment.id, 'processing', 'success', { gateway_ref: 'gw_x' }, 2);

    const result = handler.handleEvent({
      eventId: `evt_${uuidv4()}`,
      eventType: 'payment.success',
      paymentId: payment.id,
      payload: {},
    });

    expect(result.action).toBe('ignored');
  });

  test('throws ValidationError when required fields are missing', () => {
    expect(() =>
      handler.handleEvent({ eventId: null, eventType: 'payment.success', paymentId: 'x', payload: {} })
    ).toThrow('eventId, eventType, and paymentId are required');
  });

  test('ignores unknown event types gracefully', () => {
    const payment = seedPayment(db);
    const result = handler.handleEvent({
      eventId: `evt_${uuidv4()}`,
      eventType: 'payment.refunded',
      paymentId: payment.id,
      payload: {},
    });
    expect(result.action).toBe('ignored');
    expect(result.reason).toBe('unknown_event_type');
  });
});
