'use strict';

const { createTestDb } = require('../helpers/testDb');
const PaymentService = require('../../src/services/PaymentService');
const Payment = require('../../src/models/Payment');
const RetryQueue = require('../../src/services/RetryQueue');
const CircuitBreaker = require('../../src/services/CircuitBreaker');
const { v4: uuidv4 } = require('uuid');

function makeService(gatewayImpl, maxRetries = 2) {
  const db = createTestDb();
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 99 }); // don't interfere
  const retryQueue = new RetryQueue(db, { baseDelayMs: 10, maxDelayMs: 50, tickIntervalMs: 20 });
  const service = new PaymentService(db, { charge: gatewayImpl }, circuitBreaker, retryQueue);
  retryQueue.setPaymentService(service);

  const paymentModel = new Payment(db);
  const paymentId = uuidv4();
  paymentModel.create({ id: paymentId, merchantId: 'merch_1', amount: 1000, currency: 'USD', maxRetries });

  return { service, retryQueue, paymentModel, paymentId, db };
}

describe('Retry Exhaustion', () => {
  test('payment moves to failed after all retry attempts are exhausted (timeout errors)', async () => {
    const { GatewayTimeoutError } = require('../../src/utils/errors');
    let callCount = 0;
    const alwaysTimeout = jest.fn(async () => {
      callCount++;
      throw new GatewayTimeoutError();
    });

    const { service, retryQueue, paymentModel, paymentId, db } = makeService(alwaysTimeout, 2);
    retryQueue.start();

    // First attempt
    await service.processPayment(paymentId, 1);
    expect(paymentModel.findById(paymentId).status).toBe('pending'); // scheduled for retry

    // Second attempt
    await service.processPayment(paymentId, 2);
    expect(paymentModel.findById(paymentId).status).toBe('pending');

    // Third attempt — retry count exhausted (maxRetries=2 means attempts 1,2,3 then fail)
    await service.processPayment(paymentId, 3);

    const final = paymentModel.findById(paymentId);
    expect(final.status).toBe('failed');
    expect(final.failureReason).toBe('GATEWAY_TIMEOUT');
    expect(final.retryCount).toBe(2);

    retryQueue.stop();
    db.close();
  }, 10000);

  test('payment fails immediately on non-retryable decline (no retries)', async () => {
    const alwaysDecline = jest.fn(async () => ({
      success: false,
      code: 'CARD_DECLINED',
      ref: null,
    }));

    const { service, retryQueue, paymentModel, paymentId, db } = makeService(alwaysDecline, 3);

    await service.processPayment(paymentId, 1);

    const final = paymentModel.findById(paymentId);
    expect(final.status).toBe('failed');
    expect(final.failureReason).toBe('CARD_DECLINED');
    expect(final.retryCount).toBe(0); // zero retries — non-retryable
    expect(alwaysDecline).toHaveBeenCalledTimes(1);

    retryQueue.stop();
    db.close();
  });

  test('payment succeeds on third attempt after two timeouts', async () => {
    const { GatewayTimeoutError } = require('../../src/utils/errors');
    let callCount = 0;
    const failTwiceThenSucceed = jest.fn(async () => {
      callCount++;
      if (callCount < 3) throw new GatewayTimeoutError();
      return { success: true, code: 'APPROVED', ref: 'gw_eventual_success' };
    });

    const { service, retryQueue, paymentModel, paymentId, db } = makeService(failTwiceThenSucceed, 3);

    // Simulate the queue driving the retries
    await service.processPayment(paymentId, 1); // times out → pending, retry_count=1
    await service.processPayment(paymentId, 2); // times out → pending, retry_count=2
    await service.processPayment(paymentId, 3); // succeeds

    const final = paymentModel.findById(paymentId);
    expect(final.status).toBe('success');
    expect(final.gatewayRef).toBe('gw_eventual_success');
    expect(final.retryCount).toBe(2);
    expect(callCount).toBe(3);

    retryQueue.stop();
    db.close();
  });

  test('circuit breaker open counts as retryable — payment retries later', async () => {
    const { CircuitOpenError } = require('../../src/utils/errors');
    const db = createTestDb();

    // Circuit breaker that is already open
    const openCircuit = new CircuitBreaker({ failureThreshold: 1, halfOpenAfterMs: 60000 });
    await openCircuit.execute(() => Promise.reject(new Error('trip'))).catch(() => {});
    expect(openCircuit.state).toBe('OPEN');

    const retryQueue = new RetryQueue(db, { baseDelayMs: 10, maxDelayMs: 50 });
    const service = new PaymentService(db, { charge: jest.fn() }, openCircuit, retryQueue);
    retryQueue.setPaymentService(service);

    const paymentModel = new Payment(db);
    const paymentId = uuidv4();
    paymentModel.create({ id: paymentId, merchantId: 'merch_1', amount: 500, currency: 'USD', maxRetries: 3 });

    const result = await service.processPayment(paymentId, 1);

    expect(result).toBe(false); // re-queued, not terminal
    const p = paymentModel.findById(paymentId);
    expect(p.status).toBe('pending'); // back to pending for retry
    expect(p.failureReason).toBe('CIRCUIT_OPEN');

    retryQueue.stop();
    db.close();
  });
});
