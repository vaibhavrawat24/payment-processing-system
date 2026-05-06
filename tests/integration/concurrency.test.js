'use strict';

const createApp = require('../../src/app');
const { createTestDb } = require('../helpers/testDb');
const PaymentService = require('../../src/services/PaymentService');
const Payment = require('../../src/models/Payment');
const RetryQueue = require('../../src/services/RetryQueue');
const CircuitBreaker = require('../../src/services/CircuitBreaker');
const { createPaymentData, createIdempotencyKey } = require('../helpers/factories');
const { v4: uuidv4 } = require('uuid');

describe('Concurrency Control', () => {
  test('only one processPayment call transitions payment to processing', async () => {
    const db = createTestDb();

    // Gateway that takes a moment so concurrent calls overlap
    let gatewayCallCount = 0;
    const slowGateway = {
      charge: jest.fn(async () => {
        gatewayCallCount++;
        await new Promise((r) => setTimeout(r, 20));
        return { success: true, code: 'APPROVED', ref: 'gw_ref' };
      }),
    };

    const circuitBreaker = new CircuitBreaker({ failureThreshold: 10 });
    const retryQueue = new RetryQueue(db, { baseDelayMs: 1000 });
    const service = new PaymentService(db, slowGateway, circuitBreaker, retryQueue);
    retryQueue.setPaymentService(service);

    // Create a payment
    const paymentModel = new Payment(db);
    const paymentId = uuidv4();
    paymentModel.create({
      id: paymentId,
      merchantId: 'merch_1',
      amount: 1000,
      currency: 'USD',
      maxRetries: 3,
    });

    // Fire 5 concurrent processPayment calls
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.processPayment(paymentId, 1))
    );

    // Only one should have actually processed (the rest return null — lost the lock)
    const processed = results.filter((r) => r === true);
    const skipped = results.filter((r) => r === null);

    expect(processed.length).toBe(1);
    expect(skipped.length).toBe(4);

    // Gateway should have been called exactly once
    expect(gatewayCallCount).toBe(1);

    // Final state should be success
    const final = paymentModel.findById(paymentId);
    expect(final.status).toBe('success');

    db.close();
  });

  test('version counter increments on each state transition', () => {
    const db = createTestDb();
    const model = new Payment(db);
    const id = uuidv4();

    model.create({ id, merchantId: 'merch_1', amount: 500, currency: 'USD', maxRetries: 3 });
    const initial = model.findById(id);
    expect(initial.version).toBe(1);

    model.transitionStatus(id, 'pending', 'processing', {}, 1);
    const v2 = model.findById(id);
    expect(v2.version).toBe(2);

    model.transitionStatus(id, 'processing', 'success', {}, 2);
    const v3 = model.findById(id);
    expect(v3.version).toBe(3);

    db.close();
  });

  test('stale version update returns 0 changes', () => {
    const db = createTestDb();
    const model = new Payment(db);
    const id = uuidv4();

    model.create({ id, merchantId: 'merch_1', amount: 500, currency: 'USD', maxRetries: 3 });
    // Advance version by transitioning
    model.transitionStatus(id, 'pending', 'processing', {}, 1);

    // Try update with old version = 1 (stale)
    const changes = model.transitionStatus(id, 'processing', 'success', {}, 1);
    expect(changes).toBe(0);

    // Status must remain processing
    const payment = model.findById(id);
    expect(payment.status).toBe('processing');

    db.close();
  });
});
