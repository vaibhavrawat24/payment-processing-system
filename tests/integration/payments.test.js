'use strict';

const request = require('supertest');
const createApp = require('../../src/app');
const { createTestDb } = require('../helpers/testDb');
const { createPaymentData, createIdempotencyKey } = require('../helpers/factories');

// Deterministic gateway: always succeeds immediately
const successGateway = { charge: jest.fn().mockResolvedValue({ success: true, code: 'APPROVED', ref: 'gw_test_ref' }) };
const failGateway = { charge: jest.fn().mockResolvedValue({ success: false, code: 'CARD_DECLINED', ref: null }) };

function makeApp(gateway = successGateway) {
  const db = createTestDb();
  const app = createApp({ db, gateway, skipWorker: true });
  app._testDb = db;
  return app;
}

describe('POST /api/v1/payments', () => {
  test('creates a payment and returns 202', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', createIdempotencyKey())
      .send(createPaymentData());

    expect(res.status).toBe(202);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('pending');
    expect(res.body.amount).toBe(1000);
  });

  test('returns 400 when Idempotency-Key header is missing', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/v1/payments')
      .send(createPaymentData());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 for invalid amount', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', createIdempotencyKey())
      .send(createPaymentData({ amount: -50 }));

    expect(res.status).toBe(400);
  });

  test('returns 400 for missing merchantId', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', createIdempotencyKey())
      .send({ amount: 1000 });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/payments/:id', () => {
  test('returns 404 for unknown payment', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/v1/payments/nonexistent-id');
    expect(res.status).toBe(404);
  });

  test('returns the payment after creation', async () => {
    const app = makeApp();
    const key = createIdempotencyKey();
    const createRes = await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(createPaymentData());

    const getRes = await request(app).get(`/api/v1/payments/${createRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(createRes.body.id);
  });
});

describe('GET /api/v1/payments', () => {
  test('returns a list of payments', async () => {
    const app = makeApp();
    await request(app).post('/api/v1/payments').set('Idempotency-Key', createIdempotencyKey()).send(createPaymentData());
    await request(app).post('/api/v1/payments').set('Idempotency-Key', createIdempotencyKey()).send(createPaymentData());

    const res = await request(app).get('/api/v1/payments');
    expect(res.status).toBe(200);
    expect(res.body.payments.length).toBeGreaterThanOrEqual(2);
  });

  test('filters by status', async () => {
    const app = makeApp();
    await request(app).post('/api/v1/payments').set('Idempotency-Key', createIdempotencyKey()).send(createPaymentData());

    const res = await request(app).get('/api/v1/payments?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.payments.every((p) => p.status === 'pending')).toBe(true);
  });
});

describe('POST /api/v1/payments/:id/retry', () => {
  test('returns 422 when trying to retry a pending payment', async () => {
    const app = makeApp();
    const createRes = await request(app)
      .post('/api/v1/payments')
      .set('Idempotency-Key', createIdempotencyKey())
      .send(createPaymentData());

    const retryRes = await request(app).post(`/api/v1/payments/${createRes.body.id}/retry`);
    expect(retryRes.status).toBe(422);
    expect(retryRes.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  test('returns 404 for unknown payment', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/v1/payments/no-such-id/retry');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/health', () => {
  test('returns ok', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
